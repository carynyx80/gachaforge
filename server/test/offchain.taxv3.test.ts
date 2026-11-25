/** TAX MODEL v3 (SPEC "TAX MODEL v3"): creator-chosen tax, 5/5/90 split with pot share, creator payouts, $FORGE split. */
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { buildApp } from '../src/app.js';
import { splitNetWei } from '../src/core/packs.js';
import { sweepableWei } from '../src/offchain/engine.js';
import { regTax, splitNet, taxSplitWei, tradeEntries } from '../src/offchain/ledger.js';
import { registerMessage } from '../src/offchain/message.js';
import { ALICE, BOB, E18, OPS, PORTAL, TOKEN, TREASURY, bnb, h32, harness, machine, tokenCreatedLog } from './helpers/offchain.js';

const launcher = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const stranger = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TX = h32(7);
const PAYOUT = '0x00000000000000000000000000000000000c0ffe';

const tradeLog = (side: 'BUY' | 'SELL', eth: bigint, i: number) => ({
  address: PORTAL,
  eventName: side === 'BUY' ? 'TokenBought' : 'TokenSold',
  args: { ts: 1_700_000_100n, token: TOKEN, [side === 'BUY' ? 'buyer' : 'seller']: ALICE, amount: 1_000n * E18, eth, fee: 0n, postPrice: 0n },
  blockNumber: 1000n,
  logIndex: i,
  transactionHash: h32(0x300 + i),
});

describe('v3 split math (wei)', () => {
  it('5% company / 5% buyback / 90% creator share split by potShare; sums exactly for many rates and pot shares', () => {
    const s = splitNetWei(10_000n, { model: 'creator', potShareBps: 4000 });
    expect(s).toEqual({ company: 500n, buyback: 500n, pot: 3600n, creator: 5400n });
    expect(splitNetWei(10_000n, { model: 'creator', potShareBps: 10_000 })).toEqual({ company: 500n, buyback: 500n, pot: 9000n, creator: 0n });
    expect(splitNetWei(10_000n, { model: 'creator', potShareBps: 2000 })).toEqual({ company: 500n, buyback: 500n, pot: 1800n, creator: 7200n }); // 18% of tax minimum
    for (const taxBps of [100, 200, 300, 500, 700, 1000])
      for (const potShareBps of [2000, 2500, 3333, 4000, 5000, 7777, 10_000])
        for (const tradeWei of [1n, 999n, E18, 123_456_789_012_345_679n, 77n * E18]) {
          for (const share of [9000, 8765, 10_000]) {
            const x = taxSplitWei(tradeWei, share, taxBps, { model: 'creator', potShareBps });
            expect(x.tax).toBe((tradeWei * BigInt(taxBps)) / 10_000n);
            expect(x.flap + x.platform + x.buyback + x.pot + x.creator).toBe(x.tax);
            expect(x.platform + x.buyback + x.pot + x.creator).toBe(x.net);
            const e = tradeEntries({ machine: TOKEN, ref: 'r', tradeWei, ts: 1, txHash: h32(1) }, share, taxBps, { model: 'creator', potShareBps });
            expect(e.map((y) => y.bucket)).toEqual(['TAX', 'FLAP', 'PLATFORM', 'POT', 'BUYBACK', 'CREATOR']);
            expect(e.slice(1).reduce((a, y) => a + y.amountWei, 0n)).toBe(e[0].amountWei);
          }
        }
    // negative corrections split the same way and still sum
    const neg = splitNet(-12_345n, { model: 'creator', potShareBps: 3000 });
    expect(neg.platform + neg.buyback + neg.pot + neg.creator).toBe(-12_345n);
  });
  it('$FORGE and legacy: 90% company / 7% pot / 3% buyback, no creator share', () => {
    for (const model of ['forge', 'legacy'] as const) {
      expect(splitNetWei(10_000n, { model })).toEqual({ company: 9000n, pot: 700n, buyback: 300n, creator: 0n });
      const x = taxSplitWei(E18, 9000, 200, { model });
      expect(x.platform + x.pot + x.buyback + x.flap).toBe(x.tax);
      expect(x.creator).toBe(0n);
    }
    expect(regTax(null)).toEqual({ model: 'legacy', potShareBps: undefined });
  });
});

