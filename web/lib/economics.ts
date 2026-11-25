/**
 * GachaForge tax economics — single source of truth for every number shown on the site.
 * Change the split here; all pages, labels and worked examples derive from these values.
 */

/** Fixed trading tax for every machine, in basis points (applies to buys and to sells). */
export const TAX_BPS = 200;
export const TAX_PCT = TAX_BPS / 100; // 2

/** Share of the tax flap.sh keeps before the remainder reaches GachaForge. */
export const FLAP_CUT_PCT = 10; // measured on a BSC mainnet fork at a 2% tax; set by flap.sh and may change

/** Split of the tax that reaches GachaForge (percent, sums to 100). */
export const SPLIT = {
  platform: 90, // GachaForge platform (company treasury)
  pot: 7, // gacha pot — buys real card packs
  buyback: 3, // buys back and burns $FORGE
} as const;

/** Creator share of the tax. */
export const CREATOR_PCT = 0;

/** Worked example used in the docs. */
export function workedExample(volumeUsd = 10_000, packUsd = 28) {
  const tax = (volumeUsd * TAX_PCT) / 100;
  const flap = (tax * FLAP_CUT_PCT) / 100;
  const net = tax - flap;
  const platform = (net * SPLIT.platform) / 100;
  const pot = (net * SPLIT.pot) / 100;
  const buyback = (net * SPLIT.buyback) / 100;
  return { volumeUsd, tax, flap, net, platform, pot, buyback, packUsd, pulls: pot / packUsd };
}

/** "$9.50" / "$171" style formatting for small dollar amounts. */
export const money = (n: number) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2));

/** Fill {tax} {platform} {pot} {buyback} {flap} placeholders in copy (used by i18n strings). */
export function fillEconomics(str: string): string {
  const v: Record<string, number> = { tax: TAX_PCT, flap: FLAP_CUT_PCT, creator: CREATOR_PCT, ...SPLIT };
  return str.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
}

// ---------------------------------------------------------------- packs, pulls & rewards
// Mirrors contracts/src (MachineVault, GachaForgeFactory) and server/src/core. Docs read these.

/** Packs: USD price per pull and approximate max win multiple. */
export const PACKS = [
  { id: 'FORGE_28', usd: 28, maxWin: '~10x' },
  { id: 'FORGE_48', usd: 48, maxWin: '~11x' },
  { id: 'FORGE_88', usd: 88, maxWin: '~9.9x' },
] as const;

/** A pull may spend up to the pack price plus this buffer (MachineVault.SLIPPAGE_CAP_BPS = 11_000). */
export const PULL_BUFFER_PCT = 10;
/** Default cooldown between pulls, seconds (factory pullCooldown; timelock can set 10 s – 1 day). */
export const DEFAULT_COOLDOWN_S = 60;
export const MIN_COOLDOWN_S = 10;
export const MAX_COOLDOWN_H = 24;
/** Chainlink price older than this makes pulls revert. */
export const FEED_MAX_AGE_H = 1;

/** Holder eligibility: balance >= supply × MIN_HOLD_BPS / 10_000 at the snapshot block. */
export const TOTAL_SUPPLY = 1_000_000_000;
export const MIN_HOLD_BPS = 1;
export const MIN_HOLD_PCT = MIN_HOLD_BPS / 100; // 0.01
export const MIN_HOLD_TOKENS = (TOTAL_SUPPLY * MIN_HOLD_BPS) / 10_000; // 100,000

/** Renaiss sell-back schedule: percent of card value paid if sold back within N hours. */
export const SELL_BACK = [
  { withinH: 1, pct: 90 },
  { withinH: 24, pct: 85 },
  { withinH: 72, pct: 50 },
] as const;
/** Renaiss holds a won card this long before releasing it to the winner. */
export const CUSTODY_WINDOW_H = 72;

/** Dividend rounds stay claimable this long (MachineVault.CLAIM_WINDOW). */
export const CLAIM_WINDOW_DAYS = 180;
/** Admin actions wait this long in the timelock. */
export const TIMELOCK_H = 48;
/** flap.sh salt-lock fee (optional front-run protection), BNB. */
export const SALT_LOCK_BNB = 0.01;

/** Fraction of trading volume that lands in the gacha pot. */
export const potShareOfVolume = () => (TAX_PCT / 100) * (1 - FLAP_CUT_PCT / 100) * (SPLIT.pot / 100);
/** Trading volume (USD) needed to fund one pull of a pack. */
export const volumePerPull = (packUsd: number) => packUsd / potShareOfVolume();
