import type { PackId, Strategy } from '../types.js';

/**
 * Ledger buckets (BNB wei, signed entries; balance = Σ):
 *  TAX       gross side-specific tax of every indexed trade (informational, never spent)
 *  FLAP      flap.sh's cut (estimate, corrected by RECONCILE entries from real treasury receipts)
 *  PLATFORM  company share of what reaches the treasury (SWEEP debits it): 5% for creator machines (v3), 90% $FORGE/legacy
 *  POT       per machine virtual gacha pot (PULL_SPEND debits it, unclaimed sell-backs credit it): 90%×potShare (v3), 7%
 *  BUYBACK   global $FORGE buyback & burn (BUYBACK_SPEND debits it): 5% (v3), 3% ($FORGE/legacy)
 *  CREATOR   per machine, owed to the creator payout address: 90%×(1−potShare) (v3); CREATOR_PAID debits it
 *  DIVIDEND  per machine, sell-back proceeds owed to holders (payouts debit it; what is left is dust carry-over)
 *  BURN      per machine, sell-back proceeds owed to a buy & burn of the machine token
 */
export type Bucket = 'TAX' | 'FLAP' | 'PLATFORM' | 'POT' | 'BUYBACK' | 'DIVIDEND' | 'BURN' | 'CREATOR';
export const BUCKETS: Bucket[] = ['TAX', 'FLAP', 'PLATFORM', 'POT', 'BUYBACK', 'DIVIDEND', 'BURN', 'CREATOR'];

export type EntryKind =
  | 'TRADE_TAX'
  | 'RECONCILE'
  | 'PULL_SPEND'
  | 'PULL_REFUND'
  | 'SELLBACK'
  | 'DIVIDEND_PAID'
  | 'BURN_SPEND'
  | 'BUYBACK_SPEND'
  | 'SWEEP'
  | 'CREATOR_PAID'
  | 'ADJUST';

export interface LedgerEntry {
  /** Idempotency key: the same ref is never booked twice. */
  ref: string;
  ts: number;
  machine: string | null;
  bucket: Bucket;
  kind: EntryKind;
  /** Signed wei. */
  amountWei: bigint;
  txHash?: string | null;
  data?: Record<string, unknown>;
}

export type OpsTxStatus = 'QUEUED' | 'BLOCKED' | 'SENT' | 'CONFIRMED' | 'FAILED';
export type OpsTxKind = 'PULL' | 'SELLBACK' | 'DIVIDEND' | 'BURN' | 'BUYBACK' | 'DISPATCH' | 'SWEEP' | 'CREATOR_PAYOUT' | 'CARD_TRANSFER' | 'APPROVE' | 'OTHER';

export interface OpsTx {
  id: string;
  createdAt: number;
  updatedAt: number;
  kind: OpsTxKind;
  /** Contract function or 'transfer'. */
  label?: string;
  machine?: string | null;
  to?: string | null;
  /** BNB value sent (wei). */
  amountWei: bigint;
  /** Gas actually paid (wei), once known. */
  feeWei: bigint;
  hash?: string | null;
  status: OpsTxStatus;
  /** Queued/blocked attempts with the same key are recorded once. */
  dedupeKey?: string | null;
  error?: string | null;
  nonce?: number | null;
}

/** Stage of the single open pull of a machine (persisted for crash recovery; see docs/OFFCHAIN-OPS.md). */
export type OpenPullStage = 'STARTED' | 'SWAPPED' | 'BOUGHT' | 'SOLD';

export interface OpenPull {
  key: string;
  round: number;
  stage: OpenPullStage;
  startedAt: number;
  snapshotBlock: number;
  /** BNB the swap spent (debited from the pot). */
  bnbSpentWei?: string;
  usdtBought?: string;
  requestId?: string;
  error?: string;
}

/** Off-chain machine registration + indexing state. pack/strategy/split are immutable once stored. */
export interface Registration {
  token: string;
  txHash: string;
  createdBlock: number;
  createdAt: number;
  creator: string;
  taxProcessor: string;
  pack: PackId;
  strategy: Strategy;
  split?: { dividendBps: number; burnBps: number; lpBps: number };
  registeredBy: 'api' | 'auto' | 'forge';
  /**
   * TAX MODEL v3. Absent on registrations made before v3 → 'legacy' (fixed 2%, 90/7/3; never changed retroactively).
   */
  taxModel?: 'creator' | 'forge' | 'legacy';
  /** On-chain buy / sell tax (bps), verified at registration. */
  buyTaxBps?: number;
  sellTaxBps?: number;
  /** 'creator' model: pot share of the creator share (2000–10000). */
  potShareBps?: number;
  /** 'creator' model: where creator payouts go (signed at registration; default = launch tx sender). */
  payout?: string;
  /** Per-token measured treasury receipts vs gross tax (flap cut), cumulative wei (decimal strings). */
  measuredReceivedWei?: string;
  measuredGrossWei?: string;
  registeredAt: number;
  /** PancakeSwap V2 pair once graduated. */
  pool?: string;
  tokenIsToken0?: boolean;
  /** Last block whose logs were applied for this token. */
  syncedTo: number;
  /** TaxProcessor.totalQuoteSentToMarketing() at the last reconcile (wei, decimal). */
  sentToTreasuryWei: string;
  /** Ledger entry id up to which this machine's trade tax has been reconciled with real receipts. */
  reconciledToEntryId: number;
  lastPullAt: number;
  round: number;
  pullQueued: boolean;
  pullQueuedReason?: string;
  openPull?: OpenPull | null;
}

/** Portal TokenCreated whose tax recipient is the treasury; auto-registered after AUTO_REGISTER_DELAY_SEC. */
export interface Candidate {
  token: string;
  txHash: string;
  block: number;
  ts: number;
}

/** Dividend transfer waiting in the payout queue. */
export interface PendingPayout {
  pullKey: string;
  wallet: string;
  amountWei: string;
}
