/**
 * Multi-token indexer for OFF-CHAIN MODE (generalises the $FORGE indexer to N registered tokens).
 * One shared scanner walks blocks with an adaptive range (public-RPC friendly) and per chunk fetches:
 *   - Portal logs once (TokenCreated → auto-detect candidates; TokenBought/TokenSold/LaunchedToDEX/progress/re-route for
 *     registered tokens; Portal event fields are not indexed, so this is one unfiltered call per chunk)
 *   - token Transfer + pair Swap logs with batched address filters (LOGS_ADDRESS_BATCH addresses per call)
 * Newly registered tokens start at their creation block and are caught up on their own until they reach the shared
 * cursor, then join it (each log is applied exactly once per token: holder balances are additive).
 */
import { formatEther, type Hex } from 'viem';
import { portalAbi } from '../abi/flap.js';
import { selectEligible } from '../core/snapshot.js';
import { TOTAL_SUPPLY_DEFAULT } from '../core/packs.js';
import { pairAbi, swapEvent, transferEvent } from '../forge/chain.js';
import { decodePairSwap } from '../forge/math.js';
import { AdaptiveRange, DEFAULT_SCAN, mapLimit, scanRange, type ScanOptions } from '../forge/scan.js';
import { addPool, excludedFor } from '../indexer/excluded.js';
import type { Ledger } from '../ledger.js';
import { round2 } from '../ledger.js';
import type { Logger } from '../log.js';
import type { OffchainLedger } from './ledger.js';
import type { OffchainStore } from './store.js';
import type { Candidate, Registration } from './types.js';

export type AnyLog = { address: string; eventName?: string; args?: any; blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null };

/** Subset of viem's PublicClient (tests pass a fake). */
export interface IndexerClient {
  getBlockNumber(): Promise<bigint>;
  getLogs(p: any): Promise<any[]>;
  readContract(p: any): Promise<any>;
  getTransaction(p: { hash: Hex }): Promise<{ from: Hex }>;
  getBlock(p: { blockNumber: bigint }): Promise<{ timestamp: bigint; hash: Hex | null }>;
}

export interface IndexerOptions {
  portal: string;
  vaultPortal: string;
  startBlock?: bigint;
  maxRange: number;
  addressBatch: number;
  /** Blocks behind head to stay (shallow BSC reorgs). */
  confirmations?: number;
  excluded: string[];
  scan?: Partial<ScanOptions>;
}

const CURSOR = 'offchain:cursor';
const CANDIDATES = 'offchain:candidates';
const ZERO = '0x0000000000000000000000000000000000000000';
const lc = (a: string) => a.toLowerCase();
const eq = (a?: string | null, b?: string | null) => !!a && !!b && lc(a) === lc(b);
const byChainOrder = (a: AnyLog, b: AnyLog) => (a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : a.blockNumber! < b.blockNumber! ? -1 : 1);
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const portalEvents = portalAbi.filter((x) => x.type === 'event' && ['TokenCreated', 'TokenBought', 'TokenSold', 'LaunchedToDEX', 'FlapTokenProgressChanged', 'TaxTokenAddressesUpdated'].includes(x.name));

export class OffchainIndexer {
  private range: AdaptiveRange;
  private scanOpts: ScanOptions;
  private running = false;
  private blockTs = new Map<bigint, number>();

  constructor(
    private client: IndexerClient,
    private store: OffchainStore,
    private accounts: OffchainLedger,
    private log: Logger,
    private o: IndexerOptions,
  ) {
    this.scanOpts = {
      ...DEFAULT_SCAN,
      maxRange: o.maxRange,
      initialRange: Math.min(DEFAULT_SCAN.initialRange, o.maxRange),
      onError: (err, from, to, attempt) => log.warn({ err: (err as Error)?.message?.slice(0, 200), from: String(from), to: String(to), attempt }, 'offchain getLogs failed; shrinking range + backing off'),
      ...o.scan,
    };
    this.range = new AdaptiveRange(this.scanOpts);
  }

  private get ledger(): Ledger {
    return this.accounts.ledger;
  }
  private get repo() {
    return this.ledger.repo;
  }

  async cursor(): Promise<bigint | null> {
    const v = await this.repo.getMeta(CURSOR);
    return v ? BigInt(v) : null;
  }

  /** Safe head (latest − confirmations). */
  async head() {
    const latest = await this.client.getBlockNumber();
    const c = BigInt(this.o.confirmations ?? 2);
    return latest > c ? latest - c : latest;
  }

