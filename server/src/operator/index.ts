import { formatEther, parseEther, parseEventLogs, type Hex } from 'viem';
import { tokenAbi, vaultAbi } from '../abi/index.js';
import type { ChainCtx } from '../chain.js';
import type { Config } from '../config.js';
import type { HolderBalance } from '../core/snapshot.js';
import { excludedFor } from '../indexer/excluded.js';
import type { Ledger } from '../ledger.js';
import { now } from '../ledger.js';
import type { Logger } from '../log.js';
import type { CardProvider } from '../renaiss/types.js';
import { summaryCard } from '../renaiss/types.js';
import { refundFor, SimulatedSwapper, usdtToBuy, type Swapper } from '../swap/pancake.js';
import { enqueueCardReleases } from './release.js';
import type { Machine } from '../types.js';
import { planDividend, planPull } from './settle.js';

/**
 * Operator loop: for each machine, open a pull when pot >= pack cost (vault sends ≤ price+10% BNB to the operator),
 * swap just enough BNB→USDT, buy the pack from the card provider (Renaiss: Permit2-signed USDT pull), refund unspent
 * BNB via settlePull, then raffle (card delivered after the provider's release window) or sell back → USDT→BNB →
 * depositProceeds (+ merkle root for DIVIDEND/SPLIT).
 */
export class Operator {
  private timer: NodeJS.Timeout | null = null;
  private busy = new Set<string>();
  private lock: Promise<unknown> = Promise.resolve();
  private swapper: Swapper;

  constructor(
    private cfg: Config,
    private chain: ChainCtx,
    private ledger: Ledger,
    private provider: CardProvider,
    private log: Logger,
    swapper?: Swapper,
  ) {
    this.swapper = swapper ?? new SimulatedSwapper(cfg.BNB_USD_PRICE);
  }

  /** Serialises operator-wallet USDT work (swap → buy, sell-back → swap) across machines. */
  private walletLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

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

    // 2. fund + buy under the wallet lock (USDT balance and swaps are shared across machines)
    const bought = await this.walletLock(async () => {
      try {
      const cost = await this.provider.packCost(m.pack);
      const balance = await this.swapper.usdtBalance();
      const toBuy = usdtToBuy(cost.usdt, balance, this.cfg.SWAP_USDT_BUFFER_BPS);
      const swap = toBuy > 0n ? await this.swapper.buyExactUsdt(toBuy, amountSent) : { bnb: 0n, usdt: 0n };
      const result = await this.provider.buyPack(m.pack, {
        onSubmitted: (requestId) => this.ledger.repo.setMeta(`provider-request:${pullKey}`, requestId),
      });
        return { ...result, bnbSpent: swap.bnb };
      } catch (err) {
        // The pull stays OPEN on-chain; provider-request:<pullKey> meta (if set) is the Renaiss requestId to recover.
        this.log.error({ err, pullKey, requestId: await this.ledger.repo.getMeta(`provider-request:${pullKey}`) }, 'pack purchase failed; pull left OPEN for manual recovery');
        throw err;
      }
    });
    const cards = bought.cards;
    const card = summaryCard(cards);
    const cardValueWholeUsd = Math.floor(card.valueUsd); // contract compares whole USD
    await this.ledger.repo.upsertPull({
      id: pullKey,
      machine: m.address,
      ticker: m.ticker,
      pack: m.pack,
      round: Number(pullId),
      card,
      result: 'SOLD', // provisional; RaffleRecorded / ProceedsDeposited (indexer) finalise
      txHash: receipt.transactionHash,
      timestamp: now(),
    });

    // 3. settle: BNB from openPull that the swap did not spend returns to the pot.
    const operatorIsReceiver = paymentReceiver.toLowerCase() === this.chain.account!.address.toLowerCase();
    const refund = operatorIsReceiver ? refundFor(amountSent, bought.bnbSpent) : 0n;
    if (!operatorIsReceiver) this.log.warn({ pullKey, paymentReceiver }, 'paymentReceiver is not the operator wallet; no refund');
    this.log.info({ pullKey, priceBnb: priceBnb.toString(), amountSent: amountSent.toString(), spent: bought.bnbSpent.toString(), refund: refund.toString(), cards: cards.length }, 'pack bought');
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
      // Every card of the pull goes to the winner once the provider releases it (Renaiss: after 72h).
      await enqueueCardReleases(this.ledger, { pullKey, machine: m.address, ticker: m.ticker, winner: plan.winner, cards });
      this.log.info({ pullKey, winner: plan.winner, cards: cards.length }, 'raffle recorded; delivery queued');
      return;
    }

    // A HIT_HUNTER hit with no eligible holder must be published on-chain before the vault allows a sell-back.
    if (m.strategy === 'HIT_HUNTER' && cardValueWholeUsd > m.packPriceUsd) {
      await this.write(v, 'recordNoEligible', [pullId, snapshotBlock, plan.snapshotHash]);
      this.log.info({ pullKey }, 'hit had no eligible holder; recorded before sell-back');
    }

    // 5. sell back → deposit proceeds (vault routes by strategy into pot/dividend/burn/lp buckets)
    // Every card of the pull is sold back in one signed batch (same pack); USDT proceeds → BNB → vault.
    const { sold, proceedsWei } = await this.walletLock(async () => {
      const sold = await this.provider.sellBack(cards);
      const swap = await this.swapper.sellUsdt(sold.proceedsUsdt);
      return { sold, proceedsWei: swap.bnb };
    });
    this.log.info({ pullKey, proceedsUsdt: sold.proceedsUsdt.toString(), proceedsWei: proceedsWei.toString(), txRef: sold.txRef }, 'sold back');
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
