/**
 * OFF-CHAIN MODE accounting. Every indexed trade of a registered token books its side-specific tax (buy or sell bps) into
 * append-only ledger entries (BNB wei): flap.sh cut (estimated from the token's measured treasury share), then the rest
 * split by the machine's tax model (TAX MODEL v3: 5% company / 5% $FORGE buyback / 90% creator share = pot × potShare +
 * creator payout; $FORGE and pre-v3 machines: 90% company / 7% pot / 3% buyback). When the TaxProcessor's cumulative
 * `totalQuoteSentToMarketing()` grows (a dispatch happened), the difference between what really reached the treasury
 * and the estimate is booked as RECONCILE entries, the token's measured share is updated, and its FeeEvents settle.
 */
import { formatEther } from 'viem';
import { sideTaxBps, splitNetWei, TAX_BPS, type MachineTax } from '../core/packs.js';
import type { Ledger } from '../ledger.js';
import { round2 } from '../ledger.js';
import type { Repository } from '../store/repository.js';
import type { FeeEvent, Machine, Trade } from '../types.js';
import type { OffchainStore } from './store.js';
import type { Bucket, LedgerEntry, Registration } from './types.js';

const BPS = 10_000n;
export const SHARE_META = 'offchain:treasuryShare';
/** Clamp for the measured treasury share of the tax (sanity against one-off lumps). */
const MIN_SHARE_BPS = 5_000;

export const weiToBnb = (w: bigint) => Number(formatEther(w));
export const usdToWei = (usd: number, bnbUsd: number) => (bnbUsd > 0 ? BigInt(Math.ceil((usd / bnbUsd) * 1e18)) : 0n);
export const weiToUsd = (w: bigint, bnbUsd: number) => weiToBnb(w) * bnbUsd;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Tax model of a registration (pre-v3 rows have none → 'legacy'). */
export function regTax(reg: Pick<Registration, 'taxModel' | 'potShareBps'> | null | undefined): MachineTax {
  return { model: reg?.taxModel ?? 'legacy', potShareBps: reg?.potShareBps };
}

export interface TaxSplitWei {
  tax: bigint;
  flap: bigint;
  /** What reaches the treasury. */
  net: bigint;
  /** Company share. */
  platform: bigint;
  pot: bigint;
  buyback: bigint;
  /** Owed to the creator ('creator' model only). */
  creator: bigint;
}

/** Splits the net (treasury) amount by the tax model; parts sum exactly to `net`. Works for negative corrections too. */
export function splitNet(net: bigint, t: MachineTax = {}) {
  const s = splitNetWei(net, t);
  return { pot: s.pot, buyback: s.buyback, creator: s.creator, platform: s.company };
}

/** tax = trade × taxBps; net = tax × treasuryShareBps (measured, else 1 − FLAP_CUT estimate); flap = tax − net. */
export function taxSplitWei(tradeWei: bigint, treasuryShareBps: number, taxBps = TAX_BPS, t: MachineTax = {}): TaxSplitWei {
  const tax = (tradeWei * BigInt(taxBps)) / BPS;
  const net = (tax * BigInt(treasuryShareBps)) / BPS;
  return { tax, flap: tax - net, net, ...splitNet(net, t) };
}

export function tradeEntries(t: { machine: string; ref: string; tradeWei: bigint; ts: number; txHash: string }, treasuryShareBps: number, taxBps = TAX_BPS, mt: MachineTax = {}): LedgerEntry[] {
  const s = taxSplitWei(t.tradeWei, treasuryShareBps, taxBps, mt);
  const base = { ts: t.ts, machine: t.machine.toLowerCase(), kind: 'TRADE_TAX' as const, txHash: t.txHash, data: { taxBps } };
  const rows: [Bucket, bigint][] = [
    ['TAX', s.tax],
    ['FLAP', s.flap],
    ['PLATFORM', s.platform],
    ['POT', s.pot],
    ['BUYBACK', s.buyback],
  ];
  if (mt.model === 'creator') rows.push(['CREATOR', s.creator]);
  return rows.map(([bucket, amountWei]) => ({ ...base, ref: `${t.ref}:${bucket}`, bucket, amountWei }));
}

/** Correction once real receipts are known: delta = received − estimated net; flap absorbs −delta; delta splits by the model. */
export function reconcileEntries(p: { machine: string; ref: string; receivedWei: bigint; estimatedNetWei: bigint; ts: number; data?: Record<string, unknown>; tax?: MachineTax }): LedgerEntry[] {
  const delta = p.receivedWei - p.estimatedNetWei;
  if (delta === 0n) return [];
  const s = splitNet(delta, p.tax);
  const base = { ts: p.ts, machine: p.machine.toLowerCase(), kind: 'RECONCILE' as const, data: { receivedWei: p.receivedWei.toString(), estimatedNetWei: p.estimatedNetWei.toString(), ...p.data } };
  const rows: [Bucket, bigint][] = [
    ['FLAP', -delta],
    ['PLATFORM', s.platform],
    ['POT', s.pot],
    ['BUYBACK', s.buyback],
    ['CREATOR', s.creator],
  ];
  return rows.filter(([, v]) => v !== 0n).map(([bucket, amountWei]) => ({ ...base, ref: `${p.ref}:${bucket}`, bucket, amountWei }));
}

