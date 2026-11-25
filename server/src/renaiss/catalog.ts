import { PACK_PRICE_USD } from '../core/packs.js';
import type { Logger } from '../log.js';
import { PACKS, type PackId } from '../types.js';
import type { RenaissClient } from './client.js';
import { ONE_USDT, type RenaissNetwork } from './networks.js';
import type { BuybackTier } from './schemas.js';

export interface ResolvedPack {
  pack: PackId;
  slug: string;
  /** Catalog UUID (prepare's `packId`). */
  id: string;
  /** bytes32 pack id inside the Permit2 witness. */
  onChainPackId: string;
  priceInUsdt: bigint;
  vendingMachine: string;
  /** Longest buyback window = when Renaiss releases the NFT to the buyer wallet. */
  releaseAfterSeconds: number;
  buybackConfig: { buybackPercentage: number; buybackExpiredInSeconds: number }[];
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

export const expectedPriceUsdt = (pack: PackId) => BigInt(PACK_PRICE_USD[pack]) * ONE_USDT;

/**
 * Resolves FORGE_28/48/88 → Renaiss slug → catalog UUID + on-chain pack id + USDT price, at runtime.
 * Cached for `ttlMs`; a refresh that finds a missing slug, inactive pack, wrong vending machine or a price
 * different from our USD tier throws (and the stale entry is dropped so nothing is bought at a wrong price).
 */
export class RenaissCatalog {
  private cache = new Map<PackId, ResolvedPack>();
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private client: Pick<RenaissClient, 'getPack'>,
    private network: Pick<RenaissNetwork, 'slugs' | 'vendingMachine' | 'name'>,
    private log?: Logger,
    private ttlMs = 5 * 60_000,
    private now: () => number = Date.now,
  ) {}

  async resolve(pack: PackId): Promise<ResolvedPack> {
    if (!this.cache.has(pack) || this.now() - this.fetchedAt > this.ttlMs) await this.refresh();
    const r = this.cache.get(pack);
    if (!r) throw new CatalogError(`Renaiss catalog: ${pack} not resolved`);
    return r;
  }

  refresh(): Promise<void> {
    this.inflight ??= this.doRefresh().finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async doRefresh() {
    const next = new Map<PackId, ResolvedPack>();
    const problems: string[] = [];
    for (const pack of PACKS) {
      const slug = this.network.slugs[pack];
      try {
        const { cardPack: p } = await this.client.getPack(slug);
        const want = expectedPriceUsdt(pack);
        if (p.slug !== slug) problems.push(`${slug}: catalog returned slug ${p.slug}`);
        else if (p.stage !== 'active') problems.push(`${slug}: stage is ${p.stage}, not active`);
        else if (BigInt(p.priceInUsdt) !== want) problems.push(`${slug}: price ${p.priceInUsdt} != expected ${want} (${PACK_PRICE_USD[pack]} USDT)`);
        else if (p.vendingMachineAddress.toLowerCase() !== this.network.vendingMachine.toLowerCase())
          problems.push(`${slug}: vending machine ${p.vendingMachineAddress} != ${this.network.vendingMachine}`);
        else
          next.set(pack, {
            pack,
            slug,
            id: p.id,
            onChainPackId: p.onChainPackId,
            priceInUsdt: want,
            vendingMachine: p.vendingMachineAddress,
            releaseAfterSeconds: Math.max(0, ...p.buybackConfig.map((b) => b.buybackExpiredInSeconds)),
            buybackConfig: p.buybackConfig,
          });
      } catch (err) {
        const status = (err as { status?: number }).status;
        problems.push(status === 404 ? `${slug}: slug not found (404)` : `${slug}: ${String((err as Error).message ?? err)}`);
      }
    }
    this.cache = next;
    this.fetchedAt = this.now();
    if (problems.length) {
      const msg = `Renaiss catalog (${this.network.name}) check failed: ${problems.join('; ')}`;
      this.log?.error({ problems }, msg);
      throw new CatalogError(msg);
    }
    this.log?.info({ packs: [...next.values()].map((p) => ({ pack: p.pack, slug: p.slug, id: p.id })) }, 'renaiss catalog resolved');
  }
}

/** First tier whose expiresAt is still in the future (same rule as the SDK's getEoaBuybackTierAt). */
export function currentTier(tiers: BuybackTier[], nowMs = Date.now()): BuybackTier | undefined {
  return tiers.find((t) => Date.parse(t.expiresAt) >= nowMs);
}
