'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLAP_CUT_PCT, SPLIT, TAX_PCT } from '@/lib/economics';
import { addToTotals, feeUsd, fetchFeeSummary, type FeeEvent, type FeeSummary, type FeeTotals } from '@/lib/fees';
import { ago } from '@/lib/format';
import { SectionTitle } from '../Scoreboard';
import { useTween } from './AnimatedNumber';
import { onFeeEvent, useLiveFees, usePrefersReducedMotion } from './useLiveFees';

type BranchKey = 'flapUsd' | 'platformUsd' | 'potUsd' | 'buybackUsd';
const BRANCHES: { k: BranchKey; label: string; sub: string; color: string }[] = [
  { k: 'flapUsd', label: 'flap.sh', sub: `~${FLAP_CUT_PCT}% of tax`, color: '#8E9686' },
  { k: 'platformUsd', label: 'GachaForge platform', sub: `${SPLIT.platform}% of rest`, color: '#F4F7EE' },
  { k: 'potUsd', label: 'Gacha pot', sub: `${SPLIT.pot}% · real packs`, color: '#B6FF2E' },
  { k: 'buybackUsd', label: '$FORGE buyback', sub: `${SPLIT.buyback}% · burned`, color: '#D4FF7A' },
];

const MAX_PER_SEC = 4;
const DOT_MS = 1500;

// ---- geometry (SVG user units) -------------------------------------------------
const D = { w: 900, h: 400, bx: 515, bw: 375, bh: 82, cy: (i: number) => 50 + i * 100 };
const dPath = (i: number) => `M85 200 H380 C455 200 445 ${D.cy(i)} ${D.bx} ${D.cy(i)}`;
const M = { w: 360, h: 584, bx: 44, bw: 306, bh: 100, cy: (i: number) => 176 + i * 116 };
const mPath = (i: number) => `M90 32 H270 V86 Q270 98 258 98 H36 Q24 98 24 110 V${M.cy(i) - 12} Q24 ${M.cy(i)} 36 ${M.cy(i)} H${M.bx}`;

function Tw({ v }: { v: number | null }) {
  const n = useTween(v ?? 0);
  return <>{v === null ? '—' : feeUsd(n)}</>;
}

interface Layout { svg: SVGSVGElement | null; paths: (SVGPathElement | null)[]; boxes: (SVGRectElement | null)[]; dots: SVGGElement | null }
const newLayout = (): Layout => ({ svg: null, paths: [], boxes: [], dots: null });

