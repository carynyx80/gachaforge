import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEther, type Hex } from 'viem';
import { buildApp } from '../src/app.js';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { MemoryRepository } from '../src/store/memory.js';
import { DEAD, PORTAL, VAULT_PORTAL, type ForgeClient } from '../src/forge/chain.js';
import { FORGE_DEFAULT_RPC, FORGE_FALLBACK_RPC, loadForgeConfig } from '../src/forge/config.js';
import { matchCreation, toCreationLog, type CreationLog } from '../src/forge/discovery.js';
import { buildCandles, curvePrice, decodePairSwap, marketCap, pairPrice, stats24h, tradeValues } from '../src/forge/math.js';
import { normalizeMetadata, parseIpfsPath, resolveAsset } from '../src/forge/metadata.js';
import { AdaptiveRange, DEFAULT_SCAN, scanRange } from '../src/forge/scan.js';
import { ForgeService } from '../src/forge/service.js';
import { PREVIEW_ADDRESS } from '../src/forge/preview.js';
import type { WsMessage } from '../src/types.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const DEPLOYER = '0x00000000000000000000000000000000000dE910' as Hex;
const OTHER = '0x000000000000000000000000000000000000beef' as Hex;
const TOKEN = '0x000000000000000000000000000000000f0e7777' as Hex;
const POOL = '0x00000000000000000000000000000000000000cc' as Hex;
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Hex;
const BURNER = '0x00000000000000000000000000000000000000bb' as Hex;
const ALICE = '0x00000000000000000000000000000000000a11ce' as Hex;
const BOB = '0x0000000000000000000000000000000000000b0b' as Hex;
const ZERO = '0x0000000000000000000000000000000000000000' as Hex;
const h = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;

const creation = (over: Partial<CreationLog>): CreationLog => ({ token: TOKEN, creator: DEPLOYER, name: 'Forge', symbol: 'FORGE', meta: '', blockNumber: 10n, logIndex: 0, transactionHash: h(1), ...over });

describe('forge discovery matching', () => {
  it('matches creator in event data without any tx lookup', async () => {
    let lookups = 0;
    const m = await matchCreation([creation({})], DEPLOYER.toLowerCase(), async () => (lookups++, null));
    expect(m).toMatchObject({ token: TOKEN, matchedBy: 'creator' });
    expect(lookups).toBe(0);
  });
  it('falls back to tx.from when creator is a contract (VaultPortal) or missing', async () => {
    const froms: Record<string, string> = { [h(1)]: OTHER, [h(2)]: DEPLOYER };
    const logs = [creation({ creator: VAULT_PORTAL, token: '0x0000000000000000000000000000000000001111', transactionHash: h(1) }), creation({ creator: null, blockNumber: 11n, transactionHash: h(2) })];
    const m = await matchCreation(logs, DEPLOYER, async (x) => froms[x] ?? null);
    expect(m).toMatchObject({ token: TOKEN, matchedBy: 'txFrom' });
  });
  it('first match (block, logIndex) wins over a later direct creator hit', async () => {
    const early = creation({ creator: VAULT_PORTAL, token: '0x0000000000000000000000000000000000002222', blockNumber: 10n, logIndex: 1, transactionHash: h(5) });
    const late = creation({ creator: DEPLOYER, blockNumber: 12n, transactionHash: h(6) });
    const m = await matchCreation([late, early], DEPLOYER, async (x) => (x === h(5) ? DEPLOYER : null));
    expect(m?.token).toBe('0x0000000000000000000000000000000000002222');
  });
  it('returns null when nobody matches; tolerates tx lookup errors', async () => {
    expect(await matchCreation([creation({ creator: OTHER })], DEPLOYER, async () => { throw new Error('rpc'); })).toBeNull();
  });
  it('decodes viem logs and treats a zero creator as missing', () => {
    const c = toCreationLog({ eventName: 'TokenCreated', args: { ts: 5n, creator: ZERO, nonce: 1n, token: TOKEN, name: 'A', symbol: 'B', meta: 'bafy' }, blockNumber: 3n, logIndex: 2, transactionHash: h(9) });
    expect(c).toMatchObject({ creator: null, token: TOKEN, meta: 'bafy', blockNumber: 3n, logIndex: 2 });
    expect(toCreationLog({ eventName: 'TokenBought', args: {}, blockNumber: 1n, logIndex: 0, transactionHash: h(1) })).toBeNull();
  });
});

