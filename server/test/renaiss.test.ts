import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PACK_MAX_MULTIPLIER, PACK_PRICE_USD } from '../src/core/packs.js';
import { CatalogError, currentTier, RenaissCatalog } from '../src/renaiss/catalog.js';
import { parseRetryAfter, RenaissApiError, RenaissClient } from '../src/renaiss/client.js';
import { mapDraw, parseGrade } from '../src/renaiss/mapping.js';
import { RENAISS_NETWORKS } from '../src/renaiss/networks.js';
import { buybackTypedData, permit2TypedData, RenaissFlowError, RenaissProvider, verifyPrepare } from '../src/renaiss/provider.js';
import { drawSchema, packDetailSchema, packListSchema, prepareSchema, pullStatusSchema } from '../src/renaiss/schemas.js';
import { mulberry32, randomCard, SimulatedProvider } from '../src/renaiss/simulated.js';
import { summaryCard } from '../src/renaiss/types.js';
import { fakeFetch, fakeWallet, fixture, json, noopLog } from './helpers/renaiss.js';

const MAIN = RENAISS_NETWORKS.mainnet;
const TEST = RENAISS_NETWORKS.testnet;
const noSleep = async () => {};

describe('SimulatedProvider', () => {
  it('produces cards within the pack value band', () => {
    const rng = mulberry32(1);
    for (const pack of ['FORGE_28', 'FORGE_48', 'FORGE_88'] as const) {
      for (let i = 0; i < 300; i++) {
        const c = randomCard(pack, rng);
        expect(c.valueUsd).toBeGreaterThan(0);
        expect(c.valueUsd).toBeLessThanOrEqual(PACK_PRICE_USD[pack] * PACK_MAX_MULTIPLIER[pack] + 0.01);
        expect(['PSA', 'CGC', 'BGS']).toContain(c.grader);
        expect(c.tokenId).toMatch(/^\d+$/);
      }
    }
  });
  it('buy → quote → sell with time-based rate; release after the window', async () => {
    let t = 1000;
    const op = '0x00000000000000000000000000000000000000aa';
    const p = new SimulatedProvider(mulberry32(2), () => t, op);
    expect((await p.packCost('FORGE_48')).usdt).toBe(48n * 10n ** 18n);
    let submitted = '';
    const { cards, pullId } = await p.buyPack('FORGE_48', { onSubmitted: (id) => void (submitted = id) });
    expect(submitted).toBe(pullId);
    expect((await p.quoteSellBack(cards)).rate).toBe(0.9);
    t += 7200;
    const s = await p.sellBack(cards);
    expect(s.rate).toBe(0.85);
    expect(s.proceedsUsd).toBeCloseTo(cards[0].valueUsd * 0.85, 1);
    expect(s.proceedsUsdt).toBe(BigInt(Math.round(s.proceedsUsd * 100)) * 10n ** 16n);
    await expect(p.sellBack(cards)).rejects.toThrow(/already sold/);

    const b = await p.buyPack('FORGE_28');
    const c = b.cards[0];
    expect((await p.releaseStatus(c)).released).toBe(false);
    await expect(p.transferCard(c.tokenId, '0x00000000000000000000000000000000000000bb')).rejects.toThrow(/not released/);
    t += 259_200;
    expect(await p.releaseStatus(c)).toMatchObject({ released: true, owner: op });
    await p.transferCard(c.tokenId, '0x00000000000000000000000000000000000000bb');
    expect((await p.releaseStatus(c)).owner).toBe('0x00000000000000000000000000000000000000bb');
  });
});

describe('schemas on recorded payloads', () => {
  it('parse live catalog + spec-shaped pull/buyback payloads', () => {
    expect(packListSchema.parse(fixture('packs-mainnet')).cardPacks.map((p) => p.slug).sort()).toEqual(['pandora-28', 'pandora-48', 'pandora-88-plus']);
    expect(packListSchema.parse(fixture('packs-testnet')).cardPacks.map((p) => p.slug)).toContain('pandora-88');
    const d = packDetailSchema.parse(fixture('pack-pandora-28')).cardPack;
    expect(d.buybackConfig.map((b) => b.buybackExpiredInSeconds)).toEqual([3600, 86400, 259200]);
    expect(prepareSchema.parse(fixture('pull-prepare')).unsignedPullPayload.numOfTokens).toBe(1);
    for (const f of ['pull-request-202', 'pull-status-pending-resolution', 'pull-status-resolved', 'pull-status-failed']) expect(pullStatusSchema.safeParse(fixture(f)).success).toBe(true);
  });
});

