import { describe, expect, it } from 'vitest';
import { encodeFunctionData, erc20Abi, keccak256, parseEther, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { MemoryRepository } from '../src/store/memory.js';
import { assertBurnCall, AUTO_BURN_KEY, ForgeAutoBurner, loadAutoBurnEnv, viemBurnBackend, type BurnBackend, type BurnReceipt } from '../src/forge/autoburn.js';
import { DEAD, PORTAL, type ForgeClient } from '../src/forge/chain.js';
import { loadForgeConfig } from '../src/forge/config.js';
import { AUTO_BURN_POLL_MS, ForgeService } from '../src/forge/service.js';
import type { WsMessage } from '../src/types.js';

// anvil default accounts (public test keys)
const KEY0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const KEY1 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const DEPLOYER = privateKeyToAccount(KEY0).address;
const OTHER = privateKeyToAccount(KEY1).address;
const TOKEN = '0x000000000000000000000000000000000f0e7777' as Hex;
const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory chain for the deployer: transfers move the balance to DEAD when "mined". */
class FakeBurn implements BurnBackend {
  bal: bigint;
  bnb: bigint;
  fee = 21_000n * 10n ** 9n;
  dead = 0n;
  signed: { token: string; amount: bigint; raw: Hex; hash: Hex }[] = [];
  broadcasts: Hex[] = [];
  receipts = new Map<string, BurnReceipt>();
  /** errors thrown by the next broadcast calls (in order) */
  broadcastErrors: Error[] = [];
  /** don't mine on broadcast (simulates a crash/slow chain) */
  holdMining = false;
  private pending = new Map<string, bigint>();
  constructor(
    readonly address: Hex,
    o: { bal?: bigint; bnb?: bigint } = {},
  ) {
    this.bal = o.bal ?? parseEther('81043445.24');
    this.bnb = o.bnb ?? parseEther('0.01');
  }
  async tokenBalance() {
    return this.bal;
  }
  async nativeBalance() {
    return this.bnb;
  }
  async estimateFee() {
    return this.fee;
  }
  async signBurn(token: Hex, amount: bigint) {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD, amount] });
    assertBurnCall({ to: token, data, value: 0n }, token);
    const raw = toHex(`burn:${token}:${amount}:${this.signed.length}`);
    const hash = keccak256(raw);
    this.signed.push({ token, amount, raw, hash });
    this.pending.set(hash, amount);
    return { raw, hash };
  }
  mine(hash: string) {
    const amount = this.pending.get(hash);
    if (amount === undefined || this.receipts.has(hash)) return;
    this.bal -= amount;
    this.dead += amount;
    this.bnb -= this.fee;
    this.receipts.set(hash, { status: 'success', blockNumber: 100n });
  }
  async broadcast(raw: Hex) {
    const err = this.broadcastErrors.shift();
    if (err) throw err;
    this.broadcasts.push(raw);
    const hash = keccak256(raw);
    if (!this.holdMining) this.mine(hash);
    return hash;
  }
  async getReceipt(hash: Hex) {
    return this.receipts.get(hash) ?? null;
  }
  async waitReceipt(hash: Hex) {
    const r = this.receipts.get(hash);
    if (!r) throw new Error('Timed out while waiting for transaction');
    return r;
  }
}

function mk(o: { backend?: FakeBurn | null; deployer?: string; repo?: MemoryRepository; enabled?: boolean; sleep?: (ms: number) => Promise<void>; gasWaitMaxMs?: number } = {}) {
  const repo = o.repo ?? new MemoryRepository();
  const bus = new Bus();
  const msgs: WsMessage[] = [];
  bus.subscribe((m) => msgs.push(m));
  const ledger = new Ledger(repo, bus);
  const errors: string[] = [];
  const log = { ...silent, error: (_o: unknown, m?: string) => void errors.push(m ?? '') };
  const sleeps: number[] = [];
  const backend = o.backend === undefined ? new FakeBurn(DEPLOYER) : o.backend;
  const burner = new ForgeAutoBurner({
    enabled: o.enabled ?? true,
    deployer: o.deployer ?? DEPLOYER,
    backend,
    repo,
    bus,
    ledger,
    log,
    retryBaseMs: 1,
    gasWaitMaxMs: o.gasWaitMaxMs,
    sleep: o.sleep ?? (async (ms) => void sleeps.push(ms)),
  });
  return { burner, repo, msgs, errors, sleeps, backend: backend as FakeBurn };
}

