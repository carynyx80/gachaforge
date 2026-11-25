import type { Bus } from '../bus.js';
import type { Logger } from '../log.js';
import type { Repository } from '../store/repository.js';
import {
  buybackEvent,
  CHAINLINK_BNB_USD,
  chainlinkAbi,
  createForgeClient,
  DEAD,
  pairAbi,
  PORTAL,
  portalAbi,
  portalTradeEvents,
  swapEvent,
  taxProcessorAbi,
  tokenAbi,
  tokenCreatedEvent,
  transferEvent,
  USD_QUOTES,
  VAULT_PORTAL,
  ZERO,
  type ForgeClient,
} from './chain.js';
import type { ForgeAutoBurner } from './autoburn.js';
import type { ForgeConfig } from './config.js';
import { matchCreation, toCreationLog, type CreationLog } from './discovery.js';
import { buildCandles, chainlinkUsd, curvePrice, decodePairSwap, marketCap, pairPrice, round, sig, stats24h, tradeValues, wad } from './math.js';
import { fetchFlapMetadata } from './metadata.js';
import { ForgePreview } from './preview.js';
import { AdaptiveRange, DEFAULT_SCAN, mapLimit, scanRange, type ScanOptions } from './scan.js';
import { CANDLE_INTERVALS, type Candle, type CandleInterval, type ForgeRecord, type ForgeStatus, type ForgeToken, type ForgeTrade, type StoredForgeTrade } from './types.js';

/** Read side used by the HTTP routes. */
export interface ForgeApi {
  status(): Promise<ForgeStatus>;
  trades(limit: number): Promise<ForgeTrade[]>;
  candles(interval: CandleInterval, limit?: number): Promise<Candle[]>;
}

export interface ForgeServiceDeps {
  cfg: ForgeConfig;
  repo: Repository;
  bus: Bus;
  log: Logger;
  client?: ForgeClient;
  fetch?: typeof fetch;
  now?: () => number;
  /** Used only if Chainlink can't be read. */
  bnbUsdFallback?: number;
  scan?: Partial<ScanOptions>;
  /** $FORGE auto-burn (FORGE_AUTO_BURN): burns the deployer's balance once the token is discovered. */
  autoBurn?: ForgeAutoBurner;
}

/** Discovery poll interval while FORGE_AUTO_BURN is armed and $FORGE isn't discovered yet (BSC blocks ≈0.75–3 s). */
export const AUTO_BURN_POLL_MS = 1500;

type AnyLog = { address: string; eventName?: string; args?: any; blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null; blockTimestamp?: bigint | number | null };

const lc = (a: string) => a.toLowerCase();
const eq = (a?: string | null, b?: string | null) => !!a && !!b && lc(a) === lc(b);
const holderKey = (token: string) => `forge:${lc(token)}`;
const tradeCursorKey = (token: string) => `forge:trades:${lc(token)}`;
const discoveryKey = (deployer: string) => `forge:discovery:${lc(deployer)}`;
const publicTrade = ({ side, trader, amountBnb, tokens, priceUsd, txHash, timestamp }: StoredForgeTrade): ForgeTrade => ({ side, trader, amountBnb, tokens, priceUsd, txHash, timestamp });
const byChainOrder = (a: AnyLog, b: AnyLog) => (a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : a.blockNumber! < b.blockNumber! ? -1 : 1);

interface TokenState {
  status: number;
  price: bigint;
  quoteTokenAddress: string;
  buyTaxRate: bigint;
  sellTaxRate: bigint;
  pool: string;
  progress: bigint;
}

/**
 * $FORGE watcher (SPEC "$FORGE token page"). Always BSC mainnet, independent of MOCK_MODE/CHAIN_ID.
 *  waiting  → no FORGE_DEPLOYER (idle) or deployer set but nothing created yet (polls Portal TokenCreated)
 *  live     → token persisted; indexes Portal curve trades, PancakeSwap pair swaps, Transfers, buybacks.
 */
