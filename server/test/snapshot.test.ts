import { describe, expect, it } from 'vitest';
import { keccak256, stringToBytes } from 'viem';
import {
  DEAD_ADDRESS,
  ZERO_ADDRESS,
  minEligibleBalance,
  selectEligible,
  snapshotHash,
  snapshotPreimage,
  TOTAL_SUPPLY_DEFAULT,
} from '../src/core/index.js';

const E18 = 10n ** 18n;
const A = '0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB';
const C = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC';
const POOL = '0x1111111111111111111111111111111111111111';

describe('minEligibleBalance', () => {
  it('is 0.01% of supply (100,000 tokens of 1B)', () => {
    expect(minEligibleBalance(TOTAL_SUPPLY_DEFAULT)).toBe(100_000n * E18);
  });
  it('floors', () => {
    expect(minEligibleBalance(19_999n)).toBe(1n);
    expect(minEligibleBalance(9_999n)).toBe(0n);
  });
});

describe('selectEligible', () => {
  const supply = TOTAL_SUPPLY_DEFAULT;
  it('applies threshold inclusively', () => {
    const r = selectEligible(
      [
        { address: A, balance: 100_000n * E18 },
        { address: B, balance: 100_000n * E18 - 1n },
      ],
      { totalSupply: supply, excluded: [] },
    );
    expect(r).toEqual([{ address: A.toLowerCase(), balance: 100_000n * E18 }]);
  });
  it('excludes dead, zero and configured addresses case-insensitively', () => {
    const big = 10_000_000n * E18;
    const r = selectEligible(
      [
        { address: DEAD_ADDRESS, balance: big },
        { address: ZERO_ADDRESS, balance: big },
        { address: POOL, balance: big },
        { address: C, balance: big },
      ],
      { totalSupply: supply, excluded: [POOL.toUpperCase().replace('0X', '0x')] },
    );
    expect(r.map((h) => h.address)).toEqual([C.toLowerCase()]);
  });
  it('merges duplicates and sorts by lowercase address', () => {
    const r = selectEligible(
      [
        { address: C, balance: 60_000n * E18 },
        { address: A, balance: 200_000n * E18 },
        { address: C.toLowerCase(), balance: 60_000n * E18 },
      ],
      { totalSupply: supply, excluded: [] },
    );
    expect(r).toEqual([
      { address: A.toLowerCase(), balance: 200_000n * E18 },
      { address: C.toLowerCase(), balance: 120_000n * E18 },
    ]);
  });
  it('drops zero/negative balances even with zero threshold', () => {
    const r = selectEligible([{ address: A, balance: 0n }], { totalSupply: 0n, excluded: [] });
    expect(r).toEqual([]);
  });
});

describe('snapshotHash', () => {
  it('hashes the documented preimage', () => {
    const h = [
      { address: B, balance: 2n },
      { address: A, balance: 1n },
    ];
    const pre = `${A.toLowerCase()}:1\n${B.toLowerCase()}:2`;
    expect(snapshotPreimage(h)).toBe(pre);
    expect(snapshotHash(h)).toBe(keccak256(stringToBytes(pre)));
  });
  it('is order independent and case independent', () => {
    const x = snapshotHash([
      { address: A, balance: 5n },
      { address: B, balance: 7n },
    ]);
    const y = snapshotHash([
      { address: B.toLowerCase(), balance: 7n },
      { address: A.toUpperCase().replace('0X', '0x'), balance: 5n },
    ]);
    expect(x).toBe(y);
  });
  it('changes when any balance changes', () => {
    const x = snapshotHash([{ address: A, balance: 5n }]);
    const y = snapshotHash([{ address: A, balance: 6n }]);
    expect(x).not.toBe(y);
  });
});