describe('FORGE_AUTO_BURN config', () => {
  it('defaults to disabled; parses the key without ever echoing it', () => {
    expect(loadAutoBurnEnv({})).toMatchObject({ enabled: false, key: null });
    expect(loadAutoBurnEnv({ FORGE_AUTO_BURN: 'true', FORGE_DEPLOYER_PRIVATE_KEY: KEY0 })).toEqual({ enabled: true, key: KEY0 });
    expect(loadAutoBurnEnv({ FORGE_AUTO_BURN: 'TRUE', FORGE_DEPLOYER_PRIVATE_KEY: KEY0.slice(2) }).key).toBe(KEY0);
    const bad = loadAutoBurnEnv({ FORGE_AUTO_BURN: 'true', FORGE_DEPLOYER_PRIVATE_KEY: '0x1234' });
    expect(bad.key).toBeNull();
    expect(bad.keyProblem).toMatch(/malformed/);
    expect(bad.keyProblem).not.toContain('1234');
  });
  it('viem backend derives the deployer address from the key', () => {
    expect(viemBurnBackend(KEY0, ['http://127.0.0.1:1']).address).toBe(DEPLOYER);
  });
  it('the signing guard only allows token.transfer(DEAD, x) with value 0', () => {
    const ok = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD, 5n] });
    expect(() => assertBurnCall({ to: TOKEN, data: ok, value: 0n }, TOKEN)).not.toThrow();
    expect(() => assertBurnCall({ to: OTHER, data: ok }, TOKEN)).toThrow(/target/);
    expect(() => assertBurnCall({ to: TOKEN, data: ok, value: 1n }, TOKEN)).toThrow(/value/);
    expect(() => assertBurnCall({ to: TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [OTHER, 5n] }) }, TOKEN)).toThrow(/dEaD/);
    expect(() => assertBurnCall({ to: TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [DEAD, 5n] }) }, TOKEN)).toThrow(/transfer/);
    expect(() => assertBurnCall({ to: TOKEN, data: '0x' }, TOKEN)).toThrow();
  });
});

