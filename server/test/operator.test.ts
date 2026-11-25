import { describe, expect, it } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, parseEther, type Hex } from 'viem';
import { vaultAbi } from '../src/abi/index.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { Ledger } from '../src/ledger.js';
import { Operator } from '../src/operator/index.js';
import { SimulatedProvider, mulberry32 } from '../src/renaiss/simulated.js';
import { MemoryRepository } from '../src/store/memory.js';
import { verifyRaffle, verifyClaim } from '../src/core/index.js';
import type { ChainCtx } from '../src/chain.js';
import type { Machine, Strategy } from '../src/types.js';
import type { CardProvider, ProviderCard } from '../src/renaiss/types.js';
import { SimulatedSwapper, usdtToBuy, type Swapper } from '../src/swap/pancake.js';

const TOKEN = '0x0000000000000000000000000000000000007777';
const VAULT = '0x000000000000000000000000000000000000000a' as Hex;
const OPERATOR = '0x0000000000000000000000000000000000000abc';
const E18 = 10n ** 18n;
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const holders = ['0x00000000000000000000000000000000000000a1', '0x00000000000000000000000000000000000000a2'];

function pullOpenedLog() {
  const topics = encodeEventTopics({ abi: vaultAbi, eventName: 'PullOpened', args: { pullId: 7n } });
  const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }], [parseEther('0.055'), parseEther('0.05'), OPERATOR]);
  return { address: VAULT, topics, data, blockNumber: 500n, logIndex: 0, transactionHash: '0x' + '9'.repeat(64), blockHash: '0x' + '0'.repeat(64), transactionIndex: 0, removed: false };
}

function harness(strategy: Strategy, deps: { provider?: CardProvider; swapper?: Swapper } = {}) {
  const calls: { fn: string; args: unknown[]; value?: bigint }[] = [];
  const reads: Record<string, unknown> = { canOpenPull: true, maxPullAmount: parseEther('0.055'), burnReserve: 0n, lpReserve: 0n, totalSupply: 1_000_000_000n * E18 };
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => reads[functionName],
    getBlock: async () => ({ hash: ('0x' + 'cd'.repeat(32)) as Hex, timestamp: 1n }),
    multicall: async () => [1_000_000n * E18, 3_000_000n * E18],
    waitForTransactionReceipt: async ({ hash }: { hash: string }) => ({
      status: 'success',
      blockNumber: 500n,
      transactionHash: hash,
      logs: hash === '0xopenPull' ? [pullOpenedLog()] : [],
    }),
  };
  const walletClient = {
    writeContract: async ({ functionName, args, value }: { functionName: string; args: unknown[]; value?: bigint }) => {
      calls.push({ fn: functionName, args, value });
      return `0x${functionName}`;
    },
  };
  const chain = { chain: {}, publicClient, walletClient, account: { address: OPERATOR }, factory: '0x00000000000000000000000000000000000000fa', portal: '0x00000000000000000000000000000000000000b0', vaultPortal: '0x00000000000000000000000000000000000000b1' } as unknown as ChainCtx;
  const repo = new MemoryRepository();
  const ledger = new Ledger(repo, new Bus());
  const cfg = loadConfig({ FACTORY_ADDRESS: '0x00000000000000000000000000000000000000fa', RPC_URL: 'http://127.0.0.1:8545', BNB_USD_PRICE: '600', AUTO_PUSH_MIN_BNB: '0.001' });
  const op = new Operator(cfg, chain, ledger, deps.provider ?? new SimulatedProvider(mulberry32(3)), silent, deps.swapper);
  const m = { address: TOKEN, vault: VAULT, ticker: 'T', pack: 'FORGE_28', packPriceUsd: 28, strategy, stage: 'GRADUATED', eligibleHolders: 2 } as Machine;
  return { calls, reads, repo, op, m };
}

