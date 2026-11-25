import type { Hex } from 'viem';
import { taxProcessorAbi, tokenAbi, vaultAbi } from '../abi/index.js';
import type { ChainCtx } from '../chain.js';
import type { Indexer } from '../indexer/index.js';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../log.js';

/**
 * Periodic keeper:
 *  - reconciles potUsd from vault.pot()
 *  - reconciles stage/progress/pool from Portal.getTokenV8Safe
 *  - post-graduation, pokes the flap.sh tax processor's permissionless dispatch()
 *    when it holds pending tax for our vault (marketQuoteBalance > 0), so the pot updates.
 * Note: per docs/flap-integration.md, dispatch() lives on token.taxProcessor(), not the token itself.
 */
export class Keeper {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private chain: ChainCtx,
    private ledger: Ledger,
    private indexer: Indexer,
    private log: Logger,
    private bnbUsd: number,
    private intervalMs = 60_000,
    private minPendingWei = 0n,
  ) {}

  start() {
    const run = () => void this.tick().catch((err) => this.log.error({ err }, 'keeper tick failed'));
    run();
    this.timer = setInterval(run, this.intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const pc = this.chain.publicClient;
    for (const m of await this.ledger.repo.listMachines()) {
      await this.indexer.syncFlapState(m.address).catch((err) => this.log.debug({ err, token: m.address }, 'getTokenV8Safe failed'));
      // split any tax that arrived since the last sync (curve-phase tax lands directly in the vault)
      await this.syncVault(m.vault as Hex);
      // reconcile pot with the vault's on-chain bucket
      await pc
        .readContract({ address: m.vault as Hex, abi: vaultAbi, functionName: 'pot' })
        .then((pot) => this.ledger.updateMachine(m.address, () => ({ potUsd: Math.round((Number(pot as bigint) / 1e18) * this.bnbUsd * 100) / 100 })))
        .catch((err) => this.log.debug({ err, vault: m.vault }, 'pot() read failed'));
      const fresh = await this.ledger.repo.getMachine(m.address);
      if (fresh?.stage !== 'GRADUATED' || !this.chain.walletClient) continue;
      try {
        const processor = (await pc.readContract({ address: m.address as Hex, abi: tokenAbi, functionName: 'taxProcessor' })) as Hex;
        const pending = (await pc.readContract({ address: processor, abi: taxProcessorAbi, functionName: 'marketQuoteBalance' })) as bigint;
        if (pending <= this.minPendingWei) continue;
        const hash = await this.chain.walletClient.writeContract({ address: processor, abi: taxProcessorAbi, functionName: 'dispatch', chain: this.chain.chain, account: this.chain.account! });
        await pc.waitForTransactionReceipt({ hash });
        this.log.info({ token: m.address, pending: pending.toString(), hash }, 'dispatched pending tax');
        await this.syncVault(m.vault as Hex);
      } catch (err) {
        this.log.warn({ err, token: m.address }, 'dispatch failed');
      }
    }
  }

  /**
   * The vault's receive() only accepts BNB; the 70/20/10 split happens in the permissionless
   * sync(). Call it whenever the vault holds more BNB than its tracked buckets.
   */
  async syncVault(vault: Hex) {
    if (!this.chain.walletClient) return;
    const pc = this.chain.publicClient;
    try {
      const [bal, tracked] = await Promise.all([
        pc.getBalance({ address: vault }),
        pc.readContract({ address: vault, abi: vaultAbi, functionName: 'trackedBalance' }) as Promise<bigint>,
      ]);
      if (bal <= tracked) return;
      const hash = await this.chain.walletClient.writeContract({ address: vault, abi: vaultAbi, functionName: 'sync', chain: this.chain.chain, account: this.chain.account! });
      await pc.waitForTransactionReceipt({ hash });
      this.log.info({ vault, fresh: (bal - tracked).toString(), hash }, 'synced vault tax');
    } catch (err) {
      this.log.warn({ err, vault }, 'vault sync failed');
    }
  }
}
