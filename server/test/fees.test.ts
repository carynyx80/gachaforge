import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { Bus } from '../src/bus.js';
import { BUYBACK_SHARE_BPS, FLAP_CUT_BPS, feeSplit, POT_SHARE_BPS, TAX_BPS, TREASURY_SHARE_BPS } from '../src/core/packs.js';
import { Ledger, now } from '../src/ledger.js';
import { seedMock, simulateTrade } from '../src/mock/seed.js';
import { MemoryRepository } from '../src/store/memory.js';
import type { FeeEvent, Machine, Trade, WsMessage } from '../src/types.js';

const feeKeys = ['amountBnb', 'buybackUsd', 'companyUsd', 'creatorUsd', 'flapUsd', 'id', 'machine', 'packPriceUsd', 'pending', 'platformUsd', 'potAfterUsd', 'potUsd', 'side', 'taxUsd', 'ticker', 'timestamp', 'trader', 'txHash'];
const totalKeys = ['buybackUsd', 'creatorUsd', 'flapUsd', 'platformUsd', 'potUsd', 'totalTaxUsd'];

const machine = (over: Partial<Machine> = {}): Machine => ({
  address: '0x0000000000000000000000000000000000007777',
  vault: '0x000000000000000000000000000000000000000a',
  name: 'Test',
  ticker: 'TEST',
  description: '',
  image: '',
  creator: '0x0000000000000000000000000000000000000001',
  createdAt: 1,
  pack: 'FORGE_28',
  packPriceUsd: 28,
  strategy: 'RAFFLE',
  taxBps: TAX_BPS,
  stage: 'CURVE',
  bondingCurvePct: 0,
  marketCapUsd: 10_000,
  change24hPct: 0,
  volume24hUsd: 0,
  holders: 0,
  eligibleHolders: 0,
  potUsd: 10,
  packsOpened: 0,
  round: 0,
  paidToHoldersBnb: 0,
  burnedTokens: 0,
  ...over,
});
const trade = (amountBnb: number, ts = now()): Trade => ({ side: 'BUY', trader: '0x00000000000000000000000000000000000A11CE', amountBnb, tokens: 1, taxUsd: 0, txHash: '0xabc', timestamp: ts });

describe('fee split', () => {
  it('constants: 2% tax, flap keeps 10%, rest 90/7/3', () => {
    expect(TAX_BPS).toBe(200);
    expect(FLAP_CUT_BPS).toBe(1000);
    expect(TREASURY_SHARE_BPS + POT_SHARE_BPS + BUYBACK_SHARE_BPS).toBe(10_000);
  });
  it('1 BNB @ $600: tax $12 → flap $1.20, pot $0.76, buyback $0.32, platform $9.72', () => {
    expect(feeSplit(600)).toEqual({ taxUsd: 12, flapUsd: 1.2, potUsd: 0.76, buybackUsd: 0.32, platformUsd: 9.72, companyUsd: 9.72, creatorUsd: 0 });
  });
  it('v3 creator split: 5% tax, potShare 40% → company 5%, buyback 5%, pot 36%, creator 54% of the net', () => {
    // $1000 trade, 5% → $50 tax, flap $5, net $45: company 2.25, buyback 2.25, pot 16.2, creator 24.3
    expect(feeSplit(1000, 500, { model: 'creator', potShareBps: 4000 })).toEqual({ taxUsd: 50, flapUsd: 5, platformUsd: 2.25, companyUsd: 2.25, buybackUsd: 2.25, potUsd: 16.2, creatorUsd: 24.3 });
    for (const [bps, pot] of [[100, 2000], [300, 10_000], [700, 5500], [1000, 2000]] as const)
      for (const usd of [1, 12.34, 999.99, 98_765.43]) {
        const s = feeSplit(usd, bps, { model: 'creator', potShareBps: pot });
        expect(s.flapUsd + s.companyUsd + s.buybackUsd + s.potUsd + s.creatorUsd).toBeCloseTo(s.taxUsd, 9);
        expect(s.platformUsd).toBe(s.companyUsd);
      }
  });
  it('side-specific tax in the ledger fee flow (buy 5% / sell 3%)', async () => {
    const repo = new MemoryRepository();
    const ledger = new Ledger(repo, new Bus());
    await repo.upsertMachine(machine({ buyTaxBps: 500, sellTaxBps: 300, taxBps: 500, taxModel: 'creator', potShareBps: 10_000 }));
    const A = '0x0000000000000000000000000000000000007777';
    const b = (await ledger.recordFee(A, trade(1, 100), 600, { id: 'b' }))!;
    const s = (await ledger.recordFee(A, { ...trade(1, 101), side: 'SELL' }, 600, { id: 's' }))!;
    expect(b.taxUsd).toBe(30);
    expect(s.taxUsd).toBe(18);
    expect(b.creatorUsd).toBe(0); // potShare 100%
  });
  it('parts always sum to taxUsd', () => {
    for (const usd of [0.5, 1, 12.34, 99.99, 152.7, 1234.56, 98_765.43]) {
      const s = feeSplit(usd);
      expect(s.flapUsd + s.platformUsd + s.potUsd + s.buybackUsd).toBeCloseTo(s.taxUsd, 9);
      expect(s.taxUsd).toBeCloseTo(Math.round(usd * 2) / 100, 9);
    }
  });
});