function Diagram({ mobile, totals, day, L }: { mobile: boolean; totals: FeeTotals | null; day: FeeTotals | null; L: Layout }) {
  const G = mobile ? M : D;
  const path = mobile ? mPath : dPath;
  const tax = totals ? totals.totalTaxUsd : null;
  const txt = { fill: 'var(--fg)' };
  return (
    <svg ref={(el) => { L.svg = el; }} viewBox={`0 0 ${G.w} ${G.h}`} className={mobile ? 'block w-full md:hidden' : 'hidden w-full md:block'} role="img"
      aria-label={`Trade, ${TAX_PCT}% tax, split to flap.sh, GachaForge platform, gacha pot and $FORGE buyback`}>
      {BRANCHES.map((b, i) => (
        <g key={b.k}>
          <path d={path(i)} fill="none" stroke="#1F2419" strokeWidth={mobile ? 3 : 4} />
          <path ref={(el) => { L.paths[i] = el; }} d={path(i)} fill="none" stroke={b.color} strokeOpacity=".55" strokeWidth="1.5" className="flow-line" />
        </g>
      ))}
      <g ref={(el) => { L.dots = el; }} />
      {/* trade + tax nodes */}
      {(mobile
        ? [{ x: 10, y: 4, w: 160, h: 56 }, { x: 190, y: 4, w: 160, h: 56 }]
        : [{ x: 10, y: 158, w: 150, h: 84 }, { x: 230, y: 158, w: 150, h: 84 }]
      ).map((r, j) => (
        <g key={j}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="4" fill={j ? '#B6FF2E' : '#0E0F0C'} stroke={j ? '#050505' : '#2B3322'} strokeWidth="2" />
          <text x={r.x + 14} y={r.y + (mobile ? 25 : 34)} className="font-display" fontSize={mobile ? 14 : 17} fontWeight="800" fill={j ? '#050505' : 'var(--fg)'}>
            {j ? `${TAX_PCT}% TAX` : 'TRADE'}
          </text>
          <text x={r.x + 14} y={r.y + (mobile ? 45 : 62)} className="font-mono" fontSize={mobile ? 11 : 13} fill={j ? '#050505' : 'var(--muted)'} fontWeight={j ? 700 : 400}>
            {j ? <Tw v={tax} /> : 'buy or sell'}
          </text>
        </g>
      ))}
      {/* branch nodes */}
      {BRANCHES.map((b, i) => {
        const y = G.cy(i) - G.bh / 2;
        const x = G.bx;
        const accent = b.k === 'potUsd';
        return (
          <g key={b.k}>
            <rect ref={(el) => { L.boxes[i] = el; }} x={x} y={y} width={G.bw} height={G.bh} rx="4" fill={accent ? '#13190A' : '#0E0F0C'} stroke={accent ? '#B6FF2E' : '#2B3322'} strokeWidth="2" />
            <rect x={x} y={y} width="5" height={G.bh} fill={b.color} />
            {mobile ? (
              <>
                <text x={x + 16} y={y + 26} className="font-display" fontSize="13.5" fontWeight="800" style={txt}>{b.label}</text>
                <text x={x + 16} y={y + 45} className="font-mono" fontSize="11" fill="var(--muted)">{b.sub}</text>
                <text x={x + 16} y={y + 78} className="font-display" fontSize="19" fontWeight="800" fill={accent ? '#B6FF2E' : 'var(--fg)'}><Tw v={totals ? totals[b.k] : null} /></text>
                <text x={x + G.bw - 14} y={y + 78} textAnchor="end" className="font-mono" fontSize="11" fill="var(--muted)">24h <Tw v={day ? day[b.k] : null} /></text>
              </>
            ) : (
              <>
                <text x={x + 20} y={y + 30} className="font-display" fontSize="15" fontWeight="800" style={txt}>{b.label}</text>
                <text x={x + G.bw - 16} y={y + 30} textAnchor="end" className="font-mono" fontSize="12" fill="var(--muted)">{b.sub}</text>
                <text x={x + 20} y={y + 64} className="font-display" fontSize="21" fontWeight="800" fill={accent ? '#B6FF2E' : 'var(--fg)'}><Tw v={totals ? totals[b.k] : null} /></text>
                <text x={x + G.bw - 16} y={y + 64} textAnchor="end" className="font-mono" fontSize="12" fill="var(--muted)">24h <Tw v={day ? day[b.k] : null} /></text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const NS = 'http://www.w3.org/2000/svg';
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function FeeFlow() {
  const reduce = usePrefersReducedMotion();
  const { events, seeded, connected } = useLiveFees(undefined, 8);
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const layouts = useRef<Layout[]>([newLayout(), newLayout()]);

  // Totals: poll /api/fees/summary (fast until it exists, then a slow re-sync), add live events in between.
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      const s = await fetchFeeSummary();
      if (stop) return;
      if (s && typeof s.totalTaxUsd === 'number') setSummary(s);
      t = setTimeout(load, s ? 30_000 : 15_000);
    };
    load();
    return () => { stop = true; clearTimeout(t); };
  }, []);

  // ---- particles -------------------------------------------------------------
  const queue = useRef<FeeEvent[]>([]);
  const dots = useRef<{ el: SVGCircleElement; path: SVGPathElement; len: number; t0: number; box: SVGRectElement | null }[]>([]);
  const raf = useRef(0);

  const frame = useCallback((now: number) => {
    dots.current = dots.current.filter((d) => {
      const k = (now - d.t0) / DOT_MS;
      if (k >= 1) {
        d.el.remove();
        if (d.box) { d.box.classList.remove('fee-hit'); void d.box.getBBox(); d.box.classList.add('fee-hit'); }
        return false;
      }
      const p = d.path.getPointAtLength(ease(Math.max(0, k)) * d.len);
      d.el.setAttribute('cx', String(p.x));
      d.el.setAttribute('cy', String(p.y));
      d.el.setAttribute('opacity', String(k < 0 ? 0 : 1));
      return true;
    });
    raf.current = dots.current.length ? requestAnimationFrame(frame) : 0;
  }, []);

  const spawn = useCallback((e: FeeEvent) => {
    const L = layouts.current.find((l) => l.svg && l.svg.getBoundingClientRect().width > 0);
    if (!L || !L.dots) return;
    const t0 = performance.now(); // rAF timestamps share this clock
    BRANCHES.forEach((b, i) => {
      const path = L.paths[i];
      if (!path) return;
      const el = document.createElementNS(NS, 'circle');
      const amt = Math.max(0, e[b.k]);
      el.setAttribute('r', String(Math.min(7, 3 + Math.sqrt(amt) * 2.2)));
      el.setAttribute('fill', b.color);
      el.setAttribute('opacity', '0');
      el.style.filter = `drop-shadow(0 0 4px ${b.color})`;
      L.dots!.appendChild(el);
      dots.current.push({ el, path, len: path.getTotalLength(), t0: t0 + i * 40, box: L.boxes[i] ?? null });
    });
    if (!raf.current) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(() => {
    const off = onFeeEvent((e) => {
      setSummary((s) => (s ? { ...addToTotals(s, e), last24h: addToTotals(s.last24h, e) } : s));
      if (!reduce) { queue.current.push(e); if (queue.current.length > 12) queue.current.shift(); }
    });
    const iv = setInterval(() => {
      const e = queue.current.shift();
      if (e && document.visibilityState === 'visible') spawn(e);
    }, 1000 / MAX_PER_SEC);
    return () => { off(); clearInterval(iv); };
  }, [reduce, spawn]);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    dots.current.forEach((d) => d.el.remove());
    dots.current = [];
  }, []);

  const totals = summary;
  const day = summary?.last24h ?? null;
  const status = connected ? (seeded || summary ? 'live' : 'waiting for fee feed') : 'connecting';

  return (
    <section className="mx-auto max-w-7xl px-4 pt-16">
      <SectionTitle right={
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase text-muted">
          <span className={`h-2 w-2 rounded-full ${status === 'live' ? 'animate-pulse bg-accent' : 'bg-muted/60'}`} />{status}
        </span>
      }>Where the fees go</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-[1.75fr_1fr]">
        <div className="panel panel-strong min-w-0 p-3 sm:p-5">
          <p className="mb-3 max-w-xl text-sm text-muted">
            Every buy and sell pays a fixed {TAX_PCT}% tax. flap.sh keeps ~{FLAP_CUT_PCT}%; the rest splits {SPLIT.platform}% / {SPLIT.pot}% / {SPLIT.buyback}%.
            {!reduce && ' Each dot is a real trade.'}
          </p>
          <Diagram mobile={false} totals={totals} day={day} L={layouts.current[0]} />
          <Diagram mobile totals={totals} day={day} L={layouts.current[1]} />
          <div className="mt-2 text-right font-mono text-[10px] text-muted">all-time · 24h {summary ? '' : '· totals load when the fee API answers'}</div>
        </div>

        <div className="panel panel-strong min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b-2 border-line px-4 py-3">
            <h3 className="font-display text-sm font-extrabold uppercase">Live fees</h3>
            <span className="font-mono text-[10px] uppercase text-muted">tax · pot share</span>
          </div>
          {events.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">{seeded ? 'Waiting for the next trade…' : 'Fee feed is warming up…'}</div>
          ) : (
            <ul className="divide-y divide-line font-mono text-xs">
              {events.map((e) => (
                <li key={e.id} className="fee-in grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-4 py-2.5">
                  <span className="min-w-0 truncate">
                    <span className="font-display text-[12px] font-bold text-glow">${e.ticker}</span>{' '}
                    <span className={`font-bold ${e.side === 'BUY' ? 'text-success' : 'text-danger'}`}>{e.side}</span>
                    {e.pending && <span className="ml-1.5 text-[10px] text-muted" title="pending vault sync">◌</span>}
                  </span>
                  <span className="text-right">{feeUsd(e.taxUsd)} <span className="text-accent">→ {feeUsd(e.potUsd)}</span></span>
                  <span className="w-8 text-right text-muted">{ago(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
