import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { snapshotHash, verifyRaffle, verifyClaim, TOTAL_SUPPLY_DEFAULT } from '../src/core/index.js';
import { planDividend, planPull } from '../src/operator/settle.js';

const E18 = 10n ** 18n;
const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;
const BH = ('0x' + '11'.repeat(32)) as Hex;
const balances = [
  { address: addr(1), balance: 1_000_000n * E18 },
  { address: addr(2), balance: 3_000_000n * E18 },
  { address: addr(3), balance: 50_000n * E18 }, // below 0.01%
  { address: addr(99), balance: 500_000_000n * E18 }, // pool, excluded
];
const base = { balances, totalSupply: TOTAL_SUPPLY_DEFAULT, excluded: [addr(99)], blockHash: BH, pullId: 3n, pullKey: 'm-3', snapshotBlock: 123n };

describe('planPull', () => {
  it('RAFFLE: eligible snapshot excludes pool & small holders and draws a verifiable winner', () => {
    const p = planPull({ ...base, machine: { address: '0xM', strategy: 'RAFFLE', packPriceUsd: 28 }, card: { valueUsd: 10 } });
    expect(p.outcome).toBe('RAFFLE');
    expect(p.eligible.map((e) => e.address)).toEqual([addr(1), addr(2)]);
    expect(p.snapshotHash).toBe(snapshotHash(p.eligible));
    expect(verifyRaffle({ eligible: p.eligible, seed: p.seed, snapshotHash: p.snapshotHash, winner: p.winner, blockHash: BH, pullId: 3n })).toBe(true);
    expect(p.proof.eligible[0]).toEqual({ address: addr(1), balance: 1_000_000, balanceRaw: (1_000_000n * E18).toString() });
    expect(p.proof.snapshotBlock).toBe(123);
  });
  it('HIT_HUNTER sells non-hits', () => {
    const p = planPull({ ...base, machine: { address: '0xM', strategy: 'HIT_HUNTER', packPriceUsd: 28 }, card: { valueUsd: 20 } });
    expect(p.outcome).toBe('SELL');
    expect(p.winner).toBeNull();
  });
  it('RAFFLE with nobody eligible sells', () => {
    const p = planPull({ ...base, balances: [balances[2]], machine: { address: '0xM', strategy: 'RAFFLE', packPriceUsd: 28 }, card: { valueUsd: 99 } });
    expect(p.outcome).toBe('SELL');
  });
});

describe('planDividend', () => {
  const eligible = [
    { address: addr(1), balance: 1n * E18 },
    { address: addr(2), balance: 3n * E18 },
  ];
  it('DIVIDEND gives the whole amount to holders with valid proofs + auto-push', () => {
    const d = planDividend({ machine: { strategy: 'DIVIDEND', stage: 'CURVE' }, proceedsWei: 4n * E18, eligible, autoPushMinWei: 2n * E18 });
    expect(d.dividendWei).toBe(4n * E18);
    expect(d.tree!.total).toBe(4n * E18);
    for (const c of d.tree!.claims) expect(verifyClaim(d.tree!.root, c.address, c.amount, c.proof)).toBe(true);
    expect(d.autoPush).toEqual([{ address: addr(2), amount: 3n * E18 }]);
  });
  it('SPLIT only distributes the dividend bps', () => {
    const d = planDividend({ machine: { strategy: 'SPLIT', stage: 'GRADUATED', split: { dividendBps: 2500, burnBps: 5000, lpBps: 2500 } }, proceedsWei: 4n * E18, eligible, autoPushMinWei: 10n * E18 });
    expect(d.dividendWei).toBe(1n * E18);
    expect(d.autoPush).toEqual([]);
  });
  it('BURN distributes nothing', () => {
    const d = planDividend({ machine: { strategy: 'BURN', stage: 'CURVE' }, proceedsWei: 4n * E18, eligible, autoPushMinWei: 0n });
    expect(d.tree).toBeNull();
  });
});
