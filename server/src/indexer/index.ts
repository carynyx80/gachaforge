import { formatEther, type Log } from 'viem';
import { buybackBurnerAbi, factoryAbi, portalAbi, tokenAbi, vaultAbi, vaultPortalAbi, FLAP_STATUS } from '../abi/index.js';
import type { ChainCtx } from '../chain.js';
import type { Config } from '../config.js';
import { selectEligible } from '../core/snapshot.js';
import { feeSplit, PACK_BY_INDEX, PACK_PRICE_USD, STRATEGY_BY_INDEX, TOTAL_SUPPLY_DEFAULT } from '../core/packs.js';
import { now, round2, type Ledger } from '../ledger.js';
import type { Logger } from '../log.js';
import type { Machine, Pull } from '../types.js';
import { addPool, excludedFor } from './excluded.js';

const CURSOR = 'indexer:block';
const MAX_RANGE = 2000n;
const bnb = (wei: bigint) => Number(formatEther(wei));
const lc = (a: string) => a.toLowerCase();

type AnyLog = Log & { eventName?: string; args?: any };

/**
 * Polling log indexer (viem getLogs with a persisted block cursor, so it backfills after restarts).
 * Sources: GachaForge factory, per-machine vaults, machine tokens (Transfer), flap.sh Portal/VaultPortal.
 */
export class Indexer {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tokens = new Set<string>();
  private vaultToToken = new Map<string, string>();
  private buybackBurner: string | null = null;

  constructor(
    private cfg: Config,
    private chain: ChainCtx,
    private ledger: Ledger,
    private log: Logger,
  ) {}

  private get repo() {
    return this.ledger.repo;
  }

