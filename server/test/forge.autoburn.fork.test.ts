/**
 * $FORGE auto-burn on a BSC mainnet fork (anvil, 1 s blocks). Skipped unless BSC_RPC_URL is set:
 *   BSC_RPC_URL=https://bsc-rpc.publicnode.com npx vitest run test/forge.autoburn.fork.test.ts
 * An anvil test account plays FORGE_DEPLOYER: it launches a flap.sh Tax Token V3 via Portal.newTokenV6 with an initial
 * buy; the real ForgeService (1.5 s discovery polling) finds it and the auto-burner sends the whole balance to 0x…dEaD.
 * Uses anvil's well-known test keys only.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, encodeAbiParameters, erc20Abi, getContractAddress, http, keccak256, parseEther, parseEventLogs, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { FLAP_TAX_TOKEN_IMPL, portalAbi, portalOpsAbi } from '../src/abi/flap.js';
import { tokenAbi } from '../src/abi/token.js';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { ForgeAutoBurner, viemBurnBackend } from '../src/forge/autoburn.js';
import { createForgeClient } from '../src/forge/chain.js';
import { loadForgeConfig } from '../src/forge/config.js';
import { ForgeService } from '../src/forge/service.js';
import { MemoryRepository } from '../src/store/memory.js';

const RPC = process.env.BSC_RPC_URL;
const PORT = 9155 + Math.floor(Math.random() * 300);
const ANVIL = `http://127.0.0.1:${PORT}`;
const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0' as Hex;
const DEAD = '0x000000000000000000000000000000000000dEaD' as Hex;
const ZERO = '0x0000000000000000000000000000000000000000' as Hex;
// anvil account #3 = test FORGE_DEPLOYER, #4 = tax recipient
const DEPLOYER_KEY = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as Hex;
const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
const BENEFICIARY = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a').address;

function mineSalt(): Hex {
  const impl = FLAP_TAX_TOKEN_IMPL[56].slice(2).toLowerCase();
  const bytecodeHash = keccak256(`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`);
  const seed = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'string' }], [BigInt(Date.now()), 'gachaforge-autoburn']));
  for (let i = 0n; ; i++) {
    const salt = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [seed, i]));
    if (getContractAddress({ opcode: 'CREATE2', from: PORTAL, salt, bytecodeHash }).toLowerCase().endsWith('7777')) return salt;
  }
}

describe.skipIf(!RPC)('$FORGE auto-burn on a BSC mainnet fork (anvil)', () => {
  let anvil: ChildProcess;
  let pc: PublicClient;

  beforeAll(async () => {
    anvil = spawn('anvil', ['--fork-url', RPC!, '--port', String(PORT), '--silent', '--chain-id', '56', '--block-time', '1'], { stdio: 'ignore' });
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
    // well-known anvil addresses carry EIP-7702 sweeper delegations on BSC mainnet: clear them on the fork
    for (const a of [DEPLOYER.address, BENEFICIARY]) await pc.request({ method: 'anvil_setCode' as never, params: [a, '0x'] as never });
  }, 90_000);
  afterAll(() => {
    anvil?.kill('SIGTERM');
  });

  it(
    'deployer launches with an initial buy → discovered → whole balance burned once to 0x…dEaD (untaxed)',
    async () => {
      const head = await pc.getBlockNumber();
      const repo = new MemoryRepository();
      const bus = new Bus();
      const ledger = new Ledger(repo, bus);
      const marks: Record<string, number> = {};
      const log = {
        info: (_o: unknown, m?: string) => {
          if (m?.includes('auto-burn tx broadcast')) marks.broadcast = Date.now();
          if (m?.includes('auto-burn DONE')) marks.done = Date.now();
        },
        warn() {},
        error: (o: unknown, m?: string) => console.error('[fork] error', m, o),
        debug() {},
      };
      const cfg = { ...loadForgeConfig({ FORGE_DEPLOYER: DEPLOYER.address, FORGE_START_BLOCK: String(head + 1n) }), rpcUrls: [ANVIL] };
      const autoBurn = new ForgeAutoBurner({ enabled: true, deployer: DEPLOYER.address, backend: viemBurnBackend(DEPLOYER_KEY, [ANVIL]), repo, bus, ledger, log, receiptTimeoutMs: 60_000 });
      const origTrigger = autoBurn.trigger.bind(autoBurn);
      autoBurn.trigger = (ctx) => {
        marks.detect ??= Date.now();
        return origTrigger(ctx);
      };
      const svc = new ForgeService({ cfg, repo, bus, log, client: createForgeClient([ANVIL]), autoBurn, fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch });
      await svc.start();
      expect(svc.pollMs).toBe(1500);
      expect((await svc.status()).autoBurn).toMatchObject({ enabled: true, status: 'waiting' });

      // owner launches $FORGE directly on the Portal with an initial buy (quoteAmt = msg.value)
      const dep = createWalletClient({ chain: bsc, transport: http(ANVIL), account: DEPLOYER });
      const quoteAmt = parseEther('0.5');
      const launchTx = await dep.writeContract({
        address: PORTAL,
        abi: portalOpsAbi,
        functionName: 'newTokenV6',
        args: [
          {
            name: 'GachaForge',
            symbol: 'FORGE',
            meta: '',
            dexThresh: 1,
            salt: mineSalt(),
            migratorType: 1,
            quoteToken: ZERO,
            quoteAmt,
            beneficiary: BENEFICIARY,
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
        value: quoteAmt,
      });
      const launch = await pc.waitForTransactionReceipt({ hash: launchTx });
      const launchSeen = Date.now();
      expect(launch.status).toBe('success');
      const token = parseEventLogs({ abi: portalAbi, eventName: 'TokenCreated', logs: launch.logs })[0].args.token as Hex;
      const bought = parseEventLogs({ abi: portalAbi, eventName: 'TokenBought', logs: launch.logs })[0].args;
      expect(bought.buyer.toLowerCase()).toBe(DEPLOYER.address.toLowerCase());
      const boughtAmount = bought.amount;
      const state0 = await pc.readContract({ address: token, abi: tokenAbi, functionName: 'state' });

      // wait for discovery + burn
      for (let i = 0; i < 600 && (await svc.status()).autoBurn?.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 100));
      svc.stop();
      const st = await svc.status();
      expect(st.status).toBe('live');
      expect(st.token?.address).toBe(token.toLowerCase());
      expect(st.autoBurn).toMatchObject({ enabled: true, status: 'done' });

      const dead = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD] });
      const left = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [DEPLOYER.address] });
      expect(left).toBe(0n);
      expect(dead).toBe(boughtAmount); // nothing taxed / withheld on the wallet → dead transfer
      // the burn tx is a single ERC-20 transfer deployer → dead of exactly the bought amount
      const burnTx = await pc.getTransaction({ hash: st.autoBurn!.txHash as Hex });
      expect(burnTx.to?.toLowerCase()).toBe(token.toLowerCase());
      expect(burnTx.value).toBe(0n);
      const rc = await pc.getTransactionReceipt({ hash: burnTx.hash });
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: rc.logs.filter((l) => l.address.toLowerCase() === token.toLowerCase()) });
      expect(transfers).toHaveLength(1);
      expect(transfers[0].args).toMatchObject({ from: DEPLOYER.address, to: DEAD, value: boughtAmount });
      expect((await repo.listBurns(0, 5)).items[0]).toMatchObject({ kind: 'BURN', txHash: burnTx.hash });

      // restart: same repo → never burns again
      const autoBurn2 = new ForgeAutoBurner({ enabled: true, deployer: DEPLOYER.address, backend: viemBurnBackend(DEPLOYER_KEY, [ANVIL]), repo, bus, ledger, log });
      const svc2 = new ForgeService({ cfg, repo, bus, log, client: createForgeClient([ANVIL]), autoBurn: autoBurn2 });
      await svc2.init();
      await new Promise((r) => setTimeout(r, 500));
      expect((await svc2.status()).autoBurn).toMatchObject({ status: 'done', txHash: burnTx.hash });
      expect(await pc.getTransactionCount({ address: DEPLOYER.address })).toBe(burnTx.nonce + 1);

      const taxed = dead !== boughtAmount || transfers.length !== 1;
      console.log(
        `[fork] token ${token} state()=${state0} (0=BondingCurve) bought ${Number(boughtAmount) / 1e18} → dead ${Number(dead) / 1e18}; tax on transfer: ${taxed ? 'YES' : 'none'}; ` +
          `launch-receipt→detect ${marks.detect - launchSeen} ms, detect→broadcast ${marks.broadcast - marks.detect} ms, detect→burn receipt ${marks.done - marks.detect} ms; ` +
          `launch block ${launch.blockNumber} burn block ${rc.blockNumber} (+${rc.blockNumber - launch.blockNumber}); gas ${rc.gasUsed}`,
      );
    },
    300_000,
  );
});