describe('forge adaptive scanning', () => {
  const opts = { ...DEFAULT_SCAN, initialRange: 4000, maxRange: 5000, minRange: 100, baseDelayMs: 100, maxDelayMs: 1000, maxRetries: 5, growAfter: 2 };
  it('halves the range on RPC limit errors, backs off exponentially, then grows again', async () => {
    const delays: number[] = [];
    const calls: [bigint, bigint][] = [];
    const o = { ...opts, sleep: async (ms: number) => void delays.push(ms) };
    const range = new AdaptiveRange(o);
    const seen: [bigint, bigint][] = [];
    const r = await scanRange(
      1n,
      6000n,
      async (a, b) => {
        calls.push([a, b]);
        if (b - a + 1n > 1000n) throw new Error('exceed maximum block range: 1000');
        return [];
      },
      async (_x, a, b) => void seen.push([a, b]),
      range,
      o,
    );
    expect(r).toEqual({ last: 6000n, stopped: false });
    expect(calls.slice(0, 3).map(([a, b]) => Number(b - a + 1n))).toEqual([4000, 2000, 1000]);
    expect(delays.slice(0, 2)).toEqual([100, 200]);
    // contiguous coverage, no gaps or overlaps
    let next = 1n;
    for (const [a, b] of seen) {
      expect(a).toBe(next);
      expect(b - a + 1n).toBeLessThanOrEqual(1000n);
      next = b + 1n;
    }
    expect(next).toBe(6001n);
  });
  it('grows after consecutive successes up to maxRange and stops early on request', async () => {
    const o = { ...opts, initialRange: 1000 };
    const range = new AdaptiveRange(o);
    const sizes: number[] = [];
    const r = await scanRange(0n, 100_000n, async () => [], async (_x, a, b) => (sizes.push(Number(b - a + 1n)), sizes.length === 5), range, o);
    expect(sizes).toEqual([1000, 1000, 2000, 2000, 4000]);
    expect(r.stopped).toBe(true);
  });
  it('gives up after maxRetries consecutive failures (caller retries next tick)', async () => {
    const o = { ...opts, maxRetries: 2, sleep: async () => {} };
    await expect(scanRange(0n, 10n, async () => { throw new Error('down'); }, async () => {}, new AdaptiveRange(o), o)).rejects.toThrow('down');
  });
});

