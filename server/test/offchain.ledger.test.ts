import { describe, expect, it } from 'vitest';
import { measuredShareBps, reconcileEntries, splitNet, taxSplitWei, tradeEntries } from '../src/offchain/ledger.js';
import type { WsMessage } from '../src/types.js';
import { ALICE, BOB, E18, TOKEN, TP, bnb, h32, harness, machine } from './helpers/offchain.js';

const buyLog = (eth: bigint, i: number, buyer = ALICE) => ({
  address: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
  eventName: 'TokenBought',
  args: { ts: 1_700_000_100n, token: TOKEN, buyer, amount: 1_000_000n * E18, eth, fee: 0n, postPrice: 0n },
  blockNumber: 1000n,
  logIndex: i,
  transactionHash: h32(0x100 + i),
});
const transferLog = (from: string, to: string, value: bigint, i: number) => ({ address: TOKEN, eventName: 'Transfer', args: { from, to, value }, blockNumber: 1000n, logIndex: 50 + i, transactionHash: h32(0x200 + i) });

describe('offchain ledger math', () => {
  it('splits 2% tax: flap cut by treasury share, then 90/7/3, parts sum exactly', () => {
    const s = taxSplitWei(E18, 9000);
    expect(s.tax).toBe(E18 / 50n); // 0.02 BNB
    expect(s.net).toBe((E18 / 50n) * 9n / 10n);
    expect(s.flap + s.net).toBe(s.tax);
    expect(s.pot).toBe((s.net * 700n) / 10_000n);
    expect(s.buyback).toBe((s.net * 300n) / 10_000n);
    expect(s.platform + s.pot + s.buyback).toBe(s.net);
    const odd = taxSplitWei(123_456_789_012_345_679n, 8_765);
    expect(odd.flap + odd.platform + odd.pot + odd.buyback).toBe(odd.tax);
    const e = tradeEntries({ machine: TOKEN, ref: 'x', tradeWei: E18, ts: 1, txHash: h32(1) }, 9000);
    expect(e.map((x) => x.bucket)).toEqual(['TAX', 'FLAP', 'PLATFORM', 'POT', 'BUYBACK']);
    expect(e.slice(1).reduce((a, x) => a + x.amountWei, 0n)).toBe(e[0].amountWei);
  });
  it('reconcile entries move the difference between receipts and estimate', () => {
    const e = reconcileEntries({ machine: TOKEN, ref: 'r', receivedWei: 1000n, estimatedNetWei: 900n, ts: 1 });
    const by = Object.fromEntries(e.map((x) => [x.bucket, x.amountWei]));
    expect(by.FLAP).toBe(-100n);
    expect(by.POT! + by.BUYBACK! + by.PLATFORM!).toBe(100n);
    expect(splitNet(-100n).pot).toBe(-7n);
    expect(reconcileEntries({ machine: TOKEN, ref: 'r', receivedWei: 5n, estimatedNetWei: 5n, ts: 1 })).toEqual([]);
    expect(measuredShareBps(null, 9000)).toBe(9000);
    expect(measuredShareBps({ receivedWei: 95n, grossWei: 100n }, 9000)).toBe(9500);
    expect(measuredShareBps({ receivedWei: 1n, grossWei: 100n }, 9000)).toBe(5000); // clamped
  });
});

