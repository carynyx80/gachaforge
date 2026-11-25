'use client';
import type { Machine } from '@/lib/types';
import { GF_SHARE_PCT, machineSplit, machineTax, type MachineTaxFields } from '@/lib/economics';
import { addrUrl } from '@/lib/chain';
import { short } from '@/lib/format';
import { useOffT } from '../useOffchain';

const bnb = (n?: number) => (typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(n >= 1 ? 3 : 4)} BNB` : '—');

/** Machine page: this token's own tax (buy/sell), its split (GF 10% · pot · creator) and creator paid / owed. */
export function TaxSplitPanel({ m }: { m: Machine }) {
  const t = useOffT();
  const v = m as Machine & MachineTaxFields;
  const tax = machineTax(v);
  const pct = machineSplit(tax.buyBps, tax.potShareBps).pctOfNet;
  const segs = [
    { k: 'gf', label: t('mv_gf'), pct: GF_SHARE_PCT, color: '#F4F7EE' },
    { k: 'pot', label: t('mv_pot'), pct: pct.pot, color: '#B6FF2E' },
    { k: 'creator', label: t('mv_creator'), pct: pct.creator, color: '#3DDC97' },
  ];
  return (
    <div className="panel p-4">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <h3 className="truncate font-display text-lg font-bold uppercase tracking-wide">{t('mv_title')}</h3>
        <span className="shrink-0 text-[10px] text-muted">{t('mv_locked')}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-md border border-line bg-bg p-2.5"><div className="text-[11px] uppercase tracking-widest text-muted">{t('mv_buy')}</div><div className="font-mono text-xl font-bold text-success">{tax.buyPct}%</div></div>
        <div className="rounded-md border border-line bg-bg p-2.5"><div className="text-[11px] uppercase tracking-widest text-muted">{t('mv_sell')}</div><div className="font-mono text-xl font-bold text-danger">{tax.sellPct}%</div></div>
      </div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line" aria-hidden>
        {segs.map((s) => <span key={s.k} style={{ width: `${s.pct}%`, background: s.color }} />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
        {segs.map((s) => (
          <li key={s.k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} /><span className="font-sans text-muted">{s.label}</span> {s.pct}%</li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-muted">{t('mv_split_note', { pot: pct.pot, creator: pct.creator })}</p>
      <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
        {v.creatorPayout && (
          <div className="flex min-w-0 justify-between gap-2"><span className="shrink-0 text-muted">{t('mv_payout')}</span>
            <a href={addrUrl(v.creatorPayout)} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-fg underline decoration-line hover:decoration-accent">{short(v.creatorPayout)} ↗</a></div>
        )}
        <div className="flex justify-between gap-2"><span className="text-muted">{t('mv_paid')}</span><span className="font-mono text-success">{bnb(v.creatorPaidBnb ?? 0)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-muted">{t('mv_owed')}</span><span className="font-mono">{bnb(v.creatorOwedBnb ?? 0)}</span></div>
      </div>
    </div>
  );
}
