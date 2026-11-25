'use client';
import type { Pull } from '@/lib/types';
import { ago, PACK_LABEL, short, usd } from '@/lib/format';
import { CardThumb } from './CardThumb';
import { useT } from './LangProvider';
import { SectionTitle } from './Scoreboard';

const BADGE: Record<Pull['result'], string> = {
  WON: 'bg-success/15 text-success border-success/40',
  SOLD: 'bg-white/5 text-muted border-line',
  BURNED: 'bg-danger/15 text-danger border-danger/40',
};

export function RecentPulls({ pulls }: { pulls: Pull[] }) {
  const { t } = useT();
  return (
    <section id="pulls" className="min-w-0">
      <SectionTitle right={<a href="/#pulls" className="text-sm text-glow hover:underline">{t('view_all')} →</a>}>{t('pulls_title')}</SectionTitle>
      <div className="panel overflow-hidden">
        <div className="hidden grid-cols-[2.2fr_1.2fr_0.8fr_1fr_0.5fr] gap-3 border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted sm:grid">
          <span>{t('col_card')}</span><span>{t('col_machine')}</span><span>{t('col_result')}</span><span>{t('col_winner')}</span><span className="text-right">{t('col_time')}</span>
        </div>
        <ul className="divide-y divide-line">
          {pulls.map((p) => (
            <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.02] sm:grid-cols-[2.2fr_1.2fr_0.8fr_1fr_0.5fr]">
              <div className="flex min-w-0 items-center gap-3">
                <CardThumb card={p.card} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.card.name}</div>
                  <div className="truncate text-xs text-muted">{p.card.grader} {p.card.grade} · {p.card.set} · <span className="font-mono text-fg">{usd(p.card.valueUsd)}</span></div>
                  <div className="mt-1 flex items-center gap-2 text-xs sm:hidden">
                    <span className="font-display font-bold text-glow">${p.ticker}</span>
                    <span className="text-muted">{PACK_LABEL[p.pack]}</span>
                    <WinnerCell p={p} />
                  </div>
                </div>
              </div>
              <div className="hidden min-w-0 sm:block">
                <div className="font-display font-bold text-glow">${p.ticker}</div>
                <div className="text-xs text-muted">{PACK_LABEL[p.pack]} · R{p.round}</div>
              </div>
              <div className="flex flex-col items-end gap-1 sm:block">
                <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-bold tracking-wider ${BADGE[p.result]}`}>{p.result}</span>
                <span className="font-mono text-[11px] text-muted sm:hidden">{ago(p.timestamp)}</span>
              </div>
              <div className="hidden sm:block"><WinnerCell p={p} /></div>
              <div className="hidden text-right font-mono text-sm text-muted sm:block">{ago(p.timestamp)}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function WinnerCell({ p }: { p: Pull }) {
  const { t } = useT();
  if (p.result === 'WON') return <span className="font-mono text-sm text-success">{short(p.winner)}</span>;
  return (
    <span className="flex flex-col leading-tight">
      <span className={`text-sm ${p.result === 'BURNED' ? 'text-danger' : 'text-glow'}`}>{p.result === 'BURNED' ? t('r_burned') : t('r_holders')}</span>
      {p.proceedsBnb !== undefined && <span className="font-mono text-[10px] text-muted">{p.proceedsBnb} BNB</span>}
    </span>
  );
}
