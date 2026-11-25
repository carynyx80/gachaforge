'use client';
import Link from 'next/link';
import { isPreview, priceFmt } from '@/lib/forge';
import { LogoMark } from '../Logo';
import { useForge, useForgeT } from './useForge';

/** Slim home-page card linking to /forge: "coming soon" while waiting, live price + 24h change once live. */
export function ForgeBanner() {
  const t = useForgeT();
  const { state, live } = useForge({ withTrades: false });
  const tok = live ? state?.token : undefined;
  const ch = tok?.change24hPct ?? 0;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6">
      <Link href="/forge" className="group relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden rounded-md border-2 border-accent/60 bg-surface px-4 py-3 transition hover:border-accent hover:shadow-[4px_4px_0_0_var(--accent)]">
        <div className="pointer-events-none absolute -left-10 top-1/2 h-24 w-48 -translate-y-1/2 rounded-full bg-accent/20 blur-2xl" />
        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md">
          {tok?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tok.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <LogoMark size={36} className="block h-full w-full" />
          )}
        </span>
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-display text-sm font-extrabold uppercase">
            {tok ? t('banner_live') : t('banner_soon')}
            {tok && isPreview(state) && <span className="rounded-sm border border-accent px-1 py-px text-[9px] text-accent">{t('preview')}</span>}
            {!tok && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          </div>
          {!tok && <div className="truncate text-xs text-muted">{t('banner_soon_sub')}</div>}
        </div>
        {tok && (
          <div className="relative flex items-baseline gap-3 font-mono">
            <span className="text-base font-bold">{priceFmt(tok.priceUsd)}</span>
            <span className={`text-sm font-bold ${ch >= 0 ? 'text-success' : 'text-danger'}`}>{ch >= 0 ? '+' : ''}{ch.toFixed(2)}%</span>
          </div>
        )}
        <span className="relative font-display text-xs font-bold uppercase text-accent transition group-hover:translate-x-0.5">{t('banner_cta')} →</span>
      </Link>
    </div>
  );
}