describe('ForgeAutoBurner', () => {
  it('disabled → idle, never touches the chain', async () => {
    const { burner, backend } = mk({ enabled: false });
    await burner.init();
    await burner.trigger({ token: TOKEN });
    expect(burner.status()).toEqual({ enabled: false, status: 'idle' });
    expect(backend.signed).toHaveLength(0);
  });

  it('refuses (error, never signs) when the key address != FORGE_DEPLOYER', async () => {
    const { burner, backend, errors } = mk({ backend: new FakeBurn(OTHER) });
    await burner.init();
    expect(burner.armed).toBe(false);
    await burner.trigger({ token: TOKEN });
    expect(backend.signed).toHaveLength(0);
    expect(backend.broadcasts).toHaveLength(0);
    expect(burner.status()).toMatchObject({ enabled: true, status: 'error', detail: expect.stringMatching(/does not match/) });
    expect(errors.join()).toMatch(/REFUSED/);
  });

  it('refuses when enabled without a key', async () => {
    const { burner } = mk({ backend: null });
    await burner.init();
    expect(burner.status()).toMatchObject({ status: 'error', detail: expect.stringMatching(/not set/) });
  });

  it('matches FORGE_DEPLOYER case-insensitively', async () => {
    const { burner } = mk({ deployer: DEPLOYER.toLowerCase() });
    await burner.init();
    expect(burner.armed).toBe(true);
    expect(burner.status()).toMatchObject({ status: 'waiting' });
  });

  it('burns the full balance exactly once, records burn + activity, persists done + tx hash', async () => {
    const { burner, backend, repo, msgs } = mk();
    const full = backend.bal;
    let burned = 0;
    burner.onBurned = async () => void burned++;
    await burner.init();
    await Promise.all([burner.trigger({ token: TOKEN, symbol: 'FORGE', priceUsd: 0.00001 }), burner.trigger({ token: TOKEN })]);
    await burner.trigger({ token: TOKEN });
    expect(backend.signed).toHaveLength(1);
    expect(backend.signed[0]).toMatchObject({ token: TOKEN.toLowerCase(), amount: full });
    expect(backend.bal).toBe(0n);
    expect(backend.dead).toBe(full);
    const st = burner.status();
    expect(st).toMatchObject({ enabled: true, status: 'done', txHash: backend.signed[0].hash, amount: 81043445.24 });
    const saved = JSON.parse((await repo.getMeta(AUTO_BURN_KEY))!);
    expect(saved).toMatchObject({ status: 'done', txHash: backend.signed[0].hash, amountWei: full.toString() });
    expect(saved.raw).toBeUndefined();
    const burns = await repo.listBurns(0, 10);
    expect(burns.items).toEqual([expect.objectContaining({ id: `autoburn-${backend.signed[0].hash}`, kind: 'BURN', amount: 81043445.24, txHash: backend.signed[0].hash })]);
    expect(msgs.find((m) => m.type === 'activity')).toMatchObject({ data: { kind: 'BURN', machine: TOKEN.toLowerCase(), ticker: 'FORGE' } });
    expect(burned).toBe(1);
  });

  it('restart after done never repeats', async () => {
    const repo = new MemoryRepository();
    const a = mk({ repo });
    await a.burner.trigger({ token: TOKEN });
    expect(a.burner.status().status).toBe('done');
    const b = mk({ repo, backend: new FakeBurn(DEPLOYER) }); // fresh balance on the "chain" again
    await b.burner.init();
    await b.burner.trigger({ token: TOKEN });
    expect(b.backend.signed).toHaveLength(0);
    expect(b.backend.broadcasts).toHaveLength(0);
    expect(b.burner.status()).toMatchObject({ status: 'done', txHash: a.backend.signed[0].hash });
  });

  it('restart mid-burn: settles the persisted signed tx (rebroadcasts the same raw), never signs a second one', async () => {
    const repo = new MemoryRepository();
    const chain = new FakeBurn(DEPLOYER);
    chain.holdMining = true;
    // run 1 "crashes" while waiting for the receipt
    const a = mk({ repo, backend: chain });
    chain.broadcastErrors = [];
    const p = a.burner.trigger({ token: TOKEN });
    await p; // waitReceipt times out repeatedly → transient retries exhausted → error, raw kept
    expect(chain.signed).toHaveLength(1);
    const saved = JSON.parse((await repo.getMeta(AUTO_BURN_KEY))!);
    expect(saved.raw).toBe(chain.signed[0].raw);
    expect(saved.txHash).toBe(chain.signed[0].hash);
    // run 2 after restart: the tx gets mined now
    chain.holdMining = false;
    const b = mk({ repo, backend: chain });
    await b.burner.init();
    await b.burner.trigger({ token: TOKEN });
    expect(chain.signed).toHaveLength(1);
    expect(chain.broadcasts.every((r) => r === chain.signed[0].raw)).toBe(true);
    expect(b.burner.status()).toMatchObject({ status: 'done', txHash: chain.signed[0].hash });
    expect(chain.dead).toBe(parseEther('81043445.24'));
  });

  it('zero balance → nothing (recorded, never retried)', async () => {
    const repo = new MemoryRepository();
    const { burner, backend } = mk({ repo, backend: new FakeBurn(DEPLOYER, { bal: 0n }) });
    await burner.trigger({ token: TOKEN });
    expect(burner.status()).toMatchObject({ enabled: true, status: 'nothing' });
    expect(burner.status().txHash).toBeUndefined();
    expect(backend.signed).toHaveLength(0);
    backend.bal = 5n;
    await burner.trigger({ token: TOKEN });
    const again = mk({ repo, backend });
    await again.burner.trigger({ token: TOKEN });
    expect(backend.signed).toHaveLength(0);
  });

  it('insufficient BNB for gas: logs, waits 30 s between checks, burns once funded', async () => {
    const chain = new FakeBurn(DEPLOYER, { bnb: 0n });
    const statuses: string[] = [];
    let n = 0;
    const ctx = mk({
      backend: chain,
      sleep: async (ms) => {
        ctx.sleeps.push(ms);
        statuses.push(`${ctx.burner.status().status}:${ctx.burner.status().detail}`);
        if (++n === 3) chain.bnb = parseEther('0.001'); // owner tops up
      },
    });
    await ctx.burner.trigger({ token: TOKEN });
    expect(ctx.sleeps).toEqual([30_000, 30_000, 30_000]);
    expect(statuses[0]).toBe('waiting:deployer needs BNB for gas');
    expect(ctx.errors.filter((e) => /INSUFFICIENT BNB FOR GAS/.test(e))).toHaveLength(3);
    expect(chain.signed).toHaveLength(1);
    expect(ctx.burner.status().status).toBe('done');
  });

  it('insufficient BNB for gas for the whole window → error', async () => {
    const chain = new FakeBurn(DEPLOYER, { bnb: 0n });
    const { burner } = mk({ backend: chain, gasWaitMaxMs: 0 });
    await burner.trigger({ token: TOKEN });
    expect(burner.status()).toMatchObject({ status: 'error', detail: expect.stringMatching(/insufficient BNB/) });
    expect(chain.signed).toHaveLength(0);
  });

  it('retries transient broadcast errors with backoff (same signed tx), then succeeds', async () => {
    const chain = new FakeBurn(DEPLOYER);
    chain.broadcastErrors = [new Error('fetch failed'), new Error('HTTP 503')];
    const { burner, sleeps } = mk({ backend: chain });
    await burner.trigger({ token: TOKEN });
    expect(burner.status().status).toBe('done');
    expect(chain.signed).toHaveLength(1);
    expect(sleeps).toEqual([1, 2]);
  });

  it('a non-transient error stops with status error (retried on next restart)', async () => {
    const chain = new FakeBurn(DEPLOYER);
    chain.broadcastErrors = [new Error('execution reverted: something')];
    const repo = new MemoryRepository();
    const { burner } = mk({ backend: chain, repo });
    await burner.trigger({ token: TOKEN });
    expect(burner.status()).toMatchObject({ status: 'error' });
    const b = mk({ backend: chain, repo });
    await b.burner.trigger({ token: TOKEN });
    expect(b.burner.status().status).toBe('done');
    expect(chain.signed).toHaveLength(2); // the first never reached the mempool
    expect(chain.dead).toBe(parseEther('81043445.24'));
  });
});