describe('v3 ledger: side-specific tax + creator balance', () => {
  it('buy 5% / sell 3%, potShare 40%: entries, FeeEvent fields, machine fields', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0, undefined, { buyTaxBps: 500, sellTaxBps: 300, potShareBps: 4000, payout: PAYOUT });
    await h.svc.indexer.apply([tradeLog('BUY', E18, 1), tradeLog('SELL', 2n * E18, 2)], [TOKEN], false);
    const tax = await h.accounts.balance('TAX', TOKEN);
    expect(tax).toBe(E18 / 20n + (2n * E18 * 3n) / 100n); // 0.05 + 0.06
    const b = taxSplitWei(E18, 9000, 500, { model: 'creator', potShareBps: 4000 });
    const s = taxSplitWei(2n * E18, 9000, 300, { model: 'creator', potShareBps: 4000 });
    expect(await h.accounts.balance('CREATOR', TOKEN)).toBe(b.creator + s.creator);
    expect(await h.accounts.potWei(TOKEN)).toBe(b.pot + s.pot);
    expect(await h.accounts.balance('BUYBACK')).toBe(b.buyback + s.buyback);
    expect(await h.accounts.balance('PLATFORM')).toBe(b.platform + s.platform);
    const fees = await h.repo.listFeeEvents({ limit: 5 });
    const buy = fees.find((f) => f.side === 'BUY')!;
    const sell = fees.find((f) => f.side === 'SELL')!;
    expect(buy.taxUsd).toBe(30); // 0.05 BNB × $600
    expect(sell.taxUsd).toBe(36); // 0.06 BNB × $600
    expect(buy).toMatchObject({ companyUsd: 1.35, platformUsd: 1.35, buybackUsd: 1.35, potUsd: 9.72, creatorUsd: 14.58, flapUsd: 3 });
    const m = (await h.repo.getMachine(TOKEN))!;
    expect(m).toMatchObject({ buyTaxBps: 500, sellTaxBps: 300, taxBps: 500, potShareBps: 4000, creatorPayout: PAYOUT, taxModel: 'creator', creatorPaidBnb: 0 });
    expect(m.creatorOwedBnb).toBeCloseTo(Number(b.creator + s.creator) / 1e18, 6);
    const summary = await h.repo.feeSummary(0);
    expect(summary.creatorUsd).toBeCloseTo(buy.creatorUsd + sell.creatorUsd, 6);

    // reconcile: per-token measured share; the correction also splits into the creator bucket
    const received = (tax * 95n) / 100n;
    h.chain.sentToMarketing = received;
    await h.engine.tickReconcile();
    const sum = async () => (await Promise.all((['PLATFORM', 'POT', 'BUYBACK', 'CREATOR'] as const).map((k) => h.accounts.balance(k, TOKEN)))).reduce((a, x) => a + x, 0n);
    expect(await sum()).toBe(received);
    const reg = (await h.store.getRegistration(TOKEN))!;
    expect(reg).toMatchObject({ measuredReceivedWei: received.toString(), measuredGrossWei: tax.toString() });
    expect(await h.accounts.shareBps(reg)).toBe(9500);
  });
});

