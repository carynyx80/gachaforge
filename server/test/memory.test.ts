import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/store/memory.js';

describe('MemoryRepository', () => {
  it('tracks balances through transfers (mint/burn via zero address)', async () => {
    const r = new MemoryRepository();
    const Z = '0x0000000000000000000000000000000000000000';
    await r.applyTransfer('0xT', Z, '0xA', 100n);
    await r.applyTransfer('0xT', '0xA', '0xB', 30n);
    await r.applyTransfer('0xt', '0xb', Z, 10n);
    expect(await r.getBalance('0xT', '0xa')).toBe(70n);
    expect(await r.getBalance('0xT', '0xB')).toBe(20n);
    expect((await r.getBalances('0xT')).length).toBe(2);
  });
  it('merges pulls and paginates newest first', async () => {
    const r = new MemoryRepository();
    const card = { name: 'x', set: 's', grader: 'PSA' as const, grade: '10', image: '', valueUsd: 1 };
    for (let i = 0; i < 5; i++) await r.upsertPull({ id: `p${i}`, machine: '0xM', ticker: 'T', pack: 'FORGE_28', round: i, card, result: 'SOLD', txHash: '0x', timestamp: i });
    await r.upsertPull({ ...(await r.getPull('p1'))!, result: 'WON', winner: '0xw' });
    const pg = await r.listPulls({ machine: '0xm', offset: 0, limit: 2 });
    expect(pg.total).toBe(5);
    expect(pg.items.map((p) => p.id)).toEqual(['p4', 'p3']);
    expect((await r.getPull('p1'))!.result).toBe('WON');
  });
  it('rewards credit/debit', async () => {
    const r = new MemoryRepository();
    await r.creditRewards('0xM', '0xW', 1.5);
    await r.debitClaimable('0xm', '0xw', 1);
    expect(await r.getRewards('0xM', '0xW')).toEqual({ claimableBnb: 0.5, totalEarnedBnb: 1.5 });
  });
});
