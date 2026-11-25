import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { RegistrationError, verifyLaunchTx } from '../src/offchain/register.js';
import { privateKeyToAccount } from 'viem/accounts';
import { registerMessage } from '../src/offchain/message.js';
import { ALICE, FORGE, PORTAL, TOKEN, TREASURY, h32, harness, tokenCreatedLog } from './helpers/offchain.js';

// viem/anvil public test keys
const launcher = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const stranger = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const CREATOR = launcher.address;
const sig = (pack: string, strategy: string, split?: { dividendBps: number; burnBps: number; lpBps: number }, who = launcher, token: string = TOKEN, chainId = 56) =>
  who.signMessage({ message: registerMessage({ token, pack, strategy, split, chainId }) });
const TX = h32(7);
function withLaunch(h: ReturnType<typeof harness>, logs = [tokenCreatedLog(TOKEN, CREATOR)], status: 'success' | 'reverted' = 'success') {
  h.chain.receipts.set(TX.toLowerCase(), { status, blockNumber: 100n, from: CREATOR, logs });
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof RegistrationError ? e.code : `other:${(e as Error).message}`;
  }
};

describe('offchain registration verification', () => {
  it('accepts a Portal launch with 200/200 tax and the treasury as tax recipient', async () => {
    const h = harness();
    withLaunch(h);
    const v = await verifyLaunchTx(h.chain as any, { txHash: TX, portal: PORTAL, treasury: TREASURY });
    expect(v).toMatchObject({ token: TOKEN.toLowerCase(), buyTaxBps: 200, sellTaxBps: 200, taxRecipient: TREASURY.toLowerCase(), creator: CREATOR.toLowerCase(), name: 'Test', symbol: 'TST', createdBlock: 100 });
  });
  it('rejects bad tax, wrong recipient, commission, non-BNB quote', async () => {
    const h = harness();
    withLaunch(h);
    const run = () => verifyLaunchTx(h.chain as any, { txHash: TX, portal: PORTAL, treasury: TREASURY });
    h.chain.tokenState = { ...h.chain.tokenState, buyTaxRate: 300n, sellTaxRate: 300n };
    expect(await code(run())).toBe('bad_tax');
    h.chain.tokenState = { ...h.chain.tokenState, buyTaxRate: 200n, sellTaxRate: 100n };
    expect(await code(run())).toBe('bad_tax');
    h.chain.tokenState = { ...h.chain.tokenState, sellTaxRate: 200n };
    h.chain.taxRecipient = ALICE;
    expect(await code(run())).toBe('wrong_recipient');
    h.chain.taxRecipient = TREASURY;
    h.chain.commission = ALICE;
    expect(await code(run())).toBe('commission_set');
    h.chain.commission = '0x0000000000000000000000000000000000000000';
    h.chain.tokenState = { ...h.chain.tokenState, quoteTokenAddress: '0x55d398326f99059fF775485246999027B3197955' };
    expect(await code(run())).toBe('bad_quote');
  });
  it('rejects unknown / reverted txs and txs without a Portal TokenCreated', async () => {
    const h = harness();
    expect(await code(verifyLaunchTx(h.chain as any, { txHash: TX, portal: PORTAL, treasury: TREASURY }))).toBe('tx_not_found');
    withLaunch(h, [tokenCreatedLog(TOKEN, CREATOR)], 'reverted');
    expect(await code(verifyLaunchTx(h.chain as any, { txHash: TX, portal: PORTAL, treasury: TREASURY }))).toBe('tx_reverted');
    // same event from a contract that is not the Portal does not count
    withLaunch(h, [{ ...tokenCreatedLog(TOKEN, CREATOR), address: ALICE }]);
    expect(await code(verifyLaunchTx(h.chain as any, { txHash: TX, portal: PORTAL, treasury: TREASURY }))).toBe('no_token_created');
  });
});