describe('live fee flow (ledger)', () => {
  it('trade → pending fee + pot estimate; TaxReceived → reconciled to the real pot', async () => {
    const bus = new Bus();
    const repo = new MemoryRepository();
    const ledger = new Ledger(repo, bus);
    const msgs: WsMessage[] = [];
    bus.subscribe((m) => msgs.push(m));
    await repo.upsertMachine(machine());
    const A = '0x0000000000000000000000000000000000007777';

    const e1 = (await ledger.recordFee(A, trade(1, 100), 600, { id: 'tx1-0' }))!;
    const e2 = (await ledger.recordFee(A, trade(2, 101), 600, { id: 'tx2-0' }))!;
    expect(e1).toMatchObject({ pending: true, taxUsd: 12, potUsd: 0.76, potAfterUsd: 10.76, packPriceUsd: 28, machine: A, ticker: 'TEST' });
    expect(e2.potAfterUsd).toBeCloseTo(10.76 + 1.51, 6);
    expect(await ledger.recordFee(A, trade(1, 100), 600, { id: 'tx1-0' })).toBeNull(); // replay is a no-op
    expect(await repo.pendingFeePotUsd(A)).toBeCloseTo(2.27, 6);
    expect((await repo.getMachine(A))!.potUsd).toBeCloseTo(12.27, 6);
    const fees = msgs.filter((m) => m.type === 'fee');
    expect(fees).toHaveLength(2);
    expect(msgs.filter((m) => m.type === 'machine').map((m) => (m.data as Machine).potUsd)).toEqual([10.76, 12.27]);

    // Keeper reconcile keeps the pending estimate on top of the on-chain pot.
    await ledger.reconcilePot(A, 10);
    expect((await repo.getMachine(A))!.potUsd).toBeCloseTo(12.27, 6);

    // Vault TaxReceived: real pot share is a bit different from the estimate → pot = on-chain truth.
    await ledger.taxReceived(A, 32.4, 2.25, 200);
    expect((await repo.getMachine(A))!.potUsd).toBeCloseTo(12.25, 6);
    expect(await repo.pendingFeePotUsd(A)).toBe(0);
    expect((await repo.listFeeEvents({ machine: A, limit: 10 })).every((e) => !e.pending)).toBe(true);
  });

  it('summary totals (all-time + last24h)', async () => {
    const repo = new MemoryRepository();
    const ledger = new Ledger(repo, new Bus());
    await repo.upsertMachine(machine());
    const A = '0x0000000000000000000000000000000000007777';
    const t = now();
    await ledger.recordFee(A, trade(1, t - 3 * 86_400), 600, { id: 'old' });
    await ledger.recordFee(A, trade(1, t - 60), 600, { id: 'new1' });
    await ledger.recordFee(A, trade(0.5, t), 600, { id: 'new2' });
    const s = await repo.feeSummary(t - 86_400);
    expect(s).toEqual({
      totalTaxUsd: 30,
      flapUsd: 3,
      platformUsd: 24.3,
      potUsd: 1.9,
      buybackUsd: 0.8,
      creatorUsd: 0,
      last24h: { totalTaxUsd: 18, flapUsd: 1.8, platformUsd: 14.58, potUsd: 1.14, buybackUsd: 0.48, creatorUsd: 0 },
    });
    expect(s.flapUsd + s.platformUsd + s.potUsd + s.buybackUsd).toBeCloseTo(s.totalTaxUsd, 6);
  });
});