describe('forge price math + candles', () => {
  it('curve price is 1e18-scaled quote/token; pair price respects token order', () => {
    expect(curvePrice(5546341239n)).toBeCloseTo(5.546341239e-9, 18);
    expect(pairPrice(parseEther('1000000'), parseEther('10'), true)).toBeCloseTo(1e-5, 12);
    expect(pairPrice(parseEther('10'), parseEther('1000000'), false)).toBeCloseTo(1e-5, 12);
    expect(pairPrice(0n, 1n, true)).toBe(0);
  });
  it('decodes V2 swaps for both orientations', () => {
    const z = { amount0In: 0n, amount1In: 0n, amount0Out: 0n, amount1Out: 0n };
    expect(decodePairSwap({ ...z, amount1In: 5n, amount0Out: 100n }, true)).toEqual({ side: 'BUY', tokensWei: 100n, quoteWei: 5n });
    expect(decodePairSwap({ ...z, amount0In: 100n, amount1Out: 5n }, true)).toEqual({ side: 'SELL', tokensWei: 100n, quoteWei: 5n });
    expect(decodePairSwap({ ...z, amount0In: 5n, amount1Out: 100n }, false)).toEqual({ side: 'BUY', tokensWei: 100n, quoteWei: 5n });
    expect(decodePairSwap(z, true)).toBeNull();
  });
  it('trade values: BNB quote and USD-stable quote', () => {
    expect(tradeValues(parseEther('1000000'), parseEther('1'), 600, 600)).toEqual({ tokens: 1_000_000, amountBnb: 1, priceUsd: 0.0006 });
    expect(tradeValues(parseEther('1000'), parseEther('60'), 1, 600)).toEqual({ tokens: 1000, amountBnb: 0.1, priceUsd: 0.06 });
    expect(marketCap(1e9, 0.0006)).toBe(600_000);
  });
  it('24h stats: volume in window, change vs last trade before window', () => {
    const now = 1_000_000;
    const trades = [
      { timestamp: now - 90_000, tokens: 100, priceUsd: 1 },
      { timestamp: now - 3600, tokens: 10, priceUsd: 2 },
      { timestamp: now - 60, tokens: 5, priceUsd: 3 },
    ];
    expect(stats24h(trades, 3, now, trades[0])).toEqual({ volume24hUsd: 35, change24hPct: 200 });
    expect(stats24h(trades, 3, now, null)).toEqual({ volume24hUsd: 35, change24hPct: 50 });
    expect(stats24h([], 0, now)).toEqual({ volume24hUsd: 0, change24hPct: 0 });
  });
  it('builds OHLCV buckets with forward-filled gaps and a limit', () => {
    const tr = [
      { timestamp: 60, tokens: 1, priceUsd: 10 },
      { timestamp: 90, tokens: 2, priceUsd: 12 },
      { timestamp: 100, tokens: 1, priceUsd: 8 },
      { timestamp: 250, tokens: 1, priceUsd: 11 },
    ];
    expect(buildCandles(tr, 60)).toEqual([
      { t: 60, o: 10, h: 12, l: 8, c: 8, v: 42 },
      { t: 120, o: 8, h: 8, l: 8, c: 8, v: 0 },
      { t: 180, o: 8, h: 8, l: 8, c: 8, v: 0 },
      { t: 240, o: 11, h: 11, l: 11, c: 11, v: 11 },
    ]);
    const lim = buildCandles(tr, 60, { limit: 2, until: 400 });
    expect(lim).toEqual([
      { t: 300, o: 11, h: 11, l: 11, c: 11, v: 0 },
      { t: 360, o: 11, h: 11, l: 11, c: 11, v: 0 },
    ]);
    expect(buildCandles([], 60)).toEqual([]);
  });
});

describe('forge metadata', () => {
  const gw = 'https://flap.mypinata.cloud/ipfs/';
  const cid = 'bafkreiagq2h2rpn5dfm5bh6ot3ia2lvyh4tkgmfn3xhui6f4osxwlto7se';
  it('parses CID, ipfs:// and gateway URLs', () => {
    expect(parseIpfsPath(cid)).toBe(cid);
    expect(parseIpfsPath(`ipfs://${cid}`)).toBe(cid);
    expect(parseIpfsPath(`https://ipfs.io/ipfs/${cid}`)).toBe(cid);
    expect(parseIpfsPath('')).toBeNull();
    expect(parseIpfsPath('hello')).toBeNull();
    expect(resolveAsset(cid, gw)).toBe(gw + cid);
    expect(resolveAsset('https://x.test/a.png', gw)).toBe('https://x.test/a.png');
  });
  it('normalizes flap JSON (image CID, twitter→x, empty links dropped)', () => {
    expect(normalizeMetadata({ description: 'd', image: cid, website: '', twitter: 'forge', telegram: 'https://t.me/forge' }, gw)).toEqual({
      image: gw + cid,
      description: 'd',
      links: { x: 'https://x.com/forge', telegram: 'https://t.me/forge' },
    });
    expect(normalizeMetadata({ website: '', twitter: '' }, gw)).toEqual({ image: undefined, description: undefined });
  });
});

describe('forge config', () => {
  it('defaults: mainnet public RPC + fallback, no deployer, preview off', () => {
    const c = loadForgeConfig({ MOCK_MODE: 'true', CHAIN_ID: '97' });
    expect(c.rpcUrls).toEqual([FORGE_DEFAULT_RPC, FORGE_FALLBACK_RPC]);
    expect(c.deployer).toBeUndefined();
    expect(c.preview).toBe(false);
    expect(c.maxRange).toBe(5000);
  });
  it('parses overrides and rejects bad addresses', () => {
    const c = loadForgeConfig({ FORGE_RPC_URL: 'https://a.example', FORGE_DEPLOYER: DEPLOYER, FORGE_START_BLOCK: '123', FORGE_PREVIEW: 'true', FORGE_TOKEN_ADDRESS: '' });
    expect(c.rpcUrls).toEqual(['https://a.example', FORGE_FALLBACK_RPC]);
    expect(c.startBlock).toBe(123n);
    expect(c.tokenOverride).toBeUndefined();
    expect(c.preview).toBe(true);
    expect(() => loadForgeConfig({ FORGE_DEPLOYER: '0x123' })).toThrow(/FORGE_DEPLOYER/);
  });
});