describe('POST /api/machines/register', () => {
  async function app(h: ReturnType<typeof harness>) {
    return buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], offchain: h.svc, health: { mode: 'offchain', chainId: 56, treasury: TREASURY } });
  }
  const post = (a: Awaited<ReturnType<typeof app>>, body: unknown) => a.inject({ method: 'POST', url: '/api/machines/register', payload: body as object });

  it('registers, is idempotent for the same params and immutable otherwise', async () => {
    const h = harness();
    withLaunch(h);
    const a = await app(h);
    const r1 = await post(a, { txHash: TX, pack: 'FORGE_48', strategy: 'DIVIDEND', signature: await sig('FORGE_48', 'DIVIDEND') });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().machine).toMatchObject({ address: TOKEN.toLowerCase(), pack: 'FORGE_48', packPriceUsd: 48, strategy: 'DIVIDEND', taxBps: 200, pullQueued: false, ticker: 'TST' });
    const again = await post(a, { txHash: TX, pack: 'FORGE_48', strategy: 'DIVIDEND', signature: await sig('FORGE_48', 'DIVIDEND') });
    expect(again.statusCode).toBe(200);
    expect(again.json().created).toBe(false);
    const clash = await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'RAFFLE', signature: await sig('FORGE_28', 'RAFFLE') });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe('already_registered');
    const m = await a.inject({ method: 'GET', url: `/api/machines/${TOKEN}` });
    expect(m.json()).toMatchObject({ strategy: 'DIVIDEND', pullQueued: false });
    const reg = await h.store.getRegistration(TOKEN);
    expect(reg).toMatchObject({ syncedTo: 99, registeredBy: 'api', taxProcessor: expect.any(String) });
    await a.close();
  });
  it('returns clear errors', async () => {
    const h = harness();
    withLaunch(h);
    const a = await app(h);
    expect((await post(a, { txHash: '0x12', pack: 'FORGE_28', strategy: 'RAFFLE' })).statusCode).toBe(400);
    const bad = { dividendBps: 5000, burnBps: 4000, lpBps: 0 };
    const split = await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'SPLIT', split: bad, signature: await sig('FORGE_28', 'SPLIT', bad) });
    expect(split.statusCode).toBe(400);
    expect(split.json().error).toBe('invalid_params');
    h.chain.taxRecipient = ALICE;
    const wrong = await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'RAFFLE', signature: await sig('FORGE_28', 'RAFFLE') });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ error: 'wrong_recipient', details: { taxRecipient: ALICE } });
    expect(wrong.json().message).toMatch(/treasury/);
    h.chain.taxRecipient = TREASURY;
    h.chain.tokenState = { ...h.chain.tokenState, buyTaxRate: 500n, sellTaxRate: 500n };
    const tax = await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'RAFFLE', signature: await sig('FORGE_28', 'RAFFLE') });
    expect(tax.json()).toMatchObject({ error: 'bad_tax', details: { buyTaxBps: 500, sellTaxBps: 500 } });
    await a.close();
  });
  it('rejects the $FORGE token and is unavailable outside offchain mode', async () => {
    const h = harness({ forge: TOKEN.toLowerCase() });
    withLaunch(h);
    const a = await app(h);
    expect((await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'RAFFLE', signature: await sig('FORGE_28', 'RAFFLE') })).json().error).toBe('forge_token');
    await a.close();
    const m = await buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], health: { mode: 'mock' } });
    expect((await m.inject({ method: 'POST', url: '/api/machines/register', payload: { txHash: TX, pack: 'FORGE_28', strategy: 'RAFFLE' } })).statusCode).toBe(409);
    await m.close();
    expect(FORGE).toBeTruthy();
  });
});

