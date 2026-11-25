import { randomUUID } from 'node:crypto';
import { PACK_MAX_MULTIPLIER, PACK_PRICE_USD, sellBackRate } from '../core/packs.js';
import type { Grader, PackId } from '../types.js';
import { ONE_USDT } from './networks.js';
import type { BuyPackResult, CardProvider, PackCost, ProviderCard, ReleaseStatus, SellBackQuote, SellBackResult } from './types.js';

// Invented, generic names only — no real franchises or trademarks.
const CREATURES = ['Ember Drake', 'Tidal Wisp', 'Volt Fox', 'Moss Golem', 'Frost Lynx', 'Shadow Moth', 'Crystal Ram', 'Storm Kite', 'Dune Serpent', 'Neon Koi', 'Iron Beetle', 'Solar Owl', 'Void Jackal', 'Bloom Sprite', 'Quartz Tortoise', 'Plasma Hound'];
const VARIANTS = ['', 'Holo', 'Full Art', 'Alt Art', 'Secret Rare', 'Gold Foil', 'Shadowless', 'First Edition'];
const SETS = ['Forge Origins', 'Neon Drift', 'Arcade Legends', 'Midnight Circuit', 'Lime Nova', 'Glitch Era'];
const GRADERS: Grader[] = ['PSA', 'CGC', 'BGS'];
const GRADES: Record<Grader, string[]> = { PSA: ['8', '9', '10'], CGC: ['8.5', '9', '9.5', '10'], BGS: ['8.5', '9', '9.5', '10'] };

export type Rng = () => number;

/** Mulberry32 — deterministic RNG for reproducible mock data. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, xs: T[]) => xs[Math.floor(rng() * xs.length)];

/** Value distribution: mostly 0.3x–1.2x pack price, ~15% 1.2x–3x, ~3% chase up to max multiplier. */
export function randomCard(pack: PackId, rng: Rng = Math.random): ProviderCard {
  const price = PACK_PRICE_USD[pack];
  const r = rng();
  let mult: number;
  if (r < 0.82) mult = 0.3 + rng() * 0.9;
  else if (r < 0.97) mult = 1.2 + rng() * 1.8;
  else mult = 3 + rng() * (PACK_MAX_MULTIPLIER[pack] - 3);
  const grader = pick(rng, GRADERS);
  const variant = pick(rng, VARIANTS);
  const name = [pick(rng, CREATURES), variant].filter(Boolean).join(' ');
  const n = Math.floor(rng() * 1e12);
  const id = `sim-${n.toString(36)}`;
  const tokenId = String(n);
  return {
    tokenId,
    settlementId: id,
    name,
    set: pick(rng, SETS),
    grader,
    grade: pick(rng, GRADES[grader]),
    image: `https://picsum.photos/seed/${id}/400/560`,
    valueUsd: Math.round(price * mult * 100) / 100,
  };
}

export class SimulatedProvider implements CardProvider {
  readonly name = 'simulated';
  private pulls = new Map<string, { id: string; card: ProviderCard; purchasedAt: number; sold: boolean; owner: string }>();
  private bySettlement = new Map<string, string>();
  private byToken = new Map<string, string>();

  constructor(
    private rng: Rng = Math.random,
    private clock: () => number = () => Math.floor(Date.now() / 1000),
    /** Address that "receives" released cards (the operator wallet in prod). */
    private operator = '0x000000000000000000000000000000000000dEaD',
    private releaseAfterSeconds = 259_200,
  ) {}

  async packCost(packId: PackId): Promise<PackCost> {
    return { usdt: BigInt(PACK_PRICE_USD[packId]) * ONE_USDT, usd: PACK_PRICE_USD[packId] };
  }

  async buyPack(packId: PackId, opts: { onSubmitted?: (requestId: string) => void | Promise<void> } = {}): Promise<BuyPackResult> {
    const purchasedAt = this.clock();
    const card = { ...randomCard(packId, this.rng), releaseAt: purchasedAt + this.releaseAfterSeconds };
    const id = randomUUID();
    await opts.onSubmitted?.(id);
    this.pulls.set(id, { id, card, purchasedAt, sold: false, owner: 'inventory' });
    this.bySettlement.set(card.settlementId, id);
    this.byToken.set(card.tokenId, id);
    return { pullId: id, cards: [card], totalValueUsd: card.valueUsd, paidUsdt: (await this.packCost(packId)).usdt, purchasedAt };
  }

  private pullFor(c: Pick<ProviderCard, 'settlementId'>) {
    const p = this.pulls.get(this.bySettlement.get(c.settlementId) ?? '');
    if (!p) throw new Error(`unknown card ${c.settlementId}`);
    return p;
  }

  async quoteSellBack(cards: ProviderCard[]): Promise<SellBackQuote> {
    const ps = cards.map((c) => this.pullFor(c));
    const rate = sellBackRate(this.clock() - ps[0].purchasedAt);
    const valueUsd = Math.round(ps.reduce((s, p) => s + p.card.valueUsd, 0) * 100) / 100;
    const proceedsUsd = Math.round(valueUsd * rate * 100) / 100;
    return { settlementIds: cards.map((c) => c.settlementId), valueUsd, rate, proceedsUsd, proceedsUsdt: BigInt(Math.round(proceedsUsd * 100)) * (ONE_USDT / 100n) };
  }

  async sellBack(cards: ProviderCard[]): Promise<SellBackResult> {
    const q = await this.quoteSellBack(cards);
    for (const c of cards) {
      const p = this.pullFor(c);
      if (p.sold) throw new Error(`card ${c.settlementId} already sold`);
    }
    for (const c of cards) this.pullFor(c).sold = true;
    return { ...q, txRef: `sim-sell-${cards[0].settlementId}` };
  }

  async releaseStatus(card: Pick<ProviderCard, 'tokenId' | 'releaseAt'>): Promise<ReleaseStatus> {
    const p = this.pulls.get(this.byToken.get(card.tokenId) ?? '');
    if (!p) return { released: false };
    if (p.owner === 'inventory' && !p.sold && this.clock() >= (p.card.releaseAt ?? 0)) p.owner = this.operator;
    return { released: p.owner === this.operator, owner: p.owner, releaseAt: p.card.releaseAt };
  }

  async transferCard(tokenId: string, to: string): Promise<string> {
    const p = this.pulls.get(this.byToken.get(tokenId) ?? '');
    if (!p || p.owner !== this.operator) throw new Error(`card ${tokenId} not released`);
    p.owner = to;
    return `0xsim-transfer-${tokenId}`;
  }
}
