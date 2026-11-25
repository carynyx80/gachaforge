'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { INTERVALS, applyTrade, fetchForgeCandles, fixtureCandles, priceFmt, type Candle, type ForgeTrade, type Interval } from '@/lib/forge';
import { useForgeT } from './useForge';

const H = 340;
const VOL_H = 48;
const PAD_R = 78;
const PAD_T = 12;

/** Hand-rolled SVG candlestick chart (no chart lib): candles + volume, crosshair, live trade folding. */
export function ForgeChart({ subscribeTrades, fixture }: { subscribeTrades: (cb: (t: ForgeTrade) => void) => () => void; fixture: boolean }) {
  const t = useForgeT();
  const [interval, setIntervalV] = useState<Interval>('15m');
  const [data, setData] = useState<{ iv: Interval; c: Candle[] } | null>(null);
  const candles = data?.iv === interval ? data.c : null;
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let on = true;
    const load = async () => {
      const c = fixture ? fixtureCandles(interval) : await fetchForgeCandles(interval);
      if (on) setData({ iv: interval, c: c ?? [] });
    };
    load();
    const id = fixture ? undefined : setInterval(load, 60_000);
    const off = subscribeTrades((tr) => setData((d) => (d && d.iv === interval ? { iv: d.iv, c: applyTrade(d.c, tr, interval) } : d)));
    return () => { on = false; clearInterval(id); off(); };
  }, [interval, fixture, subscribeTrades]);

  const maxBars = Math.max(20, Math.floor((w - PAD_R) / 7));
  const view = useMemo(() => (candles ?? []).slice(-maxBars), [candles, maxBars]);
  const geo = useMemo(() => {
    if (!view.length) return null;
    const hi = Math.max(...view.map((c) => c.h));
    const lo = Math.min(...view.map((c) => c.l));
    const span = hi - lo || hi * 0.05 || 1;
    const top = hi + span * 0.08;
    const bot = lo - span * 0.08;
    const plotH = H - VOL_H - PAD_T - 18;
    const y = (p: number) => PAD_T + ((top - p) / (top - bot)) * plotH;
    const bw = (w - PAD_R) / maxBars;
    const x = (i: number) => (maxBars - view.length + i) * bw + bw / 2;
    const vmax = Math.max(...view.map((c) => c.v)) || 1;
    const ticks = Array.from({ length: 5 }, (_, i) => bot + ((top - bot) * (i + 0.5)) / 5);
    return { y, x, bw, vmax, ticks, plotH };
  }, [view, w, maxBars]);

  const last = view[view.length - 1];
  const hc = hover !== null ? view[hover] : null;
  const shown = hc ?? last;
  const up = shown ? shown.c >= shown.o : true;
  const fmtT = (s: number) => {
    const d = new Date(s * 1000);
    return interval === '1d' ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    const i = Math.floor(px / geo.bw) - (maxBars - view.length);
    setHover(i >= 0 && i < view.length ? i : null);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-xs">
          <span className="uppercase tracking-widest text-muted">{t('chart')}</span>
          {shown && (
            <span className={up ? 'text-success' : 'text-danger'}>
              O {priceFmt(shown.o)} H {priceFmt(shown.h)} L {priceFmt(shown.l)} C {priceFmt(shown.c)}
            </span>
          )}
        </div>
        <div role="tablist" className="flex overflow-hidden rounded-md border border-line font-mono text-xs">
          {INTERVALS.map((iv) => (
            <button key={iv} role="tab" aria-selected={iv === interval} onClick={() => setIntervalV(iv)}
              className={`px-2.5 py-1.5 transition ${iv === interval ? 'bg-accent font-bold text-black' : 'text-muted hover:text-fg'}`}>{iv}</button>
          ))}
        </div>
      </div>
      <div ref={box} className="relative" style={{ height: H }}>
        {candles === null && <div className="absolute inset-0 grid place-items-center font-mono text-sm text-muted">{t('chart_loading')}</div>}
        {candles && !view.length && <div className="absolute inset-0 grid place-items-center font-mono text-sm text-muted">{t('chart_empty')}</div>}
        {geo && (
          <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} className="block touch-pan-y select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {geo.ticks.map((p, i) => (
              <g key={i}>
                <line x1={0} x2={w - PAD_R} y1={geo.y(p)} y2={geo.y(p)} stroke="var(--line)" strokeDasharray="2 4" />
                <text x={w - PAD_R + 6} y={geo.y(p) + 4} fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{priceFmt(p)}</text>
              </g>
            ))}
            {view.map((c, i) => {
              const cx = geo.x(i);
              const g = c.c >= c.o;
              const col = g ? 'var(--success)' : 'var(--danger)';
              const bw = Math.max(1, geo.bw * 0.66);
              const yo = geo.y(c.o), yc = geo.y(c.c);
              const vh = (c.v / geo.vmax) * (VOL_H - 6);
              return (
                <g key={c.t}>
                  <rect x={cx - bw / 2} y={H - 18 - vh} width={bw} height={vh} fill={col} opacity={0.22} />
                  <line x1={cx} x2={cx} y1={geo.y(c.h)} y2={geo.y(c.l)} stroke={col} strokeWidth={1} />
                  <rect x={cx - bw / 2} y={Math.min(yo, yc)} width={bw} height={Math.max(1, Math.abs(yc - yo))} fill={col} />
                </g>
              );
            })}
            {last && (
              <g>
                <line x1={0} x2={w - PAD_R} y1={geo.y(last.c)} y2={geo.y(last.c)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
                <rect x={w - PAD_R + 2} y={geo.y(last.c) - 9} width={PAD_R - 4} height={18} rx={2} fill="var(--accent)" />
                <text x={w - PAD_R + 6} y={geo.y(last.c) + 4} fontSize="10" fontWeight="700" fill="#050505" fontFamily="var(--font-mono)">{priceFmt(last.c)}</text>
              </g>
            )}
            {hc && hover !== null && (
              <g pointerEvents="none">
                <line x1={geo.x(hover)} x2={geo.x(hover)} y1={0} y2={H - 18} stroke="var(--muted)" strokeDasharray="3 3" />
                <text x={Math.min(w - PAD_R - 60, Math.max(4, geo.x(hover) - 30))} y={H - 4} fontSize="10" fill="var(--fg)" fontFamily="var(--font-mono)">{fmtT(hc.t)}</text>
              </g>
            )}
            {!hc && view.length > 1 && [0, Math.floor(view.length / 2), view.length - 1].map((i) => (
              <text key={i} x={Math.min(w - PAD_R - 60, Math.max(4, geo.x(i) - 24))} y={H - 4} fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{fmtT(view[i].t)}</text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