export class ForgeService implements ForgeApi {
  private record: ForgeRecord | null = null;
  private previewSim: ForgePreview | null = null;
  private client: ForgeClient;
  private scanOpts: ScanOptions;
  private discRange: AdaptiveRange;
  private idxRange: AdaptiveRange;
  private timer: NodeJS.Timeout | null = null;
  private previewTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private bnbUsdCache: { v: number; at: number } | null = null;
  private supplyCache: number | null = null;
  private blockTs = new Map<bigint, number>();
  private lastMetaAttempt = 0;
  private lastRefresh = 0;
  private now: () => number;

  constructor(private d: ForgeServiceDeps) {
    this.client = d.client ?? createForgeClient(d.cfg.rpcUrls);
    this.now = d.now ?? (() => Math.floor(Date.now() / 1000));
    this.scanOpts = {
      ...DEFAULT_SCAN,
      maxRange: d.cfg.maxRange,
      initialRange: Math.min(DEFAULT_SCAN.initialRange, d.cfg.maxRange),
      onError: (err, from, to, attempt) => d.log.warn({ err: (err as Error)?.message?.slice(0, 200), from: String(from), to: String(to), attempt }, 'forge getLogs failed; shrinking range + backing off'),
      ...d.scan,
    };
    this.discRange = new AdaptiveRange(this.scanOpts);
    this.idxRange = new AdaptiveRange(this.scanOpts);
  }

  private get cfg() {
    return this.d.cfg;
  }
  private get repo() {
    return this.d.repo;
  }

  /** Loads the persisted token (if any). An explicit FORGE_TOKEN_ADDRESS that differs wins. */
  async init() {
    const rec = await this.repo.getForgeRecord();
    if (rec && (!this.cfg.tokenOverride || eq(rec.token.address, this.cfg.tokenOverride))) this.record = rec;
    if (!this.record && this.cfg.preview) this.startPreview();
    const ab = this.d.autoBurn;
    if (ab) {
      await ab.init();
      ab.onBurned = async () => {
        if (!this.record) return; // adopt() publishes once it finishes
        await this.refresh();
        this.d.bus.publish({ type: 'forge', data: this.wsToken() });
      };
      // Discovered before (e.g. restart mid-burn, or the flag was enabled after discovery): finish the one-time burn.
      if (this.record) this.triggerAutoBurn(this.record.token.address, this.record.token.creator, this.record.token.symbol);
    }
  }

  /** Poll interval: fast while auto-burn is armed and $FORGE is still undiscovered. */
  get pollMs() {
    return this.d.autoBurn?.armed && !this.record ? Math.min(this.cfg.pollMs, AUTO_BURN_POLL_MS) : this.cfg.pollMs;
  }

  /** Burns only a token actually created by FORGE_DEPLOYER (never an arbitrary FORGE_TOKEN_ADDRESS). */
  private triggerAutoBurn(token: string, creator: string, symbol: string) {
    const ab = this.d.autoBurn;
    if (!ab?.armed) return;
    if (!this.cfg.deployer || !eq(creator, this.cfg.deployer)) {
      this.d.log.error({ token, creator, deployer: this.cfg.deployer ?? null }, '$FORGE auto-burn skipped: token creator is not FORGE_DEPLOYER');
      return;
    }
    const self = this;
    // Getters: the burn finishes after adopt() has loaded the real symbol/price.
    void ab.trigger({
      token,
      get symbol() {
        return self.record?.token.symbol || symbol;
      },
      get priceUsd() {
        return self.record?.token.priceUsd ?? 0;
      },
    });
  }

  private wsToken(): ForgeToken {
    const t = this.record!.token;
    return this.d.autoBurn ? { ...t, autoBurn: this.d.autoBurn.status() } : t;
  }

