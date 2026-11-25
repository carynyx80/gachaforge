/**
 * Wires OFF-CHAIN MODE: chain client, ops wallet, ledger, indexer, engine, Renaiss provider and the job loops.
 */
import { createPublicClient, createWalletClient, fallback, http, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc, bscTestnet } from 'viem/chains';
import { FLAP_ADDRESSES } from '../abi/flap.js';
import type { Config } from '../config.js';
import { CHAINLINK_BNB_USD, chainlinkAbi } from '../forge/chain.js';
import { FLAP_IPFS_GATEWAY } from '../forge/config.js';
import type { ForgeApi } from '../forge/service.js';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../log.js';
import { ReleaseJob } from '../operator/release.js';
import { RenaissCatalog, RenaissClient, RenaissProvider, resolveNetwork, type CardProvider } from '../renaiss/index.js';
import { PancakeSwapper, type Swapper } from '../swap/pancake.js';
import { OffchainEngine, type EngineClient, type RegisterParams } from './engine.js';
import { OffchainIndexer, type IndexerClient } from './indexer.js';
import { OffchainLedger, weiToBnb } from './ledger.js';
import { OpsWallet, viemBackend, type TxBackend } from './ops.js';
import { createOffchainStore, type OffchainStore } from './store.js';
import type { Bucket } from './types.js';

export interface OffchainApi {
  register(p: RegisterParams): Promise<{ machine: unknown; created: boolean }>;
  transparency(): Promise<Transparency>;
  readiness(): { opsReady: boolean; renaissReady: boolean; opsPaused: boolean; ops: string | null };
}

export interface Transparency {
  mode: 'offchain';
  chainId: number;
  treasury: { address: string; balanceBnb: number; url: string };
  ops: { address: string | null; balanceBnb: number; url: string | null; ready: boolean; paused: boolean; sameAsTreasury: boolean; dailyCapBnb: number; spent24hBnb: number };
  balances: { treasuryBnb: number; opsBnb: number; payingWalletBnb: number; coverageBnb: number };
  owed: { pots: number; creators: number; buyback: number; dividendsPending: number; burnsPending: number; total: number };
  ledger: { taxBnb: number; flapBnb: number; platformBnb: number; potsBnb: number; buybackBnb: number; creatorsBnb: number; creatorsPaidBnb: number; treasuryShareBps: number; measured: boolean };
  machines: {
    address: string;
    ticker: string;
    taxModel: string;
    buyTaxBps: number | null;
    sellTaxBps: number | null;
    potShareBps: number | null;
    creatorPayout: string | null;
    creatorOwedBnb: number;
    creatorPaidBnb: number;
    treasuryShareBps: number;
    potBnb: number;
    potUsd: number;
    taxBnb: number;
    dividendsPendingBnb: number;
    burnsPendingBnb: number;
    pullQueued: boolean;
    pullQueuedReason: string | null;
    openPull: unknown;
  }[];
  txs: { id: string; kind: string; label: string | null; machine: string | null; to: string | null; amountBnb: number; feeBnb: number; hash: string | null; url: string | null; status: string; error: string | null; timestamp: number }[];
  updatedAt: number;
}

