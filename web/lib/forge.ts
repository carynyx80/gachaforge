import { API_URL } from './api';

/** SPEC.md "$FORGE token page". */
export interface ForgeToken {
  address: string; name: string; symbol: string; image?: string; description?: string;
  links?: { website?: string; x?: string; telegram?: string };
  creator: string; createdAt: number; createdTx: string;
  stage: 'CURVE' | 'GRADUATED'; bondingCurvePct: number; pool?: string;
  priceUsd: number; priceBnb: number; marketCapUsd: number; change24hPct: number; volume24hUsd: number;
  holders: number; buyTaxBps: number; sellTaxBps: number; taxRecipient?: string;
  burnedTokens: number;
  buybackPendingBnb: number;
  buybackTotalBnb: number;
  /** Set by the backend when FORGE_PREVIEW=true (flagged sample token). */
  preview?: boolean;
}
export interface ForgeState {
  status: 'waiting' | 'live';
  deployer?: string;
  token?: ForgeToken;
  preview?: boolean;
  /** Optional while waiting: BNB already sitting in the BuybackBurner. */
  buybackPendingBnb?: number;
  buybackTotalBnb?: number;
}
export interface ForgeTrade {
  side: 'BUY' | 'SELL'; trader: string; amountBnb: number; tokens: number; priceUsd: number; txHash: string; timestamp: number;
}
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTERVAL_SEC: Record<Interval, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

export const FORGE_SUPPLY = 1_000_000_000;
export const DEAD = '0x000000000000000000000000000000000000dEaD';
export const flapTokenUrl = (a: string) => `https://flap.sh/bnb/${a}`;
export const pancakeUrl = (a: string) => `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${a}`;
export const isPreview = (s?: ForgeState | null) => !!(s?.preview || s?.token?.preview);

async function tryGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
export const fetchForge = () => tryGet<ForgeState>('/forge');
export const fetchForgeTrades = (limit = 40) => tryGet<ForgeTrade[]>(`/forge/trades?limit=${limit}`);
export const fetchForgeCandles = (interval: Interval) => tryGet<Candle[]>(`/forge/candles?interval=${interval}`);

/** Fold a trade into a candle series (in place-safe: returns a new array). */
export function applyTrade(candles: Candle[], tr: ForgeTrade, interval: Interval): Candle[] {
  const step = INTERVAL_SEC[interval];
  const t = Math.floor(tr.timestamp / step) * step;
  const p = tr.priceUsd;
  if (!(p > 0)) return candles;
  const last = candles[candles.length - 1];
  const vol = tr.amountBnb;
  if (last && last.t === t) {
    return [...candles.slice(0, -1), { ...last, h: Math.max(last.h, p), l: Math.min(last.l, p), c: p, v: last.v + vol }];
  }
  if (last && t < last.t) return candles;
  const o = last ? last.c : p;
  return [...candles, { t, o, h: Math.max(o, p), l: Math.min(o, p), c: p, v: vol }].slice(-500);
}

/** "$0.0₅1234" style for tiny prices. */
export function priceFmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (n >= 0.001) return '$' + n.toFixed(6).replace(/0+$/, '');
  const s = n.toFixed(20).slice(2);
  const zeros = s.match(/^0*/)![0].length;
  const sig = s.slice(zeros, zeros + 4).replace(/0+$/, '');
  const sub = String(zeros).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]).join('');
  return `$0.0${sub}${sig}`;
}
export const compact = (n: number, d = 1) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: d }).format(n);
export const bnbFmt = (n: number, d = 4) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : d, minimumFractionDigits: n > 0 && n < 1 ? 2 : 0 });

// ---------------------------------------------------------------------------------------------
// Dev-only fixture: `/forge?fixture=preview|waiting` when NODE_ENV !== 'production'.
// Used for design while the backend endpoints are not deployed. Never active in production builds.
// ---------------------------------------------------------------------------------------------
export const FIXTURE_ALLOWED = process.env.NODE_ENV !== 'production';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');

export function fixtureState(kind: 'preview' | 'waiting', now = Math.floor(Date.now() / 1000)): ForgeState {
  if (kind === 'waiting') return { status: 'waiting', deployer: '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c', buybackPendingBnb: 1.8432, buybackTotalBnb: 0 };
  return {
    status: 'live', deployer: '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c', preview: true,
    token: {
      address: '0xf0f9e5c3a1b2d4e6f8a0c2e4b6d8f0a2c4e67777', name: 'GachaForge', symbol: 'FORGE',
      description: 'The GachaForge platform token. 3% of every machine tax buys it back and burns it.',
      links: { website: 'https://gachaforge.xyz', x: 'https://x.com/gachaforge', telegram: 'https://t.me/gachaforge' },
      creator: '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c', createdAt: now - 3 * 86400, createdTx: '0x' + 'a1'.repeat(32),
      stage: 'CURVE', bondingCurvePct: 63.4,
      priceUsd: 0.00004182, priceBnb: 0.0000000672, marketCapUsd: 41_820, change24hPct: 18.7, volume24hUsd: 96_400,
      holders: 1284, buyTaxBps: 300, sellTaxBps: 300, burnedTokens: 12_480_000,
      buybackPendingBnb: 0.4213, buybackTotalBnb: 6.92, preview: true,
    },
  };
}

export function fixtureCandles(interval: Interval, now = Math.floor(Date.now() / 1000)): Candle[] {
  const step = INTERVAL_SEC[interval];
  const r = rng(step);
  const n = 90;
  const end = Math.floor(now / step) * step;
  let p = 0.00002;
  const out: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const o = p;
    const drift = 1 + (r() - 0.44) * 0.09;
    const c = Math.max(1e-6, o * drift);
    const h = Math.max(o, c) * (1 + r() * 0.03);
    const l = Math.min(o, c) * (1 - r() * 0.03);
    out.push({ t: end - i * step, o, h, l, c, v: 0.2 + r() * 4 });
    p = c;
  }
  // Land on the fixture price.
  const k = 0.00004182 / p;
  return out.map((x) => ({ ...x, o: x.o * k, h: x.h * k, l: x.l * k, c: x.c * k }));
}

let fxSeed = 7;
export function fixtureTrade(priceUsd: number, ts = Math.floor(Date.now() / 1000)): ForgeTrade {
  const r = rng(fxSeed++ * 7919);
  const side = r() > 0.4 ? 'BUY' : 'SELL';
  const amountBnb = Number((0.02 + r() * r() * 2).toFixed(4));
  const p = priceUsd * (1 + (side === 'BUY' ? 1 : -1) * r() * 0.006);
  return { side, trader: '0x' + hex(r, 40), amountBnb, tokens: (amountBnb * 620) / p, priceUsd: p, txHash: '0x' + hex(r, 64), timestamp: ts };
}
export function fixtureTrades(priceUsd: number, n = 24, now = Math.floor(Date.now() / 1000)): ForgeTrade[] {
  return Array.from({ length: n }, (_, i) => fixtureTrade(priceUsd, now - i * 47 - 5));
}
