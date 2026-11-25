import { MOCK_NOW } from './mock';

export const usd = (n: number, compact = n >= 10_000) =>
  '$' + (compact ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: n < 1000 ? 2 : 0 }));
export const num = (n: number) => Intl.NumberFormat('en-US', { notation: n >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const nowSec = () => (process.env.NEXT_PUBLIC_USE_MOCK === 'true' ? MOCK_NOW : Math.floor(Date.now() / 1000));
// Under a minute shows "<1m" (not exact seconds) so server and browser render the same text.
export const ago = (ts: number, now = nowSec()) => {
  const s = Math.max(0, now - ts);
  if (s < 60) return '<1m';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
/** Generated-art hue, folded into the lime/green band (62–121°) so art stays on-brand whatever the source hue. */
export const hueOf = (img: string) => 62 + ((img.startsWith('hue:') ? Number(img.slice(4)) || 0 : 22) % 60 + 60) % 60;
export const STRATEGY_LABEL = { RAFFLE: 'Raffle', HIT_HUNTER: 'Hit Hunter', DIVIDEND: 'Dividend', BURN: 'Burn', SPLIT: 'Split' } as const;
export const PACK_LABEL = { FORGE_28: '$28 Pack', FORGE_48: '$48 Pack', FORGE_88: '$88 Pack' } as const;
