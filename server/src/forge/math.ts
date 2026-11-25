import { formatUnits } from 'viem';
import type { Candle, ForgeTrade } from './types.js';

export const wad = (x: bigint, decimals = 18) => Number(formatUnits(x, decimals));
export const round = (n: number, dp: number) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : 0);
/** Significant-figure rounding for tiny prices. */
export const sig = (n: number, digits = 6) => (Number.isFinite(n) && n !== 0 ? Number(n.toPrecision(digits)) : 0);

/** Chainlink answer (8 decimals) → USD. */
export const chainlinkUsd = (answer: bigint) => Number(answer) / 1e8;

/** getTokenV8Safe.price is quote-per-token scaled by 1e18 (curve: (y+r)²/K). */
export const curvePrice = (priceWad: bigint) => wad(priceWad);

/** Spot price (quote per token) from V2 reserves; both sides 18 decimals on BSC. */
export function pairPrice(reserve0: bigint, reserve1: bigint, forgeIsToken0: boolean): number {
  const [t, q] = forgeIsToken0 ? [reserve0, reserve1] : [reserve1, reserve0];
  return t === 0n ? 0 : wad(q) / wad(t);
}

/** PancakeSwap V2 Swap → $FORGE side and amounts, from the pair's point of view. */
export function decodePairSwap(a: { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint }, forgeIsToken0: boolean): { side: 'BUY' | 'SELL'; tokensWei: bigint; quoteWei: bigint } | null {
  const [tIn, tOut, qIn, qOut] = forgeIsToken0 ? [a.amount0In, a.amount0Out, a.amount1In, a.amount1Out] : [a.amount1In, a.amount1Out, a.amount0In, a.amount0Out];
  if (tOut > 0n && qIn > 0n) return { side: 'BUY', tokensWei: tOut, quoteWei: qIn };
  if (tIn > 0n && qOut > 0n) return { side: 'SELL', tokensWei: tIn, quoteWei: qOut };
  return null;
}

/** Trade value fields. quoteUsd = USD per quote unit (BNB/USD for native, 1 for stables). */
export function tradeValues(tokensWei: bigint, quoteWei: bigint, quoteUsd: number, bnbUsd: number) {
  const tokens = wad(tokensWei);
  const quote = wad(quoteWei);
  const usd = quote * quoteUsd;
  return { tokens: round(tokens, 4), amountBnb: round(bnbUsd > 0 ? usd / bnbUsd : 0, 8), priceUsd: tokens > 0 ? sig(usd / tokens, 8) : 0 };
}

export const marketCap = (supply: number, priceUsd: number) => round(supply * priceUsd, 2);

/** 24h volume (Σ tokens × trade price) and change vs the last trade before the window (else the first inside it). */
export function stats24h(trades: Pick<ForgeTrade, 'timestamp' | 'tokens' | 'priceUsd'>[], priceNowUsd: number, now: number, before?: Pick<ForgeTrade, 'priceUsd'> | null) {
  const since = now - 86_400;
  const win = trades.filter((t) => t.timestamp >= since).sort((a, b) => a.timestamp - b.timestamp);
  const volume24hUsd = round(
    win.reduce((s, t) => s + t.tokens * t.priceUsd, 0),
    2,
  );
  const ref = before?.priceUsd || win[0]?.priceUsd || 0;
  const change24hPct = ref > 0 && priceNowUsd > 0 ? round((priceNowUsd / ref - 1) * 100, 2) : 0;
  return { volume24hUsd, change24hPct };
}

/**
 * OHLCV (USD price, USD volume) buckets of `intervalSec`, oldest first. Gaps between the first and last
 * bucket (or `until`) are forward-filled with flat zero-volume candles. Keeps the newest `limit`.
 */
export function buildCandles(trades: Pick<ForgeTrade, 'timestamp' | 'tokens' | 'priceUsd'>[], intervalSec: number, opts: { limit?: number; until?: number } = {}): Candle[] {
  const limit = opts.limit ?? 500;
  const sorted = trades.filter((t) => t.priceUsd > 0).sort((a, b) => a.timestamp - b.timestamp);
  if (!sorted.length) return [];
  const byT = new Map<number, Candle>();
  for (const tr of sorted) {
    const t = Math.floor(tr.timestamp / intervalSec) * intervalSec;
    const c = byT.get(t);
    const v = tr.tokens * tr.priceUsd;
    if (!c) byT.set(t, { t, o: tr.priceUsd, h: tr.priceUsd, l: tr.priceUsd, c: tr.priceUsd, v });
    else {
      c.h = Math.max(c.h, tr.priceUsd);
      c.l = Math.min(c.l, tr.priceUsd);
      c.c = tr.priceUsd;
      c.v += v;
    }
  }
  const first = Math.floor(sorted[0].timestamp / intervalSec) * intervalSec;
  const lastTrade = Math.floor(sorted[sorted.length - 1].timestamp / intervalSec) * intervalSec;
  const last = opts.until !== undefined ? Math.max(lastTrade, Math.floor(opts.until / intervalSec) * intervalSec) : lastTrade;
  const start = Math.max(first, last - (limit - 1) * intervalSec);
  const out: Candle[] = [];
  // Close of the newest bucket before `start` seeds the forward fill.
  let prev: number | null = null;
  for (const tr of sorted) if (tr.timestamp < start) prev = tr.priceUsd;
  for (let t = start; t <= last; t += intervalSec) {
    const c = byT.get(t);
    if (c) {
      out.push({ ...c, v: round(c.v, 2) });
      prev = c.c;
    } else if (prev !== null) out.push({ t, o: prev, h: prev, l: prev, c: prev, v: 0 });
  }
  return out;
}
