import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, concat, type Hex } from 'viem';
import { buildDividendTree, proRata, selectAutoPush, verifyClaim } from '../src/core/index.js';

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;

describe('proRata', () => {
  it('splits proportionally and conserves the total (dust to largest)', () => {
    const a = proRata(
      [
        { address: addr(1), balance: 1n },
        { address: addr(2), balance: 1n },
        { address: addr(3), balance: 1n },
      ],
      100n,
    );
    expect(a.reduce((s, x) => s + x.amount, 0n)).toBe(100n);
    expect(a.map((x) => x.amount)).toEqual([34n, 33n, 33n]);
  });
  it('weights by balance', () => {
    const a = proRata(
      [
        { address: addr(1), balance: 3n },
        { address: addr(2), balance: 1n },
      ],
      1000n,
    );
    expect(a).toEqual([
      { address: addr(1), amount: 750n },
      { address: addr(2), amount: 250n },
    ]);
  });
  it('dust goes to the largest holder', () => {
    const a = proRata(
      [
        { address: addr(1), balance: 1n },
        { address: addr(2), balance: 5n },
        { address: addr(3), balance: 1n },
      ],
      10n,
    );
    expect(a.find((x) => x.address === addr(2))!.amount).toBe(8n);
    expect(a.reduce((s, x) => s + x.amount, 0n)).toBe(10n);
  });
  it('returns [] when nothing to split', () => {
    expect(proRata([], 10n)).toEqual([]);
    expect(proRata([{ address: addr(1), balance: 1n }], 0n)).toEqual([]);
  });
  it('drops zero allocations', () => {
    const a = proRata(
      [
        { address: addr(1), balance: 1n },
        { address: addr(2), balance: 10n ** 30n },
      ],
      1n,
    );
    expect(a).toEqual([{ address: addr(2), amount: 1n }]);
  });
});

describe('buildDividendTree', () => {
  const allocs = [
    { address: addr(1), amount: 10n ** 17n },
    { address: addr(2), amount: 2n * 10n ** 17n },
    { address: addr(3), amount: 5n },
  ];
  it('produces proofs that verify for every claim', () => {
    const t = buildDividendTree(allocs);
    expect(t.claims).toHaveLength(3);
    expect(t.total).toBe(3n * 10n ** 17n + 5n);
    for (const c of t.claims) expect(verifyClaim(t.root, c.address, c.amount, c.proof)).toBe(true);
  });
  it('rejects wrong amounts', () => {
    const t = buildDividendTree(allocs);
    const c = t.claims[0];
    expect(verifyClaim(t.root, c.address, c.amount + 1n, c.proof)).toBe(false);
  });
  it('uses OZ double-hashed leaves (Solidity MerkleProof compatible)', () => {
    const t = buildDividendTree([{ address: addr(7), amount: 42n }]);
    const leaf = keccak256(
      concat([keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [addr(7) as Hex, 42n]))]),
    );
    expect(t.root).toBe(leaf); // single-leaf tree root == leaf
    expect(t.claims[0].proof).toEqual([]);
  });
  it('fails on empty or duplicate input', () => {
    expect(() => buildDividendTree([])).toThrow();
    expect(() => buildDividendTree([allocs[0], { ...allocs[0] }])).toThrow(/duplicate/);
  });
  it('is deterministic', () => {
    expect(buildDividendTree(allocs).root).toBe(buildDividendTree([...allocs]).root);
  });
});

describe('selectAutoPush', () => {
  it('keeps allocations >= threshold, largest first', () => {
    const r = selectAutoPush(
      [
        { address: addr(1), amount: 5n },
        { address: addr(2), amount: 50n },
        { address: addr(3), amount: 10n },
      ],
      10n,
    );
    expect(r.map((x) => x.address)).toEqual([addr(2), addr(3)]);
  });
});
