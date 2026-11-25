'use client';
import { useEffect, useState } from 'react';
import { fetchFeeSummary } from '@/lib/fees';
import { addrUrl } from '@/lib/chain';
import { short } from '@/lib/format';
import { bnbFmt, type ForgeState } from '@/lib/forge';
import type { ForgeKey } from '@/lib/forge-i18n';
import { useTween } from '../live/AnimatedNumber';
import { useForgeT } from './useForge';

const HOW: [ForgeKey, ForgeKey][] = [
  ['how_1_t', 'how_1_d'], ['how_2_t', 'how_2_d'], ['how_3_t', 'how_3_d'], ['how_4_t', 'how_4_d'], ['how_5_t', 'how_5_d'],
];

/** 'waiting' state: no token yet. No price is shown. */
export function ForgeComing({ state }: { state: ForgeState | null }) {
  const t = useForgeT();
  const pending = state?.buybackPendingBnb ?? state?.token?.buybackPendingBnb;
  const [usd, setUsd] = useState<number | null>(null);
  useEffect(() => {
    if (pending !== undefined) return;
    let on = true;
    const load = () => fetchFeeSummary().then((s) => { if (on && s) setUsd(s.buybackUsd); });
    load();
    const id = setInterval(load, 20_000);
    return () => { on = false; clearInterval(id); };
  }, [pending]);
  const pv = useTween(pending ?? 0, 900);
  const uv = useTween(usd ?? 0, 900);

  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="hero-sky pointer-events-none absolute inset-0" />
      <div className="grid-floor pointer-events-none absolute inset-x-0 bottom-0 h-[45%] opacity-70" />
      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-10 md:pb-20 md:pt-16">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-sm border-2 border-accent/50 bg-accent-soft px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-glow">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> {t('coming_kicker')}
          </span>
          <span className="inline-flex items-center gap-2 rounded-sm border-2 border-fg/80 bg-fg px-3 py-1 font-display text-xs font-extrabold uppercase tracking-wide text-black">
            {t('coming_flap')} ↗
          </span>
        </div>
        <h1 className="mt-6 font-display font-black uppercase">
          <span className="neon-text block text-[clamp(3.4rem,15vw,10rem)] leading-[0.9] tracking-[-0.04em] text-accent">{t('coming_title_1')}</span>
          <span className="mt-2 block text-[2rem] leading-none tracking-[-0.02em] sm:text-5xl lg:text-6xl">{t('coming_title_2')}</span>
        </h1>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_1fr] lg:items-end">
          <div>
            <p className="max-w-xl text-lg text-muted">{t('coming_sub')}</p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-line bg-surface/80 px-3 py-2 font-mono text-xs text-muted">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-accent" /></span>
              {t('coming_watching')}
            </p>
            <p className="mt-3 max-w-xl text-sm text-fg">{t('coming_auto')}</p>
            <p className="mt-1 font-mono text-xs text-muted">{t('no_price')}</p>
          </div>
          <div className="panel panel-strong relative overflow-hidden border-accent/60 p-6 shadow-[6px_6px_0_0_var(--accent)]">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/25 blur-3xl" />
            <div className="text-xs uppercase tracking-widest text-muted">{pending !== undefined || usd === null ? t('coming_waiting') : t('coming_waiting_usd')}</div>
            <div className="mt-2 font-mono text-4xl font-bold tabular-nums sm:text-5xl">
              {pending !== undefined ? <>{bnbFmt(pv)} <span className="text-xl text-accent">BNB</span></>
                : usd !== null ? <>${uv.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</>
                : '—'}
            </div>
            <div className="mt-2 text-sm text-muted">{t('coming_waiting_note')}</div>
            {state?.deployer && (
              <div className="mt-4 border-t border-line pt-3 font-mono text-xs text-muted">
                {t('coming_deployer')}: <a href={addrUrl(state.deployer)} target="_blank" rel="noreferrer" className="text-glow hover:underline">{short(state.deployer)} ↗</a>
              </div>
            )}
          </div>
        </div>

        <div className="mt-14">
          <h2 className="font-display text-xl font-extrabold uppercase sm:text-2xl">{t('how_title')}</h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {HOW.map(([h, d], i) => (
              <li key={h} className={`panel relative p-4 ${i === 4 ? 'border-danger/50' : ''}`}>
                <div className="font-mono text-xs text-accent">0{i + 1}</div>
                <div className="mt-1 font-display text-sm font-bold uppercase">{i === 4 ? <><span className="forge-flame">🔥</span> {t(h)}</> : t(h)}</div>
                <p className="mt-1 text-sm text-muted">{t(d)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
