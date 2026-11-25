import type { PackId, Strategy } from '../types.js';

export const PACK_PRICE_USD: Record<PackId, number> = { FORGE_28: 28, FORGE_48: 48, FORGE_88: 88 };
export const PACK_MAX_MULTIPLIER: Record<PackId, number> = { FORGE_28: 10, FORGE_48: 11, FORGE_88: 9.9 };

/** On-chain enum order (uint8) — keep in sync with contracts. */
export const PACK_BY_INDEX: PackId[] = ['FORGE_28', 'FORGE_48', 'FORGE_88'];
export const STRATEGY_BY_INDEX: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];

export const TOTAL_SUPPLY_DEFAULT = 1_000_000_000n * 10n ** 18n;
/** 0.01% of supply, expressed in basis points. */
export const ELIGIBILITY_BPS = 1n;

/** Renaiss sell-back rate by age of the pull. */
export function sellBackRate(ageSeconds: number): number {
  if (ageSeconds <= 3600) return 0.9;
  if (ageSeconds <= 86_400) return 0.85;
  if (ageSeconds <= 259_200) return 0.5;
  return 0;
}
