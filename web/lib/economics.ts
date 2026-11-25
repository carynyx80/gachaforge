/**
 * GachaForge tax economics — single source of truth for every number shown on the site.
 * Change the split here; all pages, labels and worked examples derive from these values.
 */

// ================================================================ TAX MODEL v3 (SPEC.md)
// Two kinds of tokens: MACHINE tokens (launched on GachaForge, tax chosen by the creator) and
// $FORGE (GachaForge's own token, fixed 2% with its own 90/7/3 split).

/** Share of the tax flap.sh keeps before the remainder reaches the GachaForge ops wallet (~10% at low rates). */
export const FLAP_CUT_PCT = 10; // measured on a BSC mainnet fork; set by flap.sh and may change (backend uses the measured ratio per token)

// ---------------------------------------------------------------- $FORGE
/** $FORGE's own trading tax (set by the owner on flap.sh, planned 2% / 2%). */
export const FORGE_TAX_BPS = 200;
export const FORGE_TAX_PCT = FORGE_TAX_BPS / 100; // 2
/** Split of the $FORGE tax that reaches GachaForge (percent, sums to 100). */
export const FORGE_SPLIT = {
  company: 90, // GachaForge company
  pot: 7, // $FORGE gacha pot
  buyback: 3, // $FORGE buyback & burn
} as const;

// ---------------------------------------------------------------- MACHINE tokens
/** Creator-chosen tax, each side, whole percent (flap.sh limits). */
export const MACHINE_TAX_MIN_PCT = 1;
export const MACHINE_TAX_MAX_PCT = 10;
export const MACHINE_TAX_DEFAULT_PCT = 3;
export const MACHINE_TAX_OPTIONS = Array.from({ length: MACHINE_TAX_MAX_PCT - MACHINE_TAX_MIN_PCT + 1 }, (_, i) => i + MACHINE_TAX_MIN_PCT);

/** Of the tax that reaches the ops wallet: GachaForge keeps 10%, split 5% company / 5% $FORGE buyback. */
export const GF_SHARE_BPS = 1000;
export const GF_COMPANY_BPS = 5000; // of the GF share
export const GF_BUYBACK_BPS = 5000; // of the GF share
export const GF_SHARE_PCT = GF_SHARE_BPS / 100; // 10
export const GF_COMPANY_PCT = (GF_SHARE_PCT * GF_COMPANY_BPS) / 10_000; // 5 (of the tax that reaches GachaForge)
export const GF_BUYBACK_PCT = (GF_SHARE_PCT * GF_BUYBACK_BPS) / 10_000; // 5
/** The creator share (90%) is split by the creator between the gacha pot (≥ 20% of it) and their own payout. */
export const CREATOR_SHARE_PCT = 100 - GF_SHARE_PCT; // 90
export const CREATOR_POT_MIN_BPS = 2000;
export const POT_SHARE_MAX_BPS = 10_000;
export const POT_SHARE_DEFAULT_BPS = 5000;

export interface MachineSplit {
  /** Fractions of $1 of trade volume. tax = flap + company + buyback + pot + creator. */
  tax: number; flap: number; net: number; gf: number; company: number; buyback: number; creatorShare: number; pot: number; creator: number;
  /** Percent of the tax that reaches GachaForge (after flap.sh). company + buyback + pot + creator = 100. */
  pctOfNet: { company: number; buyback: number; pot: number; creator: number };
}

/** Per-$ shares of one trade for a machine with `taxBps` tax and `potShareBps` (of the creator's 90%). */
export function machineSplit(taxBps: number, potShareBps: number = POT_SHARE_DEFAULT_BPS): MachineSplit {
  const ps = Math.min(POT_SHARE_MAX_BPS, Math.max(CREATOR_POT_MIN_BPS, potShareBps || POT_SHARE_DEFAULT_BPS)) / 10_000;
  const tax = Math.max(0, taxBps) / 10_000;
  const flap = (tax * FLAP_CUT_PCT) / 100;
  const net = tax - flap;
  const gf = (net * GF_SHARE_BPS) / 10_000;
  const company = (gf * GF_COMPANY_BPS) / 10_000;
  const buyback = gf - company;
  const creatorShare = net - gf;
  const pot = creatorShare * ps;
  const creator = creatorShare - pot;
  const potPct = Math.round(CREATOR_SHARE_PCT * ps * 10) / 10;
  return {
    tax, flap, net, gf, company, buyback, creatorShare, pot, creator,
    pctOfNet: { company: GF_COMPANY_PCT, buyback: GF_BUYBACK_PCT, pot: potPct, creator: Math.round((CREATOR_SHARE_PCT - potPct) * 10) / 10 },
  };
}

