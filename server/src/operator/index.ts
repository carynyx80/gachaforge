import { formatEther, parseEther, parseEventLogs, type Hex } from 'viem';
import { tokenAbi, vaultAbi } from '../abi/index.js';
import type { ChainCtx } from '../chain.js';
import type { Config } from '../config.js';
import type { HolderBalance } from '../core/snapshot.js';
import { excludedFor } from '../indexer/excluded.js';
import type { Ledger } from '../ledger.js';
import { now } from '../ledger.js';
import type { Logger } from '../log.js';
import type { CardProvider } from '../renaiss/provider.js';
import type { Machine } from '../types.js';
import { planDividend, planPull } from './settle.js';

/**
 * Operator loop: for each machine, open a pull when pot >= pack cost, buy the pack from the
 * card provider, then raffle (RAFFLE/HIT_HUNTER) or sell back + deposit (+ merkle root for DIVIDEND/SPLIT).
 */
export class Operator {
  private timer: NodeJS.Timeout | null = null;
  private busy = new Set<string>();

  constructor(
    private cfg: Config,
    private chain: ChainCtx,
    private ledger: Ledger,
    private provider: CardProvider,
    private log: Logger,
  ) {}

  start() {
    if (!this.chain.walletClient || !this.chain.account) {
      this.log.warn({}, 'operator disabled (OPERATOR_ENABLED=false or no OPERATOR_PRIVATE_KEY): indexer-only');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.cfg.OPERATOR_POLL_MS);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    for (const m of await this.ledger.repo.listMachines()) {
      if (this.busy.has(m.address)) continue;
      this.busy.add(m.address);
      this.processMachine(m)
        .catch((err) => this.log.error({ err, machine: m.address }, 'operator: machine failed'))
        .finally(() => this.busy.delete(m.address));
    }
  }

  private read<T>(address: string, functionName: string, args: unknown[] = [], blockNumber?: bigint): Promise<T> {
    return this.chain.publicClient.readContract({ address: address as Hex, abi: vaultAbi, functionName: functionName as any, args: args as any, blockNumber }) as Promise<T>;
  }

