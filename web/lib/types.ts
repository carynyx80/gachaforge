// Types mirror SPEC.md "Data model" exactly.
export type Strategy = 'RAFFLE' | 'HIT_HUNTER' | 'DIVIDEND' | 'BURN' | 'SPLIT';
export type PackId = 'FORGE_28' | 'FORGE_48' | 'FORGE_88';
export type Stage = 'CURVE' | 'GRADUATED';

export interface Machine {
  address: string;
  vault: string;
  name: string;
  ticker: string;
  description: string;
  image: string;
  creator: string;
  createdAt: number;
  pack: PackId;
  packPriceUsd: number;
  strategy: Strategy;
  taxBps: number;
  split?: { dividendBps: number; burnBps: number; lpBps: number };
  stage: Stage;
  bondingCurvePct: number;
  marketCapUsd: number;
  change24hPct: number;
  volume24hUsd: number;
  holders: number;
  eligibleHolders: number;
  potUsd: number;
  packsOpened: number;
  round: number;
  paidToHoldersBnb: number;
  burnedTokens: number;
  links?: { website?: string; x?: string; telegram?: string };
  /** Off-chain mode: pot ≥ pack price but card buying (Renaiss) isn't enabled yet. */
  pullQueued?: boolean;
}

export interface Pull {
  id: string;
  machine: string;
  ticker: string;
  pack: PackId;
  round: number;
  card: { name: string; set: string; grader: 'PSA' | 'CGC' | 'BGS'; grade: string; image: string; valueUsd: number };
  result: 'WON' | 'SOLD' | 'BURNED';
  winner?: string;
  proceedsBnb?: number;
  txHash: string;
  timestamp: number;
}

export interface ActivityEvent {
  id: string;
  ticker: string;
  machine: string;
  timestamp: number;
  kind: 'TAX' | 'PULL_WON' | 'PULL_SOLD' | 'PAYOUT' | 'BURN' | 'NEW_MACHINE';
  text: string;
  amountUsd?: number;
}

export interface Stats {
  potsUsd: number;
  packsOpened: number;
  cardsAwarded: number;
  burnedUsd: number;
  launches: number;
}
export interface BurnEvent {
  id: string;
  kind: 'BUYBACK' | 'BURN';
  amount: number;
  txHash: string;
  timestamp: number;
}
export interface RewardsView {
  address: string;
  eligible: boolean;
  balance: number;
  minBalance: number;
  oddsPct: number;
  claimableBnb: number;
  totalEarnedBnb: number;
  /** Off-chain mode: BNB already pushed to this wallet by dividend rounds (optional; hidden if absent). */
  paidBnb?: number;
  /** Off-chain mode: recent dividend payouts to this wallet (optional). */
  payouts?: { amountBnb: number; txHash: string; timestamp: number }[];
}

/** GET /api/health */
export type HealthMode = 'mock' | 'live' | 'offchain' | 'vault';
export interface Health {
  mode: HealthMode;
  chainId?: number;
  treasury?: string;
  /** Off-chain mode: ops hot wallet configured + funded. */
  opsReady?: boolean;
  /** Off-chain mode: Renaiss card buying enabled. */
  renaissReady?: boolean;
}

/** Normalised GET /api/transparency (SPEC "OFF-CHAIN MODE"). All amounts in BNB. */
export interface TransparencyTx {
  hash: string;
  kind: string;
  valueBnb?: number;
  to?: string;
  machine?: string;
  ticker?: string;
  timestamp?: number;
  status?: string;
  label?: string;
}
export interface TransparencyMachine {
  address: string;
  ticker?: string;
  name?: string;
  potBnb?: number;
  potUsd?: number;
  packPriceUsd?: number;
  creditedBnb?: number;
  taxBnb?: number;
  dividendsPendingBnb?: number;
  spentBnb?: number;
  pulls?: number;
  pullQueued?: boolean;
}
export interface Transparency {
  treasury: { address?: string; balanceBnb?: number };
  ops: { address?: string; balanceBnb?: number };
  owed: { pots: number; buyback: number; dividendsPending: number; burnsPending?: number; total?: number };
  machines?: TransparencyMachine[];
  txs: TransparencyTx[];
  updatedAt?: number;
}

export interface Trade {
  side: 'BUY' | 'SELL';
  trader: string;
  amountBnb: number;
  tokens: number;
  taxUsd: number;
  txHash: string;
  timestamp: number;
}

export interface RaffleProof {
  snapshotBlock: number;
  snapshotHash: string;
  seed: string;
  eligible: { address: string; balance: number }[];
  winner: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export type MachineSort = 'trending' | 'new' | 'most_pulled' | 'market_cap';

export interface MachineQuery {
  sort?: MachineSort;
  strategy?: Strategy | '';
  pack?: PackId | '';
  stage?: Stage | '';
  page?: number;
  pageSize?: number;
}

export const PACK_PRICE: Record<PackId, number> = { FORGE_28: 28, FORGE_48: 48, FORGE_88: 88 };

/** Unclaimed dividend round with merkle proof (GET /api/machines/:address/claims/:wallet). */
export interface DividendClaim { machine: string; epoch: number; root: string; wallet: string; amountWei: string; proof: string[]; pushed: boolean }