export interface OffchainServiceDeps {
  cfg: Config;
  ledger: Ledger;
  log: Logger;
  forge?: ForgeApi;
  /** Test overrides. */
  client?: PublicClient | (IndexerClient & EngineClient);
  backend?: TxBackend;
  store?: OffchainStore;
  provider?: CardProvider | null;
  swapper?: Swapper | null;
  now?: () => number;
  fetch?: typeof fetch;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class OffchainService implements OffchainApi {
  readonly engine: OffchainEngine;
  readonly indexer: OffchainIndexer;
  readonly accounts: OffchainLedger;
  readonly ops: OpsWallet;
  readonly store: OffchainStore;
  readonly provider: CardProvider | null;
  private timers: NodeJS.Timeout[] = [];
  private release: ReleaseJob | null = null;
  private bnbUsdCache: { v: number; at: number } | null = null;
  private balCache = new Map<string, { v: bigint; at: number }>();
  private explorer: string;
  readonly renaissReady: boolean;

  constructor(
    private d: OffchainServiceDeps & { client: IndexerClient & EngineClient; store: OffchainStore; backend: TxBackend },
  ) {
    const cfg = d.cfg;
    this.store = d.store;
    this.explorer = cfg.CHAIN_ID === 56 ? 'https://bscscan.com' : 'https://testnet.bscscan.com';
    const flap = FLAP_ADDRESSES[cfg.CHAIN_ID];
    this.ops = new OpsWallet(d.store, d.backend, {
      paused: cfg.OPS_PAUSED,
      dailyCapWei: BigInt(Math.round(cfg.OPS_DAILY_CAP_BNB * 1e9)) * 10n ** 9n,
      retries: cfg.OPS_TX_RETRIES,
      timeoutMs: cfg.OPS_TX_TIMEOUT_MS,
      log: d.log,
      ...(d.now ? { now: d.now } : {}),
    });
    this.accounts = new OffchainLedger(d.store, d.ledger, { estimateShareBps: 10_000 - cfg.FLAP_CUT_ESTIMATE_BPS, bnbUsd: () => this.bnbUsd(), now: d.now });
    this.indexer = new OffchainIndexer(d.client, d.store, this.accounts, d.log, {
      portal: flap.portal,
      vaultPortal: flap.vaultPortal,
      startBlock: cfg.START_BLOCK,
      maxRange: cfg.LOGS_MAX_RANGE,
      addressBatch: cfg.LOGS_ADDRESS_BATCH,
      excluded: cfg.EXCLUDED_ADDRESSES,
    });
    const network = resolveNetwork(cfg);
    let provider: CardProvider | null = d.provider ?? null;
    let swapper: Swapper | null = d.swapper ?? null;
    if (d.provider === undefined && cfg.RENAISS_API_KEY && this.ops.ready) {
      const client = new RenaissClient({ baseUrl: network.apiBaseUrl, apiKey: cfg.RENAISS_API_KEY, timeoutMs: cfg.RENAISS_TIMEOUT_MS, log: d.log });
      const catalog = new RenaissCatalog(client, network, d.log);
      provider = new RenaissProvider({ client, catalog, network, wallet: this.ops.evmWallet('CARD_TRANSFER'), log: d.log });
    }
    if (d.swapper === undefined && this.ops.ready)
      swapper = new PancakeSwapper(this.ops.evmWallet('PULL'), { router: network.pancakeRouter, usdt: network.usdt, slippageBps: cfg.SWAP_SLIPPAGE_BPS, deadlineSeconds: cfg.SWAP_DEADLINE_SECONDS, log: d.log });
    this.provider = provider;
    this.renaissReady = !!cfg.RENAISS_API_KEY || !!d.provider;
    const wei = (bnb: number) => BigInt(Math.round(bnb * 1e12)) * 10n ** 6n;
    this.engine = new OffchainEngine({
      cfg: {
        chainId: cfg.CHAIN_ID,
        portal: flap.portal,
        vaultPortal: flap.vaultPortal,
        treasury: cfg.TREASURY_ADDRESS,
        pancakeRouter: network.pancakeRouter,
        excluded: cfg.EXCLUDED_ADDRESSES,
        pullBufferBps: cfg.OPS_PULL_BUFFER_BPS,
        swapBufferBps: cfg.SWAP_USDT_BUFFER_BPS,
        cooldownSec: cfg.PULL_COOLDOWN_SEC,
        dividendMinWei: wei(cfg.DIVIDEND_MIN_BNB),
        dividendBatch: cfg.DIVIDEND_BATCH_SIZE,
        buybackMinWei: wei(cfg.BUYBACK_MIN_BNB),
        burnMinWei: wei(cfg.BURN_MIN_BNB),
        burnSlippageBps: cfg.BURN_SLIPPAGE_BPS,
        dispatchMaxGasPct: cfg.DISPATCH_MAX_GAS_PCT,
        autoRegisterDelaySec: cfg.AUTO_REGISTER_DELAY_SEC,
        sweepTo: cfg.SWEEP_TO_ADDRESS,
        sweepMinWei: wei(cfg.SWEEP_MIN_BNB),
        reserveWei: wei(cfg.OPS_RESERVE_BNB),
        forgeDeployer: process.env.FORGE_DEPLOYER || undefined,
        ipfsGateway: process.env.FORGE_IPFS_GATEWAY || FLAP_IPFS_GATEWAY,
        renaissReady: this.renaissReady,
        creatorPayoutMinWei: wei(cfg.CREATOR_PAYOUT_MIN_BNB),
        forgePack: cfg.FORGE_PACK,
        forgeStrategy: cfg.FORGE_STRATEGY,
      },
      store: d.store,
      accounts: this.accounts,
      ops: this.ops,
      provider,
      swapper,
      client: d.client,
      indexer: this.indexer,
      bnbUsd: () => this.bnbUsd(),
      forgeToken: () => this.forgeToken(),
      forgeInfo: () => this.forgeInfo(),
      log: d.log,
      now: d.now,
      fetch: d.fetch,
    });
  }

  /** Builds the real viem clients / store from config. */
  static async create(deps: OffchainServiceDeps): Promise<OffchainService> {
    const cfg = deps.cfg;
    const chain = cfg.CHAIN_ID === 56 ? bsc : bscTestnet;
    const transports = cfg.RPC_URLS.map((u) => http(u, { batch: true, retryCount: 2, timeout: 20_000 }));
    const transport = transports.length > 1 ? fallback(transports) : transports[0];
    const publicClient = (deps.client as PublicClient | undefined) ?? (createPublicClient({ chain, transport }) as PublicClient);
    const account = cfg.OPS_PRIVATE_KEY ? privateKeyToAccount(cfg.OPS_PRIVATE_KEY as Hex) : null;
    const walletClient = account ? createWalletClient({ chain, transport, account }) : null;
    const backend = deps.backend ?? viemBackend({ publicClient, walletClient, account, chain });
    const store = deps.store ?? (await createOffchainStore(cfg.DATABASE_URL));
    return new OffchainService({ ...deps, client: publicClient as unknown as IndexerClient & EngineClient, store, backend });
  }

  readiness() {
    return { opsReady: this.ops.ready, renaissReady: this.renaissReady, opsPaused: this.ops.paused, ops: this.ops.address };
  }

  register(p: RegisterParams) {
    return this.engine.register(p, 'api');
  }

  async bnbUsd(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    if (this.bnbUsdCache && now - this.bnbUsdCache.at < 60) return this.bnbUsdCache.v;
    let v = this.bnbUsdCache?.v ?? this.d.cfg.BNB_USD_PRICE;
    if (this.d.cfg.CHAIN_ID === 56) {
      const r = (await this.d.client.readContract({ address: CHAINLINK_BNB_USD, abi: chainlinkAbi, functionName: 'latestRoundData' }).catch(() => null)) as readonly bigint[] | null;
      if (r && r[1] > 0n) v = Number(r[1]) / 1e8;
    }
    this.bnbUsdCache = { v, at: now };
    return v;
  }

  private async forgeToken(): Promise<string | null> {
    if (!this.d.forge) return null;
    const s = await this.d.forge.status();
    return s.status === 'live' && !s.preview && s.token ? s.token.address : null;
  }

  private async forgeInfo() {
    if (!this.d.forge) return null;
    const s = await this.d.forge.status();
    return s.status === 'live' && !s.preview && s.token ? s.token : null;
  }

  private async balanceOf(address: string | null): Promise<bigint> {
    if (!address) return 0n;
    const hit = this.balCache.get(address.toLowerCase());
    const now = Date.now();
    if (hit && now - hit.at < 15_000) return hit.v;
    const v = await this.d.client.getBalance({ address: address as Hex }).catch(() => hit?.v ?? 0n);
    this.balCache.set(address.toLowerCase(), { v, at: now });
    return v;
  }

  async transparency(): Promise<Transparency> {
    const cfg = this.d.cfg;
    const sum = (b: Bucket) => this.accounts.balance(b);
    const [owed, tax, flap, platform, pots, buyback, creators, creatorsPaid, share, measured, txs, spent, regs, treasuryBal, opsBal] = await Promise.all([
      this.accounts.owed(),
      sum('TAX'),
      sum('FLAP'),
      sum('PLATFORM'),
      sum('POT'),
      sum('BUYBACK'),
      sum('CREATOR'),
      this.store.sum({ bucket: 'CREATOR', kind: 'CREATOR_PAID' }),
      this.accounts.shareBps(),
      this.accounts.measured(),
      this.store.listOpsTxs({ limit: 200 }),
      this.ops.spent24h(),
      this.store.listRegistrations(),
      this.balanceOf(cfg.TREASURY_ADDRESS),
      this.balanceOf(this.ops.address),
    ]);
    const bnbUsd = await this.bnbUsd();
    const [potBy, divBy, burnBy, taxBy] = await Promise.all((['POT', 'DIVIDEND', 'BURN', 'TAX'] as Bucket[]).map((b) => this.store.sumByMachine(b)));
    const same = !!this.ops.address && this.ops.address.toLowerCase() === cfg.TREASURY_ADDRESS.toLowerCase();
    const paying = this.ops.address ? opsBal : treasuryBal;
    const machines = await Promise.all(
      regs.map(async (r) => {
        const m = await this.d.ledger.repo.getMachine(r.token);
        const pot = potBy.get(r.token) ?? 0n;
        const cf = await this.accounts.creatorFields(r.token);
        return {
          address: r.token,
          ticker: m?.ticker ?? '',
          taxModel: r.taxModel ?? 'legacy',
          buyTaxBps: r.buyTaxBps ?? m?.taxBps ?? null,
          sellTaxBps: r.sellTaxBps ?? m?.taxBps ?? null,
          potShareBps: r.potShareBps ?? null,
          creatorPayout: r.payout ?? null,
          creatorOwedBnb: cf.creatorOwedBnb ?? 0,
          creatorPaidBnb: cf.creatorPaidBnb ?? 0,
          treasuryShareBps: await this.accounts.shareBps(r),
          potBnb: r6(weiToBnb(pot)),
          potUsd: Math.round(weiToBnb(pot) * bnbUsd * 100) / 100,
          taxBnb: r6(weiToBnb(taxBy.get(r.token) ?? 0n)),
          dividendsPendingBnb: r6(weiToBnb(divBy.get(r.token) ?? 0n)),
          burnsPendingBnb: r6(weiToBnb(burnBy.get(r.token) ?? 0n)),
          pullQueued: r.pullQueued,
          pullQueuedReason: r.pullQueuedReason ?? null,
          openPull: r.openPull ?? null,
        };
      }),
    );
    return {
      mode: 'offchain',
      chainId: cfg.CHAIN_ID,
      treasury: { address: cfg.TREASURY_ADDRESS, balanceBnb: r6(weiToBnb(treasuryBal)), url: `${this.explorer}/address/${cfg.TREASURY_ADDRESS}` },
      ops: {
        address: this.ops.address,
        balanceBnb: r6(weiToBnb(opsBal)),
        url: this.ops.address ? `${this.explorer}/address/${this.ops.address}` : null,
        ready: this.ops.ready,
        paused: this.ops.paused,
        sameAsTreasury: same,
        dailyCapBnb: cfg.OPS_DAILY_CAP_BNB,
        spent24hBnb: r6(weiToBnb(spent)),
      },
      balances: { treasuryBnb: r6(weiToBnb(treasuryBal)), opsBnb: r6(weiToBnb(opsBal)), payingWalletBnb: r6(weiToBnb(paying)), coverageBnb: r6(weiToBnb(paying - owed.total)) },
      owed: { pots: r6(weiToBnb(owed.pots)), creators: r6(weiToBnb(owed.creators)), buyback: r6(weiToBnb(owed.buyback)), dividendsPending: r6(weiToBnb(owed.dividendsPending)), burnsPending: r6(weiToBnb(owed.burnsPending)), total: r6(weiToBnb(owed.total)) },
      ledger: { taxBnb: r6(weiToBnb(tax)), flapBnb: r6(weiToBnb(flap)), platformBnb: r6(weiToBnb(platform)), potsBnb: r6(weiToBnb(pots)), buybackBnb: r6(weiToBnb(buyback)), creatorsBnb: r6(weiToBnb(creators)), creatorsPaidBnb: r6(weiToBnb(-creatorsPaid)), treasuryShareBps: share, measured: !!measured && measured.grossWei > 0n },
      machines,
      txs: txs.map((t) => ({
        id: t.id,
        kind: t.kind,
        label: t.label ?? null,
        machine: t.machine ?? null,
        to: t.to ?? null,
        amountBnb: r6(weiToBnb(t.amountWei)),
        feeBnb: r6(weiToBnb(t.feeWei)),
        hash: t.hash ?? null,
        url: t.hash ? `${this.explorer}/tx/${t.hash}` : null,
        status: t.status,
        error: t.error ?? null,
        timestamp: t.createdAt,
      })),
      updatedAt: Math.floor(Date.now() / 1000),
    };
  }

  private loop(name: string, ms: number, fn: () => Promise<unknown>) {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (err) {
        this.d.log.error({ err: (err as Error)?.message ?? err, job: name }, 'offchain job failed');
      } finally {
        running = false;
      }
    };
    void run();
    const t = setInterval(run, ms);
    t.unref?.();
    this.timers.push(t);
  }

