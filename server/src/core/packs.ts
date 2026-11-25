import type { PackId, Strategy } from '../types.js';

export const PACK_PRICE_USD: Record<PackId, number> = { FORGE_28: 28, FORGE_48: 48, FORGE_88: 88 };
export const PACK_MAX_MULTIPLIER: Record<PackId, number> = { FORGE_28: 10, FORGE_48: 11, FORGE_88: 9.9 };

/** On-chain enum order (uint8) — keep in sync with contracts. */
export const PACK_BY_INDEX: PackId[] = ['FORGE_28', 'FORGE_48', 'FORGE_88'];
export const STRATEGY_BY_INDEX: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];

export const TOTAL_SUPPLY_DEFAULT = 1_000_000_000n * 10n ** 18n;
/** 0.01% of supply, expressed in basis points. */
export const ELIGIBILITY_BPS = 1n;

/** Every machine token's trading tax is fixed: 2% buy / 2% sell (keep in sync with contracts). */
export const TAX_BPS = 200;
/** How the vault splits the tax it receives (flap.sh keeps its cut before the vault). Shares sum to 10_000. */
export const TREASURY_SHARE_BPS = 9_000;
export const POT_SHARE_BPS = 700;
export const BUYBACK_SHARE_BPS = 300; // $FORGE buyback & burn
/** flap.sh keeps ~10% of the tax (≈0.2% of a trade at 2%) before the rest reaches the vault. */
export const FLAP_CUT_BPS = 1000;

export interface FeeSplit {
  taxUsd: number;
  flapUsd: number;
  platformUsd: number;
  potUsd: number;
  buybackUsd: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Splits one trade's tax (USD, cent precision): tax = trade × taxBps; flap.sh takes FLAP_CUT_BPS of it; the rest is split
 * pot / buyback / treasury by the vault shares. Platform (treasury) absorbs rounding so the parts sum to taxUsd.
 */
export function feeSplit(tradeUsd: number, taxBps = TAX_BPS): FeeSplit {
  const taxUsd = cents((tradeUsd * taxBps) / 10_000);
  const flapUsd = cents((taxUsd * FLAP_CUT_BPS) / 10_000);
  const rest = taxUsd - flapUsd;
  const potUsd = cents((rest * POT_SHARE_BPS) / 10_000);
  const buybackUsd = cents((rest * BUYBACK_SHARE_BPS) / 10_000);
  return { taxUsd, flapUsd, platformUsd: cents(taxUsd - flapUsd - potUsd - buybackUsd), potUsd, buybackUsd };
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
