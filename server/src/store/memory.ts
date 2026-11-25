import type { ForgeRecord, StoredForgeTrade } from '../forge/types.js';
import type { ActivityEvent, BurnEvent, CardRelease, DividendClaim, FeeEvent, FeeTotals, Machine, Page, Pull, RaffleProof, Trade } from '../types.js';
import { lc, type HolderRow, type Repository, type RewardsRow } from './repository.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const ACTIVITY_CAP = 5000;
/** The simulator emits several fee events per second; keep a bounded window (totals are kept separately). */
const FEE_CAP = 20_000;
const BUCKET_S = 60;
const zeroTotals = (): FeeTotals => ({ totalTaxUsd: 0, flapUsd: 0, platformUsd: 0, potUsd: 0, buybackUsd: 0, creatorUsd: 0 });
const addTotals = (t: FeeTotals, e: FeeEvent) => {
  t.totalTaxUsd += e.taxUsd;
  t.flapUsd += e.flapUsd;
  t.platformUsd += e.platformUsd;
  t.potUsd += e.potUsd;
  t.buybackUsd += e.buybackUsd;
  t.creatorUsd += e.creatorUsd ?? 0;
};
const roundTotals = (t: FeeTotals): FeeTotals => ({
  totalTaxUsd: r2(t.totalTaxUsd),
  flapUsd: r2(t.flapUsd),
  platformUsd: r2(t.platformUsd),
  potUsd: r2(t.potUsd),
  buybackUsd: r2(t.buybackUsd),
  creatorUsd: r2(t.creatorUsd),
});
const r2 = (n: number) => Math.round(n * 100) / 100;

export class MemoryRepository implements Repository {
  private machines = new Map<string, Machine>();
  private pulls = new Map<string, Pull>();
  private trades = new Map<string, Trade[]>();
  private activity: ActivityEvent[] = [];
  private fees: FeeEvent[] = [];
  private feeIds = new Set<string>();
  private pendingFees = new Map<string, FeeEvent>();
  private feeTotals = zeroTotals();
  /** Per-minute totals for the rolling 24h window. */
  private feeBuckets = new Map<number, FeeTotals>();
  private burns: BurnEvent[] = [];
  private proofs = new Map<string, RaffleProof>();
  private balances = new Map<string, Map<string, bigint>>();
  private rewards = new Map<string, RewardsRow>();
  private claims = new Map<string, DividendClaim>();
  private meta = new Map<string, string>();
  private counters = new Map<string, number>();
  private releases = new Map<string, CardRelease>();
  private forgeRecord: ForgeRecord | null = null;
  private forgeTrades = new Map<string, StoredForgeTrade[]>();
  private forgeTradeIds = new Set<string>();

  async init() {}
  async close() {}

  async upsertMachine(m: Machine) {
    this.machines.set(lc(m.address), { ...m, address: lc(m.address) });
  }
  async getMachine(address: string) {
    return this.machines.get(lc(address)) ?? null;
  }
  async listMachines() {
    return [...this.machines.values()];
  }

