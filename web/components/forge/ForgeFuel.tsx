'use client';
import { Fragment, useEffect, useState } from 'react';
import { getBurns } from '@/lib/api';
import { ago, num, short } from '@/lib/format';
import { DEAD, FORGE_SUPPLY, bnbFmt, compact } from '@/lib/forge';
import type { BurnEvent, Paged } from '@/lib/types';
import { useTween } from '../live/AnimatedNumber';
import { useForgeT } from './useForge';
import type { ForgeKey } from '@/lib/forge-i18n';
import { FORGE_SPLIT, GF_BUYBACK_PCT, GF_COMPANY_PCT } from '@/lib/economics';

type Burns = { totalBurned: number; pctOfSupply: number } & Paged<BurnEvent>;

export function useBurns() {
  const [b, setB] = useState<Burns | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => getBurns(1).then((r) => { if (on) setB(r); }).catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => { on = false; clearInterval(id); };
  }, []);
  return b;
}

function Tw({ v, f }: { v: number; f: (n: number) => string }) {
  const n = useTween(v);
  return <>{f(n)}</>;
}

const STEPS: { k: ForgeKey; icon: string; hot?: boolean }[] = [
  { k: 'f_trade', icon: '⇄' },
  { k: 'f_tax', icon: '%' },
  { k: 'f_share', icon: '◔' },
  { k: 'f_burner', icon: '⚙' },
  { k: 'f_buy', icon: '↗' },
  { k: 'f_dead', icon: '🔥', hot: true },
];

/** $FORGE's own 2% model next to the machine-token model that feeds it (TAX MODEL v3). */
export function ForgeModel() {
  const t = useForgeT();
  const fs = [
    { l: t('model_co'), v: FORGE_SPLIT.company, c: '#F4F7EE' },
    { l: t('model_pot'), v: FORGE_SPLIT.pot, c: '#B6FF2E' },
    { l: t('model_bb'), v: FORGE_SPLIT.buyback, c: '#D4FF7A' },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="panel min-w-0 p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted">{t('model_forge_t')}</div>
        <div className="mt-1 font-mono text-2xl font-bold text-glow">{t('model_forge_v')}</div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line" aria-hidden>{fs.map((x) => <span key={x.l} style={{ width: `${x.v}%`, background: x.c }} />)}</div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">{fs.map((x) => <li key={x.l} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: x.c }} /><span className="font-sans text-muted">{x.l}</span> {x.v}%</li>)}</ul>
        <p className="mt-3 text-xs leading-relaxed text-muted">{t('model_forge_d')}</p>
      </div>
      <div className="panel min-w-0 border-accent/50 bg-accent-soft/30 p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted">{t('model_machine_t')}</div>
        <div className="mt-1 font-mono text-2xl font-bold text-accent">{t('model_machine_v')}</div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line" aria-hidden>
          <span style={{ width: `${GF_COMPANY_PCT}%`, background: '#F4F7EE' }} /><span style={{ width: `${GF_BUYBACK_PCT}%`, background: '#D4FF7A' }} /><span className="flex-1" style={{ background: '#2B3322' }} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">{t('model_machine_d')}</p>
      </div>
    </div>
  );
}

