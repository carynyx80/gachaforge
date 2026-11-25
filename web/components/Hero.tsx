'use client';
import Link from 'next/link';
import { useT } from './LangProvider';
import { GachaMachine } from './GachaMachine';

export function Hero() {
  const { t } = useT();
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="hero-sky pointer-events-none absolute inset-0" />
      <div className="grid-floor pointer-events-none absolute inset-x-0 bottom-0 h-[55%]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-4 pb-16 pt-12 md:grid-cols-[1.2fr_1fr] md:pb-24 md:pt-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-sm border-2 border-accent/50 bg-accent-soft px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-glow">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> {t('hero_kicker')}
          </span>
          <h1 className="mt-5 font-display text-[2.5rem] font-black leading-[1.02] tracking-[-0.02em] sm:text-5xl lg:text-6xl">
            <span className="block">{t('hero_title_1')}</span>
            <span className="neon-text block text-accent">{t('hero_title_2')}</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted">{t('hero_sub')}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/launch" className="btn-chunky px-6 py-3 text-base">{t('cta_launch')} →</Link>
            <a href="#board" className="btn-ghost px-6 py-3 text-base">{t('cta_board')}</a>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted">
            <span>{t('hero_tax')}</span><span>{t('hero_split_platform')}</span><span>{t('hero_split_pot')}</span><span>{t('hero_split_buyback')}</span>
          </div>
        </div>
        <div className="relative mx-auto w-64 sm:w-72 md:w-80">
          <div className="absolute inset-x-6 bottom-2 h-10 rounded-[50%] bg-accent/40 blur-2xl" />
          <GachaMachine className="relative w-full gm-float" />
        </div>
      </div>
    </section>
  );
}