describe('v3 registration', () => {
  const CREATOR = launcher.address;
  async function app(h: ReturnType<typeof harness>) {
    h.chain.receipts.set(TX.toLowerCase(), { status: 'success', blockNumber: 100n, from: CREATOR, logs: [tokenCreatedLog(TOKEN, CREATOR)] });
    h.chain.tokenState = { ...h.chain.tokenState, buyTaxRate: 500n, sellTaxRate: 300n };
    return buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], offchain: h.svc, health: { mode: 'offchain', chainId: 56, treasury: TREASURY } });
  }
  const msg = (o: { buy?: number; sell?: number; pot?: number; payout?: string }) =>
    registerMessage({ token: TOKEN, pack: 'FORGE_48', strategy: 'RAFFLE', buyTaxBps: o.buy ?? 500, sellTaxBps: o.sell ?? 300, potShareBps: o.pot ?? 4000, payout: o.payout ?? PAYOUT, chainId: 56 });
  const body = (signature: string, o: { buy?: number; sell?: number; pot?: number; payout?: string } = {}) => ({
    txHash: TX,
    pack: 'FORGE_48',
    strategy: 'RAFFLE',
    buyTaxBps: o.buy ?? 500,
    sellTaxBps: o.sell ?? 300,
    potShareBps: o.pot ?? 4000,
    payout: o.payout ?? PAYOUT,
    signature,
  });

  it('message format includes tax, pot share and payout', () => {
    expect(msg({})).toBe(`GachaForge register\ntoken:${TOKEN.toLowerCase()}\npack:FORGE_48\nstrategy:RAFFLE\nsplit:0/0/0\nbuyTaxBps:500\nsellTaxBps:300\npotShareBps:4000\npayout:${PAYOUT}\nchainId:56`);
  });
  it('accepts matching on-chain tax and records the immutable v3 config', async () => {
    const h = harness();
    const a = await app(h);
    const post = (b: object) => a.inject({ method: 'POST', url: '/api/machines/register', payload: b });
    const signature = await launcher.signMessage({ message: msg({}) });
    const r = await post(body(signature));
    expect(r.statusCode).toBe(201);
    expect(r.json().machine).toMatchObject({ buyTaxBps: 500, sellTaxBps: 300, taxBps: 500, potShareBps: 4000, creatorPayout: PAYOUT, creatorOwedBnb: 0, creatorPaidBnb: 0, taxModel: 'creator' });
    expect(await h.store.getRegistration(TOKEN)).toMatchObject({ taxModel: 'creator', buyTaxBps: 500, sellTaxBps: 300, potShareBps: 4000, payout: PAYOUT });
    expect((await post(body(signature))).statusCode).toBe(200); // idempotent
    const other = await post(body(await launcher.signMessage({ message: msg({ pot: 5000 }) }), { pot: 5000 }));
    expect(other.json().error).toBe('already_registered');
    await a.close();
  });
  it('payout defaults to the launch wallet', async () => {
    const h = harness();
    const a = await app(h);
    const signature = await launcher.signMessage({ message: msg({ payout: CREATOR }) });
    const { payout: _p, ...b } = body(signature);
    const r = await a.inject({ method: 'POST', url: '/api/machines/register', payload: b });
    expect(r.statusCode).toBe(201);
    expect(r.json().machine.creatorPayout).toBe(CREATOR.toLowerCase());
    await a.close();
  });
  it('rejects bad tax, potShare < 2000, wrong signer, tampered payout / pot share', async () => {
    const h = harness();
    const a = await app(h);
    // straight to the service (the HTTP route rate-limits to 10/min per IP)
    const post = async (b: object) => h.svc.register(b as never).then(() => ({ error: 'ok' }), (e) => ({ error: e.code, details: e.details }));
    // signed 5%/5% but the token has 5%/3%
    expect(await post(body(await launcher.signMessage({ message: msg({ sell: 500 }) }), { sell: 500 }))).toMatchObject({ error: 'bad_tax', details: { buyTaxBps: 500, sellTaxBps: 300, signedSellTaxBps: 500 } });
    // out of range / not whole %
    for (const o of [{ buy: 50 }, { sell: 1100 }, { buy: 250 }]) expect((await post(body(await launcher.signMessage({ message: msg(o) }), o))).error).toBe('invalid_params');
    for (const pot of [1999, 0, 10_001]) expect((await post(body(await launcher.signMessage({ message: msg({ pot }) }), { pot }))).error).toBe('invalid_params');
    expect((await post({ ...body(await launcher.signMessage({ message: msg({}) })), potShareBps: undefined })).error).toBe('invalid_params'); // incomplete v3
    expect((await post(body(await stranger.signMessage({ message: msg({}) })))).error).toBe('bad_signature');
    const signed = await launcher.signMessage({ message: msg({}) });
    expect((await post(body(signed, { payout: BOB }))).error).toBe('bad_signature'); // tampered payout
    expect((await post(body(signed, { pot: 9000 }))).error).toBe('bad_signature'); // tampered pot share
    expect(await h.store.getRegistration(TOKEN)).toBeNull();
    // on-chain tax outside 1–10% is refused even when signed
    h.chain.tokenState = { ...h.chain.tokenState, buyTaxRate: 1500n };
    expect((await post(body(await launcher.signMessage({ message: msg({}) })))).error).toBe('bad_tax');
    await a.close();
  });
});

