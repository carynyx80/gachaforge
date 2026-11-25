'use client';
import type { Machine } from '@/lib/types';
import { PACK_LABEL, usd } from '@/lib/format';
import { useT } from './LangProvider';
import { MachineArt } from './MachineArt';
import { SectionTitle } from './Scoreboard';

export function AboutToRip({ machines }: { machines: Machine[] }) {
  const { t } = useT();
  return (
    <section className="min-w-0">
      <SectionTitle>{t('rip_title')}</SectionTitle>
      <div className="flex flex-col gap-3">
        {machines.map((m, i) => {
          const pct = Math.min(100, (m.potUsd / m.packPriceUsd) * 100);
          const left = Math.max(0, m.packPriceUsd - m.potUsd);
          return (
            <a key={m.address} href={`/m/${m.address}`} className="panel group flex items-center gap-4 p-4 transition hover:border-accent/60">
              <div className="relative">
                <MachineArt image={m.image} ticker={m.ticker} className="h-14 w-14 rounded-lg" />
                <span className="absolute -left-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-accent font-display text-xs font-bold text-black">{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{m.name} <span className="font-display text-glow">${m.ticker}</span></span>
                  <span className="shrink-0 text-xs text-muted">{PACK_LABEL[m.pack]}</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-black/60 ring-1 ring-line">
                  <div className="rip-bar h-full rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-xs">
                  <span className="text-muted">{usd(m.potUsd)} / {usd(m.packPriceUsd)}</span>
                  <span className="font-semibold text-accent">{usd(left)} {t('to_rip')}</span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
