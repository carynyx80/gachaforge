import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { verifyRaffle } from '../src/core/index.js';
import { planPayouts, sweepableWei } from '../src/offchain/engine.js';
import { OpsCapError, OpsQueuedError, OpsWallet } from '../src/offchain/ops.js';
import { MemoryOffchainStore } from '../src/offchain/store.js';
import { SimulatedSwapper, usdtToBuy } from '../src/swap/pancake.js';
import { ALICE, BOB, CAROL, DEAD, E18, FORGE, FakeBackend, FakeChain, FixedProvider, OPS, TOKEN, TREASURY, bnb, harness, machine } from './helpers/offchain.js';

const holders = async (h: ReturnType<typeof harness>, rows: [string, bigint][]) => {
  for (const [a, b] of rows) await h.repo.setBalance(TOKEN, a, b);
};
const spent28 = async () => (await new SimulatedSwapper(600).buyExactUsdt(usdtToBuy(28n * E18, 0n, 10), E18)).bnb;

describe('offchain pulls', () => {
  it('pot below pack price: nothing happens', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0.04); // $24 < $28
    await h.engine.tickPulls();
    expect((h.provider as FixedProvider).bought).toBe(0);
    expect((await h.repo.getMachine(TOKEN))!.pullQueued).toBe(false);
  });
  it('pot ≥ pack: swap → Renaiss buy → pot debited by BNB actually spent → raffle with published proof', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0.06);
    await holders(h, [
      [ALICE, 300_000n * E18],
      [BOB, 200_000n * E18],
      [CAROL, 10n * E18], // below 0.01%
    ]);
    await h.engine.tickPulls();
    const spent = await spent28();
    expect(await h.accounts.potWei(TOKEN)).toBe(bnb(0.06) - spent);
    const pull = (await h.repo.listPulls({ machine: TOKEN, offset: 0, limit: 5 })).items[0];
    expect(pull).toMatchObject({ id: `${TOKEN.toLowerCase()}-1`, result: 'WON', round: 1 });
    expect([ALICE.toLowerCase(), BOB.toLowerCase()]).toContain(pull.winner);
    const m = (await h.repo.getMachine(TOKEN))!;
    expect([m.packsOpened, m.round]).toEqual([1, 1]);
    const reg = (await h.store.getRegistration(TOKEN))!;
    expect(reg.openPull).toBeNull();
    expect(reg.round).toBe(1);
    // published proof is re-checkable
    const app = await buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], offchain: h.svc, health: { mode: 'offchain' } });
    const proof = (await app.inject({ method: 'GET', url: `/api/raffles/${pull.id}` })).json();
    expect(proof.eligible.map((e: { address: string }) => e.address)).toEqual([BOB.toLowerCase(), ALICE.toLowerCase()].sort());
    expect(proof.snapshotBlock).toBe(999);
    expect(verifyRaffle({ eligible: proof.eligible.map((e: any) => ({ address: e.address, balance: BigInt(e.balanceRaw) })), seed: proof.seed, snapshotHash: proof.snapshotHash, winner: proof.winner, blockHash: proof.blockHash, pullId: 1n })).toBe(true);
    await app.close();
    const releases = await h.repo.listCardReleases();
    expect(releases[0]).toMatchObject({ pullKey: pull.id, winner: pull.winner, status: 'PENDING' });
    // one pull at a time + the next one needs a full pot again
    await h.engine.tickPulls();
    expect((h.provider as FixedProvider).bought).toBe(1);
  });
  it('per-pull cap: never sends more than pack price + 10% to the swap', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 1);
    const seen: bigint[] = [];
    const sw = new SimulatedSwapper(600);
    (h.engine as any).d.swapper = { name: 'spy', usdtBalance: async () => 0n, buyExactUsdt: async (u: bigint, max: bigint) => (seen.push(max), sw.buyExactUsdt(u, max)), sellUsdt: (u: bigint) => sw.sellUsdt(u) };
    await h.engine.tickPulls();
    const pack = BigInt(Math.ceil((28 / 600) * 1e18));
    expect(seen[0]).toBe((pack * 11_000n) / 10_000n);
  });
  it('no RENAISS_API_KEY → machine.pullQueued=true (API), pull runs once a provider is present', async () => {
    const h = harness({ provider: null });
    await machine(h, 'RAFFLE', 0.06);
    await h.engine.tickPulls();
    const app = await buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], offchain: h.svc, health: { mode: 'offchain' } });
    expect((await app.inject({ method: 'GET', url: `/api/machines/${TOKEN}` })).json().pullQueued).toBe(true);
    expect((await h.store.getRegistration(TOKEN))!.pullQueuedReason).toBe('renaiss_key_missing');
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ mode: 'offchain', opsReady: true, renaissReady: false });
    await app.close();
    // key configured (provider available) → retried
    (h.engine as any).d.provider = new FixedProvider();
    (h.engine as any).d.cfg.renaissReady = true;
    await h.engine.tickPulls();
    expect((await h.repo.getMachine(TOKEN))!.pullQueued).toBe(false);
    expect((await h.repo.listPulls({ machine: TOKEN, offset: 0, limit: 1 })).total).toBe(1);
  });
  it('no ops key → read-only: pull queued, dispatch recorded as QUEUED, nothing sent', async () => {
    const h = harness({ opsAddress: null });
    await machine(h, 'RAFFLE', 0.06);
    h.chain.marketQuoteBalance = bnb(0.01);
    await h.engine.tickPulls();
    await h.engine.tickDispatch();
    await h.engine.tickDispatch();
    expect((await h.store.getRegistration(TOKEN))!.pullQueuedReason).toBe('ops_wallet_missing');
    const txs = await h.store.listOpsTxs({ limit: 10 });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ kind: 'DISPATCH', status: 'QUEUED' });
    expect(h.backend.sent).toHaveLength(0);
  });
  it('HIT_HUNTER miss → sell back → buy & burn the machine token', async () => {
    const h = harness({ provider: new FixedProvider(20, 18n * E18) });
    await machine(h, 'HIT_HUNTER', 0.06);
    await holders(h, [[ALICE, 300_000n * E18]]);
    await h.engine.tickPulls();
    const proceeds = (18n * E18 * 100n) / 60_000n; // SimulatedSwapper @ $600
    expect(await h.accounts.balance('BURN', TOKEN)).toBe(proceeds);
    expect((await h.repo.listPulls({ machine: TOKEN, offset: 0, limit: 1 })).items[0]).toMatchObject({ result: 'BURNED' });
    await h.engine.tickBurns();
    expect(h.backend.sent.map((s) => s.fn)).toEqual(['swapExactInput', 'transfer']);
    expect(h.backend.sent[0].value).toBe(proceeds);
    expect(h.backend.sent[1].args[0]).toBe(DEAD);
    expect(h.chain.bal(TOKEN, DEAD)).toBe(proceeds * h.chain.tokensPerBnb);
    expect(h.chain.bal(TOKEN, OPS)).toBe(0n);
    expect(await h.accounts.balance('BURN', TOKEN)).toBe(0n);
    expect((await h.repo.getMachine(TOKEN))!.burnedTokens).toBeGreaterThan(0);
    const txs = await h.store.listOpsTxs({ limit: 10 });
    expect(txs.every((t) => t.kind === 'BURN' && t.status === 'CONFIRMED' && t.hash)).toBe(true);
  });
  it('RAFFLE with no eligible holder → sell back → proceeds return to the pot', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0.06);
    await h.engine.tickPulls();
    const proceeds = (18n * E18 * 100n) / 60_000n;
    expect(await h.accounts.potWei(TOKEN)).toBe(bnb(0.06) - (await spent28()) + proceeds);
    expect((await h.repo.listPulls({ offset: 0, limit: 1 })).items[0].result).toBe('SOLD');
  });
  it('failed Renaiss buy sells the USDT back and refunds the pot', async () => {
    const p = new FixedProvider();
    p.buyPack = async () => {
      throw new Error('renaiss down');
    };
    const h = harness({ provider: p });
    await machine(h, 'RAFFLE', 0.06);
    await h.engine.tickPulls();
    const reg = (await h.store.getRegistration(TOKEN))!;
    expect(reg.openPull).toBeNull();
    const pot = await h.accounts.potWei(TOKEN);
    expect(pot).toBeLessThan(bnb(0.06)); // only the swap round-trip loss
    expect(pot).toBeGreaterThan(bnb(0.0599));
  });
});