describe('creator payouts', () => {
  const owe = async (h: ReturnType<typeof harness>, amount: bigint, ref = 'c') => h.accounts.book([{ ref, ts: 1, machine: TOKEN, bucket: 'CREATOR', kind: 'ADJUST', amountWei: amount }]);

  it('pays the whole owed balance once ≥ CREATOR_PAYOUT_MIN_BNB, records ops_tx CREATOR_PAYOUT, never more than owed', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0, undefined, { potShareBps: 4000, payout: PAYOUT });
    await owe(h, bnb(0.009));
    await h.engine.tickCreatorPayouts();
    expect(h.backend.sent).toHaveLength(0); // below 0.01 BNB
    await owe(h, bnb(0.004), 'c2');
    await h.engine.tickCreatorPayouts();
    expect(h.backend.sent).toEqual([expect.objectContaining({ to: PAYOUT, value: bnb(0.013), fn: 'transfer-native' })]);
    expect(await h.accounts.balance('CREATOR', TOKEN)).toBe(0n);
    const tx = (await h.store.listOpsTxs({ limit: 5 }))[0];
    expect(tx).toMatchObject({ kind: 'CREATOR_PAYOUT', machine: TOKEN.toLowerCase(), to: PAYOUT, amountWei: bnb(0.013), status: 'CONFIRMED' });
    expect((await h.repo.getMachine(TOKEN))!).toMatchObject({ creatorPaidBnb: 0.013, creatorOwedBnb: 0 });
    await h.engine.tickCreatorPayouts();
    expect(h.backend.sent).toHaveLength(1); // nothing left to pay
  });
  it('excluded from the daily cap (not blocked, not counted)', async () => {
    const h = harness({ env: { OPS_DAILY_CAP_BNB: '0.001' } });
    await machine(h, 'RAFFLE', 0, undefined, { potShareBps: 2000, payout: PAYOUT });
    await owe(h, bnb(0.5));
    await h.engine.tickCreatorPayouts();
    expect(h.backend.sent.map((s) => s.value)).toEqual([bnb(0.5)]);
    expect(await h.ops.spent24h()).toBe(0n);
    // a normal transfer is still capped
    await expect(h.ops.transfer(ALICE, bnb(0.01), { kind: 'OTHER' })).rejects.toThrow(/daily cap/);
  });
  it('failed send gives the balance back; read-only records QUEUED once; low wallet balance waits', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0, undefined, { potShareBps: 5000, payout: PAYOUT });
    await owe(h, bnb(0.02));
    h.backend.failNext = 'execution reverted: boom';
    await h.engine.tickCreatorPayouts();
    expect(await h.accounts.balance('CREATOR', TOKEN)).toBe(bnb(0.02));
    expect((await h.repo.getMachine(TOKEN))!.creatorPaidBnb).toBe(0);
    h.chain.native.set(OPS.toLowerCase(), bnb(0.01));
    await h.engine.tickCreatorPayouts();
    expect(h.backend.sent).toHaveLength(0);
    expect(await h.accounts.balance('CREATOR', TOKEN)).toBe(bnb(0.02));

    const ro = harness({ opsAddress: null });
    await machine(ro, 'RAFFLE', 0, undefined, { potShareBps: 5000, payout: PAYOUT });
    await owe(ro, bnb(0.02));
    await ro.engine.tickCreatorPayouts();
    await ro.engine.tickCreatorPayouts();
    const q = (await ro.store.listOpsTxs({ limit: 10 })).filter((t) => t.kind === 'CREATOR_PAYOUT');
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe('QUEUED');
    expect(await ro.accounts.balance('CREATOR', TOKEN)).toBe(bnb(0.02));
  });
  it('legacy and $FORGE machines never get creator payouts', async () => {
    const h = harness();
    await machine(h, 'RAFFLE', 0, undefined, { legacy: true });
    await owe(h, bnb(1));
    await h.engine.tickCreatorPayouts();
    expect(h.backend.sent).toHaveLength(0);
  });
});