describe('mapDraw', () => {
  const resolved = fixture('pull-status-resolved');
  it('maps a resolved draw to our card model', () => {
    const c = mapDraw(drawSchema.parse(resolved.result.draws[0]), { cardPackId: 'pk' });
    expect(c).toMatchObject({
      tokenId: '73721661518761489417662024120673404533370918401961634301179502961262112660096',
      settlementId: '0x' + '5e'.repeat(32),
      name: '#097 Katy',
      set: 'Pokemon Japanese Sv1v-Violet Ex',
      grader: 'PSA',
      grade: '9',
      valueUsd: 20.5,
      tier: 'C',
      certNumber: 'PSA77565797',
      cardPackId: 'pk',
      releaseAt: Math.floor(Date.parse('2026-11-28T18:00:00.000Z') / 1000),
    });
    expect(c.image).toContain('graded-cards-renders/PSA77565797');
  });
  it('uses real collectible attributes (CGC) and falls back to image/name when attributes are missing', () => {
    const cgc = fixture('collectible-cgc').collectible;
    const base = { settlementId: '0x01', tokenId: cgc.tokenId, buybackTiers: [], buybackBaseValueInUSD: '2050' };
    const a = mapDraw(drawSchema.parse({ ...base, name: '#52 Mew', frontImageUrl: cgc.frontImageUrl, attributes: cgc.attributes }));
    expect([a.grader, a.grade, a.set]).toEqual(['CGC', '8.5', 'Pokémon Japanese S12A-VSTAR Universe']);
    const b = mapDraw(drawSchema.parse({ ...base, name: cgc.name, frontImageUrl: cgc.frontImageUrl }));
    expect([b.grader, b.grade, b.set]).toEqual(['CGC', '8.5', '']);
    const c = mapDraw(drawSchema.parse({ ...base, buybackBaseValueInUSD: null, name: 'x' }));
    expect([c.grader, c.grade, c.valueUsd]).toEqual(['', '', 0]);
  });
  it('parses grade strings', () => {
    expect(['9 Mint', '8.5 NM/Mint+', 'GEM MT 10', 'BLACK LABEL 10', 'Pristine 10', ''].map(parseGrade)).toEqual(['9', '8.5', '10', '10', '10', undefined]);
  });
  it('summaryCard sums multi-card pulls and keeps the top card', () => {
    const base = mapDraw(drawSchema.parse(resolved.result.draws[0]));
    const s = summaryCard([base, { ...base, tokenId: '2', name: 'Big', valueUsd: 100 }]);
    expect(s).toEqual({ name: 'Big +1 more', set: base.set, grader: 'PSA', grade: '9', image: base.image, valueUsd: 120.5 });
  });
});

