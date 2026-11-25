/**
 * BSC mainnet fork (anvil) integration test for OFF-CHAIN MODE. Skipped unless BSC_RPC_URL is set:
 *   BSC_RPC_URL=https://bsc-rpc.publicnode.com npx vitest run test/offchain.fork.test.ts
 * Uses anvil's well-known test accounts only (no real keys).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, encodeAbiParameters, erc20Abi, getContractAddress, http, keccak256, parseEther, parseEventLogs, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { FLAP_TAX_TOKEN_IMPL, portalAbi, portalOpsAbi } from '../src/abi/flap.js';
import { registerMessage } from '../src/offchain/message.js';
import { taxProcessorAbi, tokenAbi } from '../src/abi/token.js';
import { buildApp } from '../src/app.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { Ledger } from '../src/ledger.js';
import { OffchainService } from '../src/offchain/service.js';
import { MemoryRepository } from '../src/store/memory.js';
import { FixedProvider, silent } from './helpers/offchain.js';

const RPC = process.env.BSC_RPC_URL;
const PORT = 8555 + Math.floor(Math.random() * 300);
const ANVIL = `http://127.0.0.1:${PORT}`;
const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0' as Hex;
const USDT = '0x55d398326f99059fF775485246999027B3197955' as Hex;
const DEAD = '0x000000000000000000000000000000000000dEaD' as Hex;
const ZERO = '0x0000000000000000000000000000000000000000' as Hex;
// anvil default accounts (public test keys)
const CREATOR = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const TRADER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const OPS_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;
const OPS = privateKeyToAccount(OPS_KEY).address;
const TREASURY = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Hex; // anvil account #3 = test treasury

function mineSalt(): Hex {
  const impl = FLAP_TAX_TOKEN_IMPL[56].slice(2).toLowerCase();
  const bytecodeHash = keccak256(`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`);
  const seed = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'string' }], [BigInt(Date.now()), 'gachaforge-fork']));
  for (let i = 0n; ; i++) {
    const salt = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [seed, i]));
    if (getContractAddress({ opcode: 'CREATE2', from: PORTAL, salt, bytecodeHash }).toLowerCase().endsWith('7777')) return salt;
  }
}

describe.skipIf(!RPC)('OFF-CHAIN MODE on a BSC mainnet fork (anvil)', () => {
  let anvil: ChildProcess;
  let pc: PublicClient;
  const mine = (n = 3) => pc.request({ method: 'anvil_mine' as never, params: [`0x${n.toString(16)}`] as never });

  beforeAll(async () => {
    anvil = spawn('anvil', ['--fork-url', RPC!, '--port', String(PORT), '--silent', '--chain-id', '56'], { stdio: 'ignore' });
    pc = createPublicClient({ chain: bsc, transport: http(ANVIL, { timeout: 120_000 }) }) as PublicClient;
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      try {
        await pc.getBlockNumber();
        up = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!up) throw new Error('anvil did not start');
    // The well-known anvil addresses carry EIP-7702 sweeper delegations on BSC mainnet: clear them on the fork.
    for (const a of [CREATOR.address, TRADER.address, OPS, TREASURY]) await pc.request({ method: 'anvil_setCode' as never, params: [a, '0x'] as never });
  }, 90_000);
  afterAll(() => {
    anvil?.kill('SIGTERM');
  });

  it(
    'launch (newTokenV6 → test treasury) → register via API → trades → dispatch → ledger reconciles → pot-full pull with real Pancake swap → burn',
    async () => {
      const creator = createWalletClient({ chain: bsc, transport: http(ANVIL), account: CREATOR });
      const trader = createWalletClient({ chain: bsc, transport: http(ANVIL), account: TRADER });

      // 1. creator launches directly on the Portal with the GachaForge params (tax recipient = test treasury)
      const salt = mineSalt();
      const launchTx = await creator.writeContract({
        address: PORTAL,
        abi: portalOpsAbi,
        functionName: 'newTokenV6',
        args: [
          {
            name: 'GachaForge Fork',
            symbol: 'GFFORK',
            meta: '',
            dexThresh: 1,
            salt,
            migratorType: 1,
            quoteToken: ZERO,
            quoteAmt: 0n,
            beneficiary: TREASURY,
            permitData: '0x',
            extensionID: `0x${'0'.repeat(64)}`,
            extensionData: '0x',
            dexId: 0,
            lpFeeProfile: 0,
            buyTaxRate: 200,
            sellTaxRate: 200,
            taxDuration: BigInt(100 * 365 * 86_400),
            antiFarmerDuration: 259_200n,
            mktBps: 10_000,
            deflationBps: 0,
            dividendBps: 0,
            lpBps: 0,
            minimumShareBalance: 0n,
            dividendToken: ZERO,
            commissionReceiver: ZERO,
            tokenVersion: 6,
          },
        ],
      });
      const launch = await pc.waitForTransactionReceipt({ hash: launchTx });
      expect(launch.status).toBe('success');

      // 2. backend in offchain mode against the fork, mocked Renaiss, real PancakeSwap
      const repo = new MemoryRepository();
      const bus = new Bus();
      const ledger = new Ledger(repo, bus);
      const cfg = loadConfig({
        RPC_URL: ANVIL,
        CHAIN_ID: '56',
        TREASURY_ADDRESS: TREASURY,
        OPS_PRIVATE_KEY: OPS_KEY,
        OPS_DAILY_CAP_BNB: '5',
        START_BLOCK: String(launch.blockNumber),
        PULL_COOLDOWN_SEC: '0',
        BURN_MIN_BNB: '0.001',
      });
      const provider = new FixedProvider(20, 18n * 10n ** 18n);
      const svc = await OffchainService.create({ cfg, ledger, log: silent, provider, fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch });
      const app = await buildApp({ ledger, bus, corsOrigin: [], offchain: svc, health: { mode: 'offchain', chainId: 56, treasury: TREASURY } });
      const created = parseEventLogs({ abi: portalAbi, eventName: 'TokenCreated', logs: launch.logs.filter((l) => l.address.toLowerCase() === PORTAL.toLowerCase()) })[0];
      const signature = await CREATOR.signMessage({ message: registerMessage({ token: created.args.token, pack: 'FORGE_28', strategy: 'RAFFLE', chainId: 56 }) });
      const reg = await app.inject({ method: 'POST', url: '/api/machines/register', payload: { txHash: launchTx, pack: 'FORGE_28', strategy: 'RAFFLE', signature } });
      expect(reg.statusCode).toBe(201);
      const token = reg.json().machine.address as Hex;
      expect(token.endsWith('7777')).toBe(true);

      // 3. trades via Portal.swapExactInput (curve)
      const treasury0 = await pc.getBalance({ address: TREASURY });
      const buy = async (bnb: string) =>
        pc.waitForTransactionReceipt({
          hash: await trader.writeContract({ address: PORTAL, abi: portalOpsAbi, functionName: 'swapExactInput', args: [{ inputToken: ZERO, outputToken: token, inputAmount: parseEther(bnb), minOutputAmount: 0n, permitData: '0x' }], value: parseEther(bnb) }),
        });
      await buy('1');
      const bal = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [TRADER.address] });
      await pc.waitForTransactionReceipt({ hash: await trader.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [PORTAL, bal] }) });
      await pc.waitForTransactionReceipt({ hash: await trader.writeContract({ address: PORTAL, abi: portalOpsAbi, functionName: 'swapExactInput', args: [{ inputToken: token, outputToken: ZERO, inputAmount: bal / 3n, minOutputAmount: 0n, permitData: '0x' }] }) });
      await buy('0.5');
      await mine();
      await svc.indexer.tick();
      const trades = await repo.listTrades(token, 0, 10);
      expect(trades.total).toBe(3);
      const feesBefore = await repo.listFeeEvents({ machine: token, limit: 10 });
      expect(feesBefore.every((f) => f.pending)).toBe(true);
      const taxWei = await svc.accounts.balance('TAX', token);
      const estNet = (await svc.accounts.balance('PLATFORM', token)) + (await svc.accounts.balance('POT', token)) + (await svc.accounts.balance('BUYBACK', token));

      // 4. keeper dispatch (ops wallet pays gas) → treasury receives the tax
      const tp = (await pc.readContract({ address: token, abi: tokenAbi, functionName: 'taxProcessor' })) as Hex;
      const sent0 = (await pc.readContract({ address: tp, abi: taxProcessorAbi, functionName: 'totalQuoteSentToMarketing' })) as bigint;
      await svc.engine.tickDispatch();
      await mine();
      await svc.indexer.tick();
      await svc.engine.tickReconcile();
      const received = (await pc.getBalance({ address: TREASURY })) - treasury0;
      const sent1 = (await pc.readContract({ address: tp, abi: taxProcessorAbi, functionName: 'totalQuoteSentToMarketing' })) as bigint;
      expect(received).toBeGreaterThan(0n);
      expect(sent1).toBeGreaterThan(sent0 - 1n);
      expect(sent1).toBe(received); // all tax of this token reached the test treasury
      const net = (await svc.accounts.balance('PLATFORM', token)) + (await svc.accounts.balance('POT', token)) + (await svc.accounts.balance('BUYBACK', token));
      expect(net).toBe(received); // reconciled ledger == real receipts
      const estErr = Number(estNet > received ? estNet - received : received - estNet) / Number(received);
      expect(estErr).toBeLessThan(0.25); // pre-dispatch estimate within tolerance
      const share = await svc.accounts.shareBps();
      expect(share).toBeGreaterThanOrEqual(5000);
      expect((await repo.listFeeEvents({ machine: token, limit: 10 })).every((f) => !f.pending)).toBe(true);
      const txs = await svc.store.listOpsTxs({ limit: 20 });
      console.log(`[fork] volume tax ${Number(taxWei) / 1e18} BNB, treasury received ${Number(received) / 1e18} BNB (share ${share} bps), estimate err ${(estErr * 100).toFixed(2)}%, dispatch txs: ${txs.filter((t) => t.kind === 'DISPATCH').length}`);

      // 5. pot-full pull: real BNB→USDT swap on PancakeSwap, mocked Renaiss, raffle among indexed holders
      await svc.accounts.book([{ ref: 'fork:pot', ts: 1, machine: token, bucket: 'POT', kind: 'ADJUST', amountWei: parseEther('0.2') }]);
      const potBefore = await svc.accounts.potWei(token);
      await svc.engine.tickPulls();
      expect(provider.bought).toBe(1);
      const usdt = await pc.readContract({ address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [OPS] });
      expect(usdt).toBeGreaterThanOrEqual(28n * 10n ** 18n);
      const spent = potBefore - (await svc.accounts.potWei(token));
      expect(spent).toBeGreaterThan(0n);
      expect(spent).toBeLessThan(parseEther('0.2'));
      const swapTx = (await svc.store.listOpsTxs({ limit: 20 })).find((t) => t.label === 'swapETHForExactTokens');
      expect(swapTx).toMatchObject({ kind: 'PULL', status: 'CONFIRMED' });
      const pull = (await repo.listPulls({ machine: token, offset: 0, limit: 1 })).items[0];
      expect(pull).toMatchObject({ result: 'WON', winner: TRADER.address.toLowerCase() });
      const proof = (await app.inject({ method: 'GET', url: `/api/raffles/${pull.id}` })).json();
      expect(proof.eligible.map((e: { address: string }) => e.address)).toContain(TRADER.address.toLowerCase());

      // 6. burn path: Portal buy from the ops wallet → 0x…dEaD
      await svc.accounts.book([{ ref: 'fork:burn', ts: 1, machine: token, bucket: 'BURN', kind: 'ADJUST', amountWei: parseEther('0.01') }]);
      await svc.engine.tickBurns();
      const dead = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD] });
      expect(dead).toBeGreaterThan(0n);
      expect(await pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [OPS] })).toBe(0n);
      expect(await svc.accounts.balance('BURN', token)).toBe(0n);
      const t = (await app.inject({ method: 'GET', url: '/api/transparency' })).json();
      expect(t.txs.length).toBeGreaterThanOrEqual(4);
      expect(t.ledger.measured).toBe(true);
      console.log(`[fork] pull spent ${Number(spent) / 1e18} BNB for 28 USDT; burned ${Number(dead) / 1e18} tokens; ops txs ${t.txs.map((x: any) => `${x.kind}:${x.label}:${x.status}`).join(', ')}`);
      await app.close();
      svc.stop();
    },
    600_000,
  );
});
