import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { DEMO_WALLET, seedMock, simulatePull } from '../src/mock/seed.js';
import { MemoryRepository } from '../src/store/memory.js';
import { verifyRaffle } from '../src/core/index.js';
import type { Machine } from '../src/types.js';

let app: FastifyInstance;
let ledger: Ledger;
let ctx: Awaited<ReturnType<typeof seedMock>>;
const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json(), headers: r.headers };
};
const machineKeys = ['address', 'vault', 'name', 'ticker', 'description', 'image', 'creator', 'createdAt', 'pack', 'packPriceUsd', 'strategy', 'taxBps', 'stage', 'bondingCurvePct', 'marketCapUsd', 'change24hPct', 'volume24hUsd', 'holders', 'eligibleHolders', 'potUsd', 'packsOpened', 'round', 'paidToHoldersBnb', 'burnedTokens'];

beforeAll(async () => {
  const bus = new Bus();
  ledger = new Ledger(new MemoryRepository(), bus);
  ctx = await seedMock(ledger, { bnbUsd: 600, excluded: [] });
  app = await buildApp({ ledger, bus, corsOrigin: ['http://localhost:3000', 'https://gachaforge.xyz'], health: { mode: 'mock', chainId: 97, version: '0.1.0', treasury: '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c' } });
});
afterAll(async () => app.close());

