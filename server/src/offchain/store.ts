import { and, desc, eq, gt, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as s from '../db/schema.js';
import type { Bucket, EntryKind, LedgerEntry, OpsTx, OpsTxStatus, Registration } from './types.js';

export interface StoredEntry extends LedgerEntry {
  id: number;
}

export interface SumFilter {
  bucket: Bucket;
  /** undefined = every machine (and global rows); null = global rows only. */
  machine?: string | null;
  kind?: EntryKind;
  afterId?: number;
  uptoId?: number;
}

/** Persistence for OFF-CHAIN MODE. Memory (default) or Postgres (DATABASE_URL); ledger rows are append-only. */
export interface OffchainStore {
  getRegistration(token: string): Promise<Registration | null>;
  listRegistrations(): Promise<Registration[]>;
  saveRegistration(r: Registration): Promise<void>;

  /** Inserts entries whose ref is new; returns the inserted rows (with ids) in order. */
  appendEntries(entries: LedgerEntry[]): Promise<StoredEntry[]>;
  sum(f: SumFilter): Promise<bigint>;
  /** Σ per machine for one bucket (rows with a machine only). */
  sumByMachine(bucket: Bucket): Promise<Map<string, bigint>>;
  maxEntryId(): Promise<number>;
  listEntries(o: { machine?: string; bucket?: Bucket; limit: number }): Promise<StoredEntry[]>;

  insertOpsTx(t: OpsTx): Promise<void>;
  updateOpsTx(id: string, patch: Partial<OpsTx>): Promise<void>;
  findOpsTxByDedupe(key: string, statuses: OpsTxStatus[]): Promise<OpsTx | null>;
  /** Newest first. */
  listOpsTxs(o: { limit: number; machine?: string }): Promise<OpsTx[]>;
  /** BNB that left the wallet since `ts`: value of SENT/CONFIRMED txs + fees of every tx with a hash, sweeps excluded. */
  spentSince(ts: number): Promise<bigint>;
}

const lc = (a: string) => a.toLowerCase();
const norm = (e: LedgerEntry): LedgerEntry => ({ ...e, machine: e.machine ? lc(e.machine) : null });

export class MemoryOffchainStore implements OffchainStore {
  private regs = new Map<string, Registration>();
  private entries: StoredEntry[] = [];
  private refs = new Set<string>();
  private txs = new Map<string, OpsTx>();

  async getRegistration(token: string) {
    const r = this.regs.get(lc(token));
    return r ? structuredClone(r) : null;
  }
  async listRegistrations() {
    return [...this.regs.values()].map((r) => structuredClone(r));
  }
  async saveRegistration(r: Registration) {
    this.regs.set(lc(r.token), structuredClone({ ...r, token: lc(r.token) }));
  }

  async appendEntries(entries: LedgerEntry[]) {
    const out: StoredEntry[] = [];
    for (const e of entries) {
      if (this.refs.has(e.ref)) continue;
      this.refs.add(e.ref);
      const row = { ...norm(e), id: this.entries.length + 1 };
      this.entries.push(row);
      out.push({ ...row });
    }
    return out;
  }
  async sum(f: SumFilter) {
    let t = 0n;
    for (const e of this.entries) {
      if (e.bucket !== f.bucket) continue;
      if (f.machine === null ? e.machine !== null : f.machine !== undefined && e.machine !== lc(f.machine)) continue;
      if (f.kind && e.kind !== f.kind) continue;
      if (f.afterId !== undefined && e.id <= f.afterId) continue;
      if (f.uptoId !== undefined && e.id > f.uptoId) continue;
      t += e.amountWei;
    }
    return t;
  }
  async sumByMachine(bucket: Bucket) {
    const m = new Map<string, bigint>();
    for (const e of this.entries) if (e.bucket === bucket && e.machine) m.set(e.machine, (m.get(e.machine) ?? 0n) + e.amountWei);
    return m;
  }
  async maxEntryId() {
    return this.entries.length;
  }
  async listEntries(o: { machine?: string; bucket?: Bucket; limit: number }) {
    return this.entries
      .filter((e) => (!o.machine || e.machine === lc(o.machine)) && (!o.bucket || e.bucket === o.bucket))
      .slice(-o.limit)
      .reverse()
      .map((e) => ({ ...e }));
  }

  async insertOpsTx(t: OpsTx) {
    this.txs.set(t.id, { ...t });
  }
  async updateOpsTx(id: string, patch: Partial<OpsTx>) {
    const t = this.txs.get(id);
    if (t) this.txs.set(id, { ...t, ...patch });
  }
  async findOpsTxByDedupe(key: string, statuses: OpsTxStatus[]) {
    for (const t of this.txs.values()) if (t.dedupeKey === key && statuses.includes(t.status)) return { ...t };
    return null;
  }
  async listOpsTxs(o: { limit: number; machine?: string }) {
    return [...this.txs.values()]
      .filter((t) => !o.machine || t.machine === lc(o.machine))
      .sort((a, b) => b.createdAt - a.createdAt || (b.id < a.id ? -1 : 1))
      .slice(0, o.limit)
      .map((t) => ({ ...t }));
  }
  async spentSince(ts: number) {
    let t = 0n;
    for (const x of this.txs.values()) {
      if (x.createdAt < ts || x.kind === 'SWEEP') continue;
      if (x.status === 'SENT' || x.status === 'CONFIRMED') t += x.amountWei;
      if (x.hash) t += x.feeWei;
    }
    return t;
  }
}

type EntryRow = typeof s.ledgerEntries.$inferSelect;
type TxRow = typeof s.opsTxs.$inferSelect;
const entryFromRow = (r: EntryRow): StoredEntry => ({
  id: r.id,
  ref: r.ref,
  ts: r.ts,
  machine: r.machine,
  bucket: r.bucket as Bucket,
  kind: r.kind as EntryKind,
  amountWei: BigInt(r.amountWei),
  txHash: r.txHash,
  ...(r.data ? { data: r.data } : {}),
});
const txFromRow = (r: TxRow): OpsTx => ({ ...r, label: r.label ?? undefined, kind: r.kind as OpsTx['kind'], status: r.status as OpsTxStatus, amountWei: BigInt(r.amountWei), feeWei: BigInt(r.feeWei) });
const txToRow = (t: Partial<OpsTx>) => {
  const { amountWei, feeWei, ...rest } = t;
  return { ...rest, ...(amountWei !== undefined ? { amountWei: amountWei.toString() } : {}), ...(feeWei !== undefined ? { feeWei: feeWei.toString() } : {}) };
};

/** Postgres implementation (tables from drizzle/0004_offchain.sql; migrations run by PostgresRepository.init()). */
export class PostgresOffchainStore implements OffchainStore {
  private pool: pg.Pool;
  private db: NodePgDatabase<typeof s>;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 4 });
    this.db = drizzle(this.pool, { schema: s });
  }
  async close() {
    await this.pool.end();
  }

  async getRegistration(token: string) {
    const r = await this.db.select().from(s.offchainMachines).where(eq(s.offchainMachines.token, lc(token)));
    return r[0]?.data ?? null;
  }
  async listRegistrations() {
    return (await this.db.select().from(s.offchainMachines)).map((r) => r.data);
  }
  async saveRegistration(r: Registration) {
    const data = { ...r, token: lc(r.token) };
    await this.db
      .insert(s.offchainMachines)
      .values({ token: data.token, registeredAt: r.registeredAt, data })
      .onConflictDoUpdate({ target: s.offchainMachines.token, set: { data } });
  }

  async appendEntries(entries: LedgerEntry[]) {
    if (!entries.length) return [];
    const rows = await this.db
      .insert(s.ledgerEntries)
      .values(
        entries.map((e0) => {
          const e = norm(e0);
          return { ref: e.ref, ts: e.ts, machine: e.machine, bucket: e.bucket, kind: e.kind, amountWei: e.amountWei.toString(), txHash: e.txHash ?? null, data: e.data ?? null };
        }),
      )
      .onConflictDoNothing({ target: s.ledgerEntries.ref })
      .returning();
    return rows.map(entryFromRow).sort((a, b) => a.id - b.id);
  }
  private where(f: SumFilter): SQL | undefined {
    const c: (SQL | undefined)[] = [eq(s.ledgerEntries.bucket, f.bucket)];
    if (f.machine === null) c.push(isNull(s.ledgerEntries.machine));
    else if (f.machine !== undefined) c.push(eq(s.ledgerEntries.machine, lc(f.machine)));
    if (f.kind) c.push(eq(s.ledgerEntries.kind, f.kind));
    if (f.afterId !== undefined) c.push(gt(s.ledgerEntries.id, f.afterId));
    if (f.uptoId !== undefined) c.push(lte(s.ledgerEntries.id, f.uptoId));
    return and(...c);
  }
  async sum(f: SumFilter) {
    const [r] = await this.db.select({ v: sql<string | null>`sum(${s.ledgerEntries.amountWei})` }).from(s.ledgerEntries).where(this.where(f));
    return BigInt(r?.v ?? 0);
  }
  async sumByMachine(bucket: Bucket) {
    const rows = await this.db
      .select({ machine: s.ledgerEntries.machine, v: sql<string>`sum(${s.ledgerEntries.amountWei})` })
      .from(s.ledgerEntries)
      .where(and(eq(s.ledgerEntries.bucket, bucket), sql`${s.ledgerEntries.machine} is not null`))
      .groupBy(s.ledgerEntries.machine);
    return new Map(rows.map((r) => [r.machine!, BigInt(r.v)]));
  }
  async maxEntryId() {
    const [r] = await this.db.select({ v: sql<number | null>`max(${s.ledgerEntries.id})` }).from(s.ledgerEntries);
    return Number(r?.v ?? 0);
  }
  async listEntries(o: { machine?: string; bucket?: Bucket; limit: number }) {
    const c = [o.machine ? eq(s.ledgerEntries.machine, lc(o.machine)) : undefined, o.bucket ? eq(s.ledgerEntries.bucket, o.bucket) : undefined].filter(Boolean) as SQL[];
    const rows = await this.db.select().from(s.ledgerEntries).where(c.length ? and(...c) : undefined).orderBy(desc(s.ledgerEntries.id)).limit(o.limit);
    return rows.map(entryFromRow);
  }

  async insertOpsTx(t: OpsTx) {
    await this.db.insert(s.opsTxs).values(txToRow(t) as typeof s.opsTxs.$inferInsert);
  }
  async updateOpsTx(id: string, patch: Partial<OpsTx>) {
    const { id: _i, createdAt: _c, ...rest } = patch;
    await this.db.update(s.opsTxs).set(txToRow(rest)).where(eq(s.opsTxs.id, id));
  }
  async findOpsTxByDedupe(key: string, statuses: OpsTxStatus[]) {
    const r = await this.db.select().from(s.opsTxs).where(and(eq(s.opsTxs.dedupeKey, key), inArray(s.opsTxs.status, statuses))).limit(1);
    return r[0] ? txFromRow(r[0]) : null;
  }
  async listOpsTxs(o: { limit: number; machine?: string }) {
    const r = await this.db
      .select()
      .from(s.opsTxs)
      .where(o.machine ? eq(s.opsTxs.machine, lc(o.machine)) : undefined)
      .orderBy(desc(s.opsTxs.createdAt))
      .limit(o.limit);
    return r.map(txFromRow);
  }
  async spentSince(ts: number) {
    const [r] = await this.db
      .select({
        v: sql<string | null>`coalesce(sum(case when ${s.opsTxs.status} in ('SENT','CONFIRMED') then ${s.opsTxs.amountWei} else 0 end),0) + coalesce(sum(case when ${s.opsTxs.hash} is not null then ${s.opsTxs.feeWei} else 0 end),0)`,
      })
      .from(s.opsTxs)
      .where(and(gte(s.opsTxs.createdAt, ts), sql`${s.opsTxs.kind} <> 'SWEEP'`));
    return BigInt(r?.v ?? 0);
  }
}

export async function createOffchainStore(databaseUrl?: string): Promise<OffchainStore & { close?: () => Promise<void> }> {
  return databaseUrl ? new PostgresOffchainStore(databaseUrl) : new MemoryOffchainStore();
}