  private async write(address: string, functionName: string, args: unknown[] = [], value?: bigint) {
    const wc = this.chain.walletClient!;
    const hash = await wc.writeContract({
      address: address as Hex,
      abi: vaultAbi,
      functionName: functionName as any,
      args: args as any,
      value,
      chain: this.chain.chain,
      account: this.chain.account!,
    } as any);
    const receipt = await this.chain.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted: ${hash}`);
    return receipt;
  }

  async processMachine(m: Machine) {
    const v = m.vault;
    // vault.canOpenPull() covers: no open pull, factory not paused, cooldown, projected pot >= Chainlink pack price.
    if (!(await this.read<boolean>(v, 'canOpenPull'))) return;
    const amount = await this.read<bigint>(v, 'maxPullAmount'); // price * 1.10 slippage buffer

    // 1. open pull: vault sends `amount` BNB from the pot to factory.paymentReceiver
    const receipt = await this.write(v, 'openPull', [amount]);
    const [opened] = parseEventLogs({ abi: vaultAbi, eventName: 'PullOpened', logs: receipt.logs });
    if (!opened) throw new Error('PullOpened not found in receipt');
    const { pullId, amountSent, priceBnb, paymentReceiver } = opened.args;
    const snapshotBlock = receipt.blockNumber; // holders snapshotted at the open block
    const pullKey = `${m.address}-${pullId}`;
    this.log.info({ machine: m.address, pullId: pullId.toString() }, 'pull opened');

    // 2. buy the pack from Renaiss
    const bought = await this.provider.buyPack(m.pack, receipt.transactionHash);
    const card = bought.card;
    const cardValueWholeUsd = Math.floor(card.valueUsd); // contract compares whole USD
    await this.ledger.repo.upsertPull({
      id: pullKey,
      machine: m.address,
      ticker: m.ticker,
      pack: m.pack,
      round: Number(pullId),
      card: { name: card.name, set: card.set, grader: card.grader, grade: card.grade, image: card.image, valueUsd: card.valueUsd },
      result: 'SOLD', // provisional; RaffleRecorded / ProceedsDeposited (indexer) finalise
      txHash: receipt.transactionHash,
      timestamp: now(),
    });

    // 3. settle: leftover slippage buffer returns to the pot.
    // TODO(renaiss): real refund amount once we know what Renaiss charges; assumes the operator
    // wallet is the payment receiver and paid exactly priceBnb.
    const operatorIsReceiver = paymentReceiver.toLowerCase() === this.chain.account!.address.toLowerCase();
    const refund = operatorIsReceiver && amountSent > priceBnb ? amountSent - priceBnb : 0n;
    await this.write(v, 'settlePull', [pullId, refund, BigInt(cardValueWholeUsd)], refund);

    // 4. snapshot holders at the open block and decide
    const block = await this.chain.publicClient.getBlock({ blockNumber: snapshotBlock });
    const totalSupply = (await this.chain.publicClient.readContract({ address: m.address as Hex, abi: tokenAbi, functionName: 'totalSupply', blockNumber: snapshotBlock })) as bigint;
    const balances = await this.snapshotBalances(m.address, snapshotBlock);
    const excluded = await excludedFor(this.ledger.repo, m, [this.chain.factory, this.chain.portal, this.chain.vaultPortal, ...this.cfg.EXCLUDED_ADDRESSES]);
    const plan = planPull({ machine: m, card: { valueUsd: cardValueWholeUsd }, balances, totalSupply, excluded, blockHash: block.hash!, pullId, pullKey, snapshotBlock });
    await this.ledger.repo.setRaffleProof(plan.proof);

    if (plan.outcome === 'RAFFLE' && plan.winner) {
      await this.write(v, 'recordRaffle', [pullId, snapshotBlock, plan.snapshotHash, plan.seed, plan.winner]);
      await this.provider.transferCard?.(card.id, plan.winner);
      this.log.info({ pullKey, winner: plan.winner }, 'raffle recorded');
      return;
    }

    // 5. sell back → deposit proceeds (vault routes by strategy into pot/dividend/burn/lp buckets)
    const sold = await this.provider.sellBack(card.id);
    // TODO(renaiss): Renaiss may pay out in BNB directly; until then convert at the configured price.
    const proceedsWei = parseEther((sold.proceedsUsd / this.cfg.BNB_USD_PRICE).toFixed(18));
    await this.write(v, 'depositProceeds', [pullId], proceedsWei);

    // 6. spend burn / LP reserves. TODO: compute minOut from a router quote (currently 0 = no slippage guard).
    const burnReserve = await this.read<bigint>(v, 'burnReserve');
    if (burnReserve > 0n) await this.write(v, 'buybackAndBurn', [burnReserve, 0n]);
    const lpReserve = await this.read<bigint>(v, 'lpReserve');
    if (lpReserve > 0n) await this.write(v, 'addLiquidityLocked', [lpReserve, 0n, 0n, 0n]);

    // 7. dividends: merkle root over eligible holders (roundId = pullId), auto-push large claims
    if (m.strategy === 'DIVIDEND' || m.strategy === 'SPLIT') {
      const d = planDividend({ machine: m, proceedsWei, eligible: plan.eligible, autoPushMinWei: parseEther(String(this.cfg.AUTO_PUSH_MIN_BNB)) });
      if (d.tree) {
        const roundId = pullId;
        await this.write(v, 'setDividendRoot', [roundId, d.tree.root, d.tree.total]);
        await this.ledger.repo.saveDividendClaims(
          d.tree.claims.map((c) => ({ machine: m.address, epoch: Number(roundId), root: d.tree!.root, wallet: c.address, amountWei: c.amount.toString(), proof: c.proof, pushed: false })),
        );
        for (const c of d.tree.claims) await this.ledger.repo.creditRewards(m.address, c.address, Number(formatEther(c.amount)));
        const byAddr = new Map(d.tree.claims.map((c) => [c.address, c]));
        for (const a of d.autoPush.slice(0, 50)) {
          const c = byAddr.get(a.address)!;
          try {
            await this.write(v, 'pushClaim', [roundId, c.address, c.amount, c.proof]);
            await this.ledger.repo.markClaimPushed(m.address, Number(roundId), c.address);
          } catch (err) {
            this.log.warn({ err, wallet: c.address }, 'pushClaim failed; holder can still claim');
          }
        }
        // DividendClaimed events debit claimable via the indexer.
      }
    }
  }

  /** Historical balances at the snapshot block (needs archive RPC); falls back to indexed balances. */
  private async snapshotBalances(token: string, blockNumber: bigint): Promise<HolderBalance[]> {
    const known = await this.ledger.repo.getBalances(token);
    if (!known.length) return [];
    try {
      const res = await this.chain.publicClient.multicall({
        contracts: known.map((h) => ({ address: token as Hex, abi: tokenAbi, functionName: 'balanceOf', args: [h.address as Hex] }) as const),
        blockNumber,
        allowFailure: false,
      });
      return known.map((h, i) => ({ address: h.address, balance: res[i] as bigint }));
    } catch (err) {
      this.log.warn({ err, token }, 'archive balanceOf failed; using indexed balances');
      return known;
    }
  }
}
