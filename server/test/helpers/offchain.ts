import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, type Hex, type Log } from 'viem';
import { portalAbi, portalOpsAbi } from '../../src/abi/flap.js';
import { taxProcessorAbi } from '../../src/abi/token.js';
import { Bus } from '../../src/bus.js';
import { loadConfig } from '../../src/config.js';
import { Ledger } from '../../src/ledger.js';
import { OffchainService } from '../../src/offchain/service.js';
import { MemoryOffchainStore } from '../../src/offchain/store.js';
import type { TxBackend, TxReceiptLite, TxRequest } from '../../src/offchain/ops.js';
import type { VerifiedLaunch } from '../../src/offchain/register.js';
import type { BuyPackResult, CardProvider, PackCost, ProviderCard } from '../../src/renaiss/types.js';
import { MemoryRepository } from '../../src/store/memory.js';
import { SimulatedSwapper } from '../../src/swap/pancake.js';

export const E18 = 10n ** 18n;
export const silent = { info() {}, warn() {}, error() {}, debug() {} };
export const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0' as Hex;
export const TREASURY = '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c' as Hex;
export const TOKEN = '0x00000000000000000000000000000000000a7777' as Hex;
export const TP = '0x00000000000000000000000000000000000000ab' as Hex;
export const OPS = '0x0000000000000000000000000000000000000abc' as Hex;
export const CREATOR = '0x00000000000000000000000000000000000c0de0' as Hex;
export const FORGE = '0x00000000000000000000000000000000f0e57777' as Hex;
export const DEAD = '0x000000000000000000000000000000000000dEaD' as Hex;
export const ALICE = '0x00000000000000000000000000000000000a11ce' as Hex;
export const BOB = '0x0000000000000000000000000000000000000b0b' as Hex;
export const CAROL = '0x00000000000000000000000000000000000ca401' as Hex;
export const h32 = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;
export const bnb = (x: number) => BigInt(Math.round(x * 1e9)) * 10n ** 9n;

const callAbi = [...portalOpsAbi, ...erc20Abi, ...taxProcessorAbi] as const;

export function transferLog(token: Hex, from: Hex, to: Hex, value: bigint): Log {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: 100n,
    logIndex: 0,
    transactionHash: h32(1),
    blockHash: h32(0),
    transactionIndex: 0,
    removed: false,
  } as Log;
}

export function tokenCreatedLog(token: Hex, creator: Hex, name = 'Test', symbol = 'TST', meta = '') {
  return {
    address: PORTAL,
    topics: encodeEventTopics({ abi: portalAbi, eventName: 'TokenCreated' }) as Hex[],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'string' }, { type: 'string' }, { type: 'string' }],
      [1_700_000_000n, creator, 1n, token, name, symbol, meta],
    ),
    logIndex: 3,
    blockNumber: 100n,
    transactionHash: h32(7),
  };
}

/** Shared fake chain: contract reads, receipts, balances; the fake backend mutates it when "sending". */
export class FakeChain {
  receipts = new Map<string, any>();
  native = new Map<string, bigint>();
  erc20 = new Map<string, bigint>(); // `${token}|${holder}`
  tokenState: any = { status: 1, quoteTokenAddress: '0x0000000000000000000000000000000000000000', buyTaxRate: 200n, sellTaxRate: 200n, pool: '0x0000000000000000000000000000000000000000', progress: 10n ** 17n, price: 30n * 10n ** 9n };
  taxRecipient: Hex = TREASURY;
  commission: Hex = '0x0000000000000000000000000000000000000000';
  marketQuoteBalance = 0n;
  sentToMarketing = 0n;
  /** tokens out per 1 BNB for quoteExactInput / swapExactInput */
  tokensPerBnb = 1_000_000n;
  head = 1000n;
  overrides: Record<string, (args: any) => any> = {};

  bal(token: string, holder: string) {
    return this.erc20.get(`${token.toLowerCase()}|${holder.toLowerCase()}`) ?? 0n;
  }
  addBal(token: string, holder: string, d: bigint) {
    this.erc20.set(`${token.toLowerCase()}|${holder.toLowerCase()}`, this.bal(token, holder) + d);
  }