// ─────────────── service against a fake mainnet ───────────────

type L = { address: Hex; eventName: string; args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: Hex; blockTimestamp?: bigint };
const lg = (address: Hex, eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex: number, tx = h(Number(blockNumber) * 100 + logIndex)): L => ({ address, eventName, args, blockNumber, logIndex, transactionHash: tx, blockTimestamp: 1_700_000_000n + blockNumber });

function fakeChain(opts: { head: bigint; logs: L[]; txFrom: Record<string, Hex>; state?: Partial<Record<string, unknown>>; maxRange?: bigint }) {
  const calls = { getLogs: [] as { address: unknown; names: string[]; from: bigint; to: bigint }[], getTransaction: 0 };
  const state = { status: 1, price: 5_000_000_000n, quoteTokenAddress: ZERO, buyTaxRate: 300n, sellTaxRate: 300n, pool: ZERO, progress: parseEther('0.25'), ...opts.state };
  const chain = {
    head: opts.head,
    logs: opts.logs,
    state,
    balances: { [DEAD.toLowerCase()]: parseEther('1000'), } as Record<string, bigint>,
    reserves: [parseEther('200000000'), parseEther('20')] as [bigint, bigint],
  };
  const client = {
    getBlockNumber: async () => chain.head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_700_000_000n + blockNumber }),
    getTransaction: async ({ hash }: { hash: Hex }) => {
      calls.getTransaction++;
      return { from: opts.txFrom[hash] ?? OTHER };
    },
    getBalance: async ({ address }: { address: Hex }) => (address.toLowerCase() === BURNER.toLowerCase() ? parseEther('0.5') : 0n),
    getLogs: async (p: { address: Hex | Hex[]; event?: { name: string }; events?: { name: string }[]; fromBlock: bigint; toBlock: bigint }) => {
      if (opts.maxRange && p.toBlock - p.fromBlock + 1n > opts.maxRange) throw new Error('block range too large');
      const addrs = (Array.isArray(p.address) ? p.address : [p.address]).map((a) => a.toLowerCase());
      const names = (p.events ?? [p.event!]).map((e) => e.name);
      calls.getLogs.push({ address: p.address, names, from: p.fromBlock, to: p.toBlock });
      return chain.logs.filter((l) => addrs.includes(l.address.toLowerCase()) && names.includes(l.eventName) && l.blockNumber >= p.fromBlock && l.blockNumber <= p.toBlock);
    },
    readContract: async ({ address, functionName, args }: { address: Hex; functionName: string; args?: unknown[] }) => {
      const a = address.toLowerCase();
      if (functionName === 'getTokenV8Safe') return chain.state;
      if (functionName === 'latestRoundData') return [1n, 60_000_000_000n, 0n, 0n, 1n]; // $600
      if (a === TOKEN.toLowerCase()) {
        const r: Record<string, unknown> = { name: 'GachaForge', symbol: 'FORGE', totalSupply: parseEther('1000000000'), taxProcessor: '0x00000000000000000000000000000000000000a1' };
        if (functionName === 'balanceOf') return chain.balances[(args![0] as string).toLowerCase()] ?? 0n;
        if (functionName in r) return r[functionName];
      }
      if (functionName === 'marketAddress') return '0x00000000000000000000000000000000000000a2';
      if (functionName === 'token0') return TOKEN;
      if (functionName === 'getReserves') return [...chain.reserves, 0];
      throw new Error(`unexpected read ${functionName}`);
    },
  };
  return { client: client as unknown as ForgeClient, calls, chain };
}

const mkCfg = (env: Record<string, string> = {}) => loadForgeConfig({ FORGE_DEPLOYER: DEPLOYER, FORGE_START_BLOCK: '1', BUYBACK_BURNER_ADDRESS: BURNER, ...env });
const meta = 'bafkreiagq2h2rpn5dfm5bh6ot3ia2lvyh4tkgmfn3xhui6f4osxwlto7se';
const fakeFetch = (async () => new Response(JSON.stringify({ description: 'Forge it', image: meta, twitter: 'gachaforge', website: 'gachaforge.xyz', telegram: '' }), { status: 200 })) as unknown as typeof fetch;