describe('Operator.processMachine', () => {
  it('RAFFLE: openPull → settlePull(refund) → recordRaffle with a verifiable proof', async () => {
    const h = harness('RAFFLE');
    await h.repo.upsertMachine(h.m);
    for (const a of holders) await h.repo.setBalance(TOKEN, a, 1n);
    await h.op.processMachine(h.m);
    expect(h.calls.map((c) => c.fn)).toEqual(['openPull', 'settlePull', 'recordRaffle']);
    // SimulatedSwapper @ $600: 28 USDT (+10 bps buffer) costs ~0.0467 BNB; the rest of the 0.055 BNB goes back to the pot
    const spent = (await new SimulatedSwapper(600).buyExactUsdt(usdtToBuy(28n * E18, 0n, 10), E18)).bnb;
    expect(h.calls[1].value).toBe(parseEther('0.055') - spent);
    expect(h.calls[1].args[1]).toBe(h.calls[1].value);
    const releases = await h.repo.listCardReleases();
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ pullKey: `${TOKEN}-7`, status: 'PENDING', winner: (h.calls[2].args[4] as string).toLowerCase() });
    const [pullId, snapshotBlock, snapshotHash, seed, winner] = h.calls[2].args as [bigint, bigint, Hex, Hex, string];
    expect(pullId).toBe(7n);
    expect(snapshotBlock).toBe(500n);
    const proof = (await h.repo.getRaffleProof(`${TOKEN}-7`))!;
    expect(proof.winner).toBe(winner);
    const eligible = proof.eligible.map((e) => ({ address: e.address, balance: BigInt(e.balanceRaw) }));
    expect(verifyRaffle({ eligible, seed, snapshotHash, winner, blockHash: ('0x' + 'cd'.repeat(32)) as Hex, pullId: 7n })).toBe(true);
  });

  it('DIVIDEND: sells back, deposits, sets root, auto-pushes', async () => {
    const h = harness('DIVIDEND');
    await h.repo.upsertMachine(h.m);
    for (const a of holders) await h.repo.setBalance(TOKEN, a, 1n);
    await h.op.processMachine(h.m);
    const fns = h.calls.map((c) => c.fn);
    expect(fns.slice(0, 4)).toEqual(['openPull', 'settlePull', 'depositProceeds', 'setDividendRoot']);
    expect(fns.filter((f) => f === 'pushClaim').length).toBeGreaterThan(0);
    const [roundId, root, total] = h.calls[3].args as [bigint, Hex, bigint];
    expect(roundId).toBe(7n);
    expect(total).toBe(h.calls[2].value);
    const claims = await h.repo.getDividendClaims(TOKEN, holders[1]);
    expect(verifyClaim(root, holders[1], BigInt(claims[0].amountWei), claims[0].proof as Hex[])).toBe(true);
    expect((await h.repo.getRewards(TOKEN, holders[1])).totalEarnedBnb).toBeGreaterThan(0);
  });

  it('BURN: spends burn reserve after deposit', async () => {
    const h = harness('BURN');
    h.reads.burnReserve = 123n;
    await h.repo.upsertMachine(h.m);
    await h.op.processMachine(h.m);
    expect(h.calls.map((c) => c.fn)).toEqual(['openPull', 'settlePull', 'depositProceeds', 'buybackAndBurn']);
  });

  it('multi-card pull with mocked provider + swapper: exact refund, summed value, batch sell-back, exact deposit', async () => {
    const mk = (i: number, v: number): ProviderCard => ({ tokenId: String(i), settlementId: '0x' + String(i).repeat(64), name: `C${i}`, set: 'S', grader: 'PSA', grade: '10', image: '', valueUsd: v, releaseAt: 99 });
    const sold: ProviderCard[][] = [];
    const provider: CardProvider = {
      name: 'mock',
      packCost: async () => ({ usdt: 28n * E18, usd: 28 }),
      buyPack: async (_p, o) => {
        await o?.onSubmitted?.('req-1');
        return { pullId: 'req-1', cards: [mk(1, 12.4), mk(2, 9.9)], totalValueUsd: 22.3, paidUsdt: 28n * E18, purchasedAt: 1 };
      },
      quoteSellBack: async () => ({ settlementIds: [], valueUsd: 0, rate: 0.9, proceedsUsdt: 0n, proceedsUsd: 0 }),
      sellBack: async (cards) => {
        sold.push(cards);
        return { settlementIds: cards.map((c) => c.settlementId), valueUsd: 22.3, rate: 0.9, proceedsUsdt: 20_070_000_000_000_000_000n, proceedsUsd: 20.07, txRef: '0xbb' };
      },
      releaseStatus: async () => ({ released: false }),
      transferCard: async () => '0x',
    };
    const swaps: string[] = [];
    const swapper: Swapper = {
      name: 'mock',
      usdtBalance: async () => 1n * E18,
      buyExactUsdt: async (usdt, max) => (swaps.push(`buy ${usdt} max ${max}`), { bnb: parseEther('0.0451'), usdt }),
      sellUsdt: async (usdt) => (swaps.push(`sell ${usdt}`), { bnb: parseEther('0.03211'), usdt }),
    };
    const h = harness('DIVIDEND', { provider, swapper });
    await h.repo.upsertMachine(h.m);
    for (const a of holders) await h.repo.setBalance(TOKEN, a, 1n);
    await h.op.processMachine(h.m);
    // shortfall 27 USDT + 10 bps buffer, capped at the 0.055 BNB the vault sent
    expect(swaps).toEqual([`buy ${27_027_000_000_000_000_000n} max ${parseEther('0.055')}`, `sell ${20_070_000_000_000_000_000n}`]);
    const settle = h.calls.find((c) => c.fn === 'settlePull')!;
    expect(settle.args).toEqual([7n, parseEther('0.0099'), 22n]);
    expect(settle.value).toBe(parseEther('0.0099'));
    expect(sold).toHaveLength(1);
    expect(sold[0].map((c) => c.tokenId)).toEqual(['1', '2']);
    expect(h.calls.find((c) => c.fn === 'depositProceeds')!.value).toBe(parseEther('0.03211'));
    const pull = (await h.repo.getPull(`${TOKEN}-7`))!;
    expect(pull.card).toMatchObject({ name: 'C1 +1 more', valueUsd: 22.3 });
    expect(await h.repo.getMeta(`provider-request:${TOKEN}-7`)).toBe('req-1');
  });

  it('leaves the pull open (no settle) when the purchase fails', async () => {
    const provider = new SimulatedProvider(mulberry32(3));
    provider.buyPack = async () => {
      throw new Error('Renaiss pull FAILED: CARD_PACK_NOT_ACTIVE');
    };
    const h = harness('RAFFLE', { provider });
    await h.repo.upsertMachine(h.m);
    await expect(h.op.processMachine(h.m)).rejects.toThrow(/CARD_PACK_NOT_ACTIVE/);
    expect(h.calls.map((c) => c.fn)).toEqual(['openPull']);
  });

  it('skips when vault.canOpenPull() is false', async () => {
    const h = harness('RAFFLE');
    h.reads.canOpenPull = false;
    await h.op.processMachine(h.m);
    expect(h.calls).toEqual([]);
  });
});
