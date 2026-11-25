import type { PackId, Strategy } from '../types.js';

export const PACK_PRICE_USD: Record<PackId, number> = { FORGE_28: 28, FORGE_48: 48, FORGE_88: 88 };
export const PACK_MAX_MULTIPLIER: Record<PackId, number> = { FORGE_28: 10, FORGE_48: 11, FORGE_88: 9.9 };

/** On-chain enum order (uint8) — keep in sync with contracts. */
export const PACK_BY_INDEX: PackId[] = ['FORGE_28', 'FORGE_48', 'FORGE_88'];
export const STRATEGY_BY_INDEX: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];

export const TOTAL_SUPPLY_DEFAULT = 1_000_000_000n * 10n ** 18n;
/** 0.01% of supply, expressed in basis points. */
export const ELIGIBILITY_BPS = 1n;

/** Legacy fixed tax (v2) — still the default for machines registered before TAX MODEL v3. */
export const TAX_BPS = 200;
/** How the vault splits the tax it receives (flap.sh keeps its cut before the vault). Shares sum to 10_000. */
export const TREASURY_SHARE_BPS = 9_000;
export const POT_SHARE_BPS = 700;
export const BUYBACK_SHARE_BPS = 300; // $FORGE buyback & burn
/** flap.sh keeps ~10% of the tax (≈0.2% of a trade at 2%) before the rest reaches the vault. */
export const FLAP_CUT_BPS = 1000;

// ── TAX MODEL v3 (SPEC "TAX MODEL v3") ──
/** Creator-chosen buy / sell tax bounds (flap.sh limits, whole % only). */
export const MIN_TAX_BPS = 100;
export const MAX_TAX_BPS = 1000;
export const TAX_STEP_BPS = 100;
/** GachaForge share of what reaches the treasury (after flap's cut). */
export const GF_SHARE_BPS = 1000;
/** Of the GF share: company / $FORGE buyback. */
export const GF_COMPANY_BPS = 5000;
export const GF_BUYBACK_BPS = 5000;
/** Minimum gacha-pot share of the creator share (the creator share is 10000 − GF_SHARE_BPS of net). */
export const CREATOR_POT_MIN_BPS = 2000;
export const CREATOR_POT_MAX_BPS = 10_000;

/**
 * How a machine's net tax splits:
 *  - 'creator' (v3 machine tokens): 10% GF (5% company / 5% buyback), 90% creator share = pot (potShareBps) + creator payout
 *  - 'forge'   ($FORGE): 90% company / 7% pot / 3% buyback
 *  - 'legacy'  (v2 registrations, fixed 2% tax): 90% company / 7% pot / 3% buyback
 */
export type TaxModel = 'creator' | 'forge' | 'legacy';

export interface MachineTax {
  model?: TaxModel;
  /** Of the creator share (2000–10000); 'creator' model only. */
  potShareBps?: number;
}

export const isValidTaxBps = (bps: number) => Number.isInteger(bps) && bps >= MIN_TAX_BPS && bps <= MAX_TAX_BPS && bps % TAX_STEP_BPS === 0;
export const isValidPotShareBps = (bps: number) => Number.isInteger(bps) && bps >= CREATOR_POT_MIN_BPS && bps <= CREATOR_POT_MAX_BPS;

/** Side-specific tax of a machine (old machines only have taxBps). */
export function sideTaxBps(m: { taxBps?: number; buyTaxBps?: number; sellTaxBps?: number }, side: 'BUY' | 'SELL'): number {
  const v = side === 'BUY' ? m.buyTaxBps : m.sellTaxBps;
  return v ?? m.taxBps ?? TAX_BPS;
}

export interface NetSplit<T> {
  /** Company (platform) share — swept with the rest of the platform money. */
  company: T;
  pot: T;
  buyback: T;
  /** Owed to the creator's payout address ('creator' model only, else 0). */
  creator: T;
}

/**
 * Splits the net tax (what reached the treasury) for a machine. Integer (wei) math; parts always sum exactly to `net`
 * (the company share absorbs rounding for forge/legacy; the creator payout absorbs it within the creator share).
 * Works for negative corrections too.
 */
export function splitNetWei(net: bigint, t: MachineTax = {}): NetSplit<bigint> {
  const B = 10_000n;
  if (t.model === 'creator') {
    const gf = (net * BigInt(GF_SHARE_BPS)) / B;
    const company = (gf * BigInt(GF_COMPANY_BPS)) / B;
    const buyback = gf - company;
    const creatorShare = net - gf;
    const pot = (creatorShare * BigInt(t.potShareBps ?? CREATOR_POT_MAX_BPS)) / B;
    return { company, buyback, pot, creator: creatorShare - pot };
  }
  const pot = (net * BigInt(POT_SHARE_BPS)) / B;
  const buyback = (net * BigInt(BUYBACK_SHARE_BPS)) / B;
  return { company: net - pot - buyback, pot, buyback, creator: 0n };
}

export interface FeeSplit {
  taxUsd: number;
  flapUsd: number;
  /** = companyUsd */
  platformUsd: number;
  potUsd: number;
  buybackUsd: number;
  creatorUsd: number;
  companyUsd: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Splits one trade's tax (USD, cent precision): tax = trade × taxBps; flap.sh takes FLAP_CUT_BPS of it; the rest is split
 * by the machine's tax model (see splitNetWei). Company absorbs rounding so the parts sum to taxUsd.
 */
export function feeSplit(tradeUsd: number, taxBps = TAX_BPS, t: MachineTax = {}): FeeSplit {
  const taxUsd = cents((tradeUsd * taxBps) / 10_000);
  const flapUsd = cents((taxUsd * FLAP_CUT_BPS) / 10_000);
  const rest = taxUsd - flapUsd;
  let potUsd: number;
  let buybackUsd: number;
  let creatorUsd = 0;
  if (t.model === 'creator') {
    const gf = (rest * GF_SHARE_BPS) / 10_000;
    buybackUsd = cents((gf * GF_BUYBACK_BPS) / 10_000);
    const creatorShare = rest - gf;
    potUsd = cents((creatorShare * (t.potShareBps ?? CREATOR_POT_MAX_BPS)) / 10_000);
    creatorUsd = cents(creatorShare - potUsd);
  } else {
    potUsd = cents((rest * POT_SHARE_BPS) / 10_000);
    buybackUsd = cents((rest * BUYBACK_SHARE_BPS) / 10_000);
  }
  const companyUsd = cents(taxUsd - flapUsd - potUsd - buybackUsd - creatorUsd);
  return { taxUsd, flapUsd, platformUsd: companyUsd, potUsd, buybackUsd, creatorUsd, companyUsd };
}

export interface TaxSplit {
  pot: number;
  buyback: number;
  treasury: number;
}

/** Splits a tax amount (any unit) into pot / $FORGE buyback / treasury; treasury absorbs rounding. */
export function splitTax(amount: number): TaxSplit {
  const pot = (amount * POT_SHARE_BPS) / 10_000;
  const buyback = (amount * BUYBACK_SHARE_BPS) / 10_000;
  return { pot, buyback, treasury: amount - pot - buyback };
}

/** Renaiss sell-back rate by age of the pull. */
export function sellBackRate(ageSeconds: number): number {
  if (ageSeconds <= 3600) return 0.9;
  if (ageSeconds <= 86_400) return 0.85;
  if (ageSeconds <= 259_200) return 0.5;
  return 0;
}