  /** One pass: catch up lagging tokens, then advance the shared cursor to the safe head. Never throws. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const head = await this.head();
      let cursor = await this.cursor();
      if (cursor === null) {
        cursor = (this.o.startBlock ?? head) - 1n;
        await this.repo.setMeta(CURSOR, cursor.toString());
        this.log.info({ from: String(cursor + 1n) }, 'offchain indexer: starting');
      }
      for (const r of await this.store.listRegistrations()) {
        // Created after the cursor and nothing applied yet: it can join the shared scan right away.
        if (BigInt(r.syncedTo) > cursor && r.syncedTo === r.createdBlock - 1) await this.store.saveRegistration({ ...r, syncedTo: Number(cursor) });
        else if (BigInt(r.syncedTo) < cursor) await this.catchUp(r.token, cursor);
      }
      if (cursor < head) await this.advance(cursor + 1n, head);
      // A token that was ahead of the cursor (e.g. crash between saves) is behind now: catch it up.
      const now = (await this.cursor())!;
      for (const r of await this.store.listRegistrations()) if (BigInt(r.syncedTo) < now) await this.catchUp(r.token, now);
    } catch (err) {
      this.log.error({ err: (err as Error)?.message ?? err }, 'offchain indexer tick failed');
    } finally {
      this.running = false;
    }
  }

  /** Replays one token's history from its own syncedTo up to `to` (the shared cursor). */
  async catchUp(token: string, to: bigint) {
    const reg = await this.store.getRegistration(token);
    if (!reg || BigInt(reg.syncedTo) >= to) return;
    const range = new AdaptiveRange(this.scanOpts);
    await scanRange(
      BigInt(reg.syncedTo) + 1n,
      to,
      (a, b) => this.fetch(a, b, [reg.token], false),
      async (logs, _a, b) => {
        await this.apply(logs, [reg.token], false);
        const fresh = (await this.store.getRegistration(token))!;
        fresh.syncedTo = Number(b);
        await this.store.saveRegistration(fresh);
      },
      range,
      this.scanOpts,
    );
    this.log.info({ token, to: String(to) }, 'offchain indexer: token caught up');
  }

  private async advance(from: bigint, to: bigint) {
    await scanRange(
      from,
      to,
      async (a, b) => {
        const live = (await this.store.listRegistrations()).filter((r) => BigInt(r.syncedTo) === a - 1n).map((r) => r.token);
        return { live, logs: await this.fetch(a, b, live, true) };
      },
      async ({ live, logs }, _a, b) => {
        await this.apply(logs, live, true);
        for (const t of live) {
          const r = await this.store.getRegistration(t);
          if (r) await this.store.saveRegistration({ ...r, syncedTo: Number(b) });
        }
        await this.repo.setMeta(CURSOR, b.toString());
      },
      this.range,
      this.scanOpts,
    );
  }

  /** Fetches and merges every log we need for [a, b] for `tokens` (+ Portal TokenCreated when `discover`). */
  async fetch(a: bigint, b: bigint, tokens: string[], discover: boolean): Promise<AnyLog[]> {
    const regs = (await Promise.all(tokens.map((t) => this.store.getRegistration(t)))).filter((r): r is Registration => !!r);
    const want = new Set(regs.map((r) => r.token));
    const portalP = want.size || discover ? this.client.getLogs({ address: this.o.portal, events: portalEvents, fromBlock: a, toBlock: b }) : Promise.resolve([]);
    const addrs = [...regs.map((r) => r.token), ...regs.map((r) => r.pool).filter((p): p is string => !!p)];
    const batches = chunk(addrs, this.o.addressBatch);
    const [portalLogs, ...others] = (await Promise.all([
      portalP,
      ...batches.map((batch) => this.client.getLogs({ address: batch, events: [transferEvent, swapEvent], fromBlock: a, toBlock: b })),
    ])) as AnyLog[][];
    const pools = new Map(regs.filter((r) => r.pool).map((r) => [lc(r.pool!), r.token]));
    const logs: AnyLog[] = [
      ...portalLogs.filter((l) => (discover && l.eventName === 'TokenCreated') || (l.args?.token && want.has(lc(l.args.token)))),
      ...others.flat().filter((l) => (l.eventName === 'Transfer' && want.has(lc(l.address))) || (l.eventName === 'Swap' && pools.has(lc(l.address)))),
    ];
    // Graduated inside this chunk: the pair was not in the address list yet.
    for (const g of logs.filter((l) => l.eventName === 'LaunchedToDEX')) {
      const pool = g.args?.pool as string | undefined;
      if (!pool || eq(pool, ZERO) || pools.has(lc(pool))) continue;
      const swaps = (await this.client.getLogs({ address: pool, event: swapEvent, fromBlock: g.blockNumber!, toBlock: b })) as AnyLog[];
      logs.push(...swaps);
    }
    return logs.sort(byChainOrder);
  }