/** Measured treasury share in bps from cumulative received / gross tax; estimate until something was measured. */
export function measuredShareBps(m: { receivedWei: bigint; grossWei: bigint } | null, estimateBps: number): number {
  if (!m || m.grossWei <= 0n || m.receivedWei <= 0n) return estimateBps;
  const bps = Number((m.receivedWei * BPS) / m.grossWei);
  return Math.max(MIN_SHARE_BPS, Math.min(10_000, bps));
}

export interface Owed {
  pots: bigint;
  /** Owed to creators (payout addresses), Σ CREATOR. */
  creators: bigint;
  buyback: bigint;
  dividendsPending: bigint;
  burnsPending: bigint;
  total: bigint;
}

export interface OffchainLedgerOptions {
  /** Treasury share of the tax used before anything was measured (10000 − FLAP_CUT_ESTIMATE_BPS). */
  estimateShareBps: number;
  bnbUsd: () => Promise<number>;
  now?: () => number;
}

export class OffchainLedger {
  constructor(
    readonly store: OffchainStore,
    readonly ledger: Ledger,
    private o: OffchainLedgerOptions,
  ) {}

  get repo(): Repository {
    return this.ledger.repo;
  }
  private now() {
    return this.o.now?.() ?? Math.floor(Date.now() / 1000);
  }

  async measured(): Promise<{ receivedWei: bigint; grossWei: bigint } | null> {
    const raw = await this.repo.getMeta(SHARE_META);
    if (!raw) return null;
    const j = JSON.parse(raw) as { receivedWei: string; grossWei: string };
    return { receivedWei: BigInt(j.receivedWei), grossWei: BigInt(j.grossWei) };
  }
  /**
   * Treasury share of the tax (flap cut = 1 − share): measured for this token once it had a dispatch, else the global
   * measured share, else the FLAP_CUT_ESTIMATE_BPS estimate. Without `reg`: the global value.
   */
  async shareBps(reg?: Pick<Registration, 'measuredReceivedWei' | 'measuredGrossWei'> | null) {
    const global = measuredShareBps(await this.measured(), this.o.estimateShareBps);
    if (!reg?.measuredGrossWei || !reg.measuredReceivedWei) return global;
    return measuredShareBps({ receivedWei: BigInt(reg.measuredReceivedWei), grossWei: BigInt(reg.measuredGrossWei) }, global);
  }

  async book(entries: LedgerEntry[]) {
    return this.store.appendEntries(entries);
  }

  balance(bucket: Bucket, machine?: string | null) {
    return this.store.sum({ bucket, machine });
  }
  potWei(machine: string) {
    return this.store.sum({ bucket: 'POT', machine });
  }

  /** Everything that is not company money: pots, $FORGE buyback, pending dividends/burns and creator balances. */
  async owed(): Promise<Owed> {
    const [pots, buyback, dividendsPending, burnsPending] = await Promise.all(
      (['POT', 'BUYBACK', 'DIVIDEND', 'BURN'] as Bucket[]).map((b) => this.store.sum({ bucket: b })),
    );
    // A machine's creator balance can only go negative temporarily (downward reconcile after a payout): it never reduces
    // what is owed to the other creators.
    let creators = 0n;
    for (const v of (await this.store.sumByMachine('CREATOR')).values()) if (v > 0n) creators += v;
    return { pots, creators, buyback, dividendsPending, burnsPending, total: pots + creators + buyback + dividendsPending + burnsPending };
  }

  /** creatorOwedBnb / creatorPaidBnb for the machine API. */
  async creatorFields(machine: string): Promise<Pick<Machine, 'creatorOwedBnb' | 'creatorPaidBnb'>> {
    const [owed, paid] = await Promise.all([this.store.sum({ bucket: 'CREATOR', machine }), this.store.sum({ bucket: 'CREATOR', machine, kind: 'CREATOR_PAID' })]);
    return { creatorOwedBnb: r6(weiToBnb(owed > 0n ? owed : 0n)), creatorPaidBnb: r6(weiToBnb(-paid)) };
  }
  async syncCreator(machine: string) {
    const f = await this.creatorFields(machine);
    return this.ledger.updateMachine(machine, () => f);
  }

  /** machine.potUsd = virtual pot (BNB) × BNB/USD. */
  async syncPotUsd(machine: string, bnbUsd?: number) {
    const px = bnbUsd ?? (await this.o.bnbUsd());
    const potUsd = round2(weiToUsd(await this.potWei(machine), px));
    const m = await this.repo.getMachine(machine);
    if (!m || m.potUsd === potUsd) return m;
    return this.ledger.updateMachine(machine, () => ({ potUsd }));
  }

