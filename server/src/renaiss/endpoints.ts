/**
 * Renaiss HTTP request/response shapes — ALL guesses until docs arrive.
 * TODO(renaiss): replace paths, bodies and response mapping once API docs are available.
 * Everything Renaiss-specific lives in this file so the client stays unchanged.
 */
import type { PackId } from '../types.js';
import type { BuyPackResult, PullInfo, SellBackQuote, SellBackResult, ProviderCard } from './provider.js';

export const RENAISS_PACK_IDS: Record<PackId, string> = {
  // TODO(renaiss): real pack SKUs for the $28 / $48 / $88 tiers
  FORGE_28: 'pack-28',
  FORGE_48: 'pack-48',
  FORGE_88: 'pack-88',
};

export const endpoints = {
  // TODO(renaiss): confirm paths
  buyPack: { method: 'POST', path: '/v1/packs/{packId}/purchase' },
  getPull: { method: 'GET', path: '/v1/pulls/{id}' },
  sellBack: { method: 'POST', path: '/v1/cards/{cardId}/sell-back' },
  quoteSellBack: { method: 'GET', path: '/v1/cards/{cardId}/sell-back/quote' },
  transferCard: { method: 'POST', path: '/v1/cards/{cardId}/transfer' },
} as const;

/** TODO(renaiss): auth scheme (bearer vs x-api-key). */
export function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

export const bodies = {
  buyPack: (paymentTx: string) => ({ paymentTxHash: paymentTx, chain: 'bsc' }), // TODO(renaiss)
  transferCard: (to: string) => ({ toAddress: to }), // TODO(renaiss)
};

// ---- response mapping (TODO(renaiss): field names) ----
type Raw = Record<string, any>;

export function mapCard(r: Raw): ProviderCard {
  return {
    id: String(r.id ?? r.cardId),
    name: String(r.name ?? r.title ?? 'Unknown card'),
    set: String(r.set ?? r.setName ?? ''),
    grader: (r.grader ?? r.gradingCompany ?? 'PSA') as ProviderCard['grader'],
    grade: String(r.grade ?? ''),
    image: String(r.image ?? r.imageUrl ?? ''),
    valueUsd: Number(r.valueUsd ?? r.fmv ?? r.marketValue ?? 0),
  };
}
const ts = (v: unknown) => (typeof v === 'number' ? v : v ? Math.floor(new Date(String(v)).getTime() / 1000) : Math.floor(Date.now() / 1000));

export const parse = {
  buyPack: (r: Raw): BuyPackResult => ({ pullId: String(r.pullId ?? r.id), card: mapCard(r.card ?? r), purchasedAt: ts(r.purchasedAt ?? r.createdAt) }),
  getPull: (r: Raw): PullInfo => ({
    id: String(r.id),
    status: (r.status ?? 'REVEALED') as PullInfo['status'],
    card: r.card ? mapCard(r.card) : undefined,
    purchasedAt: ts(r.purchasedAt ?? r.createdAt),
  }),
  quote: (cardId: string, r: Raw): SellBackQuote => ({
    cardId,
    valueUsd: Number(r.valueUsd ?? r.fmv ?? 0),
    rate: Number(r.rate ?? r.sellBackRate ?? 0),
    proceedsUsd: Number(r.proceedsUsd ?? r.amountUsd ?? 0),
  }),
  sellBack: (cardId: string, r: Raw): SellBackResult => ({ ...parse.quote(cardId, r), txRef: String(r.txRef ?? r.txHash ?? r.id ?? '') }),
};