describe('offchain ledger: trades → entries → reconcile', () => {
  it('indexes trades into pending FeeEvents + pot; dispatch receipts reconcile and update the measured share', async () => {
    const h = harness();
    const msgs: WsMessage[] = [];
    h.bus.subscribe((m) => msgs.push(m));
    await machine(h, 'RAFFLE');
    const apply = (logs: any[]) => h.svc.indexer.apply(logs, [TOKEN], true);
    await apply([buyLog(E18, 1), buyLog(2n * E18, 2), transferLog('0x0000000000000000000000000000000000000000', BOB, 5n * 10n ** 24n, 1)]);
    // replay is a no-op (idempotent refs; holders aren't double counted because the cursor moved on)
    await h.accounts.recordTrade(TOKEN, { ref: `${h32(0x101)}:1`, tradeWei: E18, side: 'BUY', trader: ALICE, amountBnb: 1, tokens: 1, taxUsd: 0, txHash: h32(0x101), timestamp: 1 });
    const tax = await h.accounts.balance('TAX', TOKEN);
    expect(tax).toBe((3n * E18) / 50n); // 2% of 3 BNB
    const est = taxSplitWei(3n * E18, 9000);
    expect(await h.accounts.potWei(TOKEN)).toBe(taxSplitWei(E18, 9000).pot + taxSplitWei(2n * E18, 9000).pot);
    const fees = await h.repo.listFeeEvents({ limit: 10 });
    expect(fees).toHaveLength(2);
    expect(fees.every((f) => f.pending)).toBe(true);
    expect(fees[0]).toMatchObject({ machine: TOKEN.toLowerCase(), side: 'BUY', taxUsd: expect.any(Number), potUsd: expect.any(Number) });
    expect(fees.find((f) => f.amountBnb === 2)!.taxUsd).toBe(24); // 0.04 BNB × $600
    expect(msgs.filter((m) => m.type === 'fee')).toHaveLength(2);
    expect((await h.repo.getMachine(TOKEN))!.potUsd).toBeCloseTo(Number(est.pot) / 1e18 * 600, 2);
    expect((await h.repo.listTrades(TOKEN, 0, 10)).total).toBe(2);
    expect(await h.repo.getBalance(TOKEN, BOB)).toBe(5n * 10n ** 24n);

    // dispatch: the treasury really received 92% of the tax (flap kept 8%)
    const received = (tax * 92n) / 100n;
    h.chain.sentToMarketing = received;
    await h.engine.tickReconcile();
    expect(await h.accounts.balance('FLAP', TOKEN)).toBe(tax - received);
    expect(await h.accounts.balance('PLATFORM', TOKEN) + (await h.accounts.potWei(TOKEN)) + (await h.accounts.balance('BUYBACK', TOKEN))).toBe(received);
    const potDiff = (await h.accounts.potWei(TOKEN)) - (received * 700n) / 10_000n;
    expect(potDiff < 10n && potDiff > -10n).toBe(true); // rounding wei only
    expect(await h.accounts.shareBps()).toBe(9200);
    expect((await h.repo.listFeeEvents({ limit: 10 })).every((f) => !f.pending)).toBe(true);
    const reg = (await h.store.getRegistration(TOKEN))!;
    expect(reg.sentToTreasuryWei).toBe(received.toString());
    // a second read with no new receipts changes nothing
    const before = await h.store.maxEntryId();
    await h.engine.tickReconcile();
    expect(await h.store.maxEntryId()).toBe(before);
    // new trades now use the measured share
    await apply([buyLog(E18, 3)]);
    const last = (await h.store.listEntries({ machine: TOKEN, bucket: 'FLAP', limit: 1 }))[0];
    expect(last.amountWei).toBe(taxSplitWei(E18, 9200).flap);
    expect((await h.repo.listFeeEvents({ limit: 1 }))[0].pending).toBe(true);
    expect(TP).toBeTruthy();
  });
  it('accumulates holders from Transfer logs and counts eligible holders (≥0.01%)', async () => {
    const h = harness();
    await machine(h);
    const Z = '0x0000000000000000000000000000000000000000';
    await h.svc.indexer.apply([transferLog(Z, ALICE, 200_000n * E18, 1), transferLog(Z, BOB, 50_000n * E18, 2), transferLog(ALICE, BOB, 10_000n * E18, 3)], [TOKEN], false);
    const m = (await h.repo.getMachine(TOKEN))!;
    expect(m.holders).toBe(2);
    expect(m.eligibleHolders).toBe(1); // BOB has 60k < 100k
    expect(bnb(1)).toBe(E18);
  });
});
