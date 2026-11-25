import { and, asc, count, desc, eq, gt, lte, sql, sum } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as s from '../db/schema.js';
import type { ActivityEvent, BurnEvent, CardRelease, DividendClaim, Machine, Pull, RaffleProof, Trade } from '../types.js';
import { lc, type Repository } from './repository.js';

const ZERO = '0x0000000000000000000000000000000000000000';
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export class PostgresRepository implements Repository {
  private pool: pg.Pool;
  private db: NodePgDatabase<typeof s>;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
    this.db = drizzle(this.pool, { schema: s });
  }

  async init() {
    await migrate(this.db, { migrationsFolder: MIGRATIONS_DIR });
  }
  async close() {
    await this.pool.end();
  }

  async upsertMachine(m: Machine) {
    const data = { ...m, address: lc(m.address) };
    await this.db
      .insert(s.machines)
      .values({ address: data.address, createdAt: m.createdAt, data })
      .onConflictDoUpdate({ target: s.machines.address, set: { data, createdAt: m.createdAt } });
  }
  async getMachine(address: string) {
    const r = await this.db.select().from(s.machines).where(eq(s.machines.address, lc(address)));
    return r[0]?.data ?? null;
  }
  async listMachines() {
    return (await this.db.select().from(s.machines)).map((r) => r.data);
  }

  async upsertPull(p: Pull) {
    const prev = await this.getPull(p.id);
    const data = { ...prev, ...p, machine: lc(p.machine) };
    await this.db
      .insert(s.pulls)
      .values({ id: p.id, machine: data.machine, timestamp: data.timestamp, data })
      .onConflictDoUpdate({ target: s.pulls.id, set: { data, timestamp: data.timestamp } });
  }
  async getPull(id: string) {
    const r = await this.db.select().from(s.pulls).where(eq(s.pulls.id, id));
    return r[0]?.data ?? null;
  }
  async listPulls({ machine, offset, limit }: { machine?: string; offset: number; limit: number }) {
    const where = machine ? eq(s.pulls.machine, lc(machine)) : undefined;
    const items = await this.db.select().from(s.pulls).where(where).orderBy(desc(s.pulls.timestamp)).offset(offset).limit(limit);
    const [{ n }] = await this.db.select({ n: count() }).from(s.pulls).where(where);
    return { items: items.map((r) => r.data), total: Number(n) };
  }

  async addTrade(machine: string, t: Trade) {
    await this.db.insert(s.trades).values({ machine: lc(machine), timestamp: t.timestamp, data: t });
  }
  async listTrades(machine: string, offset: number, limit: number) {
    const where = eq(s.trades.machine, lc(machine));
    const items = await this.db.select().from(s.trades).where(where).orderBy(desc(s.trades.timestamp)).offset(offset).limit(limit);
    const [{ n }] = await this.db.select({ n: count() }).from(s.trades).where(where);
    return { items: items.map((r) => r.data), total: Number(n) };
  }

  async addActivity(e: ActivityEvent) {
    await this.db.insert(s.activity).values({ id: e.id, timestamp: e.timestamp, data: e }).onConflictDoNothing();
  }
  async listActivity(limit: number) {
    return (await this.db.select().from(s.activity).orderBy(desc(s.activity.timestamp)).limit(limit)).map((r) => r.data);
  }

  async addBurn(b: BurnEvent) {
    await this.db.insert(s.burns).values({ id: b.id, timestamp: b.timestamp, amount: b.amount, data: b }).onConflictDoNothing();
  }
  async listBurns(offset: number, limit: number) {
    const items = await this.db.select().from(s.burns).orderBy(desc(s.burns.timestamp)).offset(offset).limit(limit);
    const [{ n, total }] = await this.db.select({ n: count(), total: sum(s.burns.amount) }).from(s.burns);
    return { items: items.map((r) => r.data), total: Number(n), totalBurned: Number(total ?? 0) };
  }

  async setRaffleProof(p: RaffleProof) {
    await this.db.insert(s.raffleProofs).values({ pullId: p.pullId, data: p }).onConflictDoUpdate({ target: s.raffleProofs.pullId, set: { data: p } });
  }
  async getRaffleProof(pullId: string) {
    const r = await this.db.select().from(s.raffleProofs).where(eq(s.raffleProofs.pullId, pullId));
    return r[0]?.data ?? null;
  }

  private async addBalance(machine: string, holder: string, delta: bigint) {
    await this.db
      .insert(s.holderBalances)
      .values({ machine: lc(machine), holder: lc(holder), balance: delta.toString() })
      .onConflictDoUpdate({
        target: [s.holderBalances.machine, s.holderBalances.holder],
        set: { balance: sql`${s.holderBalances.balance} + ${delta.toString()}::numeric` },
      });
  }
  async applyTransfer(machine: string, from: string, to: string, amount: bigint) {
    await this.db.transaction(async () => {
      if (lc(from) !== ZERO) await this.addBalance(machine, from, -amount);
      if (lc(to) !== ZERO) await this.addBalance(machine, to, amount);
    });
  }
  async setBalance(machine: string, holder: string, amount: bigint) {
    await this.db
      .insert(s.holderBalances)
      .values({ machine: lc(machine), holder: lc(holder), balance: amount.toString() })
      .onConflictDoUpdate({ target: [s.holderBalances.machine, s.holderBalances.holder], set: { balance: amount.toString() } });
  }
  async getBalance(machine: string, holder: string) {
    const r = await this.db
      .select()
      .from(s.holderBalances)
      .where(and(eq(s.holderBalances.machine, lc(machine)), eq(s.holderBalances.holder, lc(holder))));
    return r[0] ? BigInt(r[0].balance) : 0n;
  }
  async getBalances(machine: string) {
    const r = await this.db
      .select()
      .from(s.holderBalances)
      .where(and(eq(s.holderBalances.machine, lc(machine)), gt(s.holderBalances.balance, '0')));
    return r.map((x) => ({ address: x.holder, balance: BigInt(x.balance) }));
  }

  async creditRewards(machine: string, wallet: string, amountBnb: number) {
    await this.db
      .insert(s.rewards)
      .values({ machine: lc(machine), wallet: lc(wallet), claimableBnb: amountBnb, totalEarnedBnb: amountBnb })
      .onConflictDoUpdate({
        target: [s.rewards.machine, s.rewards.wallet],
        set: {
          claimableBnb: sql`${s.rewards.claimableBnb} + ${amountBnb}`,
          totalEarnedBnb: sql`${s.rewards.totalEarnedBnb} + ${amountBnb}`,
        },
      });
  }
  async debitClaimable(machine: string, wallet: string, amountBnb: number) {
    await this.db
      .update(s.rewards)
      .set({ claimableBnb: sql`greatest(0, ${s.rewards.claimableBnb} - ${amountBnb})` })
      .where(and(eq(s.rewards.machine, lc(machine)), eq(s.rewards.wallet, lc(wallet))));
  }
  async getRewards(machine: string, wallet: string) {
    const r = await this.db
      .select()
      .from(s.rewards)
      .where(and(eq(s.rewards.machine, lc(machine)), eq(s.rewards.wallet, lc(wallet))));
    return r[0] ? { claimableBnb: r[0].claimableBnb, totalEarnedBnb: r[0].totalEarnedBnb } : { claimableBnb: 0, totalEarnedBnb: 0 };
  }

  async saveDividendClaims(claims: DividendClaim[]) {
    if (!claims.length) return;
    await this.db
      .insert(s.dividendClaims)
      .values(claims.map((c) => ({ ...c, machine: lc(c.machine), wallet: lc(c.wallet) })))
      .onConflictDoNothing();
  }
  async getDividendClaims(machine: string, wallet: string) {
    const r = await this.db
      .select()
      .from(s.dividendClaims)
      .where(and(eq(s.dividendClaims.machine, lc(machine)), eq(s.dividendClaims.wallet, lc(wallet))))
      .orderBy(asc(s.dividendClaims.epoch));
    return r;
  }
  async markClaimPushed(machine: string, epoch: number, wallet: string) {
    await this.db
      .update(s.dividendClaims)
      .set({ pushed: true })
      .where(and(eq(s.dividendClaims.machine, lc(machine)), eq(s.dividendClaims.epoch, epoch), eq(s.dividendClaims.wallet, lc(wallet))));
  }

  async upsertCardRelease(r: CardRelease) {
    const row = { ...r, machine: lc(r.machine), winner: lc(r.winner), lastError: r.lastError ?? null, txHash: r.txHash ?? null };
    const { pullKey: _p, tokenId: _t, createdAt: _c, ...set } = row;
    await this.db.insert(s.cardReleases).values(row).onConflictDoUpdate({ target: [s.cardReleases.pullKey, s.cardReleases.tokenId], set });
  }
  async getCardRelease(pullKey: string, tokenId: string) {
    const r = await this.db
      .select()
      .from(s.cardReleases)
      .where(and(eq(s.cardReleases.pullKey, pullKey), eq(s.cardReleases.tokenId, tokenId)));
    return r[0] ? releaseRow(r[0]) : null;
  }
  async listDueCardReleases(now: number, limit: number) {
    const r = await this.db
      .select()
      .from(s.cardReleases)
      .where(and(eq(s.cardReleases.status, 'PENDING'), lte(s.cardReleases.nextAttemptAt, now)))
      .orderBy(asc(s.cardReleases.releaseAt))
      .limit(limit);
    return r.map(releaseRow);
  }
  async listCardReleases(opts: { status?: CardRelease['status']; winner?: string } = {}) {
    const conds = [opts.status ? eq(s.cardReleases.status, opts.status) : undefined, opts.winner ? eq(s.cardReleases.winner, lc(opts.winner)) : undefined].filter(Boolean);
    const r = await this.db
      .select()
      .from(s.cardReleases)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(s.cardReleases.releaseAt));
    return r.map(releaseRow);
  }

  async getMeta(key: string) {
    const r = await this.db.select().from(s.meta).where(eq(s.meta.key, key));
    return r[0]?.value ?? null;
  }
  async setMeta(key: string, value: string) {
    await this.db.insert(s.meta).values({ key, value }).onConflictDoUpdate({ target: s.meta.key, set: { value } });
  }
  async incrCounter(name: string, by: number) {
    const r = await this.db
      .insert(s.counters)
      .values({ name, value: by })
      .onConflictDoUpdate({ target: s.counters.name, set: { value: sql`${s.counters.value} + ${by}` } })
      .returning();
    return r[0].value;
  }
  async getCounter(name: string) {
    const r = await this.db.select().from(s.counters).where(eq(s.counters.name, name));
    return r[0]?.value ?? 0;
  }
}

function releaseRow(r: typeof s.cardReleases.$inferSelect): CardRelease {
  const { lastError, txHash, ...rest } = r;
  return { ...rest, ...(lastError ? { lastError } : {}), ...(txHash ? { txHash } : {}) };
}
