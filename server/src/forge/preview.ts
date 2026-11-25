import type { ForgeToken, StoredForgeTrade } from './types.js';
import { buildCandles, marketCap, round, sig, stats24h } from './math.js';

/** Clearly fake address (no such flap token); `preview: true` is set on everything served from here. */
export const PREVIEW_ADDRESS = '0x0000000000000000000000000000000000007777';
const SUPPLY = 1_000_000_000;
const BNB_USD = 600;

/** mulberry32 — deterministic so the preview looks the same on each restart. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simulated $FORGE (FORGE_PREVIEW=true, nothing discovered yet) so the frontend can be designed. */
export class ForgePreview {
  readonly trades: StoredForgeTrade[] = [];
  private price = 0.0000042;
  private rand: () => number;
  private n = 0;
  private holders = 180;
  private burned = 1_250_000;
  private buybackTotal = 0.42;

  constructor(
    private now: () => number = () => Math.floor(Date.now() / 1000),
    seed = 0xf0e9e,
    deployer: string | null = null,
  ) {
    this.rand = rng(seed);
    this.creator = deployer ?? '0x000000000000000000000000000000000000c0de';
    const t0 = this.now() - 2 * 86_400;
    this.createdAt = t0;
    // Two days of history, one trade every ~4 minutes.
    for (let ts = t0 + 60; ts < this.now(); ts += 60 + Math.floor(this.rand() * 360)) this.step(ts);
  }
  private creator: string;
  private createdAt: number;

  /** Appends one simulated trade at `ts` (default now) and returns it. */
  step(ts = this.now()): StoredForgeTrade {
    const buy = this.rand() < 0.56;
    const tokens = round(20_000 + this.rand() ** 2 * 6_000_000, 4);
    const impact = (tokens / SUPPLY) * 40 * (0.5 + this.rand());
    this.price = Math.max(0.0000005, this.price * (buy ? 1 + impact : 1 - impact));
    if (buy && this.rand() < 0.3) this.holders++;
    if (!buy && this.rand() < 0.1) this.holders = Math.max(1, this.holders - 1);
    if (this.rand() < 0.05) {
      this.burned += Math.round(tokens * 0.1);
      this.buybackTotal += 0.002;
    }
    const k = this.n++;
    const t: StoredForgeTrade = {
      id: `preview:${k}`,
      side: buy ? 'BUY' : 'SELL',
      trader: '0x' + Math.floor(this.rand() * 2 ** 52).toString(16).padStart(40, 'a').slice(-40),
      amountBnb: round((tokens * this.price) / BNB_USD, 8),
      tokens,
      priceUsd: sig(this.price, 8),
      txHash: '0x' + k.toString(16).padStart(64, 'e'),
      timestamp: ts,
      blockNumber: k,
      logIndex: 0,
      source: 'PORTAL',
    };
    this.trades.push(t);
    if (this.trades.length > 5000) this.trades.splice(0, this.trades.length - 5000);
    return t;
  }

  token(): ForgeToken {
    const now = this.now();
    const before = [...this.trades].reverse().find((t) => t.timestamp < now - 86_400) ?? null;
    const { volume24hUsd, change24hPct } = stats24h(this.trades, this.price, now, before);
    const pct = Math.min(99, round(((this.price - 0.0000005) / 0.00003) * 100, 2));
    return {
      address: PREVIEW_ADDRESS,
      name: 'GachaForge (preview)',
      symbol: 'FORGE',
      description: 'PREVIEW — simulated $FORGE data for design only. Not a real token; nothing here is on-chain.',
      links: { website: 'https://gachaforge.xyz' },
      creator: this.creator,
      createdAt: this.createdAt,
      createdTx: '0x' + '0'.repeat(64),
      stage: 'CURVE',
      bondingCurvePct: Math.max(0, pct),
      priceUsd: sig(this.price, 8),
      priceBnb: sig(this.price / BNB_USD, 8),
      marketCapUsd: marketCap(SUPPLY, this.price),
      change24hPct,
      volume24hUsd,
      holders: this.holders,
      buyTaxBps: 200,
      sellTaxBps: 200,
      taxRecipient: '0x000000000000000000000000000000000000beef',
      burnedTokens: this.burned,
      buybackPendingBnb: 0.0123,
      buybackTotalBnb: round(this.buybackTotal, 6),
      preview: true,
    };
  }

  candles(intervalSec: number, limit: number) {
    return buildCandles(this.trades, intervalSec, { limit, until: this.now() });
  }
}
