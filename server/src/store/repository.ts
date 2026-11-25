import type { ActivityEvent, BurnEvent, DividendClaim, Machine, Page, Pull, RaffleProof, Trade } from '../types.js';

export interface HolderRow {
  address: string;
  balance: bigint;
}

export interface RewardsRow {
  claimableBnb: number;
  totalEarnedBnb: number;
}

/**
 * Storage contract. Two implementations: MemoryRepository (default) and
 * PostgresRepository (Drizzle, when DATABASE_URL is set). All addresses are stored lowercase.
 */
export interface Repository {
  init(): Promise<void>;
  close(): Promise<void>;

  upsertMachine(m: Machine): Promise<void>;
  getMachine(address: string): Promise<Machine | null>;
  listMachines(): Promise<Machine[]>;

  /** Merges into an existing pull with the same id. */
  upsertPull(p: Pull): Promise<void>;
  getPull(id: string): Promise<Pull | null>;
  /** Newest first. */
  listPulls(opts: { machine?: string; offset: number; limit: number }): Promise<Page<Pull>>;

  addTrade(machine: string, t: Trade): Promise<void>;
  listTrades(machine: string, offset: number, limit: number): Promise<Page<Trade>>;

  addActivity(e: ActivityEvent): Promise<void>;
  listActivity(limit: number): Promise<ActivityEvent[]>;

  addBurn(b: BurnEvent): Promise<void>;
  listBurns(offset: number, limit: number): Promise<Page<BurnEvent> & { totalBurned: number }>;

  setRaffleProof(p: RaffleProof): Promise<void>;
  getRaffleProof(pullId: string): Promise<RaffleProof | null>;

  applyTransfer(machine: string, from: string, to: string, amount: bigint): Promise<void>;
  setBalance(machine: string, holder: string, amount: bigint): Promise<void>;
  getBalance(machine: string, holder: string): Promise<bigint>;
  /** Non-zero balances only. */
  getBalances(machine: string): Promise<HolderRow[]>;

  creditRewards(machine: string, wallet: string, amountBnb: number): Promise<void>;
  debitClaimable(machine: string, wallet: string, amountBnb: number): Promise<void>;
  getRewards(machine: string, wallet: string): Promise<RewardsRow>;

  saveDividendClaims(claims: DividendClaim[]): Promise<void>;
  getDividendClaims(machine: string, wallet: string): Promise<DividendClaim[]>;
  markClaimPushed(machine: string, epoch: number, wallet: string): Promise<void>;

  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  incrCounter(name: string, by: number): Promise<number>;
  getCounter(name: string): Promise<number>;
}

export const lc = (a: string) => a.toLowerCase();