  async readContract(p: { address: string; functionName: string; args?: any[]; blockNumber?: bigint }): Promise<any> {
    if (this.overrides[p.functionName]) return this.overrides[p.functionName](p);
    switch (p.functionName) {
      case 'getTokenV8Safe':
        return this.tokenState;
      case 'taxProcessor':
        return TP;
      case 'marketAddress':
        return this.taxRecipient;
      case 'commissionReceiver':
        return this.commission;
      case 'marketQuoteBalance':
        return this.marketQuoteBalance;
      case 'totalQuoteSentToMarketing':
        return this.sentToMarketing;
      case 'quoteExactInput':
        return (p.args![0].inputAmount * this.tokensPerBnb) / 1n;
      case 'balanceOf':
        return this.bal(p.address, p.args![0]);
      case 'latestRoundData':
        return [1n, 600n * 10n ** 8n, 0n, 0n, 1n];
      case 'token0':
        return TOKEN;
      default:
        throw new Error(`fake read: ${p.functionName}`);
    }
  }
  async getTransactionReceipt({ hash }: { hash: Hex }) {
    const r = this.receipts.get(hash.toLowerCase());
    if (!r) throw new Error('not found');
    return r;
  }
  async getTransaction() {
    return { from: ALICE };
  }
  async getBlock({ blockNumber }: { blockNumber: bigint }) {
    return { hash: h32(Number(blockNumber) + 0xabc), timestamp: 1_700_000_000n + blockNumber };
  }
  async getBlockNumber() {
    return this.head;
  }
  async getLogs() {
    return [];
  }
  async getBalance({ address }: { address: Hex }) {
    return this.native.get(address.toLowerCase()) ?? 0n;
  }
}

/** Fake TxBackend that applies the effects of the few calls the engine makes. */
export class FakeBackend implements TxBackend {
  sent: { to: Hex; fn: string; args: readonly unknown[]; value: bigint; hash: Hex }[] = [];
  fee = 21_000n * 10n ** 9n; // 21k gas @ 1 gwei
  private n = 0;
  failNext: string | null = null;
  constructor(
    readonly chain: FakeChain,
    readonly address: Hex | null = OPS,
  ) {
    if (address) chain.native.set(address.toLowerCase(), 10n * E18);
  }
  getBalance(a: Hex) {
    return this.chain.getBalance({ address: a });
  }
  read<T>(p: any) {
    return this.chain.readContract(p) as Promise<T>;
  }
  async estimateFee() {
    return this.fee;
  }
  async getNonce() {
    return this.n;
  }
  async send(req: TxRequest): Promise<Hex> {
    if (this.failNext) {
      const m = this.failNext;
      this.failNext = null;
      throw new Error(m);
    }
    const hash = h32(0xf000 + this.sent.length);
    let fn = 'transfer-native';
    let args: readonly unknown[] = [];
    if (req.data && req.data !== '0x') {
      const d = decodeFunctionData({ abi: callAbi, data: req.data });
      fn = d.functionName;
      args = d.args ?? [];
    }
    this.sent.push({ to: req.to, fn, args, value: req.value ?? 0n, hash });
    const me = this.address!.toLowerCase();
    const value = req.value ?? 0n;
    this.chain.native.set(me, (this.chain.native.get(me) ?? 0n) - value - this.fee);
    const logs: Log[] = [];
    if (fn === 'transfer-native') this.chain.native.set(req.to.toLowerCase(), (this.chain.native.get(req.to.toLowerCase()) ?? 0n) + value);
    if (fn === 'swapExactInput') {
      const p = args[0] as { outputToken: Hex; inputAmount: bigint };
      const out = (p.inputAmount * this.chain.tokensPerBnb) / 1n;
      this.chain.addBal(p.outputToken, me, out);
      logs.push(transferLog(p.outputToken, PORTAL, this.address!, out));
    }
    if (fn === 'transfer' && req.to) {
      const [to, amount] = args as [Hex, bigint];
      this.chain.addBal(req.to, me, -amount);
      this.chain.addBal(req.to, to, amount);
    }
    if (fn === 'dispatch') {
      this.chain.sentToMarketing += this.chain.marketQuoteBalance;
      this.chain.marketQuoteBalance = 0n;
    }
    this.receipts.set(hash, { status: 'success', transactionHash: hash, blockNumber: 1000n, gasUsed: 21_000n, effectiveGasPrice: 10n ** 9n, logs });
    this.n++;
    return hash;
  }
  receipts = new Map<string, TxReceiptLite>();
  async wait(hash: Hex) {
    return this.receipts.get(hash)!;
  }
  async signTypedData() {
    return '0xsig' as Hex;
  }
}