describe('ops wallet safety rails', () => {
  const mk = (o: { paused?: boolean; cap?: bigint } = {}) => {
    const chain = new FakeChain();
    const backend = new FakeBackend(chain);
    const store = new MemoryOffchainStore();
    return { chain, backend, store, ops: new OpsWallet(store, backend, { paused: !!o.paused, dailyCapWei: o.cap ?? E18, retryDelayMs: 0 }) };
  };
  it('pause: nothing is sent, the action is recorded once as QUEUED', async () => {
    const w = mk({ paused: true });
    await expect(w.ops.transfer(ALICE, bnb(0.01), { kind: 'DIVIDEND', dedupeKey: 'k' })).rejects.toBeInstanceOf(OpsQueuedError);
    await expect(w.ops.transfer(ALICE, bnb(0.01), { kind: 'DIVIDEND', dedupeKey: 'k' })).rejects.toBeInstanceOf(OpsQueuedError);
    expect(w.backend.sent).toHaveLength(0);
    const txs = await w.store.listOpsTxs({ limit: 5 });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ status: 'QUEUED', kind: 'DIVIDEND', error: 'OPS_PAUSED=true' });
  });
  it('daily cap (value + gas, rolling 24h) blocks; sweeps are exempt', async () => {
    const w = mk({ cap: bnb(0.1) });
    await w.ops.transfer(ALICE, bnb(0.08), { kind: 'DIVIDEND' });
    await expect(w.ops.transfer(BOB, bnb(0.03), { kind: 'DIVIDEND', dedupeKey: 'b' })).rejects.toBeInstanceOf(OpsCapError);
    expect(w.backend.sent).toHaveLength(1);
    expect(await w.ops.spent24h()).toBe(bnb(0.08) + 21_000n * 10n ** 9n);
    await w.ops.transfer(BOB, bnb(1), { kind: 'SWEEP', capExempt: true });
    expect(w.backend.sent).toHaveLength(2);
    const st = (await w.store.listOpsTxs({ limit: 5 })).map((t) => t.status).sort();
    expect(st).toEqual(['BLOCKED', 'CONFIRMED', 'CONFIRMED']);
  });
  it('retries transient send errors with a fresh nonce; records hash + fee', async () => {
    const w = mk();
    w.backend.failNext = 'nonce too low';
    const r = await w.ops.transfer(ALICE, 1n, { kind: 'OTHER' });
    expect(r.hash).toBeTruthy();
    const [t] = await w.store.listOpsTxs({ limit: 1 });
    expect(t).toMatchObject({ status: 'CONFIRMED', hash: r.hash, feeWei: 21_000n * 10n ** 9n, amountWei: 1n });
  });
  it('single global lock serialises actions', async () => {
    const w = mk();
    const order: string[] = [];
    const slow = (n: string) => w.ops.run({ kind: 'OTHER' }, async () => {
      order.push(`${n}:start`);
      await new Promise((r) => setTimeout(r, 5));
      await w.ops.transfer(ALICE, 1n); // re-entrant inside the action
      order.push(`${n}:end`);
    });
    await Promise.all([slow('a'), slow('b')]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});

describe('dividends', () => {
  it('pro-rata with dust carry-over; batches of DIVIDEND_BATCH_SIZE pushed directly', () => {
    const { payouts, carryWei } = planPayouts(bnb(0.01), [
      { address: ALICE, balance: 600_000n * E18 },
      { address: BOB, balance: 390_000n * E18 },
      { address: CAROL, balance: 10_000n * E18 }, // 0.0001 BNB < 0.0005 min
    ], bnb(0.0005));
    expect(payouts.map((p) => p.address)).toEqual([ALICE.toLowerCase(), BOB.toLowerCase()]);
    expect(carryWei).toBe(bnb(0.0001));
    expect(payouts.reduce((s, p) => s + p.amount, 0n) + carryWei).toBe(bnb(0.01));
  });
  it('DIVIDEND pull → queue → batched transfers → dust stays for the next round', async () => {
    const h = harness({ env: { DIVIDEND_BATCH_SIZE: '2' } });
    await machine(h, 'DIVIDEND', 0.06);
    const rows: [string, bigint][] = [
      [ALICE, 400_000n * E18],
      [BOB, 300_000n * E18],
      [CAROL, 200_000n * E18],
      ['0x00000000000000000000000000000000000d0d01', 100_001n * E18], // tiny share → dust
    ];
    await holders(h, rows);
    (h.engine as any).d.cfg.dividendMinWei = bnb(0.0031);
    await h.engine.tickPulls();
    const proceeds = (18n * E18 * 100n) / 60_000n; // 0.03 BNB
    expect(await h.accounts.balance('DIVIDEND', TOKEN)).toBe(proceeds);
    expect(await h.engine.payoutQueue(TOKEN)).toHaveLength(3);
    await h.engine.tickDividends();
    expect(h.backend.sent).toHaveLength(2); // batch size
    await h.engine.tickDividends();
    expect(h.backend.sent).toHaveLength(3);
    expect(await h.engine.payoutQueue(TOKEN)).toHaveLength(0);
    const left = await h.accounts.balance('DIVIDEND', TOKEN);
    expect(left).toBeGreaterThan(0n); // the 4th holder's dust carries over
    expect(left).toBeLessThan(bnb(0.0031));
    const paid = h.backend.sent.reduce((s, x) => s + x.value, 0n);
    expect(paid + left).toBe(proceeds);
    expect(h.chain.native.get(ALICE.toLowerCase())).toBe(h.backend.sent.find((s) => s.to === ALICE.toLowerCase() || s.to === ALICE)?.value);
    const m = (await h.repo.getMachine(TOKEN))!;
    expect(m.paidToHoldersBnb).toBeCloseTo(Number(paid) / 1e18, 6);
    const r = await h.repo.getRewards(TOKEN, ALICE);
    expect(r.claimableBnb).toBe(0);
    expect(r.totalEarnedBnb).toBeGreaterThan(0);
    expect((await h.store.listOpsTxs({ limit: 10 })).filter((t) => t.kind === 'DIVIDEND' && t.status === 'CONFIRMED')).toHaveLength(3);
  });
});

describe('$FORGE buyback, SPLIT, sweep, transparency', () => {
  it('buyback runs only once the ledger ≥ BUYBACK_MIN_BNB and $FORGE is discovered', async () => {
    const none = harness();
    await none.accounts.book([{ ref: 'bb', ts: 1, machine: TOKEN, bucket: 'BUYBACK', kind: 'ADJUST', amountWei: bnb(0.06) }]);
    await none.engine.tickBuyback();
    expect(none.backend.sent).toHaveLength(0); // $FORGE not live yet
    const h = harness({ forge: FORGE });
    await h.accounts.book([{ ref: 'bb', ts: 1, machine: TOKEN, bucket: 'BUYBACK', kind: 'ADJUST', amountWei: bnb(0.04) }]);
    await h.engine.tickBuyback();
    expect(h.backend.sent).toHaveLength(0); // below 0.05
    await h.accounts.book([{ ref: 'bb2', ts: 1, machine: TOKEN, bucket: 'BUYBACK', kind: 'ADJUST', amountWei: bnb(0.02) }]);
    await h.engine.tickBuyback();
    expect(h.backend.sent.map((s) => [s.fn, s.value])).toEqual([
      ['swapExactInput', bnb(0.06)],
      ['transfer', 0n],
    ]);
    expect(h.chain.bal(FORGE, DEAD)).toBe(bnb(0.06) * h.chain.tokensPerBnb);
    expect(await h.accounts.balance('BUYBACK')).toBe(0n);
    const burns = await h.repo.listBurns(0, 5);
    expect(burns.items[0]).toMatchObject({ kind: 'BUYBACK' });
    expect(burns.totalBurned).toBeGreaterThan(0);
  });
  it('SPLIT: creator bps between dividend and burn, LP share burned', async () => {
    const h = harness();
    await machine(h, 'SPLIT', 0.06, { dividendBps: 5000, burnBps: 3000, lpBps: 2000 });
    await holders(h, [[ALICE, 300_000n * E18]]);
    await h.engine.tickPulls();
    const proceeds = (18n * E18 * 100n) / 60_000n;
    expect(await h.accounts.balance('DIVIDEND', TOKEN)).toBe(proceeds / 2n);
    expect(await h.accounts.balance('BURN', TOKEN)).toBe(proceeds - proceeds / 2n);
  });
  it('sweep reserve: platform share minus owed + reserve, capped by balance', async () => {
    expect(sweepableWei({ balanceWei: bnb(2), platformWei: bnb(1.5), owedWei: bnb(0.3), reserveWei: bnb(0.05) })).toBe(bnb(1.5));
    expect(sweepableWei({ balanceWei: bnb(1), platformWei: bnb(1.5), owedWei: bnb(0.3), reserveWei: bnb(0.05) })).toBe(bnb(0.65));
    expect(sweepableWei({ balanceWei: bnb(0.3), platformWei: bnb(1.5), owedWei: bnb(0.3), reserveWei: bnb(0.05) })).toBe(0n);
    const COLD = '0x000000000000000000000000000000000000c01d';
    // ops wallet != treasury → no sweep
    const other = harness({ env: { SWEEP_TO_ADDRESS: COLD } });
    expect(await other.engine.tickSweep()).toBeNull();
    const h = harness({ env: { SWEEP_TO_ADDRESS: COLD, OPS_RESERVE_BNB: '0.05' }, opsAddress: TREASURY });
    h.chain.native.set(TREASURY.toLowerCase(), bnb(1));
    await h.accounts.book([
      { ref: 'p', ts: 1, machine: TOKEN, bucket: 'PLATFORM', kind: 'ADJUST', amountWei: bnb(1.5) },
      { ref: 'pot', ts: 1, machine: TOKEN, bucket: 'POT', kind: 'ADJUST', amountWei: bnb(0.2) },
      { ref: 'bb', ts: 1, machine: TOKEN, bucket: 'BUYBACK', kind: 'ADJUST', amountWei: bnb(0.1) },
    ]);
    const r = await h.engine.tickSweep();
    expect(r!.amount).toBe(bnb(0.65));
    expect(h.backend.sent[0]).toMatchObject({ to: COLD, value: bnb(0.65) });
    expect(await h.accounts.balance('PLATFORM')).toBe(bnb(0.85));
  });
  it('GET /api/transparency shape', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0.01);
    await h.ops.transfer(ALICE, 1n, { kind: 'OTHER' });
    const app = await buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], offchain: h.svc, health: { mode: 'offchain', chainId: 56, treasury: TREASURY } });
    const t = (await app.inject({ method: 'GET', url: '/api/transparency' })).json();
    expect(Object.keys(t).sort()).toEqual(['balances', 'chainId', 'ledger', 'machines', 'mode', 'ops', 'owed', 'treasury', 'txs', 'updatedAt']);
    expect(Object.keys(t.owed).sort()).toEqual(['burnsPending', 'buyback', 'creators', 'dividendsPending', 'pots', 'total']);
    expect(t.owed.pots).toBe(0.01);
    expect(t.treasury.address).toBe(TREASURY);
    expect(t.ops).toMatchObject({ address: OPS, ready: true, paused: false, dailyCapBnb: 1 });
    expect(t.machines[0]).toMatchObject({ address: TOKEN.toLowerCase(), potBnb: 0.01, pullQueued: false });
    expect(t.txs[0]).toMatchObject({ kind: 'OTHER', status: 'CONFIRMED', url: expect.stringMatching(/^https:\/\/bscscan\.com\/tx\/0x/) });
    expect(t.ledger).toMatchObject({ treasuryShareBps: 9000, measured: false });
    await app.close();
    const mock = await buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], health: { mode: 'mock' } });
    expect((await mock.inject({ method: 'GET', url: '/api/transparency' })).json()).toMatchObject({ mode: 'mock', txs: [] });
    await mock.close();
  });
  it('dispatch is skipped when gas would exceed DISPATCH_MAX_GAS_PCT of the pending tax', async () => {
    const h = harness();
    await machine(h);
    h.chain.marketQuoteBalance = 100_000n * 10n ** 9n; // 0.0001 BNB; fee 0.000021 = 21% > 10%
    await h.engine.tickDispatch();
    expect(h.backend.sent).toHaveLength(0);
    h.chain.marketQuoteBalance = bnb(0.01);
    await h.engine.tickDispatch();
    expect(h.backend.sent.map((s) => s.fn)).toEqual(['dispatch']);
    expect(h.chain.sentToMarketing).toBe(bnb(0.01));
  });
});
