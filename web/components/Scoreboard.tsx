'use client';
import { useEffect, useState } from 'react';
import type { Stats } from '@/lib/types';
import { useT } from './LangProvider';
import type { DictKey } from '@/lib/i18n';

function Digit({ d, ready }: { d: string; ready: boolean }) {
  if (!/\d/.test(d)) return <span className="px-[1px]">{d}</span>;
  const n = Number(d);
  return (
    <span className="odo-digit">
      <span className="odo-strip" style={{ transform: `translateY(-${ready ? n * 10 : 0}%)` }}>
        {Array.from({ length: 10 }, (_, i) => <span key={i}>{i}</span>)}
      </span>
    </span>
  );
}

function Odometer({ value }: { value: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return <span className="inline-flex tabular-nums">{value.split('').map((c, i) => <Digit key={i} d={c} ready={ready} />)}</span>;
}

export function Scoreboard({ stats }: { stats: Stats }) {
  const { t } = useT();
  const items: { k: DictKey; v: string }[] = [
    { k: 's_pots', v: '$' + Math.round(stats.potsUsd).toLocaleString('en-US') },
    { k: 's_packs', v: stats.packsOpened.toLocaleString('en-US') },
    { k: 's_cards', v: stats.cardsAwarded.toLocaleString('en-US') },
    { k: 's_burned', v: '$' + Math.round(stats.burnedUsd).toLocaleString('en-US') },
    { k: 's_launches', v: stats.launches.toLocaleString('en-US') },
  ];
  return (
    <section className="mx-auto max-w-7xl px-4 pt-14">
      <SectionTitle>{t('score_title')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {items.map((it, i) => (
          <div key={it.k} className={`panel p-4 ${i === 0 ? 'col-span-2 md:col-span-1' : ''}`}>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted">{t(it.k)}</div>
            <div className="mt-2 font-display text-xl font-extrabold text-fg sm:text-2xl"><Odometer value={it.v} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="flex items-center gap-3 font-display text-xl font-extrabold uppercase tracking-tight sm:text-[1.65rem]">
        <span className="h-6 w-1.5 shrink-0 bg-accent shadow-[0_0_12px_#B6FF2E]" />
        {children}
      </h2>
      {right}
    </div>
  );
}