/** Animated flow: machine trade → tax → 5% share → buyback ledger → buys $FORGE → dead address. */
export function FuelFlow() {
  const t = useForgeT();
  return (
    <div className={`flex flex-col items-stretch lg:flex-row`}>
      {STEPS.map((s, i) => (
        <Fragment key={s.k}>
          <div className={`relative flex items-center gap-3 rounded-md border-2 px-3 py-3 lg:flex-1 lg:flex-col lg:gap-1 lg:px-2 lg:py-4 lg:text-center ${s.hot ? 'border-danger/60 bg-danger/10' : i === 1 ? 'border-black bg-accent text-black' : 'border-line bg-bg'}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md font-display text-lg font-black ${s.hot ? '' : i === 1 ? 'bg-black/10' : 'bg-accent-soft text-accent'}`}>
              <span className={s.hot ? 'forge-flame' : ''}>{s.icon}</span>
            </span>
            <span className="font-display text-xs font-bold uppercase leading-tight sm:text-sm">{t(s.k)}</span>
            {s.hot && <span className="font-mono text-[10px] text-muted lg:block">0x…dEaD</span>}
          </div>
          {i < STEPS.length - 1 && (
            <>
              <div className="forge-pipe-v mx-auto h-6 w-1 overflow-visible rounded lg:hidden"><span className="forge-orb" style={{ animationDelay: `${i * 0.35}s` }} /></div>
              <div className="forge-pipe hidden h-1 w-6 shrink-0 self-center overflow-visible rounded lg:block xl:w-10"><span className="forge-orb" style={{ animationDelay: `${i * 0.35}s` }} /></div>
            </>
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function ForgeFuel({ pendingBnb, totalBnb, burnedTokens }: { pendingBnb?: number; totalBnb?: number; burnedTokens?: number }) {
  const t = useForgeT();
  const burns = useBurns();
  const burned = burnedTokens ?? burns?.totalBurned ?? 0;
  const pct = (burned / FORGE_SUPPLY) * 100;
  return (
    <section id="fuel" className="mt-14">
      <h2 className="font-display text-2xl font-extrabold uppercase sm:text-3xl">{t('fuel_title')}</h2>
      <p className="mt-2 max-w-2xl text-muted">{t('fuel_sub')}</p>
      <div className="mt-6"><ForgeModel /></div>
      <div className="panel relative mt-6 overflow-hidden p-4 sm:p-6">
        <div className="forge-scan pointer-events-none absolute inset-0" />
        <div className="relative"><FuelFlow /></div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-accent/40 bg-accent-soft p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{t('f_pending')}</div>
            <div className="mt-1 font-mono text-2xl font-bold text-glow">{pendingBnb === undefined ? '—' : <><Tw v={pendingBnb} f={(n) => bnbFmt(n)} /> BNB</>}</div>
          </div>
          <div className="rounded-md border border-line bg-bg p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{t('f_total')}</div>
            <div className="mt-1 font-mono text-2xl font-bold">{totalBnb === undefined ? '—' : <><Tw v={totalBnb} f={(n) => bnbFmt(n, 3)} /> BNB</>}</div>
          </div>
          <div className="rounded-md border border-danger/40 bg-danger/10 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{t('f_burned')}</div>
            <div className="mt-1 font-mono text-2xl font-bold"><Tw v={burned} f={(n) => compact(n, 2)} /> <span className="text-sm text-muted">$FORGE</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/60 ring-1 ring-line"><div className="rip-bar h-full rounded-full" style={{ width: `${Math.min(100, Math.max(1.5, pct))}%` }} /></div>
            <div className="mt-1 font-mono text-[11px] text-muted"><span className="text-accent">{pct.toFixed(2)}%</span> {t('of_supply')} · 1B</div>
          </div>
        </div>
      </div>

      <div className="panel mt-6 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide">{t('burn_history')}</h3>
          <span className="font-mono text-[11px] text-muted">{t('burn_addr')}: <span className="break-all">{DEAD}</span></span>
        </div>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-widest text-muted">
            <tr><th className="px-4 py-3">{t('burn_type')}</th><th>{t('burn_amt')}</th><th>{t('burn_tx')}</th><th className="pr-4 text-right">{t('time')}</th></tr>
          </thead>
          <tbody className="divide-y divide-line font-mono">
            {!burns && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">…</td></tr>}
            {burns?.items.slice(0, 12).map((b) => (
              <tr key={b.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3"><span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${b.kind === 'BURN' ? 'border-danger/40 bg-danger/15 text-danger' : 'border-accent/40 bg-accent-soft text-glow'}`}>{b.kind === 'BURN' ? '🔥 BURN' : 'BUYBACK'}</span></td>
                <td>{num(b.amount)}</td>
                <td><a href={`https://bscscan.com/tx/${b.txHash}`} target="_blank" rel="noreferrer" className="text-glow hover:underline">{short(b.txHash)} ↗</a></td>
                <td className="pr-4 text-right text-muted">{ago(b.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {burns && <div className="border-t border-line px-4 py-2 text-xs text-muted">{burns.total} {t('events')}</div>}
      </div>
    </section>
  );
}
