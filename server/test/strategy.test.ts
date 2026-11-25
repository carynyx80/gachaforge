import { describe, expect, it } from 'vitest';
import { BUYBACK_SHARE_BPS, canOpenPull, decideOutcome, POT_SHARE_BPS, sellBackRate, splitProceeds, splitTax, TAX_BPS, TREASURY_SHARE_BPS } from '../src/core/index.js';

describe('tax economics', () => {
  it('fixed 2% tax split 90% treasury / 7% pot / 3% $FORGE buyback', () => {
    expect(TAX_BPS).toBe(200);
    expect([TREASURY_SHARE_BPS, POT_SHARE_BPS, BUYBACK_SHARE_BPS]).toEqual([9000, 700, 300]);
    expect(TREASURY_SHARE_BPS + POT_SHARE_BPS + BUYBACK_SHARE_BPS).toBe(10_000);
    const s = splitTax(100);
    expect(s.pot).toBeCloseTo(7, 9);
    expect(s.buyback).toBeCloseTo(3, 9);
    expect(s.treasury).toBeCloseTo(90, 9);
  });
});

describe('decideOutcome', () => {
  const base = { cardValueUsd: 30, packPriceUsd: 28, eligibleCount: 3 };
  it('RAFFLE raffles when holders exist, sells otherwise', () => {
    expect(decideOutcome({ ...base, strategy: 'RAFFLE' })).toBe('RAFFLE');
    expect(decideOutcome({ ...base, strategy: 'RAFFLE', eligibleCount: 0 })).toBe('SELL');
  });
  it('HIT_HUNTER raffles only hits (value > pack price)', () => {
    expect(decideOutcome({ ...base, strategy: 'HIT_HUNTER' })).toBe('RAFFLE');
    expect(decideOutcome({ ...base, strategy: 'HIT_HUNTER', cardValueUsd: 28 })).toBe('SELL');
    expect(decideOutcome({ ...base, strategy: 'HIT_HUNTER', eligibleCount: 0 })).toBe('SELL');
  });
  it('DIVIDEND/BURN/SPLIT always sell', () => {
    for (const s of ['DIVIDEND', 'BURN', 'SPLIT'] as const) expect(decideOutcome({ ...base, cardValueUsd: 9999, strategy: s })).toBe('SELL');
  });
});

describe('splitProceeds', () => {
  it('routes by strategy', () => {
    expect(splitProceeds(100n, 'RAFFLE').pot).toBe(100n);
    expect(splitProceeds(100n, 'HIT_HUNTER').burn).toBe(100n);
    expect(splitProceeds(100n, 'BURN').burn).toBe(100n);
    expect(splitProceeds(100n, 'DIVIDEND').dividend).toBe(100n);
  });
  it('SPLIT honours bps and conserves amount', () => {
    const s = splitProceeds(1001n, 'SPLIT', { dividendBps: 5000, burnBps: 3000, lpBps: 2000 });
    expect(s.dividend).toBe(500n);
    expect(s.lp).toBe(200n);
    expect(s.dividend + s.burn + s.lp).toBe(1001n);
  });
  it('SPLIT burns the LP share pre-graduation', () => {
    const s = splitProceeds(1000n, 'SPLIT', { dividendBps: 5000, burnBps: 3000, lpBps: 2000 }, false);
    expect(s).toEqual({ dividend: 500n, burn: 500n, lp: 0n, pot: 0n });
  });
  it('SPLIT validates bps', () => {
    expect(() => splitProceeds(1n, 'SPLIT')).toThrow();
    expect(() => splitProceeds(1n, 'SPLIT', { dividendBps: 1, burnBps: 1, lpBps: 1 })).toThrow();
  });
});

describe('canOpenPull', () => {
  const base = { potWei: 10n, packCostWei: 10n, hasOpenPull: false, lastPullAt: 0, cooldownSec: 60, now: 60 };
  it('opens when pot >= price, idle, and cooldown passed', () => expect(canOpenPull(base)).toBe(true));
  it('blocks on each condition', () => {
    expect(canOpenPull({ ...base, potWei: 9n })).toBe(false);
    expect(canOpenPull({ ...base, hasOpenPull: true })).toBe(false);
    expect(canOpenPull({ ...base, now: 59 })).toBe(false);
    expect(canOpenPull({ ...base, paused: true })).toBe(false);
  });
});

describe('sellBackRate', () => {
  it('follows Renaiss schedule', () => {
    expect(sellBackRate(0)).toBe(0.9);
    expect(sellBackRate(3600)).toBe(0.9);
    expect(sellBackRate(3601)).toBe(0.85);
    expect(sellBackRate(86_401)).toBe(0.5);
    expect(sellBackRate(259_201)).toBe(0);
  });
});
