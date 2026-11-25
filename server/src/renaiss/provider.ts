import type { Card, PackId } from '../types.js';

export interface ProviderCard extends Card {
  id: string;
}

export interface BuyPackResult {
  pullId: string;
  card: ProviderCard;
  purchasedAt: number; // unix seconds
}

export interface PullInfo {
  id: string;
  status: 'PENDING' | 'REVEALED' | 'SOLD' | 'SHIPPED' | 'TRANSFERRED';
  card?: ProviderCard;
  purchasedAt: number;
}

export interface SellBackQuote {
  cardId: string;
  valueUsd: number;
  rate: number; // 0.9 / 0.85 / 0.5
  proceedsUsd: number;
}

export interface SellBackResult extends SellBackQuote {
  txRef: string;
}

/** Abstraction over the card source (Renaiss in prod, SimulatedProvider in dev/tests). */
export interface CardProvider {
  readonly name: string;
  buyPack(packId: PackId, paymentTx: string): Promise<BuyPackResult>;
  getPull(id: string): Promise<PullInfo>;
  sellBack(cardId: string): Promise<SellBackResult>;
  quoteSellBack(cardId: string): Promise<SellBackQuote>;
  /** Transfer the physical/vaulted card to a raffle winner. Optional until Renaiss confirms the flow. */
  transferCard?(cardId: string, toAddress: string): Promise<void>;
}