function setup(over: { logs?: L[]; env?: Record<string, string>; repo?: MemoryRepository; maxRange?: bigint; head?: bigint; minRange?: number } = {}) {
  const logs = over.logs ?? [
    // someone else's launch, direct
    lg(PORTAL, 'TokenCreated', { ts: 1_700_000_005n, creator: OTHER, nonce: 1n, token: '0x0000000000000000000000000000000000003333', name: 'X', symbol: 'X', meta: '' }, 5n, 0),
    // ours, via VaultPortal: creator in data is the VaultPortal contract → tx.from fallback
    lg(PORTAL, 'TokenCreated', { ts: 1_700_000_020n, creator: VAULT_PORTAL, nonce: 2n, token: TOKEN, name: 'GachaForge', symbol: 'FORGE', meta }, 20n, 3, h(0xf0e9)),
  ];
  const fc = fakeChain({ head: over.head ?? 30n, logs, txFrom: { [h(0xf0e9)]: DEPLOYER }, maxRange: over.maxRange });
  const repo = over.repo ?? new MemoryRepository();
  const bus = new Bus();
  const msgs: WsMessage[] = [];
  bus.subscribe((m) => msgs.push(m));
  const svc = new ForgeService({ cfg: mkCfg(over.env), repo, bus, log: silent, client: fc.client, fetch: fakeFetch, now: () => 1_700_000_100, scan: { sleep: async () => {}, ...(over.minRange ? { minRange: over.minRange } : {}) } });
  return { svc, repo, bus, msgs, ...fc };
}