  /**
   * One indexed trade → ledger entries + Trade row + pending FeeEvent (ws `fee`). Idempotent on `ref`
   * (returns null when already booked or the machine is unknown).
   */
  async recordTrade(machine: string, t: Trade & { tradeWei: bigint; ref: string }): Promise<FeeEvent | null> {
    const m0 = await this.repo.getMachine(machine);
    if (!m0) return null;
    const reg = await this.store.getRegistration(machine);
    const share = await this.shareBps(reg);
    const mt = regTax(reg);
    const taxBps = sideTaxBps({ taxBps: m0.taxBps || TAX_BPS, buyTaxBps: reg?.buyTaxBps ?? m0.buyTaxBps, sellTaxBps: reg?.sellTaxBps ?? m0.sellTaxBps }, t.side);
    const entries = tradeEntries({ machine, ref: t.ref, tradeWei: t.tradeWei, ts: t.timestamp, txHash: t.txHash }, share, taxBps, mt);
    const inserted = await this.book(entries);
    if (!inserted.length) return null;
    const px = await this.o.bnbUsd();
    const by = (b: Bucket) => entries.find((e) => e.bucket === b)?.amountWei ?? 0n;
    const usd = (b: Bucket) => round2(weiToUsd(by(b), px));
    const trade: Trade = { side: t.side, trader: t.trader.toLowerCase(), amountBnb: t.amountBnb, tokens: t.tokens, taxUsd: usd('TAX'), txHash: t.txHash, timestamp: t.timestamp };
    await this.ledger.trade(machine, trade);
    const potUsd = round2(weiToUsd(await this.potWei(machine), px));
    const e: FeeEvent = {
      id: t.ref,
      machine: m0.address,
      ticker: m0.ticker,
      side: t.side,
      trader: trade.trader,
      amountBnb: t.amountBnb,
      txHash: t.txHash,
      timestamp: t.timestamp,
      taxUsd: usd('TAX'),
      flapUsd: usd('FLAP'),
      platformUsd: usd('PLATFORM'),
      potUsd: usd('POT'),
      buybackUsd: usd('BUYBACK'),
      creatorUsd: usd('CREATOR'),
      companyUsd: usd('PLATFORM'),
      potAfterUsd: potUsd,
      packPriceUsd: m0.packPriceUsd,
      pending: true,
    };
    await this.repo.addFeeEvent(e);
    const creator = mt.model === 'creator' ? await this.creatorFields(machine) : {};
    await this.ledger.updateMachine(machine, () => ({ potUsd, ...creator }));
    this.ledger.bus.publish({ type: 'fee', data: e });
    return e;
  }

  /**
   * Treasury receipts for one machine: `cumulativeSentWei` = TaxProcessor.totalQuoteSentToMarketing() read at a block
   * the indexer has fully applied. Books the correction, updates the measured share, settles pending FeeEvents.
   * Mutates and returns `reg` (caller persists it).
   */
  async reconcile(reg: Registration, cumulativeSentWei: bigint): Promise<{ receivedWei: bigint; grossWei: bigint; estimatedNetWei: bigint } | null> {
    const prev = BigInt(reg.sentToTreasuryWei || '0');
    const received = cumulativeSentWei - prev;
    if (received <= 0n) return null;
    const upto = await this.store.maxEntryId();
    const after = reg.reconciledToEntryId ?? 0;
    const machine = reg.token;
    const [gross, flap] = await Promise.all([
      this.store.sum({ bucket: 'TAX', machine, afterId: after, uptoId: upto }),
      this.store.sum({ bucket: 'FLAP', machine, kind: 'TRADE_TAX', afterId: after, uptoId: upto }),
    ]);
    const estimatedNet = gross - flap;
    const ts = this.now();
    const mt = regTax(reg);
    await this.book(reconcileEntries({ machine, ref: `reconcile:${machine}:${cumulativeSentWei}`, receivedWei: received, estimatedNetWei: estimatedNet, ts, data: { grossWei: gross.toString() }, tax: mt }));
    if (gross > 0n) {
      const m = (await this.measured()) ?? { receivedWei: 0n, grossWei: 0n };
      await this.repo.setMeta(SHARE_META, JSON.stringify({ receivedWei: (m.receivedWei + received).toString(), grossWei: (m.grossWei + gross).toString() }));
      reg.measuredReceivedWei = (BigInt(reg.measuredReceivedWei ?? '0') + received).toString();
      reg.measuredGrossWei = (BigInt(reg.measuredGrossWei ?? '0') + gross).toString();
    }
    reg.sentToTreasuryWei = cumulativeSentWei.toString();
    reg.reconciledToEntryId = upto;
    await this.repo.settleFeeEvents(machine, ts);
    if (mt.model === 'creator') await this.syncCreator(machine);
    const m = await this.syncPotUsd(machine);
    if (m) {
      const px = await this.o.bnbUsd();
      const pot = splitNet(received, mt).pot;
      await this.ledger.activity(m, 'TAX', `tax $${round2(weiToUsd(received, px)).toFixed(2)} reached treasury · $${round2(weiToUsd(pot, px)).toFixed(2)} → gacha pot`, weiToUsd(received, px), ts);
    }
    return { receivedWei: received, grossWei: gross, estimatedNetWei: estimatedNet };
  }
}
