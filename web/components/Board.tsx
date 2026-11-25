'use client';
import { useMemo, useState } from 'react';
import type { Machine, MachineSort, PackId, Stage, Strategy } from '@/lib/types';
import { filterMachines } from '@/lib/api';
import { num, PACK_LABEL, STRATEGY_LABEL, usd } from '@/lib/format';
import { useT } from './LangProvider';
import { MachineArt } from './MachineArt';
import { SectionTitle } from './Scoreboard';
import type { DictKey } from '@/lib/i18n';
import { machineTax } from '@/lib/economics';

const TABS: { v: MachineSort; k: DictKey }[] = [
  { v: 'trending', k: 't_trending' }, { v: 'new', k: 't_new' }, { v: 'most_pulled', k: 't_most' }, { v: 'market_cap', k: 't_mcap' },
];
const PAGE_SIZE = 8;

export function Board({ machines }: { machines: Machine[] }) {
  const { t } = useT();
  const [sort, setSort] = useState<MachineSort>('trending');
  const [strategy, setStrategy] = useState<Strategy | ''>('');
  const [pack, setPack] = useState<PackId | ''>('');
  const [stage, setStage] = useState<Stage | ''>('');
  const [page, setPage] = useState(1);
  const res = useMemo(() => filterMachines(machines, { sort, strategy, pack, stage, page, pageSize: PAGE_SIZE }), [machines, sort, strategy, pack, stage, page]);
  const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <section id="board" className="mx-auto max-w-7xl px-4 pt-16">
      <SectionTitle>{t('board_title')}</SectionTitle>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1">
          {TABS.map((tb) => (
            <button key={tb.v} onClick={() => reset(setSort)(tb.v)}
              className={`whitespace-nowrap rounded-md px-3.5 py-1.5 font-display text-sm font-semibold uppercase tracking-wide transition ${sort === tb.v ? 'bg-accent text-black shadow-[0_0_16px_#B6FF2E66]' : 'text-muted hover:text-fg'}`}>
              {t(tb.k)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Select value={strategy} onChange={reset(setStrategy)} options={[['', t('all_strats')], ...Object.keys(STRATEGY_LABEL).map((k) => [k, t(`st_${k}` as DictKey)])] as [Strategy | '', string][]} />
          <Select value={pack} onChange={reset(setPack)} options={[['', t('all_packs')], ...Object.keys(PACK_LABEL).map((k) => [k, t(`pk_${k}` as DictKey)])] as [PackId | '', string][]} />
          <Select value={stage} onChange={reset(setStage)} options={[['', t('all_stages')], ['CURVE', t('sg_CURVE')], ['GRADUATED', t('sg_GRADUATED')]] as [Stage | '', string][]} />
        </div>
      </div>

      {res.items.length === 0 ? (
        <div className="panel p-10 text-center text-muted">{t('empty')}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {res.items.map((m) => <MachineCard key={m.address} m={m} />)}
        </div>
      )}

      <div className="mt-6 flex items-center justify-center gap-2">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">← {t('prev')}</button>
        {Array.from({ length: pages }, (_, i) => (
          <button key={i} onClick={() => setPage(i + 1)} className={`h-8 w-8 rounded-md border font-mono text-sm ${page === i + 1 ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:text-fg'}`}>{i + 1}</button>
        ))}
        <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">{t('next')} →</button>
      </div>
    </section>
  );
}

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}
      className="min-w-0 rounded-md border border-line bg-surface px-2 py-2 text-sm text-fg outline-none focus:border-accent">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function MachineCard({ m }: { m: Machine }) {
  const { t } = useT();
  const potPct = Math.min(100, (m.potUsd / m.packPriceUsd) * 100);
  const toRip = Math.max(0, m.packPriceUsd - m.potUsd);
  const up = m.change24hPct >= 0;
  const tax = machineTax(m);
  return (
    <a href={`/m/${m.address}`} className="panel group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[0_8px_30px_-10px_#B6FF2E66]">
      <div className="relative">
        <MachineArt image={m.image} ticker={m.ticker} className="h-32 w-full" />
        <span className={`absolute right-2 top-2 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur ${m.stage === 'GRADUATED' ? 'border-success/50 bg-black/50 text-success' : 'border-white/20 bg-black/50 text-fg'}`}>
          {t(`sg_${m.stage}`)}
        </span>
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-glow backdrop-blur">{t(`pk_${m.pack}`)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">{m.name}</span>
            <span className="font-display font-bold text-glow">${m.ticker}</span>
          </div>
          <div className="flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted">
            <span>{t(`st_${m.strategy}`)}</span><span aria-hidden>·</span>
            <span className="font-mono text-fg/90">{tax.buyPct}% / {tax.sellPct}%</span><span>{t('tax')}</span><span aria-hidden>·</span>
            <span><span className="font-mono text-accent">{tax.potSharePct}%</span> {t('pot_share')}</span>
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted"><span>{t('curve')}</span><span className="font-mono">{m.bondingCurvePct}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/60"><div className="h-full rounded-full bg-gradient-to-r from-accent to-glow" style={{ width: `${m.bondingCurvePct}%` }} /></div>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] text-muted">{t('mcap')}</div>
            <div className="font-mono text-lg font-semibold">{usd(m.marketCapUsd, true)}</div>
          </div>
          <span className={`font-mono text-sm font-semibold ${up ? 'text-success' : 'text-danger'}`}>{up ? '▲' : '▼'} {Math.abs(m.change24hPct)}%</span>
        </div>
        <div className="rounded-md border border-accent/30 bg-accent-soft/50 p-2.5">
          <div className="flex justify-between text-[11px]"><span className="text-muted">{t('pot')}</span><span className="font-mono font-semibold text-accent">{usd(toRip)} {t('to_rip')}</span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/60"><div className="rip-bar h-full rounded-full" style={{ width: `${potPct}%` }} /></div>
        </div>
        <div className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
          <Stat l={t('vol')} v={usd(m.volume24hUsd, true)} />
          <Stat l={t('opened')} v={num(m.packsOpened)} />
          <Stat l={t('holders')} v={num(m.holders)} />
        </div>
      </div>
    </a>
  );
}
const Stat = ({ l, v }: { l: string; v: string }) => (
  <div><div className="text-[10px] uppercase tracking-wider text-muted">{l}</div><div className="font-mono text-sm">{v}</div></div>
);
