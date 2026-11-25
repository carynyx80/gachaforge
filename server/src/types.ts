import type { ForgeToken, ForgeTrade } from './forge/types.js';

// Shared data model — mirrors SPEC.md exactly. Do not change shapes without updating SPEC.
export type Strategy = 'RAFFLE' | 'HIT_HUNTER' | 'DIVIDEND' | 'BURN' | 'SPLIT';
export type PackId = 'FORGE_28' | 'FORGE_48' | 'FORGE_88';
export type Stage = 'CURVE' | 'GRADUATED';
export type Grader = 'PSA' | 'CGC' | 'BGS';

export const STRATEGIES: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];
export const PACKS: PackId[] = ['FORGE_28', 'FORGE_48', 'FORGE_88'];
export const STAGES: Stage[] = ['CURVE', 'GRADUATED'];

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
  /** OFF-CHAIN MODE: pot is full but the pull waits (no Renaiss key / ops wallet / paused). UI: "Pull queued — card buying starts soon". */
  pullQueued?: boolean;
}

export interface Card {
  name: string;
  set: string;
  grader: Grader;
  grade: string;
  image: string;
  valueUsd: number;
}

export interface Pull {
  id: string;
  machine: string;
  ticker: string;
  pack: PackId;
  round: number;
  card: Card;
  result: 'WON' | 'SOLD' | 'BURNED';
  winner?: string;
  proceedsBnb?: number;
  txHash: string;
  timestamp: number;
}

export type ActivityKind = 'TAX' | 'PULL_WON' | 'PULL_SOLD' | 'PAYOUT' | 'BURN' | 'NEW_MACHINE';

export interface ActivityEvent {
  id: string;
  ticker: string;
  machine: string;
  timestamp: number;
  kind: ActivityKind;
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

export interface Page<T> {
  items: T[];
  total: number;
}

/** Raffle proof as served by GET /api/raffles/:pullId. Extra fields beyond SPEC are additive. */
export interface RaffleProof {
  pullId: string;
  machine: string;
  snapshotBlock: number;
  snapshotHash: string;
  seed: string;
  /** balance = whole-token display units; balanceRaw = exact base units used for hashing/draw */
  eligible: { address: string; balance: number; balanceRaw: string }[];
  winner: string | null;
  blockHash?: string;
  hashFormat: string;
}

export interface DividendClaim {
  machine: string;
  epoch: number;
  root: string;
  wallet: string;
  amountWei: string;
  proof: string[];
  pushed: boolean;
}

/** One trade's 2% tax and how it splits (SPEC "Live fee flow"). All amounts USD. */
export interface FeeEvent {
  id: string;
  machine: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  trader: string;
  amountBnb: number;
  txHash: string;
  timestamp: number;
  /** 2% of the trade */
  taxUsd: number;
  /** flap.sh's cut (~10% of tax) */
  flapUsd: number;
  /** 90% of the rest -> company wallet */
  platformUsd: number;
  /** 7% of the rest -> this machine's gacha pot */
  potUsd: number;
  /** 3% of the rest -> $FORGE buyback */
  buybackUsd: number;
  /** machine pot incl. this trade (estimate until vault sync) */
  potAfterUsd: number;
  /** next pack price for this machine */
  packPriceUsd: number;
  /** true until the tax has been dispatched + synced into the vault on-chain */
  pending: boolean;
}

export interface FeeTotals {
  totalTaxUsd: number;
  flapUsd: number;
  platformUsd: number;
  potUsd: number;
  buybackUsd: number;
}

/** GET /api/fees/summary */
export interface FeeSummary extends FeeTotals {
  last24h: FeeTotals;
}

export type WsMessage =
  | { type: 'activity'; data: ActivityEvent }
  | { type: 'fee'; data: FeeEvent }
  | { type: 'pull'; data: Pull }
  | { type: 'stats'; data: Stats }
  | { type: 'machine'; data: Machine }
  | { type: 'forge'; data: ForgeToken }
  | { type: 'forgeTrade'; data: ForgeTrade };

/** A raffled card waiting for the provider to release it (end of the buyback window) before we forward it. */
export type CardReleaseStatus = 'PENDING' | 'DELIVERED' | 'FAILED';
export interface CardRelease {
  pullKey: string;
  tokenId: string;
  machine: string;
  ticker: string;
  winner: string;
  cardName: string;
  /** Unix seconds: earliest time the provider should have released the NFT to the operator wallet. */
  releaseAt: number;
  status: CardReleaseStatus;
  attempts: number;
  /** Unix seconds: next time the job looks at this row. */
  nextAttemptAt: number;
  lastError?: string;
  txHash?: string;
  createdAt: number;
  updatedAt: number;
}