describe('ForgeService', () => {
  it('stays waiting and idle without FORGE_DEPLOYER', async () => {
    const fc = fakeChain({ head: 10n, logs: [], txFrom: {} });
    const svc = new ForgeService({ cfg: loadForgeConfig({}), repo: new MemoryRepository(), bus: new Bus(), log: silent, client: fc.client });
    await svc.init();
    await svc.tick();
    expect(fc.calls.getLogs).toHaveLength(0);
    expect(await svc.status()).toEqual({ status: 'waiting', deployer: null });
    expect(await svc.trades(10)).toEqual([]);
    expect(await svc.candles('1m')).toEqual([]);
  });

  it('defaults the discovery start to the head at first start and persists it', async () => {
    const fc = fakeChain({ head: 500n, logs: [], txFrom: {} });
    const repo = new MemoryRepository();
    const svc = new ForgeService({ cfg: loadForgeConfig({ FORGE_DEPLOYER: DEPLOYER }), repo, bus: new Bus(), log: silent, client: fc.client });
    await svc.tick();
    expect(fc.calls.getLogs[0]).toMatchObject({ from: 500n, to: 500n, names: ['TokenCreated'] });
    expect(fc.calls.getLogs[0].address).toEqual([PORTAL, VAULT_PORTAL]);
    expect(JSON.parse((await repo.getMeta(`forge:discovery:${DEPLOYER.toLowerCase()}`))!)).toEqual({ start: '500', cursor: '500' });
    expect((await svc.status()).status).toBe('waiting');
  });

  it('discovers via tx.from, loads metadata/tax, persists, emits WS forge; restart does not re-discover', async () => {
    const { svc, repo, msgs, calls } = setup();
    await svc.init();
    await svc.tick();
    const s = await svc.status();
    expect(s.status).toBe('live');
    expect(s.deployer).toBe(DEPLOYER.toLowerCase());
    expect(s.token).toMatchObject({
      address: TOKEN.toLowerCase(),
      name: 'GachaForge',
      symbol: 'FORGE',
      creator: DEPLOYER.toLowerCase(),
      createdAt: 1_700_000_020,
      createdTx: h(0xf0e9),
      stage: 'CURVE',
      bondingCurvePct: 25,
      buyTaxBps: 300,
      sellTaxBps: 300,
      taxRecipient: '0x00000000000000000000000000000000000000a2',
      image: `https://flap.mypinata.cloud/ipfs/${meta}`,
      description: 'Forge it',
      links: { website: 'https://gachaforge.xyz', x: 'https://x.com/gachaforge' },
      burnedTokens: 1000,
      buybackPendingBnb: 0.5,
    });
    // 5e9 / 1e18 BNB per token × $600
    expect(s.token!.priceBnb).toBeCloseTo(5e-9, 15);
    expect(s.token!.priceUsd).toBeCloseTo(3e-6, 12);
    expect(s.token!.marketCapUsd).toBe(3000);
    expect(s.preview).toBeUndefined();
    expect(msgs.some((m) => m.type === 'forge' && m.data.address === TOKEN.toLowerCase())).toBe(true);
    const rec = await repo.getForgeRecord();
    expect(rec).toMatchObject({ createdBlock: 20, discoveredBy: 'txFrom', meta, metaFetched: true });
    expect(await repo.getMeta(`forge:trades:${TOKEN.toLowerCase()}`)).toBe('19');
    // tx lookups: only the non-matching creation before ours, plus ours
    expect(calls.getTransaction).toBe(2);

    // restart on the same store: no TokenCreated scan any more
    const again = setup({ repo, logs: [] });
    await again.svc.init();
    expect((await again.svc.status()).token?.address).toBe(TOKEN.toLowerCase());
    await again.svc.tick();
    expect(again.calls.getLogs.some((c) => c.names.includes('TokenCreated'))).toBe(false);
  });

  it('a creator hit in event data matches directly (no tx lookups)', async () => {
    const logs = [lg(PORTAL, 'TokenCreated', { ts: 1_700_000_020n, creator: DEPLOYER, nonce: 2n, token: TOKEN, name: 'GachaForge', symbol: 'FORGE', meta: '' }, 20n, 0)];
    const { svc, repo, calls } = setup({ logs });
    await svc.tick();
    expect((await repo.getForgeRecord())?.discoveredBy).toBe('creator');
    expect(calls.getTransaction).toBe(0);
  });

  it('finds a token created before startup when FORGE_START_BLOCK is earlier, respecting RPC range limits', async () => {
    const { svc, calls } = setup({ maxRange: 7n, head: 40n, minRange: 2 });
    await svc.tick();
    expect((await svc.status()).status).toBe('live');
    const scans = calls.getLogs.filter((c) => c.names.includes('TokenCreated'));
    for (const c of scans.filter((c) => c.to - c.from + 1n <= 7n)) expect(c.to - c.from + 1n).toBeLessThanOrEqual(7n);
    expect(scans[scans.length - 1].to).toBeGreaterThanOrEqual(20n);
  });

  it('FORGE_TOKEN_ADDRESS skips discovery matching', async () => {
    const { svc, repo } = setup({ env: { FORGE_DEPLOYER: '', FORGE_TOKEN_ADDRESS: TOKEN } });
    await svc.tick();
    const rec = await repo.getForgeRecord();
    expect(rec).toMatchObject({ discoveredBy: 'override', createdBlock: 20, meta });
    expect(rec!.token.creator).toBe(DEPLOYER.toLowerCase());
  });

  it('indexes curve trades, transfers/holders, graduation, pair swaps and buybacks', async () => {
    const T = TOKEN;
    const logs: L[] = [
      lg(PORTAL, 'TokenCreated', { ts: 1_700_000_020n, creator: DEPLOYER, nonce: 2n, token: T, name: 'GachaForge', symbol: 'FORGE', meta: '' }, 20n, 0),
      lg(T, 'Transfer', { from: PORTAL, to: ALICE, value: parseEther('1000000') }, 21n, 0),
      lg(PORTAL, 'TokenBought', { ts: 1_700_000_021n, token: T, buyer: ALICE, amount: parseEther('1000000'), eth: parseEther('1'), fee: 0n, postPrice: 0n }, 21n, 1),
      lg(PORTAL, 'TokenBought', { ts: 1_700_000_021n, token: '0x0000000000000000000000000000000000003333', buyer: BOB, amount: 1n, eth: 1n, fee: 0n, postPrice: 0n }, 21n, 2),
      lg(T, 'Transfer', { from: PORTAL, to: BOB, value: parseEther('500000') }, 22n, 0),
      lg(T, 'Transfer', { from: BOB, to: DEAD, value: parseEther('100') }, 22n, 1),
      lg(PORTAL, 'TokenSold', { ts: 1_700_000_022n, token: T, seller: BOB, amount: parseEther('500000'), eth: parseEther('0.4'), fee: 0n, postPrice: 0n }, 22n, 2),
      lg(PORTAL, 'LaunchedToDEX', { token: T, pool: POOL, amount: 1n, eth: 1n }, 23n, 0),
      // pair LP Transfer must NOT count as a $FORGE holder transfer
      lg(POOL, 'Transfer', { from: ZERO, to: OTHER, value: 1n }, 23n, 1),
      lg(POOL, 'Swap', { sender: OTHER, amount0In: 0n, amount1In: parseEther('2'), amount0Out: parseEther('1000000'), amount1Out: 0n, to: OTHER }, 24n, 0, h(0xabc)),
      lg(BURNER, 'Buyback', { bnbSpent: parseEther('0.25'), forgeBought: parseEther('10') }, 25n, 0),
    ];
    const { svc, repo, msgs, chain } = setup({ logs });
    chain.state.status = 1;
    await svc.tick(); // discover
    chain.state.status = 4;
    chain.state.pool = POOL;
    chain.state.price = 0n;
    await svc.tick(); // index 20..30 (graduation inside the chunk → swaps fetched)
    const trades = await svc.trades(10);
    expect(trades.map((t) => [t.side, t.trader, t.tokens, t.amountBnb])).toEqual([
      ['BUY', OTHER.toLowerCase(), 1_000_000, 2],
      ['SELL', BOB.toLowerCase(), 500_000, 0.4],
      ['BUY', ALICE.toLowerCase(), 1_000_000, 1],
    ]);
    for (const t of trades) expect(Object.keys(t).sort()).toEqual(['amountBnb', 'priceUsd', 'side', 'timestamp', 'tokens', 'trader', 'txHash']);
    expect(trades[2].priceUsd).toBeCloseTo(0.0006, 10);
    const tok = (await svc.status()).token!;
    expect(tok).toMatchObject({ stage: 'GRADUATED', pool: POOL.toLowerCase(), bondingCurvePct: 100, holders: 2, buybackTotalBnb: 0.25 });
    // price from reserves 20 BNB / 200M tokens = 1e-7 BNB × $600
    expect(tok.priceUsd).toBeCloseTo(6e-5, 12);
    expect(tok.marketCapUsd).toBe(60_000);
    expect(tok.volume24hUsd).toBeGreaterThan(0);
    expect(msgs.filter((m) => m.type === 'forgeTrade')).toHaveLength(3);
    // replay of the same range must not duplicate trades
    await repo.setMeta(`forge:trades:${TOKEN.toLowerCase()}`, '19');
    await svc.tick();
    expect(await svc.trades(10)).toHaveLength(3);
    const c = await svc.candles('1m', 5);
    expect(c.length).toBeGreaterThan(0);
    for (const k of c) expect(Object.keys(k).sort()).toEqual(['c', 'h', 'l', 'o', 't', 'v']);
  });

  it('buyback fields are 0 without BUYBACK_BURNER_ADDRESS', async () => {
    const { svc } = setup({ env: { BUYBACK_BURNER_ADDRESS: '' } });
    await svc.tick();
    expect((await svc.status()).token).toMatchObject({ buybackPendingBnb: 0, buybackTotalBnb: 0 });
  });
});