describe('fees API + WS (mock simulator)', () => {
  let app: FastifyInstance;
  let ledger: Ledger;
  let ctx: Awaited<ReturnType<typeof seedMock>>;
  const get = async (url: string) => {
    const r = await app.inject({ method: 'GET', url });
    return { status: r.statusCode, body: r.json() };
  };

  beforeAll(async () => {
    const bus = new Bus();
    ledger = new Ledger(new MemoryRepository(), bus);
    ctx = await seedMock(ledger, { bnbUsd: 600, excluded: [] });
    app = await buildApp({ ledger, bus, corsOrigin: ['http://localhost:3000'] });
    await app.ready();
  });
  afterAll(async () => app.close());

  it('simulated trade moves the pot by exactly potUsd and emits fee over /ws', async () => {
    const ws = await app.injectWS('/ws');
    const got: WsMessage[] = [];
    ws.on('message', (raw: Buffer) => got.push(JSON.parse(raw.toString())));
    const m = (await ledger.repo.listMachines()).sort((a, b) => a.potUsd / a.packPriceUsd - b.potUsd / b.packPriceUsd)[0];
    const before = m.potUsd;
    const r = (await simulateTrade(ctx, m.address))!;
    expect(r.pull).toBeNull();
    expect(r.fee.pending).toBe(true);
    expect(r.fee.potAfterUsd).toBeCloseTo(before + r.fee.potUsd, 6);
    expect((await ledger.repo.getMachine(m.address))!.potUsd).toBeCloseTo(before + r.fee.potUsd, 6);
    await new Promise((res) => setTimeout(res, 50));
    const fee = got.find((x) => x.type === 'fee');
    expect(fee?.data).toEqual(r.fee);
    expect(got.some((x) => x.type === 'machine' && (x.data as Machine).potUsd === r.fee.potAfterUsd)).toBe(true);
    ws.terminate();
    // mock sync
    await ledger.settleFees(m.address, r.fee.timestamp);
    expect((await ledger.repo.listFeeEvents({ machine: m.address, limit: 1 }))[0].pending).toBe(false);
    expect((await ledger.repo.getMachine(m.address))!.potUsd).toBeCloseTo(before + r.fee.potUsd, 6);
  });

  it('pot reaching pack price fires a pull and keeps the remainder', async () => {
    const m = (await ledger.repo.listMachines())[0];
    await ledger.repo.upsertMachine({ ...m, potUsd: m.packPriceUsd - 0.01 });
    const r = (await simulateTrade(ctx, m.address))!;
    expect(r.pull).not.toBeNull();
    const after = (await ledger.repo.getMachine(m.address))!;
    expect(after.round).toBe(m.round + 1);
    expect(after.potUsd).toBeCloseTo(r.fee.potAfterUsd - m.packPriceUsd, 6);
  });

  it('GET /api/fees/recent shape, order, filter, limits', async () => {
    for (let i = 0; i < 40; i++) await simulateTrade(ctx, (await ledger.repo.listMachines())[i % 5].address);
    const { status, body } = await get('/api/fees/recent');
    expect(status).toBe(200);
    expect(body).toHaveLength(30);
    for (const e of body as FeeEvent[]) {
      expect(Object.keys(e).sort()).toEqual(feeKeys);
      expect(e.flapUsd + e.platformUsd + e.potUsd + e.buybackUsd + e.creatorUsd).toBeCloseTo(e.taxUsd, 6);
      expect(e.companyUsd).toBe(e.platformUsd);
    }
    const ts = (body as FeeEvent[]).map((e) => e.timestamp);
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
    expect((await get('/api/fees/recent?limit=3')).body).toHaveLength(3);
    expect((await get('/api/fees/recent?limit=100')).body.length).toBeLessThanOrEqual(100);
    expect((await get('/api/fees/recent?limit=101')).status).toBe(400);
    expect((await get('/api/fees/recent?machine=nope')).status).toBe(400);
    const target = (await ledger.repo.listMachines())[1].address;
    const filtered = (await get(`/api/fees/recent?machine=${target.toUpperCase().replace('0X', '0x')}&limit=100`)).body as FeeEvent[];
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((e) => e.machine === target)).toBe(true);
  });

  it('GET /api/fees/summary shape', async () => {
    const { status, body } = await get('/api/fees/summary');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([...totalKeys, 'last24h'].sort());
    expect(Object.keys(body.last24h).sort()).toEqual(totalKeys);
    expect(body.totalTaxUsd).toBeGreaterThan(0);
    expect(body.last24h.totalTaxUsd).toBeCloseTo(body.totalTaxUsd, 2);
    expect(body.flapUsd + body.platformUsd + body.potUsd + body.buybackUsd + body.creatorUsd).toBeCloseTo(body.totalTaxUsd, 1);
    expect(body.creatorUsd).toBeGreaterThan(0);
  });
});