describe('registration signature (EIP-191 by the launch tx sender)', () => {
  async function app(h: ReturnType<typeof harness>) {
    return buildApp({ ledger: h.ledger, bus: h.bus, corsOrigin: [], offchain: h.svc, health: { mode: 'offchain', chainId: 56, treasury: TREASURY } });
  }
  const post = (a: Awaited<ReturnType<typeof app>>, body: unknown) => a.inject({ method: 'POST', url: '/api/machines/register', payload: body as object });
  const sp = { dividendBps: 6000, burnBps: 3000, lpBps: 1000 };

  it('accepts a valid signature (incl. SPLIT) and rejects missing / wrong-signer / tampered ones', async () => {
    const h = harness();
    withLaunch(h);
    const a = await app(h);
    expect(registerMessage({ token: TOKEN, pack: 'FORGE_28', strategy: 'SPLIT', split: sp, chainId: 56 })).toBe(`GachaForge register\ntoken:${TOKEN.toLowerCase()}\npack:FORGE_28\nstrategy:SPLIT\nsplit:6000/3000/1000\nchainId:56`);
    expect((await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'SPLIT', split: sp })).statusCode).toBe(400);
    const wrongSigner = await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'SPLIT', split: sp, signature: await sig('FORGE_28', 'SPLIT', sp, stranger) });
    expect(wrongSigner.statusCode).toBe(401);
    expect(wrongSigner.json()).toMatchObject({ error: 'bad_signature', details: { expectedSigner: CREATOR.toLowerCase() } });
    // signed for one config, submitted with another
    const signed = await sig('FORGE_28', 'SPLIT', sp);
    for (const tampered of [
      { pack: 'FORGE_88', strategy: 'SPLIT', split: sp },
      { pack: 'FORGE_28', strategy: 'DIVIDEND' },
      { pack: 'FORGE_28', strategy: 'SPLIT', split: { dividendBps: 0, burnBps: 0, lpBps: 10_000 } },
    ])
      expect((await post(a, { txHash: TX, ...tampered, signature: signed })).json().error).toBe('bad_signature');
    expect((await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'SPLIT', split: sp, signature: await sig('FORGE_28', 'SPLIT', sp, launcher, ALICE) })).json().error).toBe('bad_signature'); // other token
    expect((await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'SPLIT', split: sp, signature: await sig('FORGE_28', 'SPLIT', sp, launcher, TOKEN, 97) })).json().error).toBe('bad_signature'); // other chain
    expect(await h.store.getRegistration(TOKEN)).toBeNull();
    const ok = await post(a, { txHash: TX, pack: 'FORGE_28', strategy: 'SPLIT', split: sp, signature: signed });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().machine).toMatchObject({ strategy: 'SPLIT', split: sp });
    await a.close();
  });
});

describe('auto-registration of treasury-taxed launches', () => {
  it('registers with FORGE_28 / RAFFLE after the delay; ignores tokens taxed to someone else', async () => {
    let now = 1_700_000_000;
    const h = harness({ now: () => now });
    withLaunch(h);
    const OTHER = '0x0000000000000000000000000000000000ba7777';
    await h.svc.indexer.addCandidates([
      { token: TOKEN.toLowerCase(), txHash: TX, block: 100, ts: now },
      { token: OTHER, txHash: h32(8), block: 100, ts: now },
    ]);
    await h.engine.tickAutoRegister();
    expect(await h.store.getRegistration(TOKEN)).toBeNull(); // < 10 min
    now += 601;
    h.chain.receipts.set(h32(8), { status: 'success', blockNumber: 100n, from: CREATOR, logs: [tokenCreatedLog(OTHER as any, CREATOR)] });
    h.chain.overrides.getTokenV8Safe = (p) => (p.args[0].toLowerCase() === OTHER ? { ...h.chain.tokenState, buyTaxRate: 300n } : h.chain.tokenState);
    await h.engine.tickAutoRegister();
    expect(await h.store.getRegistration(TOKEN)).toMatchObject({ pack: 'FORGE_28', strategy: 'RAFFLE', registeredBy: 'auto' });
    expect(await h.store.getRegistration(OTHER)).toBeNull();
    expect(await h.svc.indexer.candidates()).toEqual([]);
  });
});