describe('forge API', () => {
  const tokenKeys = ['address', 'name', 'symbol', 'creator', 'createdAt', 'createdTx', 'stage', 'bondingCurvePct', 'priceUsd', 'priceBnb', 'marketCapUsd', 'change24hPct', 'volume24hUsd', 'holders', 'buyTaxBps', 'sellTaxBps', 'burnedTokens', 'buybackPendingBnb', 'buybackTotalBnb'];
  const app = async (forge?: ForgeService) => {
    const bus = new Bus();
    return buildApp({ ledger: new Ledger(new MemoryRepository(), bus), bus, corsOrigin: ['http://localhost:3000'], forge });
  };

  it('defaults to waiting with no service; validates query params', async () => {
    const a = await app();
    expect((await a.inject('/api/forge')).json()).toEqual({ status: 'waiting', deployer: null });
    expect((await a.inject('/api/forge/trades?limit=5')).json()).toEqual([]);
    expect((await a.inject('/api/forge/candles?interval=1h')).json()).toEqual([]);
    expect((await a.inject('/api/forge/candles?interval=2m')).statusCode).toBe(400);
    expect((await a.inject('/api/forge/trades?limit=0')).statusCode).toBe(400);
    await a.close();
  });

  it('live shapes', async () => {
    const { svc } = setup();
    await svc.tick();
    const a = await app(svc);
    const body = (await a.inject('/api/forge')).json();
    expect(body.status).toBe('live');
    for (const k of tokenKeys) expect(body.token).toHaveProperty(k);
    expect(body.token.preview).toBeUndefined();
    expect(Array.isArray((await a.inject('/api/forge/trades')).json())).toBe(true);
    await a.close();
  });

  it('FORGE_PREVIEW serves a clearly flagged simulated token until discovery', async () => {
    const fc = fakeChain({ head: 10n, logs: [], txFrom: {} });
    const svc = new ForgeService({ cfg: loadForgeConfig({ FORGE_PREVIEW: 'true' }), repo: new MemoryRepository(), bus: new Bus(), log: silent, client: fc.client });
    await svc.init();
    const a = await app(svc);
    const body = (await a.inject('/api/forge')).json();
    expect(body).toMatchObject({ status: 'live', preview: true, token: { preview: true, address: PREVIEW_ADDRESS } });
    for (const k of tokenKeys) expect(body.token).toHaveProperty(k);
    const trades = (await a.inject('/api/forge/trades?limit=20')).json();
    expect(trades).toHaveLength(20);
    expect(trades[0].timestamp).toBeGreaterThanOrEqual(trades[19].timestamp);
    const candles = (await a.inject('/api/forge/candles?interval=1h&limit=24')).json();
    expect(candles.length).toBeGreaterThan(10);
    expect(candles[0]).toEqual({ t: expect.any(Number), o: expect.any(Number), h: expect.any(Number), l: expect.any(Number), c: expect.any(Number), v: expect.any(Number) });
    svc.stop();
    await a.close();
  });
});