  async upsertPull(p: Pull) {
    const prev = this.pulls.get(p.id);
    this.pulls.set(p.id, { ...prev, ...p, machine: lc(p.machine) });
  }
  async getPull(id: string) {
    return this.pulls.get(id) ?? null;
  }
  async listPulls({ machine, offset, limit }: { machine?: string; offset: number; limit: number }): Promise<Page<Pull>> {
    let all = [...this.pulls.values()];
    if (machine) all = all.filter((p) => p.machine === lc(machine));
    all.sort((a, b) => b.timestamp - a.timestamp);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  async addTrade(machine: string, t: Trade) {
    const k = lc(machine);
    const list = this.trades.get(k) ?? [];
    list.push(t);
    this.trades.set(k, list);
  }
  async listTrades(machine: string, offset: number, limit: number) {
    const all = [...(this.trades.get(lc(machine)) ?? [])].sort((a, b) => b.timestamp - a.timestamp);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  async addFeeEvent(e: FeeEvent) {
    if (this.feeIds.has(e.id)) return false;
    const ev = { ...e, machine: lc(e.machine), trader: lc(e.trader) };
    this.fees.push(ev);
    this.feeIds.add(ev.id);
    if (ev.pending) this.pendingFees.set(ev.id, ev);
    if (this.fees.length > FEE_CAP) for (const old of this.fees.splice(0, this.fees.length - FEE_CAP)) this.feeIds.delete(old.id);
    addTotals(this.feeTotals, ev);
    const b = Math.floor(ev.timestamp / BUCKET_S);
    let bucket = this.feeBuckets.get(b);
    if (!bucket) this.feeBuckets.set(b, (bucket = zeroTotals()));
    addTotals(bucket, ev);
    const horizon = b - Math.ceil(172_800 / BUCKET_S);
    if (this.feeBuckets.size > 3000) for (const k of this.feeBuckets.keys()) if (k < horizon) this.feeBuckets.delete(k);
    return true;
  }
  async listFeeEvents({ machine, limit }: { machine?: string; limit: number }) {
    const src = machine ? this.fees.filter((e) => e.machine === lc(machine)) : this.fees;
    return [...src].reverse().sort((a, b) => b.timestamp - a.timestamp).slice(0, limit).map((e) => ({ ...e }));
  }
  async settleFeeEvents(machine: string, upTo: number) {
    const changed: FeeEvent[] = [];
    for (const [id, e] of this.pendingFees) {
      if (e.machine !== lc(machine) || e.timestamp > upTo) continue;
      e.pending = false;
      this.pendingFees.delete(id);
      changed.push({ ...e });
    }
    return changed;
  }
  async pendingFeePotUsd(machine: string) {
    let s = 0;
    for (const e of this.pendingFees.values()) if (e.machine === lc(machine)) s += e.potUsd;
    return r2(s);
  }
  async feeSummary(since: number) {
    const last = zeroTotals();
    const from = Math.floor(since / BUCKET_S);
    for (const [k, t] of this.feeBuckets) {
      if (k < from) continue;
      last.totalTaxUsd += t.totalTaxUsd;
      last.flapUsd += t.flapUsd;
      last.platformUsd += t.platformUsd;
      last.potUsd += t.potUsd;
      last.buybackUsd += t.buybackUsd;
      last.creatorUsd += t.creatorUsd;
    }
    return { ...roundTotals(this.feeTotals), last24h: roundTotals(last) };
  }

  async addActivity(e: ActivityEvent) {
    this.activity.push(e);
    if (this.activity.length > ACTIVITY_CAP) this.activity.splice(0, this.activity.length - ACTIVITY_CAP);
  }
  async listActivity(limit: number) {
    return [...this.activity].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async addBurn(b: BurnEvent) {
    this.burns.push(b);
  }
  async listBurns(offset: number, limit: number) {
    const all = [...this.burns].sort((a, b) => b.timestamp - a.timestamp);
    return {
      items: all.slice(offset, offset + limit),
      total: all.length,
      totalBurned: all.reduce((s, b) => s + b.amount, 0),
    };
  }

  async setRaffleProof(p: RaffleProof) {
    this.proofs.set(p.pullId, p);
  }
  async getRaffleProof(pullId: string) {
    return this.proofs.get(pullId) ?? null;
  }

  private book(machine: string) {
    const k = lc(machine);
    let b = this.balances.get(k);
    if (!b) this.balances.set(k, (b = new Map()));
    return b;
  }
  async applyTransfer(machine: string, from: string, to: string, amount: bigint) {
    const b = this.book(machine);
    if (lc(from) !== ZERO) b.set(lc(from), (b.get(lc(from)) ?? 0n) - amount);
    if (lc(to) !== ZERO) b.set(lc(to), (b.get(lc(to)) ?? 0n) + amount);
  }
  async setBalance(machine: string, holder: string, amount: bigint) {
    this.book(machine).set(lc(holder), amount);
  }
  async getBalance(machine: string, holder: string) {
    return this.book(machine).get(lc(holder)) ?? 0n;
  }
  async getBalances(machine: string): Promise<HolderRow[]> {
    return [...this.book(machine).entries()].filter(([, v]) => v > 0n).map(([address, balance]) => ({ address, balance }));
  }

  private rk(machine: string, wallet: string) {
    return `${lc(machine)}|${lc(wallet)}`;
  }
  async creditRewards(machine: string, wallet: string, amountBnb: number) {
    const r = this.rewards.get(this.rk(machine, wallet)) ?? { claimableBnb: 0, totalEarnedBnb: 0 };
    this.rewards.set(this.rk(machine, wallet), {
      claimableBnb: r.claimableBnb + amountBnb,
      totalEarnedBnb: r.totalEarnedBnb + amountBnb,
    });
  }
  async debitClaimable(machine: string, wallet: string, amountBnb: number) {
    const r = this.rewards.get(this.rk(machine, wallet)) ?? { claimableBnb: 0, totalEarnedBnb: 0 };
    this.rewards.set(this.rk(machine, wallet), { ...r, claimableBnb: Math.max(0, r.claimableBnb - amountBnb) });
  }
  async getRewards(machine: string, wallet: string) {
    return this.rewards.get(this.rk(machine, wallet)) ?? { claimableBnb: 0, totalEarnedBnb: 0 };
  }

  private ck(machine: string, epoch: number, wallet: string) {
    return `${lc(machine)}|${epoch}|${lc(wallet)}`;
  }
  async saveDividendClaims(claims: DividendClaim[]) {
    for (const c of claims) this.claims.set(this.ck(c.machine, c.epoch, c.wallet), { ...c, machine: lc(c.machine), wallet: lc(c.wallet) });
  }
  async getDividendClaims(machine: string, wallet: string) {
    return [...this.claims.values()]
      .filter((c) => c.machine === lc(machine) && c.wallet === lc(wallet))
      .sort((a, b) => a.epoch - b.epoch);
  }
  async markClaimPushed(machine: string, epoch: number, wallet: string) {
    const c = this.claims.get(this.ck(machine, epoch, wallet));
    if (c) c.pushed = true;
  }

  async upsertCardRelease(r: CardRelease) {
    this.releases.set(`${r.pullKey}|${r.tokenId}`, { ...r, machine: lc(r.machine), winner: lc(r.winner) });
  }
  async getCardRelease(pullKey: string, tokenId: string) {
    const r = this.releases.get(`${pullKey}|${tokenId}`);
    return r ? { ...r } : null;
  }
  async listDueCardReleases(now: number, limit: number) {
    return [...this.releases.values()]
      .filter((r) => r.status === 'PENDING' && r.nextAttemptAt <= now)
      .sort((a, b) => a.releaseAt - b.releaseAt)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async listCardReleases(opts: { status?: CardRelease['status']; winner?: string } = {}) {
    return [...this.releases.values()]
      .filter((r) => (!opts.status || r.status === opts.status) && (!opts.winner || r.winner === lc(opts.winner)))
      .sort((a, b) => a.releaseAt - b.releaseAt)
      .map((r) => ({ ...r }));
  }

  async getForgeRecord() {
    return this.forgeRecord ? structuredClone(this.forgeRecord) : null;
  }
  async saveForgeRecord(r: ForgeRecord) {
    this.forgeRecord = structuredClone({ ...r, token: { ...r.token, address: lc(r.token.address) } });
  }
  async addForgeTrade(token: string, t: StoredForgeTrade) {
    const key = `${lc(token)}|${t.id}`;
    if (this.forgeTradeIds.has(key)) return false;
    this.forgeTradeIds.add(key);
    const list = this.forgeTrades.get(lc(token)) ?? [];
    list.push({ ...t, trader: lc(t.trader) });
    this.forgeTrades.set(lc(token), list);
    return true;
  }
  private forgeSorted(token: string) {
    return [...(this.forgeTrades.get(lc(token)) ?? [])].sort((a, b) => b.timestamp - a.timestamp || b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  }
  async listForgeTrades(token: string, { limit, since }: { limit: number; since?: number }) {
    return this.forgeSorted(token)
      .filter((t) => since === undefined || t.timestamp >= since)
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }
  async lastForgeTradeBefore(token: string, ts: number) {
    const t = this.forgeSorted(token).find((x) => x.timestamp < ts);
    return t ? { ...t } : null;
  }

  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
  async incrCounter(name: string, by: number) {
    const v = (this.counters.get(name) ?? 0) + by;
    this.counters.set(name, v);
    return v;
  }
  async getCounter(name: string) {
    return this.counters.get(name) ?? 0;
  }
}
