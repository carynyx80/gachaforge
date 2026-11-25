import { randomUUID } from 'node:crypto';
import type { Bus } from './bus.js';
import { feeSplit } from './core/packs.js';
import type { Repository } from './store/repository.js';
import type { ActivityEvent, ActivityKind, BurnEvent, FeeEvent, Machine, Pull, RaffleProof, Stats, Trade } from './types.js';

export const now = () => Math.floor(Date.now() / 1000);
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Write-side domain service shared by the chain indexer, operator and mock simulator.
 * Persists via Repository and broadcasts over the Bus.
 */
export class Ledger {
  private statsTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly repo: Repository,
    readonly bus: Bus,
  ) {}

  async stats(): Promise<Stats> {
    const machines = await this.repo.listMachines();
    return {
      potsUsd: round2(machines.reduce((s, m) => s + m.potUsd, 0)),
      packsOpened: machines.reduce((s, m) => s + m.packsOpened, 0),
      cardsAwarded: await this.repo.getCounter('cardsAwarded'),
      burnedUsd: round2(await this.repo.getCounter('burnedUsd')),
      launches: machines.length,
    };
  }

  /** Coalesces stats pushes to at most one per 500ms. */
  scheduleStats() {
    if (this.statsTimer) return;
    this.statsTimer = setTimeout(async () => {
      this.statsTimer = null;
      try {
        this.bus.publish({ type: 'stats', data: await this.stats() });
      } catch {
        /* ignore */
      }
    }, 500);
    this.statsTimer.unref?.();
  }

  async activity(m: Pick<Machine, 'address' | 'ticker'>, kind: ActivityKind, text: string, amountUsd?: number, ts = now()) {
    const e: ActivityEvent = { id: randomUUID(), ticker: m.ticker, machine: m.address.toLowerCase(), timestamp: ts, kind, text };
    if (amountUsd !== undefined) e.amountUsd = round2(amountUsd);
    await this.repo.addActivity(e);
    this.bus.publish({ type: 'activity', data: e });
    return e;
  }

  async saveMachine(m: Machine, broadcast = true) {
    await this.repo.upsertMachine(m);
    if (broadcast) this.bus.publish({ type: 'machine', data: (await this.repo.getMachine(m.address))! });
    this.scheduleStats();
  }

  async launch(m: Machine) {
    await this.saveMachine(m);
    await this.activity(m, 'NEW_MACHINE', `$${m.ticker} launched · ${m.pack} · ${m.strategy}`, undefined, m.createdAt);
  }

  async updateMachine(address: string, patch: (m: Machine) => Partial<Machine>) {
    const m = await this.repo.getMachine(address);
    if (!m) return null;
    const next = { ...m, ...patch(m) };
    await this.saveMachine(next);
    return next;
  }

  /**
   * Live fee flow: one trade → FeeEvent (tax × split constants, USD at `bnbUsd`). The pot share is added to the machine's
   * potUsd right away as an estimate (potUsd = on-chain pot + pending estimate) and broadcast via the `machine` update;
   * the event itself goes out as `{ type: 'fee' }`. `patch` lets the caller fold other machine changes into the same update.
   * Returns null for unknown machines or an already-recorded id (indexer replay).
   */
  async recordFee(
    address: string,
    t: Trade,
    bnbUsd: number,
    opts: { id?: string; pending?: boolean; patch?: (m: Machine) => Partial<Machine> } = {},
  ): Promise<FeeEvent | null> {
    const m0 = await this.repo.getMachine(address);
    if (!m0) return null;
    const split = feeSplit(t.amountBnb * bnbUsd, m0.taxBps);
    const e: FeeEvent = {
      id: opts.id ?? `${t.txHash}-${randomUUID().slice(0, 8)}`,
      machine: m0.address.toLowerCase(),
      ticker: m0.ticker,
      side: t.side,
      trader: t.trader.toLowerCase(),
      amountBnb: t.amountBnb,
      txHash: t.txHash,
      timestamp: t.timestamp,
      ...split,
      potAfterUsd: round2(m0.potUsd + split.potUsd),
      packPriceUsd: m0.packPriceUsd,
      pending: opts.pending ?? true,
    };
    if (!(await this.repo.addFeeEvent(e))) return null;
    const m = await this.updateMachine(address, (m) => ({ ...opts.patch?.(m), potUsd: round2(m.potUsd + split.potUsd) }));
    if (m) {
      e.potAfterUsd = m.potUsd;
      e.packPriceUsd = m.packPriceUsd;
    }
    this.bus.publish({ type: 'fee', data: e });
    return e;
  }

  /** Mock mode: mark fee events synced without touching the pot (the simulated pot is already exact). */
  async settleFees(address: string, upTo: number) {
    return this.repo.settleFeeEvents(address, upTo);
  }

  /**
   * Vault TaxReceived (live): the real pot share has landed. Fee events up to `ts` stop being pending, their estimate is
   * removed and the real amount added, so potUsd reconciles to the on-chain pot (+ any still-pending estimate).
   */
  async taxReceived(address: string, totalUsd: number, potUsd: number, ts = now()) {
    const settled = await this.repo.settleFeeEvents(address, ts);
    const estimate = settled.reduce((s, e) => s + e.potUsd, 0);
    const m = await this.updateMachine(address, (m) => ({ potUsd: round2(Math.max(0, m.potUsd - estimate) + potUsd) }));
    if (m) await this.activity(m, 'TAX', `tax ${usd(potUsd)} → gacha pot`, totalUsd, ts);
    return m;
  }

  /** Keeper reconcile from vault.pot(): potUsd = on-chain pot + still-pending fee estimate. */
  async reconcilePot(address: string, onChainPotUsd: number) {
    const pending = await this.repo.pendingFeePotUsd(address);
    const target = round2(onChainPotUsd + pending);
    const m = await this.repo.getMachine(address);
    if (!m || m.potUsd === target) return m;
    return this.updateMachine(address, () => ({ potUsd: target }));
  }

  async trade(address: string, t: Trade) {
    await this.repo.addTrade(address, t);
  }

  async pull(p: Pull, proof?: RaffleProof) {
    if (proof) await this.repo.setRaffleProof(proof);
    await this.repo.upsertPull(p);
    const saved = (await this.repo.getPull(p.id))!;
    this.bus.publish({ type: 'pull', data: saved });
    if (p.result === 'WON') {
      await this.repo.incrCounter('cardsAwarded', 1);
      await this.activity(
        { address: p.machine, ticker: p.ticker },
        'PULL_WON',
        `${p.card.grader} ${p.card.grade} ${p.card.name} won by ${short(p.winner ?? '')}`,
        p.card.valueUsd,
        p.timestamp,
      );
    } else {
      await this.activity(
        { address: p.machine, ticker: p.ticker },
        'PULL_SOLD',
        `${p.card.name} sold back${p.proceedsBnb ? ` for ${p.proceedsBnb.toFixed(4)} BNB` : ''}`,
        p.card.valueUsd,
        p.timestamp,
      );
    }
    this.scheduleStats();
    return saved;
  }

  /** Platform $FORGE buyback/burn — listed on /api/burns. */
  async burn(b: BurnEvent, usdValue: number) {
    await this.repo.addBurn(b);
    await this.repo.incrCounter('burnedUsd', usdValue);
    this.scheduleStats();
  }

  /** Machine-token burn (BURN / HIT_HUNTER / SPLIT strategies): counts toward Stats.burnedUsd + machine.burnedTokens, not /api/burns. */
  async machineBurn(address: string, tokens: number, usdValue: number, ts = now(), opts: { updateMachine?: boolean } = {}) {
    await this.repo.incrCounter('burnedUsd', usdValue);
    const m =
      opts.updateMachine === false
        ? await this.repo.getMachine(address)
        : await this.updateMachine(address, (m) => ({ burnedTokens: round2(m.burnedTokens + tokens) }));
    if (m) await this.activity(m, 'BURN', `bought back & burned ${fmtTokens(tokens)} $${m.ticker}`, usdValue, ts);
  }

  async payout(m: Pick<Machine, 'address' | 'ticker'>, bnb: number, bnbUsd: number, holders: number, ts = now()) {
    await this.activity(m, 'PAYOUT', `${bnb.toFixed(4)} BNB paid to ${holders} holders`, bnb * bnbUsd, ts);
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const short = (a: string) => (a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
