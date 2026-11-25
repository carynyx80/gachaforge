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