  async start() {
    for (const m of await this.repo.listMachines()) this.track(m.address, m.vault);
    this.buybackBurner = await this.chain.publicClient
      .readContract({ address: this.chain.factory, abi: factoryAbi, functionName: 'buybackBurner' })
      .then((a) => lc(a as string))
      .catch(() => null);
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        while (await this.step()) {
          /* catch up */
        }
      } catch (err) {
        this.log.error({ err }, 'indexer step failed');
      } finally {
        this.running = false;
      }
    };
    await tick();
    this.timer = setInterval(tick, this.cfg.INDEXER_POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private track(token: string, vault: string) {
    this.tokens.add(lc(token));
    this.vaultToToken.set(lc(vault), lc(token));
  }

  /** Processes one block range. Returns true when more ranges are pending. */
  async step(): Promise<boolean> {
    const latest = await this.chain.publicClient.getBlockNumber();
    const stored = await this.repo.getMeta(CURSOR);
    const from = stored ? BigInt(stored) + 1n : (this.cfg.START_BLOCK ?? (latest > 5000n ? latest - 5000n : 0n));
    if (from > latest) return false;
    const to = from + MAX_RANGE - 1n < latest ? from + MAX_RANGE - 1n : latest;
    const pc = this.chain.publicClient;

    // 1. New machines first so the same range's vault/token logs are picked up.
    const launches = await pc.getLogs({ address: this.chain.factory, events: factoryAbi.filter((x) => x.type === 'event' && x.name === 'MachineLaunched'), fromBlock: from, toBlock: to });
    for (const l of launches as AnyLog[]) await this.onLaunch(l);

    const vaults = [...this.vaultToToken.keys()] as `0x${string}`[];
    const tokens = [...this.tokens] as `0x${string}`[];
    const bb = this.buybackBurner as `0x${string}` | null;
    const [vaultLogs, tokenLogs, portalLogs, vpLogs, bbLogs] = await Promise.all([
      vaults.length ? pc.getLogs({ address: vaults, events: vaultAbi.filter((x) => x.type === 'event'), fromBlock: from, toBlock: to }) : [],
      tokens.length ? pc.getLogs({ address: tokens, events: tokenAbi.filter((x) => x.type === 'event' && x.name === 'Transfer'), fromBlock: from, toBlock: to }) : [],
      tokens.length ? pc.getLogs({ address: this.chain.portal, events: portalAbi.filter((x) => x.type === 'event'), fromBlock: from, toBlock: to }) : [],
      tokens.length ? pc.getLogs({ address: this.chain.vaultPortal, events: vaultPortalAbi.filter((x) => x.type === 'event'), fromBlock: from, toBlock: to }) : [],
      bb ? pc.getLogs({ address: bb, events: buybackBurnerAbi.filter((x) => x.type === 'event'), fromBlock: from, toBlock: to }) : [],
    ]);
    const all = ([...vaultLogs, ...tokenLogs, ...portalLogs, ...vpLogs, ...bbLogs] as AnyLog[]).sort((a, b) =>
      a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : a.blockNumber! < b.blockNumber! ? -1 : 1,
    );
    const touched = new Set<string>();
    for (const l of all) {
      try {
        await this.handle(l, touched);
      } catch (err) {
        this.log.error({ err, tx: l.transactionHash, event: l.eventName }, 'failed to handle log');
      }
    }
    for (const t of touched) await this.refreshHolderCounts(t);
    await this.repo.setMeta(CURSOR, to.toString());
    return to < latest;
  }

  private async onLaunch(l: AnyLog) {
    const { token, vault, creator, packId, strategy, taxBps, dividendBps, burnBps, lpBps } = l.args as {
      token: string; vault: string; creator: string; packId: number; strategy: number; taxBps: number; dividendBps: number; burnBps: number; lpBps: number;
    };
    if (await this.repo.getMachine(token)) return this.track(token, vault);
    const pc = this.chain.publicClient;
    const t = token as `0x${string}`;
    const [name, symbol, block] = await Promise.all([
      pc.readContract({ address: t, abi: tokenAbi, functionName: 'name' }).catch(() => 'Unknown'),
      pc.readContract({ address: t, abi: tokenAbi, functionName: 'symbol' }).catch(() => '???'),
      pc.getBlock({ blockNumber: l.blockNumber! }),
    ]);
    const packKey = PACK_BY_INDEX[Number(packId)] ?? 'FORGE_28';
    const strat = STRATEGY_BY_INDEX[Number(strategy)] ?? 'RAFFLE';
    const m: Machine = {
      address: lc(token),
      vault: lc(vault),
      name: String(name),
      ticker: String(symbol),
      description: '', // TODO: fetch flap.sh meta (TokenCreated.meta CID)
      image: '',
      creator: lc(creator),
      createdAt: Number(block.timestamp),
      pack: packKey,
      packPriceUsd: PACK_PRICE_USD[packKey],
      strategy: strat,
      taxBps: Number(taxBps),
      ...(strat === 'SPLIT' ? { split: { dividendBps: Number(dividendBps), burnBps: Number(burnBps), lpBps: Number(lpBps) } } : {}),
      stage: 'CURVE',
      bondingCurvePct: 0,
      marketCapUsd: 0,
      change24hPct: 0,
      volume24hUsd: 0,
      holders: 0,
      eligibleHolders: 0,
      potUsd: 0,
      packsOpened: 0,
      round: 0,
      paidToHoldersBnb: 0,
      burnedTokens: 0,
    };
    this.track(token, vault);
    await this.ledger.launch(m);
    this.log.info({ token, vault }, 'machine launched');
  }

  private async handle(l: AnyLog, touched: Set<string>) {
    const addr = lc(l.address);
    const a = l.args ?? {};
    const tx = l.transactionHash ?? '0x';
    const px = this.cfg.BNB_USD_PRICE; // TODO: Chainlink BNB/USD feed
    const ts = now();

    // token Transfer
    if (l.eventName === 'Transfer' && this.tokens.has(addr)) {
      await this.repo.applyTransfer(addr, a.from, a.to, a.value);
      touched.add(addr);
      return;
    }

    // vault events
    const token = this.vaultToToken.get(addr);
    if (token) {
      const m = await this.repo.getMachine(token);
      if (!m) return;
      const id = `${token}-${a.pullId}`;
      switch (l.eventName) {
        case 'TaxReceived':
          await this.ledger.taxReceived(token, bnb(a.amount) * px, bnb(a.toPot) * px, ts);
          return;
        case 'PullOpened':
          await this.ledger.updateMachine(token, (m) => ({ round: Number(a.pullId), potUsd: round2(Math.max(0, m.potUsd - bnb(a.amountSent) * px)) }));
          return;
        case 'PullSettled': {
          const prev = await this.repo.getPull(id);
          await this.repo.upsertPull({
            id,
            machine: token,
            ticker: m.ticker,
            pack: m.pack,
            round: Number(a.pullId),
            card: prev?.card ?? { name: 'Graded card', set: '', grader: 'PSA', grade: '', image: '', valueUsd: Number(a.cardValueUsd) },
            result: prev?.result ?? 'SOLD',
            txHash: prev?.txHash ?? tx,
            timestamp: prev?.timestamp ?? ts,
          });
          await this.ledger.updateMachine(token, (m) => ({ packsOpened: m.packsOpened + 1, potUsd: round2(m.potUsd + bnb(a.refund) * px) }));
          return;
        }
        case 'RaffleRecorded': {
          if (!(await this.repo.getRaffleProof(id))) {
            // Operator normally stores the full eligible list; otherwise keep the on-chain commitment.
            await this.repo.setRaffleProof({
              pullId: id,
              machine: token,
              snapshotBlock: Number(a.snapshotBlock),
              snapshotHash: a.snapshotHash,
              seed: a.seed,
              eligible: [],
              winner: lc(a.winner),
              hashFormat: 'eligible list not available on this server',
            });
          }
          const prev = await this.repo.getPull(id);
          if (prev) await this.ledger.pull({ ...prev, result: 'WON', winner: lc(a.winner), txHash: tx, timestamp: ts });
          return;
        }
        case 'ProceedsDeposited': {
          const prev = await this.repo.getPull(id);
          const burnedOnly = a.toBurn > 0n && a.toDiv === 0n && a.toPot === 0n && a.toLp === 0n;
          if (prev) await this.ledger.pull({ ...prev, result: burnedOnly ? 'BURNED' : 'SOLD', proceedsBnb: bnb(a.amount), txHash: tx, timestamp: ts });
          if (a.toPot > 0n) await this.ledger.updateMachine(token, (m) => ({ potUsd: round2(m.potUsd + bnb(a.toPot) * px) }));
          return;
        }
        case 'DividendRootSet': {
          const total = bnb(a.totalBnb);
          const next = await this.ledger.updateMachine(token, (m) => ({ paidToHoldersBnb: Math.round((m.paidToHoldersBnb + total) * 1e6) / 1e6 }));
          if (next) await this.ledger.payout(next, total, px, next.eligibleHolders, ts);
          return;
        }
        case 'DividendClaimed':
          await this.repo.debitClaimable(token, a.account, bnb(a.amount));
          return;
        case 'BuybackBurn':
        case 'LpShareBurned': {
          const tokens = bnb(a.tokensBurned); // 18 decimals
          await this.ledger.machineBurn(token, tokens, bnb(a.bnbSpent) * px, ts);
          return;
        }
      }
      return;
    }

    // $FORGE BuybackBurner (platform 3% tax share)
    if (this.buybackBurner && addr === this.buybackBurner) {
      if (l.eventName === 'Buyback') {
        await this.ledger.burn({ id: `${tx}-${l.logIndex}`, kind: 'BUYBACK', amount: bnb(a.forgeBought), txHash: tx, timestamp: ts }, bnb(a.bnbSpent) * px);
      } else if (l.eventName === 'Burn') {
        await this.ledger.burn({ id: `${tx}-${l.logIndex}`, kind: 'BURN', amount: bnb(a.amount), txHash: tx, timestamp: ts }, 0);
      }
      return;
    }

    // flap.sh Portal / VaultPortal events, filtered to our tokens
    const subject = a.token ? lc(a.token) : null;
    if (!subject || !this.tokens.has(subject)) return;
    switch (l.eventName) {
      case 'TokenBought':
      case 'TokenSold': {
        const m = await this.repo.getMachine(subject);
        if (!m) return;
        const eth = bnb(a.eth);
        const side = l.eventName === 'TokenBought' ? 'BUY' : 'SELL';
        const trade = {
          side,
          trader: lc(side === 'BUY' ? a.buyer : a.seller),
          amountBnb: eth,
          tokens: bnb(a.amount),
          taxUsd: feeSplit(eth * px, m.taxBps).taxUsd,
          txHash: tx,
          timestamp: Number(a.ts) || ts,
        } as const;
        await this.ledger.trade(subject, trade);
        // TODO: proper rolling 24h volume/change windows; postPrice is quote-wei per token-wei*1e18 [UNVERIFIED scale]
        const priceBnb = bnb(a.postPrice);
        // Fee event + pot estimate (pending until the vault's TaxReceived), folded into one machine update.
        await this.ledger.recordFee(subject, trade, px, {
          id: `${tx}-${l.logIndex}`,
          pending: true,
          patch: (m) => ({ volume24hUsd: round2(m.volume24hUsd + eth * px), marketCapUsd: round2(priceBnb * 1e9 * px) }),
        });
        return;
      }
      case 'FlapTokenProgressChanged':
        await this.ledger.updateMachine(subject, () => ({ bondingCurvePct: Math.min(100, round2(bnb(a.newProgress) * 100)) }));
        return;
      case 'LaunchedToDEX':
        await addPool(this.repo, subject, a.pool);
        await this.ledger.updateMachine(subject, () => ({ stage: 'GRADUATED', bondingCurvePct: 100 }));
        this.log.info({ token: subject, pool: a.pool }, 'machine graduated to DEX');
        return;
      case 'TaxTokenAddressesUpdated':
      case 'TokenVaultRefreshed': {
        const m = await this.repo.getMachine(subject);
        const detail =
          l.eventName === 'TaxTokenAddressesUpdated'
            ? `beneficiary=${a.beneficiary} feeReceiver=${a.feeReceiver}`
            : `vault ${a.oldVault} → ${a.newVault}`;
        this.log.warn({ token: subject, event: l.eventName, tx, detail }, 'ALERT: flap.sh admin re-routed tax recipient');
        const alerts = JSON.parse((await this.repo.getMeta('alerts')) ?? '[]');
        alerts.push({ token: subject, event: l.eventName, detail, txHash: tx, timestamp: ts });
        await this.repo.setMeta('alerts', JSON.stringify(alerts.slice(-200)));
        // ActivityKind has no ALERT in SPEC; surface as a TAX-kind feed item with explicit text.
        if (m) await this.ledger.activity(m, 'TAX', `⚠ tax recipient re-routed by flap.sh admin (${detail})`, undefined, ts);
        return;
      }
    }
  }

  /** Refresh holder / eligible counts after balance changes. */
  async refreshHolderCounts(token: string) {
    const m = await this.repo.getMachine(token);
    if (!m) return;
    const balances = await this.repo.getBalances(token);
    const excluded = await excludedFor(this.repo, m, [this.chain.factory, this.chain.portal, this.chain.vaultPortal, ...this.cfg.EXCLUDED_ADDRESSES]);
    const ex = new Set(excluded);
    const holders = balances.filter((b) => !ex.has(b.address)).length;
    const eligible = selectEligible(balances, { totalSupply: TOTAL_SUPPLY_DEFAULT, excluded }).length;
    if (holders !== m.holders || eligible !== m.eligibleHolders) await this.ledger.updateMachine(token, () => ({ holders, eligibleHolders: eligible }));
  }

  /** Periodic reconciliation from Portal.getTokenV8Safe (status/progress/pool). */
  async syncFlapState(token: string) {
    const s = await this.chain.publicClient.readContract({ address: this.chain.portal, abi: portalAbi, functionName: 'getTokenV8Safe', args: [token as `0x${string}`] });
    const graduated = Number(s.status) === FLAP_STATUS.DEX;
    if (graduated && s.pool !== '0x0000000000000000000000000000000000000000') await addPool(this.repo, token, s.pool);
    await this.ledger.updateMachine(token, (m) => ({
      stage: graduated ? 'GRADUATED' : m.stage,
      bondingCurvePct: graduated ? 100 : Math.min(100, round2(bnb(s.progress) * 100)),
    }));
  }
}