describe('forge persistence', () => {
  it('migration 0003 creates forge tables and is journaled', () => {
    const sql = readFileSync(new URL('../drizzle/0003_forge.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE "forge_token"');
    expect(sql).toContain('CREATE TABLE "forge_trades"');
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain('0003_forge');
  });

  it('memory repo: record round-trip, trade dedupe, ordering and since/before queries', async () => {
    const repo = new MemoryRepository();
    expect(await repo.getForgeRecord()).toBeNull();
    const t = (id: string, ts: number) => ({ id, side: 'BUY' as const, trader: ALICE, amountBnb: 1, tokens: 1, priceUsd: 1, txHash: h(1), timestamp: ts, blockNumber: ts, logIndex: 0, source: 'PORTAL' as const });
    expect(await repo.addForgeTrade(TOKEN, t('a', 10))).toBe(true);
    expect(await repo.addForgeTrade(TOKEN, t('a', 10))).toBe(false);
    await repo.addForgeTrade(TOKEN, t('b', 20));
    await repo.addForgeTrade(TOKEN, t('c', 30));
    expect((await repo.listForgeTrades(TOKEN, { limit: 10 })).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect((await repo.listForgeTrades(TOKEN, { limit: 10, since: 20 })).map((x) => x.id)).toEqual(['c', 'b']);
    expect((await repo.lastForgeTradeBefore(TOKEN, 30))?.id).toBe('b');
  });
});

// Postgres round-trip, only when a disposable database is provided.
describe.skipIf(!process.env.TEST_DATABASE_URL)('forge persistence (postgres)', () => {
  it('saves/loads the record and dedupes trades', async () => {
    const { PostgresRepository } = await import('../src/store/postgres.js');
    const repo = new PostgresRepository(process.env.TEST_DATABASE_URL!);
    await repo.init();
    const { svc } = setup({ repo: repo as unknown as MemoryRepository });
    await svc.tick();
    expect((await repo.getForgeRecord())?.token.address).toBe(TOKEN.toLowerCase());
    await repo.close();
  });
});