/** Deterministic card provider: fixed card value and sell-back proceeds. */
export class FixedProvider implements CardProvider {
  readonly name = 'fixed';
  bought = 0;
  sold = 0;
  constructor(
    public valueUsd = 20,
    public proceedsUsdt = 18n * E18,
  ) {}
  async packCost(): Promise<PackCost> {
    return { usdt: 28n * E18, usd: 28 };
  }
  async buyPack(_p: unknown, o: { onSubmitted?: (id: string) => void | Promise<void> } = {}): Promise<BuyPackResult> {
    this.bought++;
    await o.onSubmitted?.(`req-${this.bought}`);
    const card: ProviderCard = { tokenId: String(1000 + this.bought), settlementId: `s-${this.bought}`, name: 'Volt Fox', set: 'Forge Origins', grader: 'PSA', grade: '10', image: '', valueUsd: this.valueUsd, releaseAt: 1 };
    return { pullId: `req-${this.bought}`, cards: [card], totalValueUsd: this.valueUsd, paidUsdt: 28n * E18, purchasedAt: 1 };
  }
  async quoteSellBack(cards: ProviderCard[]) {
    return { settlementIds: cards.map((c) => c.settlementId), valueUsd: this.valueUsd, rate: 0.9, proceedsUsdt: this.proceedsUsdt, proceedsUsd: Number(this.proceedsUsdt / E18) };
  }
  async sellBack(cards: ProviderCard[]) {
    this.sold++;
    return { ...(await this.quoteSellBack(cards)), txRef: 'sell-ref' };
  }
  async releaseStatus() {
    return { released: true };
  }
  async transferCard() {
    return '0xtransfer';
  }
}

export function verified(over: Partial<VerifiedLaunch> = {}): VerifiedLaunch {
  return {
    token: TOKEN.toLowerCase(),
    status: 1,
    buyTaxBps: 200,
    sellTaxBps: 200,
    quoteToken: '0x0000000000000000000000000000000000000000',
    taxProcessor: TP.toLowerCase(),
    taxRecipient: TREASURY.toLowerCase(),
    pool: null,
    progress: 0n,
    price: 0n,
    txHash: h32(7),
    txFrom: CREATOR.toLowerCase(),
    creator: CREATOR.toLowerCase(),
    name: 'Test',
    symbol: 'TST',
    meta: '',
    createdBlock: 100,
    createdAt: 1_700_000_000,
    ...over,
  };
}

export interface HarnessOptions {
  env?: Record<string, string>;
  provider?: CardProvider | null;
  opsAddress?: Hex | null;
  forge?: string | null;
  now?: () => number;
}

export function harness(o: HarnessOptions = {}) {
  const chain = new FakeChain();
  const backend = new FakeBackend(chain, o.opsAddress === undefined ? OPS : o.opsAddress);
  const repo = new MemoryRepository();
  const bus = new Bus();
  const ledger = new Ledger(repo, bus);
  const store = new MemoryOffchainStore();
  const cfg = loadConfig({ PULL_COOLDOWN_SEC: '0', BNB_USD_PRICE: '600', ...o.env });
  const provider = o.provider === undefined ? new FixedProvider() : o.provider;
  const forgeStatus = o.forge ? { status: 'live' as const, deployer: null, token: { address: o.forge } as any } : { status: 'waiting' as const, deployer: null };
  const svc = new OffchainService({
    cfg,
    ledger,
    log: silent,
    client: chain as any,
    store,
    backend,
    provider,
    swapper: o.opsAddress === null ? null : new SimulatedSwapper(600),
    forge: { status: async () => forgeStatus, trades: async () => [], candles: async () => [] },
    now: o.now,
    fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch,
  });
  return { chain, backend, repo, bus, ledger, store, cfg, svc, engine: svc.engine, accounts: svc.accounts, ops: svc.ops, provider };
}

/** Registers TOKEN with the given strategy and credits its pot. */
export async function machine(h: ReturnType<typeof harness>, strategy: 'RAFFLE' | 'HIT_HUNTER' | 'DIVIDEND' | 'BURN' | 'SPLIT' = 'RAFFLE', potBnb = 0, split?: { dividendBps: number; burnBps: number; lpBps: number }) {
  await h.engine.adopt(verified(), { pack: 'FORGE_28', strategy, split }, 'api');
  const reg = (await h.store.getRegistration(TOKEN))!;
  await h.store.saveRegistration({ ...reg, syncedTo: 999 });
  if (potBnb > 0) await h.accounts.book([{ ref: `adjust:${potBnb}`, ts: 1, machine: TOKEN, bucket: 'POT', kind: 'ADJUST', amountWei: bnb(potBnb) }]);
  return reg;
}