  /** Applies decoded logs (chain order) for `tokens`. Exposed for tests. */
  async apply(logs: AnyLog[], tokens: string[], discover: boolean) {
    const want = new Set(tokens.map(lc));
    const regs = new Map<string, Registration>();
    for (const t of want) {
      const r = await this.store.getRegistration(t);
      if (r) regs.set(t, r);
    }
    const poolOf = new Map<string, string>();
    for (const r of regs.values()) if (r.pool) poolOf.set(lc(r.pool), r.token);
    // Pools that appear (graduation) inside this chunk.
    for (const l of logs) if (l.eventName === 'LaunchedToDEX' && l.args?.pool && want.has(lc(l.args.token))) poolOf.set(lc(l.args.pool), lc(l.args.token));
    // Portal trade txs per token: pair Swaps in the same tx are the same trade routed via the Portal.
    const portalTx = new Set(logs.filter((l) => l.eventName === 'TokenBought' || l.eventName === 'TokenSold').map((l) => `${lc(l.args.token)}|${l.transactionHash}`));
    const swapHashes = [...new Set(logs.filter((l) => l.eventName === 'Swap').map((l) => l.transactionHash!))];
    const froms = new Map<string, string>();
    await mapLimit(swapHashes, 4, async (h) => {
      const f = await this.client
        .getTransaction({ hash: h as Hex })
        .then((t) => t.from)
        .catch(() => null);
      if (f) froms.set(h, f);
    });
    const touched = new Set<string>();
    const dirty = new Set<string>();
    const candidates: Candidate[] = [];

    for (const l of logs) {
      const a = l.args ?? {};
      try {
        switch (l.eventName) {
          case 'TokenCreated': {
            if (!discover || !a.token) break;
            const t = lc(a.token);
            if (await this.store.getRegistration(t)) break;
            candidates.push({ token: t, txHash: l.transactionHash!, block: Number(l.blockNumber), ts: a.ts ? Number(a.ts) : await this.ts(l.blockNumber!) });
            break;
          }
          case 'TokenBought':
          case 'TokenSold': {
            const t = lc(a.token);
            if (!regs.has(t)) break;
            const side = l.eventName === 'TokenBought' ? 'BUY' : 'SELL';
            await this.accounts.recordTrade(t, {
              ref: `${l.transactionHash}:${l.logIndex}`,
              tradeWei: a.eth as bigint,
              side,
              trader: side === 'BUY' ? a.buyer : a.seller,
              amountBnb: Number(formatEther(a.eth)),
              tokens: Number(formatEther(a.amount)),
              taxUsd: 0,
              txHash: l.transactionHash!,
              timestamp: a.ts ? Number(a.ts) : await this.ts(l.blockNumber!),
            });
            dirty.add(t);
            break;
          }
          case 'FlapTokenProgressChanged': {
            const t = lc(a.token);
            if (!regs.has(t)) break;
            await this.ledger.updateMachine(t, (m) => (m.stage === 'CURVE' ? { bondingCurvePct: Math.min(100, round2(Number(formatEther(a.newProgress)) * 100)) } : {}));
            break;
          }
          case 'LaunchedToDEX': {
            const t = lc(a.token);
            const r = regs.get(t);
            if (!r) break;
            const pool = lc(a.pool);
            r.pool = pool;
            r.tokenIsToken0 = await this.client
              .readContract({ address: pool, abi: pairAbi, functionName: 'token0' })
              .then((t0: string) => eq(t0, t))
              .catch(() => undefined);
            await this.store.saveRegistration({ ...(await this.store.getRegistration(t))!, pool, tokenIsToken0: r.tokenIsToken0 });
            await addPool(this.repo, t, pool);
            await this.ledger.updateMachine(t, () => ({ stage: 'GRADUATED', bondingCurvePct: 100 }));
            this.log.info({ token: t, pool }, 'machine graduated to PancakeSwap');
            break;
          }
          case 'TaxTokenAddressesUpdated': {
            const t = lc(a.token);
            if (!regs.has(t)) break;
            const detail = `beneficiary=${a.beneficiary} feeReceiver=${a.feeReceiver}`;
            this.log.warn({ token: t, detail, tx: l.transactionHash }, 'ALERT: flap.sh admin re-routed tax recipient');
            const alerts = JSON.parse((await this.repo.getMeta('alerts')) ?? '[]');
            alerts.push({ token: t, event: l.eventName, detail, txHash: l.transactionHash, timestamp: Math.floor(Date.now() / 1000) });
            await this.repo.setMeta('alerts', JSON.stringify(alerts.slice(-200)));
            const m = await this.repo.getMachine(t);
            if (m) await this.ledger.activity(m, 'TAX', `⚠ tax recipient re-routed by flap.sh admin (${detail})`);
            break;
          }
          case 'Transfer': {
            const t = lc(l.address);
            if (!regs.has(t)) break;
            await this.repo.applyTransfer(t, a.from, a.to, a.value);
            touched.add(t);
            break;
          }
          case 'Swap': {
            const t = poolOf.get(lc(l.address));
            const r = t ? regs.get(t) : undefined;
            if (!t || !r) break;
            if (portalTx.has(`${t}|${l.transactionHash}`)) break;
            // flap's own tax liquidation (token/processor selling accumulated tax) is not a user trade.
            if (eq(a.to, t) || eq(a.to, r.taxProcessor) || eq(a.sender, r.taxProcessor)) break;
            if (r.tokenIsToken0 === undefined) {
              r.tokenIsToken0 = await this.client
                .readContract({ address: l.address, abi: pairAbi, functionName: 'token0' })
                .then((t0: string) => eq(t0, t))
                .catch(() => undefined);
              if (r.tokenIsToken0 === undefined) break;
              await this.store.saveRegistration({ ...(await this.store.getRegistration(t))!, tokenIsToken0: r.tokenIsToken0 });
            }
            const s = decodePairSwap(a, r.tokenIsToken0);
            if (!s) break;
            await this.accounts.recordTrade(t, {
              ref: `${l.transactionHash}:${l.logIndex}`,
              tradeWei: s.quoteWei,
              side: s.side,
              trader: froms.get(l.transactionHash!) ?? a.to ?? ZERO,
              amountBnb: Number(formatEther(s.quoteWei)),
              tokens: Number(formatEther(s.tokensWei)),
              taxUsd: 0,
              txHash: l.transactionHash!,
              timestamp: await this.ts(l.blockNumber!),
            });
            dirty.add(t);
            break;
          }
        }
      } catch (err) {
        this.log.error({ err: (err as Error)?.message, tx: l.transactionHash, event: l.eventName }, 'offchain: failed to handle log');
      }
    }
    for (const t of touched) await this.refreshHolderCounts(t);
    if (candidates.length) await this.addCandidates(candidates);
    return { touched: [...touched], traded: [...dirty], candidates };
  }

