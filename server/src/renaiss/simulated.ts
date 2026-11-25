import { randomUUID } from 'node:crypto';
import { PACK_MAX_MULTIPLIER, PACK_PRICE_USD, sellBackRate } from '../core/packs.js';
import type { Grader, PackId } from '../types.js';
import type { BuyPackResult, CardProvider, ProviderCard, PullInfo } from './provider.js';

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
  const id = `sim-${Math.floor(rng() * 1e12).toString(36)}`;
  return {
    id,
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
  private pulls = new Map<string, PullInfo & { card: ProviderCard }>();
  private byCard = new Map<string, string>();

  constructor(
    private rng: Rng = Math.random,
    private clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async buyPack(packId: PackId, _paymentTx: string): Promise<BuyPackResult> {
    const card = randomCard(packId, this.rng);
    const id = randomUUID();
    const purchasedAt = this.clock();
    this.pulls.set(id, { id, status: 'REVEALED', card, purchasedAt });
    this.byCard.set(card.id, id);
    return { pullId: id, card, purchasedAt };
  }
  async getPull(id: string) {
    const p = this.pulls.get(id);
    if (!p) throw new Error(`unknown pull ${id}`);
    return { ...p };
  }
  async quoteSellBack(cardId: string) {
    const p = this.pulls.get(this.byCard.get(cardId) ?? '');
    if (!p) throw new Error(`unknown card ${cardId}`);
    const rate = sellBackRate(this.clock() - p.purchasedAt);
    return { cardId, valueUsd: p.card.valueUsd, rate, proceedsUsd: Math.round(p.card.valueUsd * rate * 100) / 100 };
  }
  async sellBack(cardId: string) {
    const q = await this.quoteSellBack(cardId);
    const p = this.pulls.get(this.byCard.get(cardId)!)!;
    if (p.status === 'SOLD') throw new Error(`card ${cardId} already sold`);
    p.status = 'SOLD';
    return { ...q, txRef: `sim-sell-${cardId}` };
  }
  async transferCard(cardId: string, _to: string) {
    const p = this.pulls.get(this.byCard.get(cardId) ?? '');
    if (p) p.status = 'TRANSFERRED';
  }
}
