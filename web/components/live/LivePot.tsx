'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Machine } from '@/lib/types';
import { FLAP_CUT_PCT, SPLIT, TAX_PCT } from '@/lib/economics';
import { feeUsd, type FeeEvent } from '@/lib/fees';
import { PACK_LABEL, short, usd } from '@/lib/format';
import { GachaMachine } from '../GachaMachine';
import { AnimatedNumber } from './AnimatedNumber';
import { onFeeEvent, useLiveFees } from './useLiveFees';
import { useOffT } from '../useOffchain';

interface Chip { id: string; text: string; side: FeeEvent['side'] }

export const FEE_ROWS = [
  { k: 'flapUsd', label: 'flap.sh', pct: `${FLAP_CUT_PCT}% of tax` },
  { k: 'platformUsd', label: 'GachaForge platform', pct: `${SPLIT.platform}%` },
  { k: 'potUsd', label: 'Gacha pot', pct: `${SPLIT.pot}%` },
  { k: 'buybackUsd', label: '$FORGE buyback', pct: `${SPLIT.buyback}%` },
] as const;

/** Machine-page pot meter driven by live fee events (falls back to the server-rendered pot). */
export function LivePot({ m, children }: { m: Machine; children?: ReactNode }) {
  const { pot, pulls, events } = useLiveFees(m.address, 1);
  const t = useOffT();
  // When the server props last changed (router.refresh) — newer live values win over older props.
  const serverAt = useMemo(() => Date.now(), [m.potUsd]); // eslint-disable-line react-hooks/exhaustive-deps
  const packPrice = pot?.packPriceUsd || m.packPriceUsd;
  let potNow = pot && pot.at > serverAt ? pot.potUsd : m.potUsd;

  const [rip, setRip] = useState<{ n: number; at: number } | null>(null);
  const firstPulls = useRef(pulls);
  useEffect(() => {
    if (pulls === firstPulls.current) return;
    firstPulls.current = pulls;
    const r = { n: pulls, at: Date.now() };
    setRip(r);
    const t = setTimeout(() => setRip((x) => (x === r ? null : x)), 1300);
    return () => clearTimeout(t);
  }, [pulls]);
  const ripAt = rip?.at ?? 0;
  // A 'pull' message arrives before the next fee event carries the reduced pot: reset locally.
  if (ripAt > Math.max(pot?.at ?? 0, serverAt) && potNow >= packPrice) potNow = Math.max(0, potNow - packPrice);
  const ripping = rip !== null;

  const [chips, setChips] = useState<Chip[]>([]);
  useEffect(() => onFeeEvent((e) => {
    if (e.machine.toLowerCase() !== m.address.toLowerCase()) return;
    const c: Chip = { id: e.id, text: `+${feeUsd(e.potUsd)} from a ${e.side}`, side: e.side };
    setChips((xs) => [...xs.slice(-3), c]);
    setTimeout(() => setChips((xs) => xs.filter((x) => x !== c)), 1700);
  }), [m.address]);

  const pct = Math.min(100, (potNow / packPrice) * 100);
  const left = Math.max(0, packPrice - potNow);
  const latest = events[0];
  const pending = latest?.pending ?? pot?.pending ?? false;

  return (
    <div className="panel panel-strong relative overflow-hidden p-4">
      {ripping && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" aria-live="polite">
          <span className="rip-ring absolute h-40 w-40 rounded-full border-4 border-accent" />
          <span className="rip-burst neon-text font-display text-5xl font-black text-accent">RIP!</span>
        </div>
      )}
      <div className="flex items-center gap-4">
        <GachaMachine className="w-20 shrink-0 sm:w-24" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-widest text-muted">Gacha pot · Round #{m.round}</div>
            {pending && <span className="shrink-0 rounded-sm border border-glow/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-glow/80" title="Tax not yet dispatched + synced into the vault on-chain">pending sync</span>}
          </div>
          <div className="relative mt-1 font-display text-xl font-extrabold leading-tight sm:text-2xl">
            <AnimatedNumber value={potNow} format={(n) => usd(n)} />
            <span className="text-sm font-bold text-muted"> / {usd(packPrice)}</span>
            <div className="pointer-events-none absolute -top-1 right-0 flex flex-col items-end gap-1">
              {chips.map((c) => (
                <span key={c.id} className={`fee-chip whitespace-nowrap rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-bold ${c.side === 'BUY' ? 'bg-accent text-black' : 'bg-fg text-black'}`}>{c.text}</span>
              ))}
            </div>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line">
            <div className="rip-bar meter-fill h-full rounded-sm" style={{ width: `${ripping ? 100 : pct}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 font-mono text-xs">
            <span className="font-bold text-accent"><AnimatedNumber value={left} format={(n) => usd(n)} /> to rip</span>
            <span className="text-muted">{PACK_LABEL[m.pack]}</span>
          </div>
          {m.pullQueued && (
            <div role="status" className="mt-2 flex items-center gap-2 rounded-sm border border-accent/50 bg-accent-soft/60 px-2 py-1.5 text-xs font-semibold text-accent">
              <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
              {t('pot_queued')}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 border-t-2 border-line pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="font-display text-[11px] font-bold uppercase tracking-wide">Where this trade&apos;s fee went</h4>
          {latest && <span className="font-mono text-[10px] text-muted">{short(latest.trader)}</span>}
        </div>
        {latest ? (
          <div key={latest.id} className="fee-in mt-2">
            <div className="mb-1.5 flex flex-wrap gap-x-2 font-mono text-xs">
              <span className={`font-bold ${latest.side === 'BUY' ? 'text-success' : 'text-danger'}`}>{latest.side}</span>
              <span className="text-muted">{latest.amountBnb} BNB · {TAX_PCT}% tax</span>
              <span className="font-bold text-glow">{feeUsd(latest.taxUsd)}</span>
            </div>
            <ul className="space-y-1 font-mono text-xs">
              {FEE_ROWS.map((r) => (
                <li key={r.k} className={`flex items-center justify-between gap-2 ${r.k === 'potUsd' ? 'text-accent' : ''}`}>
                  <span className="truncate"><span className={r.k === 'potUsd' ? '' : 'text-fg/80'}>{r.label}</span> <span className="text-muted">{r.pct}</span></span>
                  <span className="font-bold">{feeUsd(latest[r.k])}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Waiting for the next trade… each buy or sell pays {TAX_PCT}% tax; {SPLIT.pot}% of what reaches GachaForge fills this pot.</p>
        )}
      </div>
      {children}
    </div>
  );
}
