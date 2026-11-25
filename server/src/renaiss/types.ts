import type { Card, PackId } from '../types.js';

/** A pulled card as the provider reports it. `Card` fields are what we store/serve (SPEC); the rest is provider bookkeeping. */
export interface ProviderCard extends Card {
  /** ERC-721 token id on RenaissRegistry (decimal string). */
  tokenId: string;
  /** Renaiss settlement id (bytes32), needed to sell the card back. */
  settlementId: string;
  /** Renaiss catalog pack UUID (buyback batches must share it). */
  cardPackId?: string;
  tier?: string | null;
  type?: string;
  certNumber?: string;
  releaseTxHash?: string | null;
  /** Unix seconds when the provider releases the NFT to the buyer wallet (end of the buyback window). */
  releaseAt?: number;
}

export interface PackCost {
  /** USDT base units (18 decimals) for one pull. */
  usdt: bigint;
  /** Same price in whole USD. */
  usd: number;
}

export interface BuyPackResult {
  /** Provider request id (Renaiss requestId). */
  pullId: string;
  /**
   * Usually one card. Renaiss can return several draws per pull (numOfTokens); we always buy 1, but if more come
   * back we keep them all: value is summed, a raffle winner gets every card, a sell-back batches them.
   */
  cards: ProviderCard[];
  totalValueUsd: number;
  /** USDT base units actually charged. */
  paidUsdt: bigint;
  purchasedAt: number; // unix seconds
  fundingTxHash?: string;
}

export interface SellBackQuote {
  settlementIds: string[];
  valueUsd: number;
  /** buybackPercentage / 100 of the current tier (0.9 / 0.85 / 0.5). */
  rate: number;
  proceedsUsdt: bigint;
  proceedsUsd: number;
}

export interface SellBackResult extends SellBackQuote {
  txRef: string;
}

export interface ReleaseStatus {
  released: boolean;
  /** Current on-chain owner, when known. */
  owner?: string;
  releaseAt?: number;
}

/** Abstraction over the card source (Renaiss in prod, SimulatedProvider in dev/tests). */
export interface CardProvider {
  readonly name: string;
  /** Current price of one pull, used to size the BNB→USDT swap. */
  packCost(packId: PackId): Promise<PackCost>;
  /**
   * Buy one pack with the operator wallet's USDT. `onSubmitted` fires as soon as a provider request id exists, so the
   * caller can persist it for recovery before the (possibly long) wait for the draw.
   */
  buyPack(packId: PackId, opts?: { onSubmitted?: (requestId: string) => void | Promise<void> }): Promise<BuyPackResult>;
  quoteSellBack(cards: ProviderCard[]): Promise<SellBackQuote>;
  sellBack(cards: ProviderCard[]): Promise<SellBackResult>;
  /** Is the NFT in the operator wallet yet (buyback window over)? */
  releaseStatus(card: Pick<ProviderCard, 'tokenId' | 'releaseAt'>): Promise<ReleaseStatus>;
  /** Forward a released card from the operator wallet to `to`. Returns the tx hash. */
  transferCard(tokenId: string, to: string): Promise<string>;
}

export const toCard = (c: Card): Card => ({ name: c.name, set: c.set, grader: c.grader, grade: c.grade, image: c.image, valueUsd: c.valueUsd });

/** The single Card we record for a pull: the most valuable draw, carrying the summed value of all draws. */
export function summaryCard(cards: ProviderCard[]): Card {
  if (!cards.length) throw new Error('pull returned no cards');
  const top = [...cards].sort((a, b) => b.valueUsd - a.valueUsd)[0];
  const total = Math.round(cards.reduce((s, c) => s + c.valueUsd, 0) * 100) / 100;
  const extra = cards.length > 1 ? ` +${cards.length - 1} more` : '';
  return { ...toCard(top), name: top.name + extra, valueUsd: total };
}