describe('RenaissClient', () => {
  it('sends x-builder-api-key on builder routes only and a request id on every call', async () => {
    const f = fakeFetch({ 'GET /v2/gacha/packs/pandora-28': json(fixture('pack-pandora-28')), 'GET /v2/gacha/pull/status': json(fixture('pull-status-resolved')) });
    const c = new RenaissClient({ baseUrl: 'https://api.example.test/', apiKey: 'k-test', fetch: f.fetch });
    await c.getPack('pandora-28');
    const s = await c.pullStatus('0c6f3a52-7d1e-4b8a-9f21-3e5d7c9a1b24');
    expect(s.status).toBe('RESOLVED');
    expect(f.calls[0].headers['x-builder-api-key']).toBeUndefined();
    expect(f.calls[1].headers['x-builder-api-key']).toBe('k-test');
    expect(f.calls[1].url.searchParams.get('requestId')).toBe('0c6f3a52-7d1e-4b8a-9f21-3e5d7c9a1b24');
    for (const call of f.calls) expect(call.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('honours Retry-After on 429, then succeeds', async () => {
    const waits: number[] = [];
    const f = fakeFetch({ 'GET /v2/gacha/packs': [json(fixture('error-429'), 429, { 'retry-after': '2' }), json(fixture('error-429'), 429), json(fixture('packs-mainnet'))] });
    const c = new RenaissClient({ baseUrl: 'https://x.test', fetch: f.fetch, backoffMs: 100, sleep: async (ms) => void waits.push(ms) });
    const r = await c.listPacks({ stage: 'active' });
    expect(r.cardPacks).toHaveLength(3);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThanOrEqual(100);
    expect(f.calls).toHaveLength(3);
  });
  it('429 is retried even for non-idempotent POSTs; 5xx is not', async () => {
    const f = fakeFetch({ 'POST /v2/gacha/buyback/request': [json(fixture('error-429'), 429, { 'retry-after': '0' }), json({ code: 'FUNCTION_ERROR', message: 'boom' }, 500)] });
    const c = new RenaissClient({ baseUrl: 'https://x.test', apiKey: 'k', fetch: f.fetch, sleep: noSleep });
    await expect(c.submitBuyback({} as any)).rejects.toMatchObject({ status: 500, code: 'FUNCTION_ERROR' });
    expect(f.calls).toHaveLength(2);
  });
  it('gives up after maxRetries and surfaces the code', async () => {
    const f = fakeFetch({ 'GET /v2/gacha/packs': json(fixture('error-429'), 429) });
    const c = new RenaissClient({ baseUrl: 'https://x.test', fetch: f.fetch, maxRetries: 2, sleep: noSleep });
    const err = await c.listPacks().catch((e) => e);
    expect(err).toBeInstanceOf(RenaissApiError);
    expect(err).toMatchObject({ status: 429, code: 'API_AUTH_RATE_LIMITED' });
    expect(f.calls).toHaveLength(3);
  });
  it('rejects responses that fail validation, and builder calls without a key', async () => {
    const f = fakeFetch({ 'GET /v2/gacha/packs/pandora-28': json({ cardPack: { slug: 'pandora-28' } }) });
    const c = new RenaissClient({ baseUrl: 'https://x.test', fetch: f.fetch });
    await expect(c.getPack('pandora-28')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(c.pullStatus('x')).rejects.toMatchObject({ code: 'API_AUTH_MISSING_CREDENTIAL' });
  });
  it('times out hung requests', async () => {
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason)))) as unknown as typeof fetch;
    const c = new RenaissClient({ baseUrl: 'https://x.test', fetch: hang, timeoutMs: 20, maxRetries: 1, sleep: noSleep });
    await expect(c.listPacks()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  it('parseRetryAfter handles seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
  });
});

function catalogFor(network: typeof MAIN, mutate?: (slug: string, body: any) => any) {
  const live = fixture('packs-mainnet').cardPacks as any[];
  const routes: Record<string, any> = {};
  for (const slug of Object.values(network.slugs)) {
    const p = live.find((x) => x.slug === slug);
    const body = p ? { cardPack: { ...p, buybackConfig: fixture('pack-pandora-28').cardPack.buybackConfig } } : null;
    const out = mutate ? mutate(slug, body) : body;
    routes[`GET /v2/gacha/packs/${slug}`] = out ? json(out) : json(fixture('error-404-pack'), 404);
  }
  const f = fakeFetch(routes);
  return { f, client: new RenaissClient({ baseUrl: 'https://x.test', fetch: f.fetch, sleep: noSleep }) };
}

describe('RenaissCatalog', () => {
  it('resolves FORGE packs to slug → uuid, on-chain id and price; caches until ttl', async () => {
    let t = 0;
    const { f, client } = catalogFor(MAIN);
    const cat = new RenaissCatalog(client, MAIN, noopLog, 1000, () => t);
    const p = await cat.resolve('FORGE_88');
    expect(p).toMatchObject({ slug: 'pandora-88-plus', id: 'ff1da6af-a678-4abd-9b03-1594da093e48', priceInUsdt: 88n * 10n ** 18n, releaseAfterSeconds: 259_200 });
    expect(p.onChainPackId).toBe('0x6c2cb6f547d4470786186cac4808dd04ef30f1eb71a94347129d20f5770fb403');
    await cat.resolve('FORGE_28');
    expect(f.calls).toHaveLength(3);
    t = 2000;
    await cat.resolve('FORGE_28');
    expect(f.calls).toHaveLength(6);
  });
  it('fails loudly when a slug disappears', async () => {
    const { client } = catalogFor(MAIN, (slug, b) => (slug === 'pandora-48' ? null : b));
    const cat = new RenaissCatalog(client, MAIN);
    await expect(cat.resolve('FORGE_28')).rejects.toThrow(/pandora-48: slug not found/);
  });
  it('fails loudly on a price that is not our USD tier, and drops the stale cache', async () => {
    let bad = false;
    let t = 0;
    const live = fixture('packs-mainnet').cardPacks as any[];
    const f = fakeFetch(
      Object.fromEntries(
        Object.values(MAIN.slugs).map((slug) => [
          `GET /v2/gacha/packs/${slug}`,
          () => {
            const p = live.find((x) => x.slug === slug);
            return json({ cardPack: { ...p, buybackConfig: [], priceInUsdt: bad && slug === 'pandora-28' ? '29000000000000000000' : p.priceInUsdt } });
          },
        ]),
      ),
    );
    const cat = new RenaissCatalog(new RenaissClient({ baseUrl: 'https://x.test', fetch: f.fetch }), MAIN, undefined, 10, () => t);
    await cat.resolve('FORGE_28');
    bad = true;
    t = 100;
    await expect(cat.resolve('FORGE_48')).rejects.toThrow(CatalogError);
    await expect(cat.resolve('FORGE_28')).rejects.toThrow(/price 29000000000000000000 != expected 28000000000000000000/);
  });
  it('rejects a pack on an unexpected vending machine (wrong network)', async () => {
    const { client } = catalogFor(MAIN);
    await expect(new RenaissCatalog(client, { ...MAIN, vendingMachine: TEST.vendingMachine }).resolve('FORGE_28')).rejects.toThrow(/vending machine/);
  });
  it('currentTier picks the first unexpired tier', () => {
    const tiers = fixture('buyback-offers').offers[1].buybackTiers;
    expect(currentTier(tiers, Date.parse('2026-11-25T18:30:00Z'))?.buybackPercentage).toBe(90);
    expect(currentTier(tiers, Date.parse('2026-11-25T20:00:00Z'))?.buybackPercentage).toBe(85);
    expect(currentTier(tiers, Date.parse('2026-12-01T00:00:00Z'))).toBeUndefined();
  });
});

// ---------------- provider ----------------

const NOW = Date.parse('2026-11-25T18:30:00Z');

function providerHarness(o: { routes?: Record<string, any>; usdt?: bigint; allowance?: bigint; owners?: Record<string, string>; maxWaitMs?: number } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  let t = NOW;
  const prep = fixture('pull-prepare');
  prep.buyerWalletAddress = account.address;
  const deadline = Math.floor(NOW / 1000) + 240;
  prep.unsignedPullPayload.deadline = deadline;
  prep.permit2TypedData.message.deadline = String(deadline);
  const withBuyer = (x: any) => ({ ...x, buyerWalletAddress: account.address });
  const { catalogRoutes } = (() => {
    const live = fixture('packs-mainnet').cardPacks as any[];
    const r: Record<string, any> = {};
    for (const slug of Object.values(MAIN.slugs)) r[`GET /v2/gacha/packs/${slug}`] = json({ cardPack: { ...live.find((x) => x.slug === slug), buybackConfig: fixture('pack-pandora-28').cardPack.buybackConfig } });
    return { catalogRoutes: r };
  })();
  const f = fakeFetch({
    ...catalogRoutes,
    'POST /v2/gacha/pull/prepare': json(prep),
    'POST /v2/gacha/pull/request': json(withBuyer(fixture('pull-request-202')), 202),
    'GET /v2/gacha/pull/status': [json(withBuyer(fixture('pull-status-pending-resolution'))), json(withBuyer(fixture('pull-status-resolved')))],
    'GET /v2/gacha/buyback/offers': json(fixture('buyback-offers')),
    'POST /v2/gacha/buyback/request': json(withBuyer(fixture('buyback-request-202')), 202),
    'GET /v2/gacha/buyback/status': json(withBuyer(fixture('buyback-status-completed'))),
    ...(o.routes ?? {}),
  });
  const client = new RenaissClient({ baseUrl: 'https://x.test', apiKey: 'k-test', fetch: f.fetch, sleep: noSleep });
  const catalog = new RenaissCatalog(client, MAIN, noopLog, 60_000, () => t);
  const { wallet, state } = fakeWallet(account, { usdt: o.usdt, allowance: o.allowance, owners: o.owners });
  const sleeps: number[] = [];
  const provider = new RenaissProvider({
    client,
    catalog,
    network: MAIN,
    wallet,
    pollIntervalMs: 1000,
    maxWaitMs: o.maxWaitMs ?? 600_000,
    offerWaitMs: 0,
    busyRetryDelayMs: 10,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  return { provider, f, state, account, prep, sleeps, clock: { get: () => t, set: (v: number) => (t = v) } };
}

describe('RenaissProvider.buyPack', () => {
  it('prepare → approve Permit2 once → sign → request → poll → map card', async () => {
    const h = providerHarness();
    let submitted = '';
    const r = await h.provider.buyPack('FORGE_28', { onSubmitted: (id) => void (submitted = id) });
    expect(submitted).toBe('0c6f3a52-7d1e-4b8a-9f21-3e5d7c9a1b24');
    expect(r.pullId).toBe(submitted);
    expect(r.paidUsdt).toBe(28n * 10n ** 18n);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ name: '#097 Katy', grader: 'PSA', grade: '9', valueUsd: 20.5, cardPackId: '4c3263d7-8aab-4498-af7b-2c8a7c484a55' });
    expect(r.totalValueUsd).toBe(20.5);
    expect(r.fundingTxHash).toBe('0x' + '4f'.repeat(32));

    const prepare = h.f.calls.find((c) => c.url.pathname === '/v2/gacha/pull/prepare')!;
    expect(prepare.body).toEqual({ buyerWalletAddress: h.account.address, packId: '4c3263d7-8aab-4498-af7b-2c8a7c484a55', quantity: 1 });
    expect(prepare.headers['x-builder-api-key']).toBe('k-test');

    // one max approval of USDT to Permit2
    expect(h.state.writes).toHaveLength(1);
    expect(h.state.writes[0]).toMatchObject({ functionName: 'approve', address: MAIN.usdt });
    expect(h.state.writes[0].args![0]).toBe(MAIN.permit2);

    const req = h.f.calls.find((c) => c.url.pathname === '/v2/gacha/pull/request')!.body;
    expect(Object.keys(req).sort()).toEqual(['amountPerToken', 'buyerWalletAddress', 'deadline', 'nonce', 'numOfTokens', 'packId', 'permitSignature']);
    const signer = await recoverTypedDataAddress({ ...(permit2TypedData(h.prep, MAIN) as any), signature: req.permitSignature as Hex });
    expect(signer).toBe(h.account.address);
    // polled about once per second
    expect(h.sleeps).toEqual([1000, 1000]);

    // second buy: allowance already max → no new approve
    h.f.calls.length = 0;
    await h.provider.buyPack('FORGE_28');
    expect(h.state.writes).toHaveLength(1);
  });

  it('throws on FAILED (never charged) with the error code', async () => {
    const h = providerHarness({ routes: { 'GET /v2/gacha/pull/status': json(fixture('pull-status-failed')) } });
    await expect(h.provider.buyPack('FORGE_28')).rejects.toMatchObject({ code: 'INSUFFICIENT_ALLOWANCE', requestId: '0c6f3a52-7d1e-4b8a-9f21-3e5d7c9a1b24' });
  });

  it('resends the same signed pull on FAILED OP_WALLET_BUSY', async () => {
    const busy = { ...fixture('pull-status-failed'), error: { code: 'OP_WALLET_BUSY', message: 'busy' } };
    const h = providerHarness({ routes: { 'POST /v2/gacha/pull/request': [json(busy, 202), json(fixture('pull-status-resolved'), 202)] } });
    const r = await h.provider.buyPack('FORGE_28');
    expect(r.cards).toHaveLength(1);
    const reqs = h.f.calls.filter((c) => c.url.pathname === '/v2/gacha/pull/request');
    expect(reqs).toHaveLength(2);
    expect(reqs[1].body).toEqual(reqs[0].body);
  });

  it('times out after the cap while pending, keeping the requestId', async () => {
    const h = providerHarness({ maxWaitMs: 5000, routes: { 'GET /v2/gacha/pull/status': json(fixture('pull-status-pending-resolution')) } });
    const err = await h.provider.buyPack('FORGE_28').catch((e) => e);
    expect(err).toBeInstanceOf(RenaissFlowError);
    expect(err).toMatchObject({ code: 'PULL_TIMEOUT', requestId: '0c6f3a52-7d1e-4b8a-9f21-3e5d7c9a1b24' });
    expect(h.sleeps.length).toBe(5);
  });

  it('refuses before signing when the operator lacks USDT', async () => {
    const h = providerHarness({ usdt: 10n });
    await expect(h.provider.buyPack('FORGE_28')).rejects.toMatchObject({ code: 'INSUFFICIENT_USDT_AMOUNT' });
    expect(h.f.calls.some((c) => c.url.pathname === '/v2/gacha/pull/request')).toBe(false);
  });

  it('recovers the requestId when /pull/request first returns 5xx (idempotent resend)', async () => {
    const h = providerHarness({ routes: { 'POST /v2/gacha/pull/request': [json({ code: 'FUNCTION_ERROR', message: 'x' }, 502), json(fixture('pull-request-202'), 202)] } });
    expect((await h.provider.buyPack('FORGE_28')).pullId).toBe('0c6f3a52-7d1e-4b8a-9f21-3e5d7c9a1b24');
  });
});

describe('verifyPrepare', () => {
  const h = providerHarness();
  const pack = { pack: 'FORGE_28' as const, slug: 'pandora-28', id: '4c3263d7-8aab-4498-af7b-2c8a7c484a55', onChainPackId: '0xcf11308cc7c642554a781b039a63a542c2f20b36f904b5b6981d48a2f76a5f90', priceInUsdt: 28n * 10n ** 18n, vendingMachine: MAIN.vendingMachine, releaseAfterSeconds: 259200, buybackConfig: [] };
  const ok = () => structuredClone(h.prep);
  const check = (p: any) => () => verifyPrepare(prepareSchema.parse(p), { pack, network: MAIN, buyer: h.account.address, quantity: 1, nowSec: Math.floor(NOW / 1000) });
  it('accepts the consistent payload', () => expect(check(ok())).not.toThrow());
  it.each([
    ['spender', (p: any) => (p.permit2TypedData.message.spender = '0x' + '9'.repeat(40))],
    ['token', (p: any) => (p.permit2TypedData.message.permitted.token = '0x' + '9'.repeat(40))],
    ['amount', (p: any) => (p.permit2TypedData.message.permitted.amount = '1')],
    ['permit2', (p: any) => (p.permit2TypedData.domain.verifyingContract = '0x' + '9'.repeat(40))],
    ['chain', (p: any) => (p.chainId = 97)],
    ['witness pack', (p: any) => (p.permit2TypedData.message.witness.packId = '0x' + '00'.repeat(32))],
    ['nonce', (p: any) => (p.unsignedPullPayload.nonce = '5')],
    ['deadline', (p: any) => ((p.unsignedPullPayload.deadline = 1), (p.permit2TypedData.message.deadline = '1'))],
    ['types', (p: any) => p.permit2TypedData.types.PermitFundWitness.pop()],
    ['buyer', (p: any) => (p.buyerWalletAddress = '0x' + '9'.repeat(40))],
  ])('rejects a mismatched %s', (_n, mutate) => {
    const p = ok();
    mutate(p);
    expect(check(p)).toThrow(/prepare response rejected/);
  });
});

describe('RenaissProvider sell-back + release', () => {
  const card = () => mapDraw(drawSchema.parse(fixture('pull-status-resolved').result.draws[0]), { cardPackId: '4c3263d7-8aab-4498-af7b-2c8a7c484a55' });

  it('quotes from wallet offers (first unexpired tier)', async () => {
    const h = providerHarness();
    const q = await h.provider.quoteSellBack([card()]);
    expect(q).toMatchObject({ rate: 0.9, proceedsUsdt: 18_450_000_000_000_000_000n, proceedsUsd: 18.45, valueUsd: 20.5 });
    h.clock.set(Date.parse('2026-11-26T00:00:00Z'));
    expect((await h.provider.quoteSellBack([card()])).rate).toBe(0.85);
    h.clock.set(Date.parse('2026-12-01T00:00:00Z'));
    await expect(h.provider.quoteSellBack([card()])).rejects.toMatchObject({ code: 'BUYBACK_EXPIRED' });
  });

  it('signs BuybackUserAuthorization over the settlement ids and polls to COMPLETED', async () => {
    const h = providerHarness();
    const r = await h.provider.sellBack([card()]);
    expect(r).toMatchObject({ proceedsUsdt: 18_450_000_000_000_000_000n, txRef: '0x' + 'ab'.repeat(32) });
    const body = h.f.calls.find((c) => c.url.pathname === '/v2/gacha/buyback/request')!.body;
    expect(body.buybackAuth).toEqual({ buybackIds: ['0x' + '5e'.repeat(32)], token: MAIN.usdt, amount: '18450000000000000000' });
    expect(body.cardPackId).toBe('4c3263d7-8aab-4498-af7b-2c8a7c484a55');
    const td = buybackTypedData({ chainId: 56, vendingMachine: MAIN.vendingMachine, settlementIds: body.buybackAuth.buybackIds, token: MAIN.usdt, amount: 18_450_000_000_000_000_000n });
    expect(await recoverTypedDataAddress({ ...(td as any), signature: body.userSignature })).toBe(h.account.address);
    expect(td.domain).toEqual({ name: 'TokenVendingMachineV3', version: '1', chainId: 56, verifyingContract: MAIN.vendingMachine });
  });

  it('fails when there is no offer for the card, or the buyback FAILED', async () => {
    const h = providerHarness({ routes: { 'GET /v2/gacha/buyback/offers': json({ offers: [] }) } });
    await expect(h.provider.sellBack([card()])).rejects.toMatchObject({ code: 'NO_BUYBACK_OFFER' });
    const failed = { ...fixture('buyback-status-completed'), status: 'FAILED', txHash: null, totalAmountInUsdt: null, error: { code: 'BUYBACK_EXPIRED', message: 'x' } };
    const h2 = providerHarness({ routes: { 'GET /v2/gacha/buyback/status': json(failed) } });
    await expect(h2.provider.sellBack([card()])).rejects.toMatchObject({ code: 'BUYBACK_EXPIRED' });
  });

  it('releaseStatus reads ownerOf; transferCard only once released', async () => {
    const c = card();
    const h = providerHarness();
    expect((await h.provider.releaseStatus(c)).released).toBe(false);
    await expect(h.provider.transferCard(c.tokenId, '0x' + '7'.repeat(40))).rejects.toMatchObject({ code: 'NOT_RELEASED' });
    h.state.owners[c.tokenId] = h.account.address;
    expect((await h.provider.releaseStatus(c)).released).toBe(true);
    await h.provider.transferCard(c.tokenId, '0x' + '7'.repeat(40));
    const w = h.state.writes.at(-1)!;
    expect(w).toMatchObject({ functionName: 'safeTransferFrom', address: MAIN.registry });
    expect(w.args).toEqual([h.account.address, '0x' + '7'.repeat(40), BigInt(c.tokenId)]);
  });
});
