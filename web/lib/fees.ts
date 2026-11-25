import { API_URL } from './api';

/** SPEC.md "Live fee flow": one per trade, pushed on /ws as { type: 'fee', data: FeeEvent }. */
export interface FeeEvent {
  id: string;
  machine: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  trader: string;
  amountBnb: number;
  txHash: string;
  timestamp: number;
  taxUsd: number;
  flapUsd: number;
  /** TAX MODEL v3: = companyUsd (GachaForge company 5% of the tax that reaches GachaForge). */
  platformUsd: number;
  potUsd: number;
  buybackUsd: number;
  /** TAX MODEL v3: creator payout share of this trade (0 / absent for $FORGE and pre-v3 events). */
  creatorUsd?: number;
  /** TAX MODEL v3: GachaForge company share (falls back to platformUsd). */
  companyUsd?: number;
  potAfterUsd: number;
  packPriceUsd: number;
  pending: boolean;
}

export interface FeeTotals {
  totalTaxUsd: number;
  flapUsd: number;
  platformUsd: number;
  potUsd: number;
  buybackUsd: number;
  /** TAX MODEL v3: paid / owed to creators. */
  creatorUsd?: number;
}
export interface FeeSummary extends FeeTotals {
  last24h: FeeTotals;
}

/** Client-side fetches. Return null (not throw) while the endpoint is not deployed yet so callers can keep polling. */
async function tryGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchRecentFees(machine?: string, limit = 30): Promise<FeeEvent[] | null> {
  const p = new URLSearchParams({ limit: String(limit) });
  if (machine) p.set('machine', machine);
  const r = await tryGet<FeeEvent[] | { items: FeeEvent[] }>(`/fees/recent?${p}`);
  if (!r) return null;
  return Array.isArray(r) ? r : Array.isArray(r.items) ? r.items : null;
}

export const fetchFeeSummary = () => tryGet<FeeSummary>('/fees/summary');

export function addToTotals(t: FeeTotals, e: FeeEvent): FeeTotals {
  return {
    totalTaxUsd: t.totalTaxUsd + e.taxUsd,
    flapUsd: t.flapUsd + e.flapUsd,
    platformUsd: t.platformUsd + e.platformUsd,
    potUsd: t.potUsd + e.potUsd,
    buybackUsd: t.buybackUsd + e.buybackUsd,
    creatorUsd: (t.creatorUsd ?? 0) + (e.creatorUsd ?? 0),
  };
}

/** Company share of an event (v3 companyUsd, else platformUsd). */
export const companyOf = (e: Pick<FeeEvent, 'platformUsd' | 'companyUsd'>) => e.companyUsd ?? e.platformUsd;

/** Small-dollar formatter: fees are often cents. */
export const feeUsd = (n: number) =>
  '$' + (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n >= 1 ? n.toFixed(2) : n.toFixed(n >= 0.01 || n === 0 ? 2 : 4));
