import type { ActivityEvent, BurnEvent, CardRelease, DividendClaim, Machine, Page, Pull, RaffleProof, Trade } from '../types.js';
import { lc, type HolderRow, type Repository, type RewardsRow } from './repository.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const ACTIVITY_CAP = 5000;

export class MemoryRepository implements Repository {
  private machines = new Map<string, Machine>();
  private pulls = new Map<string, Pull>();
  private trades = new Map<string, Trade[]>();
  private activity: ActivityEvent[] = [];
  private burns: BurnEvent[] = [];
  private proofs = new Map<string, RaffleProof>();
  private balances = new Map<string, Map<string, bigint>>();
  private rewards = new Map<string, RewardsRow>();
  private claims = new Map<string, DividendClaim>();
  private meta = new Map<string, string>();
  private counters = new Map<string, number>();
  private releases = new Map<string, CardRelease>();

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
