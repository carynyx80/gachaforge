import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseEther, type Hex } from 'viem';
import { factoryAbi, portalAbi, tokenAbi, vaultAbi } from '../src/abi/index.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { Indexer } from '../src/indexer/index.js';
import { Ledger } from '../src/ledger.js';
import { MemoryRepository } from '../src/store/memory.js';
import type { ChainCtx } from '../src/chain.js';
import type { WsMessage } from '../src/types.js';

const FACTORY = '0x00000000000000000000000000000000000000fa' as Hex;
const PORTAL = '0x00000000000000000000000000000000000000b0' as Hex;
const VP = '0x00000000000000000000000000000000000000b1' as Hex;
const TOKEN = '0x0000000000000000000000000000000000007777' as Hex;
const VAULT = '0x000000000000000000000000000000000000000a' as Hex;
const BURNER = '0x00000000000000000000000000000000000000bb' as Hex;
const ALICE = '0x00000000000000000000000000000000000a11ce' as Hex;
const silent = { info() {}, warn() {}, error() {}, debug() {} };

// Minimal decoded-log stub in the shape viem's getLogs({ events }) returns.
const log = (address: Hex, eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex: number) => ({ address, eventName, args, blockNumber, logIndex, transactionHash: ('0x' + logIndex.toString(16).padStart(64, '0')) as Hex });

function stubChain(logs: ReturnType<typeof log>[]): ChainCtx {
  const publicClient = {
    getBlockNumber: async () => 100n,
    getBlock: async () => ({ timestamp: 1_700_000_000n, hash: '0x' + '0'.repeat(64) }),
    readContract: async ({ functionName }: { functionName: string }) =>
      ({ name: 'Test Token', symbol: 'TEST', buybackBurner: BURNER })[functionName],
    getLogs: async ({ address, events }: { address: Hex | Hex[]; events: { name: string }[] }) => {
      const addrs = (Array.isArray(address) ? address : [address]).map((a) => a.toLowerCase());
      const names = new Set(events.map((e) => e.name));
      return logs.filter((l) => addrs.includes(l.address.toLowerCase()) && names.has(l.eventName));
    },
  };
  return { publicClient, walletClient: null, account: null, factory: FACTORY, portal: PORTAL, vaultPortal: VP } as unknown as ChainCtx;
}