describe('sweep reserve + transparency include creator money', () => {
  it('the company sweep never spends what is owed to creators', async () => {
    const COLD = '0x000000000000000000000000000000000000c01d';
    const h = harness({ env: { SWEEP_TO_ADDRESS: COLD, OPS_RESERVE_BNB: '0.05', CREATOR_PAYOUT_MIN_BNB: '100' }, opsAddress: TREASURY });
    await machine(h, 'RAFFLE', 0, undefined, { potShareBps: 2000, payout: PAYOUT });
    h.chain.native.set(TREASURY.toLowerCase(), bnb(1));
    await h.accounts.book([
      { ref: 'p', ts: 1, machine: TOKEN, bucket: 'PLATFORM', kind: 'ADJUST', amountWei: bnb(0.9) },
      { ref: 'pot', ts: 1, machine: TOKEN, bucket: 'POT', kind: 'ADJUST', amountWei: bnb(0.1) },
      { ref: 'cr', ts: 1, machine: TOKEN, bucket: 'CREATOR', kind: 'ADJUST', amountWei: bnb(0.4) },
    ]);
    const owed = await h.accounts.owed();
    expect(owed).toMatchObject({ pots: bnb(0.1), creators: bnb(0.4), total: bnb(0.5) });
    const r = await h.engine.tickSweep();
    expect(r!.amount).toBe(bnb(0.45)); // 1 − 0.1 pot − 0.4 creator − 0.05 reserve
    expect(sweepableWei({ balanceWei: bnb(1), platformWei: bnb(0.9), owedWei: owed.total, reserveWei: bnb(0.05) })).toBe(bnb(0.45));
    const a = await buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], offchain: h.svc, health: { mode: 'offchain', chainId: 56, treasury: TREASURY } });
    const t = (await a.inject({ method: 'GET', url: '/api/transparency' })).json();
    expect(t.owed).toMatchObject({ creators: 0.4, pots: 0.1, total: 0.5 });
    expect(t.ledger.creatorsBnb).toBe(0.4);
    expect(t.machines[0]).toMatchObject({ taxModel: 'creator', potShareBps: 2000, creatorPayout: PAYOUT, creatorOwedBnb: 0.4, creatorPaidBnb: 0 });
    await a.close();
  });
});

describe('$FORGE as a machine', () => {
  const forgeTok = (recipient: string) => ({ forge: TOKEN.toLowerCase(), forgeToken: { taxRecipient: recipient.toLowerCase(), createdTx: TX } });
  const launch = (h: ReturnType<typeof harness>) => h.chain.receipts.set(TX.toLowerCase(), { status: 'success', blockNumber: 100n, from: ALICE, logs: [tokenCreatedLog(TOKEN, ALICE, '$FORGE', 'FORGE')] });

  it('auto-registers when its tax recipient is the treasury: FORGE_PACK / FORGE_STRATEGY, 90/7/3, no creator share', async () => {
    const h = harness({ ...forgeTok(TREASURY), env: { FORGE_PACK: 'FORGE_48', FORGE_STRATEGY: 'BURN' } });
    launch(h);
    h.chain.tokenState = { ...h.chain.tokenState, buyTaxRate: 200n, sellTaxRate: 200n };
    await h.engine.tickForgeRegister();
    const reg = (await h.store.getRegistration(TOKEN))!;
    expect(reg).toMatchObject({ taxModel: 'forge', pack: 'FORGE_48', strategy: 'BURN', registeredBy: 'forge', buyTaxBps: 200, sellTaxBps: 200 });
    expect(reg.payout).toBeUndefined();
    expect(reg.potShareBps).toBeUndefined();
    await h.store.saveRegistration({ ...reg, syncedTo: 999 });
    await h.svc.indexer.apply([tradeLog('BUY', E18, 1)], [TOKEN], false);
    const x = taxSplitWei(E18, 9000, 200, { model: 'forge' });
    expect(await h.accounts.balance('PLATFORM', TOKEN)).toBe(x.platform);
    expect(await h.accounts.potWei(TOKEN)).toBe((x.net * 700n) / 10_000n);
    expect(await h.accounts.balance('BUYBACK', TOKEN)).toBe((x.net * 300n) / 10_000n);
    expect(await h.accounts.balance('CREATOR', TOKEN)).toBe(0n);
    expect((await h.repo.listFeeEvents({ limit: 1 }))[0]).toMatchObject({ creatorUsd: 0, platformUsd: 9.72, potUsd: 0.76, buybackUsd: 0.32 });
    // the API still refuses to register $FORGE as a creator machine
    expect((await h.engine.adopt({ ...(await import('./helpers/offchain.js')).verified() }, { pack: 'FORGE_28', strategy: 'RAFFLE' }, 'api').catch((e) => e)).code).toBe('forge_token');
  });
  it('display/trade-only when its tax goes elsewhere; any tax rate allowed for $FORGE', async () => {
    const h = harness(forgeTok(BOB));
    launch(h);
    await h.engine.tickForgeRegister();
    expect(await h.store.getRegistration(TOKEN)).toBeNull();
    const h2 = harness(forgeTok(TREASURY));
    launch(h2);
    h2.chain.tokenState = { ...h2.chain.tokenState, buyTaxRate: 150n, sellTaxRate: 0n };
    await h2.engine.tickForgeRegister();
    expect(await h2.store.getRegistration(TOKEN)).toMatchObject({ taxModel: 'forge', pack: 'FORGE_28', strategy: 'RAFFLE', buyTaxBps: 150, sellTaxBps: 0 });
  });
});