  async start() {
    await this.init();
    if (!this.cfg.deployer && !this.cfg.tokenOverride && !this.record) this.d.log.info({}, 'FORGE_DEPLOYER unset: $FORGE watcher idle (status waiting)');
    const loop = async () => {
      if (this.stopped) return;
      await this.tick();
      if (!this.stopped) this.timer = setTimeout(loop, this.pollMs);
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopPreview();
    this.d.autoBurn?.stop();
  }

  /** One unit of work; never throws. Exposed for tests. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      if (this.record) await this.indexOnce();
      else if (this.cfg.tokenOverride) await this.resolveOverride(this.cfg.tokenOverride);
      else if (this.cfg.deployer) await this.discoverOnce(this.cfg.deployer);
    } catch (err) {
      this.d.log.error({ err: (err as Error)?.message ?? err }, 'forge tick failed');
    } finally {
      this.running = false;
    }
  }

  // ───────────────────────────── read API ─────────────────────────────

  async status(): Promise<ForgeStatus> {
    const deployer = this.cfg.deployer ? lc(this.cfg.deployer) : this.record ? lc(this.record.token.creator) : null;
    const ab = this.d.autoBurn ? { autoBurn: this.d.autoBurn.status() } : {};
    if (this.record) return { status: 'live', deployer, token: this.record.token, ...ab };
    if (this.previewSim) return { status: 'live', deployer, token: this.previewSim.token(), preview: true, ...ab };
    return { status: 'waiting', deployer, ...ab };
  }

  async trades(limit: number): Promise<ForgeTrade[]> {
    if (this.record) return (await this.repo.listForgeTrades(this.record.token.address, { limit })).map(publicTrade);
    if (this.previewSim) return [...this.previewSim.trades].reverse().slice(0, limit).map(publicTrade);
    return [];
  }

  async candles(interval: CandleInterval, limit = 300): Promise<Candle[]> {
    const sec = CANDLE_INTERVALS[interval];
    if (this.previewSim && !this.record) return this.previewSim.candles(sec, limit);
    if (!this.record) return [];
    const now = this.now();
    const since = now - sec * limit;
    const token = this.record.token.address;
    const trades = await this.repo.listForgeTrades(token, { limit: 50_000, since });
    const prior = await this.repo.lastForgeTradeBefore(token, since);
    return buildCandles(prior ? [prior, ...trades] : trades, sec, { limit, until: now });
  }

  // ───────────────────────────── preview ─────────────────────────────

  private startPreview() {
    this.previewSim = new ForgePreview(this.now, undefined, this.cfg.deployer ?? null);
    this.d.log.warn({}, 'FORGE_PREVIEW=true: serving a SIMULATED $FORGE (preview: true) until the real token is discovered');
    this.previewTimer = setInterval(() => {
      if (!this.previewSim) return;
      const t = this.previewSim.step();
      this.d.bus.publish({ type: 'forgeTrade', data: publicTrade(t) });
      this.d.bus.publish({ type: 'forge', data: this.previewSim.token() });
    }, 6000);
    this.previewTimer.unref?.();
  }
  private stopPreview() {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    this.previewSim = null;
  }

  // ───────────────────────────── discovery ─────────────────────────────

  /**
   * Scans Portal + VaultPortal TokenCreated logs from the persisted cursor to the head.
   * Start: FORGE_START_BLOCK, else the head at first start (persisted). Changing FORGE_START_BLOCK restarts the scan there.
   */
  async discoverOnce(deployer: string): Promise<ForgeRecord | null> {
    const latest = await this.client.getBlockNumber();
    const key = discoveryKey(deployer);
    const raw = await this.repo.getMeta(key);
    let st = raw ? (JSON.parse(raw) as { start: string; cursor: string }) : null;
    if (!st || (this.cfg.startBlock !== undefined && BigInt(st.start) !== this.cfg.startBlock)) {
      const start = this.cfg.startBlock ?? latest;
      st = { start: start.toString(), cursor: (start - 1n).toString() };
      await this.repo.setMeta(key, JSON.stringify(st));
      this.d.log.info({ deployer, startBlock: st.start }, 'forge discovery: scanning flap.sh Portal TokenCreated');
    }
    const from = BigInt(st.cursor) + 1n;
    if (from > latest) return null;
    let found: ForgeRecord | null = null;
    await scanRange(
      from,
      latest,
      (a, b) => this.client.getLogs({ address: [PORTAL, VAULT_PORTAL], event: tokenCreatedEvent, fromBlock: a, toBlock: b }) as Promise<AnyLog[]>,
      async (logs, _a, b) => {
        const creations = logs.map(toCreationLog).filter((x): x is CreationLog => !!x);
        const m = await matchCreation(creations, deployer, (hash) => this.client.getTransaction({ hash: hash as `0x${string}` }).then((t) => t.from));
        st!.cursor = b.toString();
        await this.repo.setMeta(key, JSON.stringify(st));
        if (!m) return false;
        found = await this.adopt(m, deployer, m.matchedBy);
        return true;
      },
      this.discRange,
      this.scanOpts,
    );
    return found;
  }

  /** FORGE_TOKEN_ADDRESS: skip discovery; look for its TokenCreated (for meta/creator/created block) then go live. */
  async resolveOverride(token: string): Promise<ForgeRecord> {
    const latest = await this.client.getBlockNumber();
    const from = this.cfg.startBlock ?? (latest > this.cfg.overrideLookback ? latest - this.cfg.overrideLookback : 0n);
    let creation: CreationLog | null = null;
    await scanRange(
      from,
      latest,
      (a, b) => this.client.getLogs({ address: [PORTAL, VAULT_PORTAL], event: tokenCreatedEvent, fromBlock: a, toBlock: b }) as Promise<AnyLog[]>,
      async (logs) => {
        creation = logs.map(toCreationLog).find((c) => !!c && eq(c.token, token)) ?? null;
        return !!creation;
      },
      this.discRange,
      this.scanOpts,
    );
    const c = creation as CreationLog | null;
    if (!c) this.d.log.warn({ token, from: String(from) }, 'FORGE_TOKEN_ADDRESS: TokenCreated not found in range; indexing from the scan start (holders/trades may be partial)');
    const txFrom = c ? await this.client.getTransaction({ hash: c.transactionHash as `0x${string}` }).then((t) => t.from).catch(() => null) : null;
    const base: CreationLog = c ?? { token, creator: null, name: '', symbol: '', meta: '', blockNumber: from, logIndex: 0, transactionHash: '' };
    return this.adopt(base, txFrom ?? c?.creator ?? this.cfg.deployer ?? ZERO, 'override');
  }

  private async adopt(c: CreationLog, creator: string, discoveredBy: ForgeRecord['discoveredBy']): Promise<ForgeRecord> {
    const address = c.token as `0x${string}`;
    // Latency-critical: start the one-time auto-burn before metadata/stats (it only needs the token address).
    this.triggerAutoBurn(lc(address), creator, c.symbol);
    const pc = this.client;
    const [name, symbol, state, createdAt] = await Promise.all([
      pc.readContract({ address, abi: tokenAbi, functionName: 'name' }).catch(() => c.name) as Promise<string>,
      pc.readContract({ address, abi: tokenAbi, functionName: 'symbol' }).catch(() => c.symbol) as Promise<string>,
      this.readState(address),
      c.ts ? Promise.resolve(Number(c.ts)) : c.transactionHash ? this.timestampOf(c.blockNumber) : Promise.resolve(0),
    ]);
    const graduated = state?.status === 4;
    const pool = state && state.pool !== ZERO ? lc(state.pool) : undefined;
    const token: ForgeToken = {
      address: lc(address),
      name: name || c.name,
      symbol: symbol || c.symbol,
      creator: lc(creator),
      createdAt,
      createdTx: c.transactionHash,
      stage: graduated ? 'GRADUATED' : 'CURVE',
      bondingCurvePct: graduated ? 100 : state ? Math.min(100, round(wad(state.progress) * 100, 2)) : 0,
      ...(pool ? { pool } : {}),
      priceUsd: 0,
      priceBnb: 0,
      marketCapUsd: 0,
      change24hPct: 0,
      volume24hUsd: 0,
      holders: 0,
      buyTaxBps: state ? Number(state.buyTaxRate) : 0,
      sellTaxBps: state ? Number(state.sellTaxRate) : 0,
      burnedTokens: 0,
      buybackPendingBnb: 0,
      buybackTotalBnb: 0,
    };
    const rec: ForgeRecord = {
      token,
      createdBlock: Number(c.blockNumber),
      meta: c.meta,
      metaFetched: false,
      quoteToken: state ? lc(state.quoteTokenAddress) : ZERO,
      buybackTotalWei: '0',
      discoveredBy,
    };
    this.record = rec;
    if (rec.quoteToken !== ZERO && !USD_QUOTES.has(rec.quoteToken)) this.d.log.warn({ quote: rec.quoteToken }, '$FORGE quote token is neither BNB nor a known stable; USD prices assume BNB');
    if (pool) await this.ensureOrientation();
    await Promise.all([this.loadMetadata(), this.loadTax()]);
    await this.repo.saveForgeRecord(rec);
    await this.repo.setMeta(tradeCursorKey(token.address), String(rec.createdBlock - 1));
    if (this.previewSim) this.stopPreview();
    this.d.log.info({ token: token.address, symbol: token.symbol, creator: token.creator, block: rec.createdBlock, discoveredBy }, '$FORGE discovered');
    await this.refresh();
    this.d.bus.publish({ type: 'forge', data: this.wsToken() });
    return rec;
  }

  // ───────────────────────────── indexing ─────────────────────────────

  async indexOnce() {
    const rec = this.record!;
    const token = rec.token.address;
    const latest = await this.client.getBlockNumber();
    const stored = await this.repo.getMeta(tradeCursorKey(token));
    const cursor = stored ? BigInt(stored) : BigInt(rec.createdBlock) - 1n;
    if (cursor >= latest) {
      if (this.now() - this.lastRefresh >= 30) await this.refresh();
      return;
    }
    await scanRange(
      cursor + 1n,
      latest,
      (a, b) => this.fetchTokenLogs(a, b),
      async (logs, _a, b) => {
        await this.applyLogs(logs);
        await this.repo.setMeta(tradeCursorKey(token), b.toString());
      },
      this.idxRange,
      this.scanOpts,
    );
  }

  private async fetchTokenLogs(a: bigint, b: bigint): Promise<AnyLog[]> {
    const rec = this.record!;
    const token = rec.token.address;
    const pool = rec.token.pool;
    const burner = this.cfg.buybackBurner ? lc(this.cfg.buybackBurner) : undefined;
    const addrs = [token, pool, burner].filter((x): x is string => !!x) as `0x${string}`[];
    const [portalLogs, otherLogs] = (await Promise.all([
      this.client.getLogs({ address: PORTAL, events: portalTradeEvents, fromBlock: a, toBlock: b }),
      this.client.getLogs({ address: addrs, events: [transferEvent, swapEvent, buybackEvent], fromBlock: a, toBlock: b }),
    ])) as [AnyLog[], AnyLog[]];
    const logs = [
      ...portalLogs.filter((l) => eq(l.args?.token, token)),
      // The pair also emits (LP) Transfer events — only the token's own Transfers count.
      ...otherLogs.filter((l) => (l.eventName === 'Transfer' && eq(l.address, token)) || (l.eventName === 'Swap' && eq(l.address, pool)) || (l.eventName === 'Buyback' && eq(l.address, burner))),
    ];
    // Graduated inside this chunk: the pair wasn't in the address list yet, fetch its swaps for the rest of the chunk.
    const grad = logs.find((l) => l.eventName === 'LaunchedToDEX');
    if (grad && !pool && grad.args?.pool && grad.args.pool !== ZERO) {
      const swaps = (await this.client.getLogs({ address: grad.args.pool, event: swapEvent, fromBlock: grad.blockNumber!, toBlock: b })) as AnyLog[];
      logs.push(...swaps);
    }
    return logs.sort(byChainOrder);
  }

  /** Applies one chunk of decoded logs in chain order. Exposed for tests. */
  async applyLogs(logs: AnyLog[]) {
    const rec = this.record!;
    const token = rec.token.address;
    const fresh: StoredForgeTrade[] = [];
    let changed = false;
    const bnbUsd = logs.some((l) => l.eventName === 'TokenBought' || l.eventName === 'TokenSold' || l.eventName === 'Swap') ? await this.bnbUsd() : 0;
    const quoteUsd = this.quoteUsd(bnbUsd);
    // Pair swaps don't carry the human trader: use tx.from (batched).
    const swapHashes = [...new Set(logs.filter((l) => l.eventName === 'Swap').map((l) => l.transactionHash!))];
    const froms = new Map<string, string>();
    await mapLimit(swapHashes, 6, async (h) => {
      const f = await this.client
        .getTransaction({ hash: h as `0x${string}` })
        .then((t) => t.from)
        .catch(() => null);
      if (f) froms.set(h, f);
    });

    for (const l of logs) {
      const a = l.args ?? {};
      try {
        switch (l.eventName) {
          case 'TokenBought':
          case 'TokenSold': {
            const side = l.eventName === 'TokenBought' ? 'BUY' : 'SELL';
            const v = tradeValues(a.amount, a.eth, quoteUsd, bnbUsd);
            const ts = a.ts ? Number(a.ts) : await this.logTimestamp(l);
            fresh.push(this.mkTrade(l, side, side === 'BUY' ? a.buyer : a.seller, v, ts, 'PORTAL'));
            break;
          }
          case 'Swap': {
            if (rec.forgeIsToken0 === undefined) {
              if (!rec.token.pool) rec.token.pool = lc(l.address);
              await this.ensureOrientation();
            }
            const s = decodePairSwap(a, !!rec.forgeIsToken0);
            if (!s) break;
            const v = tradeValues(s.tokensWei, s.quoteWei, quoteUsd, bnbUsd);
            fresh.push(this.mkTrade(l, s.side, froms.get(l.transactionHash!) ?? a.to ?? a.sender, v, await this.logTimestamp(l), 'PAIR'));
            break;
          }
          case 'Transfer':
            await this.repo.applyTransfer(holderKey(token), a.from, a.to, a.value);
            break;
          case 'LaunchedToDEX':
            rec.token.stage = 'GRADUATED';
            rec.token.bondingCurvePct = 100;
            if (a.pool && a.pool !== ZERO) rec.token.pool = lc(a.pool);
            await this.ensureOrientation();
            changed = true;
            this.d.log.info({ token, pool: rec.token.pool }, '$FORGE graduated to PancakeSwap');
            break;
          case 'FlapTokenProgressChanged':
            if (rec.token.stage === 'CURVE') rec.token.bondingCurvePct = Math.min(100, round(wad(a.newProgress) * 100, 2));
            changed = true;
            break;
          case 'TaxTokenAddressesUpdated':
            rec.token.taxRecipient = a.beneficiary ? lc(a.beneficiary) : rec.token.taxRecipient;
            this.d.log.warn({ token, beneficiary: a.beneficiary, feeReceiver: a.feeReceiver }, '$FORGE tax recipient re-routed by flap.sh admin');
            changed = true;
            break;
          case 'Buyback':
            rec.buybackTotalWei = (BigInt(rec.buybackTotalWei) + BigInt(a.bnbSpent ?? 0n)).toString();
            changed = true;
            break;
        }
      } catch (err) {
        this.d.log.error({ err: (err as Error)?.message, tx: l.transactionHash, event: l.eventName }, 'forge: failed to handle log');
      }
    }
    const added: StoredForgeTrade[] = [];
    for (const t of fresh) if (await this.repo.addForgeTrade(token, t)) added.push(t);
    if (!added.length && !changed && !logs.some((l) => l.eventName === 'Transfer')) return;
    await this.refresh();
    for (const t of added) this.d.bus.publish({ type: 'forgeTrade', data: publicTrade(t) });
    this.d.bus.publish({ type: 'forge', data: this.wsToken() });
  }

  private mkTrade(l: AnyLog, side: 'BUY' | 'SELL', trader: string, v: ReturnType<typeof tradeValues>, timestamp: number, source: StoredForgeTrade['source']): StoredForgeTrade {
    return { id: `${l.transactionHash}:${l.logIndex}`, side, trader: lc(trader ?? ZERO), ...v, txHash: l.transactionHash!, timestamp, blockNumber: Number(l.blockNumber), logIndex: Number(l.logIndex), source };
  }

  // ───────────────────────────── live stats ─────────────────────────────

  /** Recomputes price/market cap/24h/holders/burn/buyback and persists the record. Exposed for tests. */
  async refresh() {
    const rec = this.record!;
    const t = rec.token;
    const address = t.address as `0x${string}`;
    this.lastRefresh = this.now();
    const [bnbUsd, state, supply] = await Promise.all([this.bnbUsd(), this.readState(address), this.supply(address)]);
    if (state) {
      if (state.status === 4) {
        t.stage = 'GRADUATED';
        t.bondingCurvePct = 100;
      } else if (t.stage === 'CURVE') t.bondingCurvePct = Math.min(100, round(wad(state.progress) * 100, 2));
      if (state.pool !== ZERO && !t.pool) t.pool = lc(state.pool);
      if (state.buyTaxRate > 0n || state.sellTaxRate > 0n) {
        t.buyTaxBps = Number(state.buyTaxRate);
        t.sellTaxBps = Number(state.sellTaxRate);
      }
      if (state.quoteTokenAddress) rec.quoteToken = lc(state.quoteTokenAddress);
    }
    const quoteUsd = this.quoteUsd(bnbUsd);
    let priceQuote = 0;
    if (t.stage === 'GRADUATED' && t.pool) {
      await this.ensureOrientation();
      const r = (await this.client.readContract({ address: t.pool as `0x${string}`, abi: pairAbi, functionName: 'getReserves' }).catch(() => null)) as readonly [bigint, bigint, number] | null;
      if (r) priceQuote = pairPrice(r[0], r[1], !!rec.forgeIsToken0);
    } else if (state) priceQuote = curvePrice(state.price);
    const now = this.now();
    const [recent, before] = await Promise.all([this.repo.listForgeTrades(address, { limit: 100_000, since: now - 86_400 }), this.repo.lastForgeTradeBefore(address, now - 86_400)]);
    let priceUsd = priceQuote * quoteUsd;
    if (!(priceUsd > 0)) priceUsd = recent[0]?.priceUsd ?? before?.priceUsd ?? 0;
    t.priceUsd = sig(priceUsd, 8);
    t.priceBnb = bnbUsd > 0 ? sig(priceUsd / bnbUsd, 8) : 0;
    t.marketCapUsd = marketCap(supply, priceUsd);
    Object.assign(t, stats24h(recent, priceUsd, now, before));

    const excluded = new Set([ZERO, lc(DEAD), lc(PORTAL), lc(VAULT_PORTAL), t.address, t.pool].filter(Boolean) as string[]);
    t.holders = (await this.repo.getBalances(holderKey(address))).filter((h) => !excluded.has(h.address)).length;
    const dead = (await this.client.readContract({ address, abi: tokenAbi, functionName: 'balanceOf', args: [DEAD] }).catch(() => null)) as bigint | null;
    if (dead !== null) t.burnedTokens = round(wad(dead), 2);
    if (this.cfg.buybackBurner) {
      const bal = await this.client.getBalance({ address: this.cfg.buybackBurner }).catch(() => null);
      if (bal !== null) t.buybackPendingBnb = round(wad(bal), 6);
      t.buybackTotalBnb = round(wad(BigInt(rec.buybackTotalWei)), 6);
    } else {
      t.buybackPendingBnb = 0;
      t.buybackTotalBnb = 0;
    }
    if (!rec.metaFetched && now - this.lastMetaAttempt >= 300) await this.loadMetadata();
    await this.repo.saveForgeRecord(rec);
  }

  private async loadMetadata() {
    const rec = this.record!;
    this.lastMetaAttempt = this.now();
    if (!rec.meta) {
      rec.metaFetched = true;
      return;
    }
    try {
      const m = await fetchFlapMetadata(rec.meta, this.cfg.ipfsGateway, this.d.fetch ?? fetch);
      if (m) {
        if (m.image) rec.token.image = m.image;
        if (m.description) rec.token.description = m.description;
        if (m.links) rec.token.links = m.links;
      }
      rec.metaFetched = true;
    } catch (err) {
      this.d.log.warn({ err: (err as Error)?.message, meta: rec.meta }, 'forge metadata fetch failed; will retry');
    }
  }

  /** taxRecipient = TaxProcessor.marketAddress() (the beneficiary/vault). Non-tax tokens: left unset. */
  private async loadTax() {
    const t = this.record!.token;
    const address = t.address as `0x${string}`;
    const tp = (await this.client.readContract({ address, abi: tokenAbi, functionName: 'taxProcessor' }).catch(() => null)) as string | null;
    if (tp && tp !== ZERO) {
      const mkt = (await this.client.readContract({ address: tp as `0x${string}`, abi: taxProcessorAbi, functionName: 'marketAddress' }).catch(() => null)) as string | null;
      if (mkt && mkt !== ZERO) t.taxRecipient = lc(mkt);
    }
    if (!t.buyTaxBps && !t.sellTaxBps) {
      const [b, s] = await Promise.all([
        this.client.readContract({ address, abi: tokenAbi, functionName: 'buyTaxRate' }).catch(() => null),
        this.client.readContract({ address, abi: tokenAbi, functionName: 'sellTaxRate' }).catch(() => null),
      ]);
      if (b != null) t.buyTaxBps = Number(b);
      if (s != null) t.sellTaxBps = Number(s);
    }
  }

  private async ensureOrientation() {
    const rec = this.record!;
    if (rec.forgeIsToken0 !== undefined || !rec.token.pool) return;
    const t0 = (await this.client.readContract({ address: rec.token.pool as `0x${string}`, abi: pairAbi, functionName: 'token0' }).catch(() => null)) as string | null;
    if (t0) rec.forgeIsToken0 = eq(t0, rec.token.address);
  }

  private async readState(token: `0x${string}`): Promise<TokenState | null> {
    return (await this.client.readContract({ address: PORTAL, abi: portalAbi, functionName: 'getTokenV8Safe', args: [token] }).catch(() => null)) as TokenState | null;
  }

  private async supply(token: `0x${string}`): Promise<number> {
    if (this.supplyCache === null) {
      const s = (await this.client.readContract({ address: token, abi: tokenAbi, functionName: 'totalSupply' }).catch(() => null)) as bigint | null;
      if (s === null) return 1e9; // flap.sh tokens: fixed 1B supply
      this.supplyCache = wad(s);
    }
    return this.supplyCache;
  }

  /** Chainlink BNB/USD (cached 60s); falls back to the last good value, then BNB_USD_PRICE. */
  async bnbUsd(): Promise<number> {
    const now = this.now();
    if (this.bnbUsdCache && now - this.bnbUsdCache.at < 60) return this.bnbUsdCache.v;
    const r = (await this.client.readContract({ address: CHAINLINK_BNB_USD, abi: chainlinkAbi, functionName: 'latestRoundData' }).catch(() => null)) as readonly [bigint, bigint, bigint, bigint, bigint] | null;
    const v = r && r[1] > 0n ? chainlinkUsd(r[1]) : (this.bnbUsdCache?.v ?? this.d.bnbUsdFallback ?? 600);
    this.bnbUsdCache = { v, at: now };
    return v;
  }

  /** USD per quote unit: BNB/USD for native quote, $1 for known stables. */
  private quoteUsd(bnbUsd: number) {
    const q = this.record?.quoteToken ?? ZERO;
    if (q === ZERO) return bnbUsd;
    if (USD_QUOTES.has(q)) return 1;
    return bnbUsd; // unknown ERC-20 quote: best effort, logged once at discovery
  }

  private async logTimestamp(l: AnyLog): Promise<number> {
    if (l.blockTimestamp != null) return Number(l.blockTimestamp);
    return this.timestampOf(l.blockNumber!);
  }
  private async timestampOf(block: bigint): Promise<number> {
    const hit = this.blockTs.get(block);
    if (hit) return hit;
    const b = await this.client.getBlock({ blockNumber: block }).catch(() => null);
    const ts = b ? Number(b.timestamp) : this.now();
    if (this.blockTs.size > 2000) this.blockTs.clear();
    this.blockTs.set(block, ts);
    return ts;
  }
}