describe('Indexer', () => {
  it('indexes launch, transfers, tax, trades, graduation, settlement and re-route alerts', async () => {
    const logs = [
      log(FACTORY, 'MachineLaunched', { token: TOKEN, vault: VAULT, creator: ALICE, packId: 1, strategy: 2, taxBps: 200, dividendBps: 0, burnBps: 0, lpBps: 0, index: 0n }, 10n, 0),
      log(TOKEN, 'Transfer', { from: '0x0000000000000000000000000000000000000000', to: ALICE, value: parseEther('2000000') }, 11n, 0),
      log(VAULT, 'TaxReceived', { amount: parseEther('1'), toPot: parseEther('0.07'), toBuyback: parseEther('0.03'), toTreasury: parseEther('0.9') }, 12n, 0),
      log(PORTAL, 'TokenBought', { ts: 1n, token: TOKEN, buyer: ALICE, amount: parseEther('1000'), eth: parseEther('1'), fee: 0n, postPrice: 10n ** 9n }, 12n, 1),
      log(PORTAL, 'FlapTokenProgressChanged', { token: TOKEN, newProgress: parseEther('0.5') }, 13n, 0),
      log(PORTAL, 'LaunchedToDEX', { token: TOKEN, pool: '0x00000000000000000000000000000000000000cc', amount: 1n, eth: 1n }, 14n, 0),
      log(VAULT, 'PullOpened', { pullId: 1n, amountSent: parseEther('0.05'), priceBnb: parseEther('0.045'), paymentReceiver: ALICE }, 15n, 0),
      log(VAULT, 'PullSettled', { pullId: 1n, refund: parseEther('0.005'), cardValueUsd: 40n }, 15n, 1),
      log(VAULT, 'ProceedsDeposited', { pullId: 1n, amount: parseEther('0.06'), toPot: 0n, toDiv: parseEther('0.06'), toBurn: 0n, toLp: 0n }, 15n, 2),
      log(VAULT, 'DividendRootSet', { roundId: 1n, root: '0x' + '1'.repeat(64), totalBnb: parseEther('0.06') }, 15n, 3),
      log(VAULT, 'BuybackBurn', { bnbSpent: parseEther('0.01'), tokensBurned: parseEther('5000') }, 15n, 4),
      log(BURNER, 'Buyback', { bnbSpent: parseEther('0.02'), forgeBought: parseEther('123') }, 15n, 5),
      log(PORTAL, 'TaxTokenAddressesUpdated', { token: TOKEN, beneficiary: ALICE, feeReceiver: ALICE }, 16n, 0),
      log(PORTAL, 'TokenBought', { ts: 1n, token: '0x0000000000000000000000000000000000000bad', buyer: ALICE, amount: 1n, eth: 1n, fee: 0n, postPrice: 1n }, 16n, 1),
    ];
    const bus = new Bus();
    const repo = new MemoryRepository();
    const ledger = new Ledger(repo, bus);
    const msgs: WsMessage[] = [];
    bus.subscribe((m) => msgs.push(m));
    const cfg = loadConfig({ FACTORY_ADDRESS: FACTORY, RPC_URL: 'http://127.0.0.1:8545', START_BLOCK: '1', BNB_USD_PRICE: '600' });
    const idx = new Indexer(cfg, stubChain(logs), ledger, silent);
    await idx.start();
    idx.stop();

    const m = (await repo.getMachine(TOKEN))!;
    expect(m).toMatchObject({ ticker: 'TEST', pack: 'FORGE_48', strategy: 'DIVIDEND', taxBps: 200, stage: 'GRADUATED', bondingCurvePct: 100, packsOpened: 1, holders: 1, eligibleHolders: 1, burnedTokens: 5000 });
    // tax 0.07 → pot, pull spends 0.05, refund 0.005, + pending estimate of the later 1 BNB buy ($12 tax → $0.76 pot)
    expect(m.potUsd).toBeCloseTo(42 - 30 + 3 + 0.76, 5);
    expect(m.paidToHoldersBnb).toBeCloseTo(0.06, 6);
    expect((await repo.listTrades(TOKEN, 0, 10)).items[0]).toMatchObject({ side: 'BUY', amountBnb: 1, taxUsd: 12 });
    expect((await repo.listTrades('0x0000000000000000000000000000000000000bad', 0, 10)).total).toBe(0);
    expect((await repo.getPull(`${TOKEN}-1`))!).toMatchObject({ result: 'SOLD', proceedsBnb: 0.06, card: { valueUsd: 40 } });
    const burns = await repo.listBurns(0, 10);
    expect(burns.items.map((b) => b.kind)).toEqual(['BUYBACK']); // machine-token burns stay off the $FORGE feed
    expect((await repo.listActivity(50)).some((a) => a.kind === 'BURN')).toBe(true);
    expect(JSON.parse((await repo.getMeta(`pools:${TOKEN}`))!)).toContain('0x00000000000000000000000000000000000000cc');
    const alerts = JSON.parse((await repo.getMeta('alerts'))!);
    expect(alerts[0]).toMatchObject({ token: TOKEN, event: 'TaxTokenAddressesUpdated' });
    const act = await repo.listActivity(50);
    expect(act.some((a) => a.text.includes('re-routed'))).toBe(true);
    expect(act.some((a) => a.kind === 'NEW_MACHINE')).toBe(true);
    expect(await repo.getMeta('indexer:block')).toBe('100');
    expect(msgs.some((x) => x.type === 'pull')).toBe(true);
  });

  it('placeholder ABIs encode their events (sanity)', () => {
    expect(encodeEventTopics({ abi: factoryAbi, eventName: 'MachineLaunched' })[0]).toMatch(/^0x/);
    expect(encodeEventTopics({ abi: vaultAbi, eventName: 'PullOpened' })[0]).toMatch(/^0x/);
    expect(encodeEventTopics({ abi: vaultAbi, eventName: 'RaffleRecorded' })[0]).toMatch(/^0x/);
    expect(encodeEventTopics({ abi: portalAbi, eventName: 'LaunchedToDEX' })[0]).toMatch(/^0x/);
    expect(encodeEventTopics({ abi: tokenAbi, eventName: 'Transfer' })[0]).toMatch(/^0x/);
    expect(encodeAbiParameters([{ type: 'uint256' }], [1n])).toMatch(/^0x/);
  });
});