/** Same breakdown for $FORGE (90 company / 7 pot / 3 buyback, creator 0). */
export function forgeSplit(taxBps: number = FORGE_TAX_BPS): MachineSplit {
  const tax = taxBps / 10_000;
  const flap = (tax * FLAP_CUT_PCT) / 100;
  const net = tax - flap;
  const company = (net * FORGE_SPLIT.company) / 100;
  const pot = (net * FORGE_SPLIT.pot) / 100;
  const buyback = (net * FORGE_SPLIT.buyback) / 100;
  return {
    tax, flap, net, gf: company + buyback, company, buyback, creatorShare: pot, pot, creator: 0,
    pctOfNet: { company: FORGE_SPLIT.company, buyback: FORGE_SPLIT.buyback, pot: FORGE_SPLIT.pot, creator: 0 },
  };
}

/** TAX MODEL v3 machine fields (optional so older API payloads still type-check). */
export interface MachineTaxFields {
  taxBps?: number; buyTaxBps?: number; sellTaxBps?: number; potShareBps?: number;
  creatorPayout?: string; creatorPaidBnb?: number; creatorOwedBnb?: number;
}

/** Buy / sell tax and pot share of a machine, with fallbacks for older API payloads (taxBps = buy tax). */
export function machineTax(m: MachineTaxFields) {
  const buy = m.buyTaxBps ?? m.taxBps ?? FORGE_TAX_BPS;
  const sell = m.sellTaxBps ?? m.buyTaxBps ?? m.taxBps ?? FORGE_TAX_BPS;
  const potShare = m.potShareBps ?? POT_SHARE_DEFAULT_BPS;
  return { buyBps: buy, sellBps: sell, buyPct: buy / 100, sellPct: sell / 100, potShareBps: potShare, potSharePct: potShare / 100 };
}

// ---------------------------------------------------------------- legacy aliases (= $FORGE model)
/** @deprecated machine tokens choose their own tax — use machineSplit(). Kept = $FORGE values for older copy. */
export const TAX_BPS = FORGE_TAX_BPS;
/** @deprecated */
export const TAX_PCT = FORGE_TAX_PCT;
/** @deprecated $FORGE split under its old names. */
export const SPLIT = { platform: FORGE_SPLIT.company, pot: FORGE_SPLIT.pot, buyback: FORGE_SPLIT.buyback } as const;
/** Creator share of the $FORGE tax. */
export const CREATOR_PCT = 0;

/** Worked example (machine token, default 3% tax / 50% pot share unless given). */
export function workedExample(volumeUsd = 10_000, packUsd = 28, taxBps = MACHINE_TAX_DEFAULT_PCT * 100, potShareBps = POT_SHARE_DEFAULT_BPS) {
  const s = machineSplit(taxBps, potShareBps);
  const v = (x: number) => volumeUsd * x;
  return {
    volumeUsd, tax: v(s.tax), flap: v(s.flap), net: v(s.net), platform: v(s.company), company: v(s.company), pot: v(s.pot),
    buyback: v(s.buyback), creator: v(s.creator), packUsd, pulls: v(s.pot) / packUsd,
  };
}

/** "$9.50" / "$171" style formatting for small dollar amounts. */
export const money = (n: number) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2));

/**
 * Fill placeholders in copy (used by i18n strings).
 * Legacy ($FORGE): {tax} {platform} {pot} {buyback} {flap} {creator}.
 * $FORGE explicit: {ftax} {fco} {fpot} {fbb}. Machine: {gf} {gfco} {gfbb} {cshare} {potmin} {taxmin} {taxmax} {taxdef}.
 */
export function fillEconomics(str: string): string {
  const v: Record<string, number> = {
    tax: TAX_PCT, flap: FLAP_CUT_PCT, creator: CREATOR_PCT, ...SPLIT,
    ftax: FORGE_TAX_PCT, fco: FORGE_SPLIT.company, fpot: FORGE_SPLIT.pot, fbb: FORGE_SPLIT.buyback,
    gf: GF_SHARE_PCT, gfco: GF_COMPANY_PCT, gfbb: GF_BUYBACK_PCT, cshare: CREATOR_SHARE_PCT, potmin: CREATOR_POT_MIN_BPS / 100,
    taxmin: MACHINE_TAX_MIN_PCT, taxmax: MACHINE_TAX_MAX_PCT, taxdef: MACHINE_TAX_DEFAULT_PCT,
  };
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

/** Fraction of trading volume that lands in the gacha pot (machine defaults: 3% tax, 50% pot share). */
export const potShareOfVolume = (taxBps = MACHINE_TAX_DEFAULT_PCT * 100, potShareBps = POT_SHARE_DEFAULT_BPS) => machineSplit(taxBps, potShareBps).pot;
/** Trading volume (USD) needed to fund one pull of a pack. */
export const volumePerPull = (packUsd: number, taxBps?: number, potShareBps?: number) => packUsd / potShareOfVolume(taxBps, potShareBps);