  start() {
    const cfg = this.d.cfg;
    if (!this.ops.ready) this.d.log.warn({}, 'OPS_PRIVATE_KEY unset: offchain mode is read-only (pulls/payouts/dispatch are recorded as QUEUED)');
    if (!cfg.RENAISS_API_KEY) this.d.log.warn({}, 'RENAISS_API_KEY unset: full pots are marked pullQueued until a key is configured');
    if (this.ops.paused) this.d.log.warn({}, 'OPS_PAUSED=true: no outgoing transactions');
    this.loop('indexer', cfg.INDEXER_POLL_MS, () => this.indexer.tick());
    this.loop('ops', cfg.OPERATOR_POLL_MS, async () => {
      await this.engine.tickPulls();
      await this.engine.tickDividends();
      await this.engine.tickBurns();
      await this.engine.tickBuyback();
    });
    this.loop('keeper', cfg.KEEPER_POLL_MS, async () => {
      await this.engine.tickRefresh();
      await this.engine.tickDispatch();
      await this.engine.tickReconcile();
      await this.engine.tickAutoRegister();
      await this.engine.tickForgeRegister();
    });
    this.loop('creator-payouts', cfg.CREATOR_PAYOUT_INTERVAL_MS, () => this.engine.tickCreatorPayouts());
    if (cfg.SWEEP_TO_ADDRESS) this.loop('sweep', cfg.SWEEP_INTERVAL_MS, () => this.engine.tickSweep());
    if (this.provider && this.ops.ready) {
      this.release = new ReleaseJob(this.d.ledger, this.provider, this.d.log, { intervalMs: cfg.RELEASE_POLL_MS });
      this.release.start();
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.release?.stop();
  }
}