describe('API', () => {
  it('GET /api/stats', async () => {
    const { body } = await get('/api/stats');
    expect(Object.keys(body).sort()).toEqual(['burnedUsd', 'cardsAwarded', 'launches', 'packsOpened', 'potsUsd']);
    expect(body.launches).toBe(19);
  });
  it('every machine exposes its v3 tax (1–10% buy/sell, pot share 20–100%)', async () => {
    const { body } = await get('/api/machines?pageSize=100');
    const items = (body.items ?? body) as { taxBps: number; buyTaxBps: number; sellTaxBps: number; potShareBps: number; creatorPayout: string; creatorOwedBnb: number; creatorPaidBnb: number }[];
    expect(items.length).toBeGreaterThan(0);
    for (const m of items) {
      for (const t of [m.buyTaxBps, m.sellTaxBps]) expect(t >= 100 && t <= 1000 && t % 100 === 0).toBe(true);
      expect(m.taxBps).toBe(m.buyTaxBps);
      expect(m.potShareBps >= 2000 && m.potShareBps <= 10_000).toBe(true);
      expect(m.creatorPayout).toMatch(/^0x[0-9a-f]{40}$/);
      expect(typeof m.creatorOwedBnb + typeof m.creatorPaidBnb).toBe('numbernumber');
    }
    expect(new Set(items.map((m) => m.buyTaxBps)).size).toBeGreaterThan(3);
    expect(new Set(items.map((m) => m.potShareBps)).size).toBeGreaterThan(3);
  });
  it('CORS for the frontend origin', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stats', headers: { origin: 'http://localhost:3000' } });
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
  it('GET /api/health', async () => {
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, mode: 'mock', chainId: 97, version: '0.1.0', treasury: '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c', opsReady: false, renaissReady: false });
  });
  it('CORS allows configured origins and gachaforge vercel previews only', async () => {
    const acao = async (origin: string) =>
      (await app.inject({ method: 'GET', url: '/api/stats', headers: { origin } })).headers['access-control-allow-origin'];
    expect(await acao('https://gachaforge.xyz')).toBe('https://gachaforge.xyz');
    expect(await acao('https://gachaforge.vercel.app')).toBe('https://gachaforge.vercel.app');
    expect(await acao('https://gachaforge-git-feat-x-team.vercel.app')).toBe('https://gachaforge-git-feat-x-team.vercel.app');
    expect(await acao('https://evil.vercel.app')).toBeUndefined();
    expect(await acao('https://gachaforge.vercel.app.evil.com')).toBeUndefined();
    expect(await acao('https://evil.example')).toBeUndefined();
  });
  it('GET /api/machines paginates, sorts and filters', async () => {
    const { body } = await get('/api/machines');
    expect(body.total).toBe(19);
    expect(body.items).toHaveLength(12);
    for (const k of machineKeys) expect(body.items[0]).toHaveProperty(k);
    const p2 = await get('/api/machines?page=2&pageSize=12');
    expect(p2.body.items).toHaveLength(7);
    const neu = (await get('/api/machines?sort=new&pageSize=19')).body.items as Machine[];
    for (let i = 1; i < neu.length; i++) expect(neu[i - 1].createdAt).toBeGreaterThanOrEqual(neu[i].createdAt);
    const mc = (await get('/api/machines?sort=market_cap&pageSize=19')).body.items as Machine[];
    for (let i = 1; i < mc.length; i++) expect(mc[i - 1].marketCapUsd).toBeGreaterThanOrEqual(mc[i].marketCapUsd);
    const raffles = (await get('/api/machines?strategy=RAFFLE&pack=&stage=')).body;
    expect(raffles.items.every((m: Machine) => m.strategy === 'RAFFLE')).toBe(true);
    expect((await get('/api/machines?sort=bogus')).status).toBe(400);
  });
  it('GET /api/machines/about-to-rip returns top 3 by pot ratio', async () => {
    const { body } = await get('/api/machines/about-to-rip');
    expect(body).toHaveLength(3);
    const r = body.map((m: Machine) => m.potUsd / m.packPriceUsd);
    expect(r[0]).toBeGreaterThanOrEqual(r[1]);
  });
  it('GET /api/machines/:address (+404)', async () => {
    const list = (await get('/api/machines')).body.items as Machine[];
    const one = await get(`/api/machines/${list[0].address.toUpperCase().replace('0X', '0x')}`);
    expect(one.body.address).toBe(list[0].address);
    expect((await get('/api/machines/0x0000000000000000000000000000000000000001')).status).toBe(404);
  });
  it('pulls / trades / rewards per machine', async () => {
    const m = (await get('/api/machines?sort=most_pulled')).body.items[0] as Machine;
    const pulls = (await get(`/api/machines/${m.address}/pulls?page=1`)).body;
    expect(pulls.total).toBe(m.packsOpened);
    expect(pulls.items[0]).toMatchObject({ machine: m.address, ticker: m.ticker, pack: m.pack });
    expect(pulls.items[0].card).toHaveProperty('grader');
    const trades = (await get(`/api/machines/${m.address}/trades`)).body;
    expect(trades.total).toBeGreaterThan(0);
    expect(Object.keys(trades.items[0]).sort()).toEqual(['amountBnb', 'side', 'taxUsd', 'timestamp', 'tokens', 'trader', 'txHash']);
    const rw = (await get(`/api/machines/${m.address}/rewards/${DEMO_WALLET}`)).body;
    expect(rw).toMatchObject({ address: DEMO_WALLET, eligible: true, minBalance: 100000 });
    expect(rw.oddsPct).toBeGreaterThan(0);
    expect(rw.oddsPct).toBeLessThanOrEqual(100);
    const nobody = (await get(`/api/machines/${m.address}/rewards/0x000000000000000000000000000000000000beef`)).body;
    expect(nobody).toMatchObject({ eligible: false, balance: 0, oddsPct: 0, claimableBnb: 0 });
    expect((await get(`/api/machines/${m.address}/rewards/nope`)).status).toBe(400);
  });
  it('GET /api/pulls/recent and /api/activity', async () => {
    const pulls = (await get('/api/pulls/recent?limit=5')).body;
    expect(pulls).toHaveLength(5);
    const act = (await get('/api/activity?limit=10')).body;
    expect(act).toHaveLength(10);
    expect(Object.keys(act[0])).toEqual(expect.arrayContaining(['id', 'ticker', 'machine', 'timestamp', 'kind', 'text']));
  });
  it('GET /api/burns', async () => {
    const b = (await get('/api/burns?page=1')).body;
    expect(b).toHaveProperty('totalBurned');
    expect(b).toHaveProperty('pctOfSupply');
    expect(b.total).toBeGreaterThanOrEqual(30);
    expect(['BUYBACK', 'BURN']).toContain(b.items[0].kind);
  });
  it('GET /api/raffles/:pullId publishes a verifiable proof', async () => {
    const won = ((await get('/api/pulls/recent?limit=100')).body as any[]).find((p) => p.result === 'WON');
    expect(won).toBeTruthy();
    const proof = (await get(`/api/raffles/${won.id}`)).body;
    expect(Object.keys(proof)).toEqual(expect.arrayContaining(['snapshotBlock', 'snapshotHash', 'seed', 'eligible', 'winner']));
    expect(proof.winner).toBe(won.winner);
    const eligible = proof.eligible.map((e: any) => ({ address: e.address, balance: BigInt(e.balanceRaw) }));
    expect(verifyRaffle({ eligible, seed: proof.seed, snapshotHash: proof.snapshotHash, winner: proof.winner })).toBe(true);
    expect((await get('/api/raffles/nope')).status).toBe(404);
  });
  it('simulated pull broadcasts over the bus', async () => {
    const seen: string[] = [];
    const unsub = ledger.bus.subscribe((m) => seen.push(m.type));
    const m = (await get('/api/machines')).body.items[0] as Machine;
    await simulatePull(ctx, m.address);
    unsub();
    expect(seen).toEqual(expect.arrayContaining(['machine', 'pull', 'activity']));
  });
});

describe('WebSocket /ws', () => {
  it('sends stats on connect and relays bus messages', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as any).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: any[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onmessage = (e) => {
        msgs.push(JSON.parse(String(e.data)));
        if (msgs.length === 1) ledger.activity({ address: '0x1', ticker: 'T' }, 'TAX', 'tax $1.00 → gacha pot', 1);
        if (msgs.length === 2) resolve();
      };
      ws.onerror = reject;
      setTimeout(() => reject(new Error('ws timeout')), 3000);
    });
    ws.close();
    expect(msgs[0].type).toBe('stats');
    expect(msgs[1]).toMatchObject({ type: 'activity', data: { kind: 'TAX', ticker: 'T' } });
  });
});
