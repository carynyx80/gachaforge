import type { Ledger } from '../ledger.js';
import { now as nowSec, short } from '../ledger.js';
import type { Logger } from '../log.js';
import type { CardProvider, ProviderCard } from '../renaiss/types.js';
import type { CardRelease } from '../types.js';
import { sameAddr } from '../evm.js';

export interface ReleaseJobOptions {
  intervalMs?: number;
  /** Re-check cadence while the card is still inside the provider's buyback window. */
  notReleasedRecheckSec?: number;
  /** Transfer retry backoff: base * 2^attempts, capped. */
  retryBaseSec?: number;
  retryMaxSec?: number;
  maxAttempts?: number;
  batch?: number;
  now?: () => number;
}

/** Queue a raffle win for delivery once the provider releases the NFT (one row per card). */
export async function enqueueCardReleases(
  ledger: Ledger,
  p: { pullKey: string; machine: string; ticker: string; winner: string; cards: Pick<ProviderCard, 'tokenId' | 'name' | 'releaseAt'>[] },
  t = nowSec(),
) {
  for (const c of p.cards) {
    const existing = await ledger.repo.getCardRelease(p.pullKey, c.tokenId);
    if (existing) continue;
    const releaseAt = c.releaseAt ?? t;
    await ledger.repo.upsertCardRelease({
      pullKey: p.pullKey,
      tokenId: c.tokenId,
      machine: p.machine,
      ticker: p.ticker,
      winner: p.winner,
      cardName: c.name,
      releaseAt,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: releaseAt,
      createdAt: t,
      updatedAt: t,
    });
  }
}

/**
 * Delivers raffled cards: waits until the provider has released the NFT to the operator wallet (Renaiss: end of
 * the 72h buyback window), then transfers it to the winner. Retries with backoff; FAILED after maxAttempts.
 */
export class ReleaseJob {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private o: Required<ReleaseJobOptions>;

  constructor(
    private ledger: Ledger,
    private provider: Pick<CardProvider, 'releaseStatus' | 'transferCard'>,
    private log: Logger,
    opts: ReleaseJobOptions = {},
  ) {
    this.o = {
      intervalMs: opts.intervalMs ?? 60_000,
      notReleasedRecheckSec: opts.notReleasedRecheckSec ?? 300,
      retryBaseSec: opts.retryBaseSec ?? 60,
      retryMaxSec: opts.retryMaxSec ?? 3600,
      maxAttempts: opts.maxAttempts ?? 10,
      batch: opts.batch ?? 20,
      now: opts.now ?? nowSec,
    };
  }

  start() {
    const run = () => void this.tick().catch((err) => this.log.error({ err }, 'release job tick failed'));
    run();
    this.timer = setInterval(run, this.o.intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const r of await this.ledger.repo.listDueCardReleases(this.o.now(), this.o.batch)) await this.process(r);
    } finally {
      this.running = false;
    }
  }

  async process(r: CardRelease) {
    const t = this.o.now();
    const save = (patch: Partial<CardRelease>) => this.ledger.repo.upsertCardRelease({ ...r, ...patch, updatedAt: t });
    try {
      const st = await this.provider.releaseStatus({ tokenId: r.tokenId, releaseAt: r.releaseAt });
      if (st.owner && sameAddr(st.owner, r.winner)) return this.delivered(r, save, r.txHash ?? 'already-owned');
      if (!st.released) {
        if (t > r.releaseAt + 86_400) this.log.warn({ pullKey: r.pullKey, tokenId: r.tokenId, owner: st.owner }, 'card still not released >24h after its window');
        return save({ nextAttemptAt: t + this.o.notReleasedRecheckSec });
      }
      const txHash = await this.provider.transferCard(r.tokenId, r.winner);
      return this.delivered(r, save, txHash);
    } catch (err) {
      const attempts = r.attempts + 1;
      const failed = attempts >= this.o.maxAttempts;
      this.log[failed ? 'error' : 'warn']({ err, pullKey: r.pullKey, tokenId: r.tokenId, attempts }, failed ? 'card delivery FAILED permanently' : 'card delivery failed; will retry');
      return save({
        attempts,
        status: failed ? 'FAILED' : 'PENDING',
        lastError: String((err as Error)?.message ?? err).slice(0, 500),
        nextAttemptAt: t + Math.min(this.o.retryMaxSec, this.o.retryBaseSec * 2 ** (attempts - 1)),
      });
    }
  }

  private async delivered(r: CardRelease, save: (p: Partial<CardRelease>) => Promise<void>, txHash: string) {
    await save({ status: 'DELIVERED', txHash, lastError: undefined });
    await this.ledger.activity({ address: r.machine, ticker: r.ticker }, 'PULL_WON', `card delivered to ${short(r.winner)} · ${r.cardName}`);
    this.log.info({ pullKey: r.pullKey, tokenId: r.tokenId, winner: r.winner, txHash }, 'card delivered');
  }
}
