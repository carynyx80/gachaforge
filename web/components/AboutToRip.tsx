'use client';
import { useMemo } from 'react';
import type { Machine } from '@/lib/types';
import { PACK_LABEL, usd } from '@/lib/format';
import { useT } from './LangProvider';
import { MachineArt } from './MachineArt';
import { SectionTitle } from './Scoreboard';
import { useLiveFees } from './live/useLiveFees';
import { AnimatedNumber } from './live/AnimatedNumber';

export function AboutToRip({ machines }: { machines: Machine[] }) {
  const { t } = useT();
  const { pots } = useLiveFees();
  const serverAt = useMemo(() => Date.now(), [machines]); // when these props were rendered
  return (
    <section className="min-w-0">
      <SectionTitle>{t('rip_title')}</SectionTitle>
      <div className="flex flex-col gap-3">
        {machines.map((m, i) => {
          const live = pots[m.address.toLowerCase()];
          const pot = live && live.at > serverAt ? live.potUsd : m.potUsd;
          const price = live?.packPriceUsd || m.packPriceUsd;
          const pct = Math.min(100, (pot / price) * 100);
          const left = Math.max(0, price - pot);
          return (
            <a key={m.address} href={`/m/${m.address}`} className="panel group flex items-center gap-4 p-4 transition hover:border-accent/60">
              <div className="relative">
                <MachineArt image={m.image} ticker={m.ticker} className="h-14 w-14 rounded-lg" />
                <span className="absolute -left-2 -top-2 grid h-6 w-6 place-items-center rounded-sm bg-accent font-display text-xs font-black text-black">{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{m.name} <span className="font-display text-glow">${m.ticker}</span></span>
                  <span className="shrink-0 text-xs text-muted">{PACK_LABEL[m.pack]}</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line">
                  <div className="rip-bar meter-fill h-full rounded-sm" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-xs">
                  <span className="text-muted"><AnimatedNumber value={pot} format={(n) => usd(n)} /> / {usd(price)}</span>
                  <span className="font-bold text-accent"><AnimatedNumber value={left} format={(n) => usd(n)} /> {t('to_rip')}</span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