  async addCandidates(cs: Candidate[]) {
    const list = JSON.parse((await this.repo.getMeta(CANDIDATES)) ?? '[]') as Candidate[];
    const seen = new Set(list.map((c) => c.token));
    for (const c of cs) if (!seen.has(c.token)) list.push(c);
    await this.repo.setMeta(CANDIDATES, JSON.stringify(list.slice(-2000)));
  }
  async candidates(): Promise<Candidate[]> {
    return JSON.parse((await this.repo.getMeta(CANDIDATES)) ?? '[]');
  }
  async setCandidates(cs: Candidate[]) {
    await this.repo.setMeta(CANDIDATES, JSON.stringify(cs));
  }

  /** Holder / eligible counts after balance changes. */
  async refreshHolderCounts(token: string) {
    const m = await this.repo.getMachine(token);
    if (!m) return;
    const balances = await this.repo.getBalances(token);
    const excluded = await excludedFor(this.repo, m, [this.o.portal, this.o.vaultPortal, ...this.o.excluded]);
    const ex = new Set(excluded);
    const holders = balances.filter((b) => !ex.has(b.address)).length;
    const eligible = selectEligible(balances, { totalSupply: TOTAL_SUPPLY_DEFAULT, excluded }).length;
    if (holders !== m.holders || eligible !== m.eligibleHolders) await this.ledger.updateMachine(token, () => ({ holders, eligibleHolders: eligible }));
  }

  private async ts(block: bigint) {
    const hit = this.blockTs.get(block);
    if (hit) return hit;
    const b = await this.client.getBlock({ blockNumber: block }).catch(() => null);
    const ts = b ? Number(b.timestamp) : Math.floor(Date.now() / 1000);
    if (this.blockTs.size > 5000) this.blockTs.clear();
    this.blockTs.set(block, ts);
    return ts;
  }
}
