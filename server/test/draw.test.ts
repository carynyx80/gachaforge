import { describe, expect, it } from 'vitest';
import { encodePacked, keccak256, numberToHex, type Hex } from 'viem';
import { deriveSeed, snapshotHash, verifyRaffle, weightedDraw } from '../src/core/index.js';

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;
const seedOf = (n: bigint) => numberToHex(n, { size: 32 }) as Hex;
const BH = ('0x' + 'ab'.repeat(32)) as Hex;

describe('deriveSeed', () => {
  it('= keccak256(abi.encodePacked(blockhash, pullId))', () => {
    expect(deriveSeed(BH, 7n)).toBe(keccak256(encodePacked(['bytes32', 'uint256'], [BH, 7n])));
  });
  it('differs per pull', () => {
    expect(deriveSeed(BH, 1n)).not.toBe(deriveSeed(BH, 2n));
  });
});

describe('weightedDraw', () => {
  const holders = [
    { address: addr(3), balance: 30n },
    { address: addr(1), balance: 10n },
    { address: addr(2), balance: 60n },
  ];
  // canonical order: addr1(10) addr2(60) addr3(30); total 100
  it('maps tickets onto cumulative ranges in canonical order', () => {
    expect(weightedDraw(holders, seedOf(0n))!.winner).toBe(addr(1));
    expect(weightedDraw(holders, seedOf(9n))!.winner).toBe(addr(1));
    expect(weightedDraw(holders, seedOf(10n))!.winner).toBe(addr(2));
    expect(weightedDraw(holders, seedOf(69n))!.winner).toBe(addr(2));
    expect(weightedDraw(holders, seedOf(70n))!.winner).toBe(addr(3));
    expect(weightedDraw(holders, seedOf(99n))!.winner).toBe(addr(3));
    expect(weightedDraw(holders, seedOf(100n))!.winner).toBe(addr(1)); // wraps modulo total
  });
  it('reports ticket and total', () => {
    const r = weightedDraw(holders, seedOf(1234n))!;
    expect(r.totalWeight).toBe(100n);
    expect(r.ticket).toBe(34n);
    expect(r.index).toBe(1);
  });
  it('is input-order independent', () => {
    const s = deriveSeed(BH, 42n);
    expect(weightedDraw(holders, s)!.winner).toBe(weightedDraw([...holders].reverse(), s)!.winner);
  });
  it('returns null with no weight', () => {
    expect(weightedDraw([], seedOf(1n))).toBeNull();
    expect(weightedDraw([{ address: addr(1), balance: 0n }], seedOf(1n))).toBeNull();
  });
  it('single holder always wins', () => {
    for (let i = 0n; i < 20n; i++) expect(weightedDraw([{ address: addr(9), balance: 5n }], deriveSeed(BH, i))!.winner).toBe(addr(9));
  });
  it('is statistically weighted by balance', () => {
    const counts: Record<string, number> = {};
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const w = weightedDraw(holders, deriveSeed(BH, BigInt(i)))!.winner;
      counts[w] = (counts[w] ?? 0) + 1;
    }
    expect(counts[addr(1)] / N).toBeGreaterThan(0.07);
    expect(counts[addr(1)] / N).toBeLessThan(0.13);
    expect(counts[addr(2)] / N).toBeGreaterThan(0.55);
    expect(counts[addr(2)] / N).toBeLessThan(0.65);
    expect(counts[addr(3)] / N).toBeGreaterThan(0.26);
    expect(counts[addr(3)] / N).toBeLessThan(0.34);
  });
});

describe('verifyRaffle', () => {
  const eligible = [
    { address: addr(1), balance: 10n ** 23n },
    { address: addr(2), balance: 3n * 10n ** 23n },
  ];
  const seed = deriveSeed(BH, 5n);
  const winner = weightedDraw(eligible, seed)!.winner;
  const hash = snapshotHash(eligible);
  it('accepts a correct proof', () => {
    expect(verifyRaffle({ eligible, seed, snapshotHash: hash, winner, blockHash: BH, pullId: 5n })).toBe(true);
  });
  it('rejects a tampered winner, list, or seed', () => {
    const other = winner === addr(1) ? addr(2) : addr(1);
    expect(verifyRaffle({ eligible, seed, snapshotHash: hash, winner: other })).toBe(false);
    expect(verifyRaffle({ eligible: eligible.slice(0, 1), seed, snapshotHash: hash, winner })).toBe(false);
    expect(verifyRaffle({ eligible, seed, snapshotHash: hash, winner, blockHash: BH, pullId: 6n })).toBe(false);
  });
  it('accepts empty eligible with null winner', () => {
    expect(verifyRaffle({ eligible: [], seed, snapshotHash: snapshotHash([]), winner: null })).toBe(true);
  });
});