// ─────────────── wired into ForgeService discovery ───────────────

const h = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;
function fakeClient(creator: string) {
  const log = { address: PORTAL, eventName: 'TokenCreated', args: { ts: 1_700_000_020n, creator, nonce: 1n, token: TOKEN, name: 'GachaForge', symbol: 'FORGE', meta: '' }, blockNumber: 20n, logIndex: 0, transactionHash: h(0xf0e9) };
  return {
    getBlockNumber: async () => 30n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_700_000_000n + blockNumber }),
    getTransaction: async () => ({ from: creator }),
    getBalance: async () => 0n,
    getLogs: async (p: { event?: { name: string }; fromBlock: bigint; toBlock: bigint }) => (p.event?.name === 'TokenCreated' && p.fromBlock <= 20n && p.toBlock >= 20n ? [log] : []),
    readContract: async () => {
      throw new Error('not in fake');
    },
  } as unknown as ForgeClient;
}

describe('ForgeService + auto-burn', () => {
  const env = { FORGE_DEPLOYER: DEPLOYER, FORGE_START_BLOCK: '1' };
  it('polls every 1.5 s while armed and undiscovered; discovery triggers the burn; /api/forge shows autoBurn', async () => {
    const x = mk();
    const svc = new ForgeService({ cfg: loadForgeConfig(env), repo: x.repo, bus: new Bus(), log: silent, client: fakeClient(DEPLOYER), now: () => 1_700_000_100, autoBurn: x.burner, scan: { sleep: async () => {} } });
    await svc.init();
    expect(svc.pollMs).toBe(AUTO_BURN_POLL_MS);
    expect((await svc.status()).autoBurn).toMatchObject({ enabled: true, status: 'waiting' });
    await svc.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(x.backend.signed).toHaveLength(1);
    const s = await svc.status();
    expect(s.status).toBe('live');
    expect(s.autoBurn).toMatchObject({ enabled: true, status: 'done', txHash: x.backend.signed[0].hash });
    expect(s.token?.autoBurn).toBeUndefined(); // not persisted on the token
    expect(svc.pollMs).toBe(5000);
  });

  it('disabled: normal poll interval, autoBurn idle', async () => {
    const x = mk({ enabled: false });
    const svc = new ForgeService({ cfg: loadForgeConfig(env), repo: x.repo, bus: new Bus(), log: silent, client: fakeClient(DEPLOYER), autoBurn: x.burner, scan: { sleep: async () => {} } });
    await svc.init();
    expect(svc.pollMs).toBe(5000);
    await svc.tick();
    expect((await svc.status()).autoBurn).toEqual({ enabled: false, status: 'idle' });
    expect(x.backend.signed).toHaveLength(0);
  });

  it('restart with $FORGE already discovered resumes a pending burn on init', async () => {
    const x = mk();
    const repo = x.repo;
    const svc1 = new ForgeService({ cfg: loadForgeConfig(env), repo, bus: new Bus(), log: silent, client: fakeClient(DEPLOYER), scan: { sleep: async () => {} } });
    await svc1.tick(); // discovered without auto-burn wired
    expect((await svc1.status()).status).toBe('live');
    const svc2 = new ForgeService({ cfg: loadForgeConfig(env), repo, bus: new Bus(), log: silent, client: fakeClient(DEPLOYER), autoBurn: x.burner, scan: { sleep: async () => {} } });
    await svc2.init();
    await new Promise((r) => setTimeout(r, 20));
    expect(x.backend.signed).toHaveLength(1);
    expect((await svc2.status()).autoBurn?.status).toBe('done');
  });

  it('never burns a FORGE_TOKEN_ADDRESS that FORGE_DEPLOYER did not create', async () => {
    const x = mk();
    const svc = new ForgeService({ cfg: loadForgeConfig({ ...env, FORGE_TOKEN_ADDRESS: TOKEN }), repo: x.repo, bus: new Bus(), log: silent, client: fakeClient(OTHER), autoBurn: x.burner, scan: { sleep: async () => {} } });
    await svc.init();
    await svc.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect((await svc.status()).status).toBe('live');
    expect(x.backend.signed).toHaveLength(0);
  });
});
