import type { Strategy } from '../types.js';

export type Outcome = 'RAFFLE' | 'SELL';

/** What to do with a freshly pulled card. */
export function decideOutcome(p: {
  strategy: Strategy;
  cardValueUsd: number;
  packPriceUsd: number;
  eligibleCount: number;
}): Outcome {
  switch (p.strategy) {
    case 'RAFFLE':
      return p.eligibleCount > 0 ? 'RAFFLE' : 'SELL';
    case 'HIT_HUNTER':
      return p.cardValueUsd > p.packPriceUsd && p.eligibleCount > 0 ? 'RAFFLE' : 'SELL';
    default:
      return 'SELL';
  }
}

export interface ProceedsSplit {
  dividend: bigint;
  burn: bigint;
  lp: bigint;
  pot: bigint;
}

/**
 * Where sell-back proceeds go (mirrors vault.depositProceeds logic).
 * RAFFLE (no eligible) -> pot; HIT_HUNTER/BURN -> burn; DIVIDEND -> dividend;
 * SPLIT -> by creator bps (pre-graduation LP share burned instead).
 */
export function splitProceeds(
  amount: bigint,
  strategy: Strategy,
  split?: { dividendBps: number; burnBps: number; lpBps: number },
  graduated = true,
): ProceedsSplit {
  const z = { dividend: 0n, burn: 0n, lp: 0n, pot: 0n };
  switch (strategy) {
    case 'RAFFLE':
      return { ...z, pot: amount };
    case 'HIT_HUNTER':
    case 'BURN':
      return { ...z, burn: amount };
    case 'DIVIDEND':
      return { ...z, dividend: amount };
    case 'SPLIT': {
      if (!split) throw new Error('SPLIT strategy requires split bps');
      if (split.dividendBps + split.burnBps + split.lpBps !== 10_000) throw new Error('split bps must sum to 10000');
      const dividend = (amount * BigInt(split.dividendBps)) / 10_000n;
      let lp = (amount * BigInt(split.lpBps)) / 10_000n;
      let burn = amount - dividend - lp; // burn absorbs rounding
      if (!graduated) {
        burn += lp;
        lp = 0n;
      }
      return { ...z, dividend, burn, lp };
    }
  }
}

/** Pull gating: pot covers the pack, nothing open, cooldown elapsed. */
export function canOpenPull(p: {
  potWei: bigint;
  packCostWei: bigint;
  hasOpenPull: boolean;
  lastPullAt: number;
  cooldownSec: number;
  now: number;
  paused?: boolean;
}): boolean {
  if (p.paused || p.hasOpenPull) return false;
  if (p.potWei < p.packCostWei) return false;
  return p.now - p.lastPullAt >= p.cooldownSec;
}
