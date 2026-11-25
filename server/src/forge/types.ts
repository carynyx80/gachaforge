import type { AutoBurnStatus } from './autoburn.js';
// $FORGE token page data model — mirrors SPEC.md "$FORGE token page". `preview` is additive.

export interface ForgeToken {
  address: string;
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  links?: { website?: string; x?: string; telegram?: string };
  creator: string;
  createdAt: number;
  createdTx: string;
  stage: 'CURVE' | 'GRADUATED';
  bondingCurvePct: number;
  /** PancakeSwap V2 pair after graduation */
  pool?: string;
  priceUsd: number;
  priceBnb: number;
  marketCapUsd: number;
  change24hPct: number;
  volume24hUsd: number;
  holders: number;
  buyTaxBps: number;
  sellTaxBps: number;
  taxRecipient?: string;
  /** $FORGE held by 0x…dEaD */
  burnedTokens: number;
  /** BNB waiting in BuybackBurner */
  buybackPendingBnb: number;
  /** BNB spent buying back $FORGE so far */
  buybackTotalBnb: number;
  /** true = simulated token served because FORGE_PREVIEW=true and nothing was discovered yet */
  preview?: boolean;
  /** WS `forge` messages only: current $FORGE auto-burn state (not persisted with the token). */
  autoBurn?: AutoBurnStatus;
}

export interface ForgeTrade {
  side: 'BUY' | 'SELL';
  trader: string;
  amountBnb: number;
  tokens: number;
  priceUsd: number;
  txHash: string;
  timestamp: number;
}

/** Trade as stored (id = `${txHash}:${logIndex}` dedupes replays). */
export interface StoredForgeTrade extends ForgeTrade {
  id: string;
  blockNumber: number;
  logIndex: number;
  /** 'PORTAL' = flap bonding curve, 'PAIR' = PancakeSwap V2 */
  source: 'PORTAL' | 'PAIR';
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const CANDLE_INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400 } as const;
export type CandleInterval = keyof typeof CANDLE_INTERVALS;

export interface ForgeStatus {
  status: 'waiting' | 'live';
  deployer: string | null;
  token?: ForgeToken;
  /** Present (true) only when the token is the FORGE_PREVIEW simulation. */
  preview?: boolean;
  /** FORGE_AUTO_BURN state (present whenever the auto-burner is wired, i.e. always in production). */
  autoBurn?: AutoBurnStatus;
}

/** What the backend persists once $FORGE is found (token snapshot + indexing internals). */
export interface ForgeRecord {
  token: ForgeToken;
  createdBlock: number;
  /** Raw `meta` string from TokenCreated (CID or URL), '' if unknown. */
  meta: string;
  metaFetched: boolean;
  /** Quote token from getTokenV8Safe; 0x0 = native BNB. */
  quoteToken: string;
  /** Pair orientation, set once the pool is known. */
  forgeIsToken0?: boolean;
  /** Σ Buyback.bnbSpent in wei (decimal string). */
  buybackTotalWei: string;
  discoveredBy: 'creator' | 'txFrom' | 'override';
}
