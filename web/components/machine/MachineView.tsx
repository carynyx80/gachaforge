'use client';
import { useMemo, useState } from 'react';
import type { ActivityEvent, Machine, Pull, Trade } from '@/lib/types';
import { ago, num, PACK_LABEL, short, usd } from '@/lib/format';
import { STRATEGY_INFO } from '@/lib/strategies';
import { MachineArt } from '../MachineArt';
import { CardThumb } from '../CardThumb';
import { GachaMachine } from '../GachaMachine';
import { WinnerCell } from '../RecentPulls';
import { TradePanel } from './TradePanel';
import { RewardsPanel } from './RewardsPanel';

const BSC = 'https://bscscan.com';

function series(seed: string, n = 60, end = 1) {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: number[] = [];
  let v = 0.4;
  for (let i = 0; i < n; i++) { v = Math.max(0.05, v + (r() - 0.45) * 0.08); out.push(v); }
  const k = end / out[out.length - 1];
  return out.map((x) => x * k);
}

function PriceChart({ m }: { m: Machine }) {
  const data = useMemo(() => series(m.address, 60, m.marketCapUsd), [m]);
  const max = Math.max(...data), min = Math.min(...data);
  const W = 600, H = 220;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - 10 - ((v - min) / (max - min || 1)) * (H - 30)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const up = m.change24hPct >= 0;
  const c = up ? '#3DDC97' : '#FF4D4D';
  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Market cap</div>
          <div className="font-mono text-2xl font-bold">{usd(m.marketCapUsd, true)} <span className={`text-sm ${up ? 'text-success' : 'text-danger'}`}>{up ? '▲' : '▼'} {Math.abs(m.change24hPct)}%</span></div>
        </div>
        <div className="flex gap-1 text-xs">{['1H', '6H', '24H', '7D'].map((x, i) => <span key={x} className={`rounded px-2 py-1 ${i === 2 ? 'bg-accent text-black' : 'border border-line text-muted'}`}>{x}</span>)}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full sm:h-56" preserveAspectRatio="none">
        <defs><linearGradient id="pc-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity=".35" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="#1F2419" strokeDasharray="4 6" />)}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#pc-f)" />
        <path d={line} fill="none" stroke={c} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 text-right text-[10px] text-muted">Chart preview · mock data</div>
    </div>
  );
}

function CopyAddr({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(value); setOk(true); setTimeout(() => setOk(false), 1200); }}
      className="inline-flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1 font-mono text-xs text-muted transition hover:border-accent hover:text-fg">
      <span className="text-muted/70">{label}</span>{short(value)}<span className="text-accent">{ok ? '✓' : '⧉'}</span>
    </button>
  );
}

export function MachineView({ m, pulls, trades, activity }: { m: Machine; pulls: Pull[]; trades: Trade[]; activity: ActivityEvent[] }) {
  const [tab, setTab] = useState<'pulls' | 'trades' | 'activity'>('pulls');
  const info = STRATEGY_INFO[m.strategy];
  const pct = Math.min(100, (m.potUsd / m.packPriceUsd) * 100);
  const last = pulls[0];
  const stats = [
    ['Market cap', usd(m.marketCapUsd, true)], ['24h volume', usd(m.volume24hUsd, true)], ['Holders', num(m.holders)],
    ['Eligible', num(m.eligibleHolders)], ['Packs opened', num(m.packsOpened)], ['Paid to holders', `${m.paidToHoldersBnb} BNB`],
  ];
  return (
    <div className="mx-auto max-w-7xl px-4 pt-8">
      {/* header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <MachineArt image={m.image} ticker={m.ticker} className="h-20 w-20 shrink-0 rounded-xl ring-2 ring-accent/50" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="font-display text-3xl font-bold sm:text-4xl">{m.name}</h1>
            <span className="font-display text-xl font-bold text-glow">${m.ticker}</span>
          </div>
          <p className="mt-1 text-sm text-muted">{m.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CopyAddr label="CA" value={m.address} />
            <CopyAddr label="Vault" value={m.vault} />
            <a href={`${BSC}/token/${m.address}`} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg">BscScan ↗</a>
            {m.links?.x && <a href={m.links.x} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg">X ↗</a>}
            {m.links?.website && <a href={m.links.website} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg">Web ↗</a>}
            {m.links?.telegram && <a href={m.links.telegram} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg">TG ↗</a>}
          </div>
        </div>
      </div>

      {/* strategy */}
      <div className="panel mt-6 flex flex-col gap-3 border-accent/40 bg-accent-soft/30 p-4 sm:flex-row sm:items-center">
        <span className="inline-flex shrink-0 items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-display font-bold uppercase tracking-wider text-black">{info.icon} {info.title}</span>
        <p className="text-sm text-fg/90">{info.long}{m.split && ` Ratio: ${m.split.dividendBps / 100}% dividend / ${m.split.burnBps / 100}% burn / ${m.split.lpBps / 100}% LP.`} <span className="text-muted">Tax {m.taxBps / 100}% · locked.</span></p>
      </div>

      {/* stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([l, v]) => (
          <div key={l} className="panel p-3"><div className="text-[11px] uppercase tracking-widest text-muted">{l}</div><div className="mt-1 font-mono text-lg font-semibold">{v}</div></div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <PriceChart m={m} />

          <div className="panel p-4">
            <div className="mb-2 flex justify-between text-sm"><span className="text-muted">Bonding curve</span><span className="font-mono">{m.bondingCurvePct}%{m.stage === 'GRADUATED' && <span className="ml-2 text-success">Graduated</span>}</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-black/60 ring-1 ring-line"><div className="h-full rounded-full bg-gradient-to-r from-accent to-glow" style={{ width: `${m.bondingCurvePct}%` }} /></div>
            <p className="mt-2 text-xs text-muted">Pulls run even before graduation — as soon as the pot covers a pack.</p>
          </div>

          {/* tabs */}
          <div className="panel overflow-hidden">
            <div className="flex border-b border-line">
              {(['pulls', 'trades', 'activity'] as const).map((x) => (
                <button key={x} onClick={() => setTab(x)} className={`flex-1 py-3 font-display font-semibold uppercase tracking-wider ${tab === x ? 'border-b-2 border-accent text-fg' : 'text-muted'}`}>{x}</button>
              ))}
            </div>
            {tab === 'pulls' && pulls.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">No pulls yet. The first pull opens when the pot reaches the pack price.</div>}
            {tab === 'trades' && trades.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">No trades yet.</div>}
            {tab === 'activity' && activity.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">No recent activity.</div>}
            {tab === 'pulls' && (
              <ul className="divide-y divide-line">{pulls.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <CardThumb card={p.card} />
                  <div className="min-w-0 flex-1"><div className="truncate font-semibold">{p.card.name}</div><div className="text-xs text-muted">{p.card.grader} {p.card.grade} · {usd(p.card.valueUsd)} · R{p.round}</div></div>
                  <div className="text-right"><WinnerCell p={p} /><div className="font-mono text-[11px] text-muted">{ago(p.timestamp)}</div></div>
                </li>))}
              </ul>
            )}
            {tab === 'trades' && (
              <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs uppercase tracking-widest text-muted"><tr><th className="px-4 py-2">Side</th><th>Trader</th><th>BNB</th><th>Tokens</th><th>Tax</th><th className="pr-4 text-right">Time</th></tr></thead>
                <tbody className="divide-y divide-line font-mono">{trades.map((tr) => (
                  <tr key={tr.txHash}><td className={`px-4 py-2 font-bold ${tr.side === 'BUY' ? 'text-success' : 'text-danger'}`}>{tr.side}</td><td className="text-muted">{short(tr.trader)}</td><td>{tr.amountBnb}</td><td>{num(tr.tokens)}</td><td className="text-glow">{usd(tr.taxUsd)}</td>
                    <td className="pr-4 text-right"><a href={`${BSC}/tx/${tr.txHash}`} target="_blank" rel="noreferrer" className="text-muted hover:text-fg">{ago(tr.timestamp)} ↗</a></td></tr>))}
                </tbody></table></div>
            )}
            {tab === 'activity' && (
              <ul className="divide-y divide-line">{activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span><span className="font-display font-bold text-glow">${a.ticker}</span> <span className="text-muted">{a.text}</span></span><span className="font-mono text-xs text-muted">{ago(a.timestamp)}</span></li>))}
              </ul>
            )}
          </div>
        </div>

        {/* side column */}
        <div className="flex min-w-0 flex-col gap-6">
          <div className="panel relative overflow-hidden p-4">
            <div className="flex items-center gap-4">
              <GachaMachine className="w-24 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-widest text-muted">Gacha pot · Round #{m.round}</div>
                <div className="font-mono text-2xl font-bold">{usd(m.potUsd)} <span className="text-base text-muted">/ {usd(m.packPriceUsd)}</span></div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/60 ring-1 ring-line"><div className="rip-bar h-full rounded-full" style={{ width: `${pct}%` }} /></div>
                <div className="mt-1.5 text-sm font-semibold text-accent">{usd(Math.max(0, m.packPriceUsd - m.potUsd))} to rip</div>
                <div className="text-xs text-muted">{PACK_LABEL[m.pack]}</div>
              </div>
            </div>
            {last && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
                <CardThumb card={last.card} size="md" />
                <div className="min-w-0"><div className="text-[11px] uppercase tracking-widest text-muted">Last card</div><div className="font-semibold">{last.card.name}</div><div className="text-xs text-muted">{last.card.grader} {last.card.grade} · {usd(last.card.valueUsd)}</div><div className="mt-1"><WinnerCell p={last} /></div></div>
              </div>
            )}
          </div>

          <TradePanel m={m} />

          <RewardsPanel m={m} />

          <div className="panel p-4">
            {m.strategy === 'RAFFLE' || m.strategy === 'HIT_HUNTER' ? (
              <>
                <h3 className="font-display text-lg font-bold uppercase tracking-wide">Raffle odds</h3>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-xs text-muted">Eligible holders</div><div className="font-mono text-lg">{num(m.eligibleHolders)}</div></div>
                  <div><div className="text-xs text-muted">Avg. odds / pull</div><div className="font-mono text-lg">{(100 / Math.max(1, m.eligibleHolders)).toFixed(2)}%</div></div>
                </div>
                <p className="mt-3 text-xs text-muted">Weighted by balance. Each raffle publishes snapshot hash, seed and winner so anyone can re-check.</p>
              </>
            ) : (
              <>
                <h3 className="font-display text-lg font-bold uppercase tracking-wide">{m.strategy === 'BURN' ? 'Burn stats' : 'Dividend stats'}</h3>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-xs text-muted">Paid to holders</div><div className="font-mono text-lg">{m.paidToHoldersBnb} BNB</div></div>
                  <div><div className="text-xs text-muted">Tokens burned</div><div className="font-mono text-lg">{num(m.burnedTokens)}</div></div>
                </div>
                <p className="mt-3 text-xs text-muted">Sell-back rate: 90% within 1h · 85% within 24h · 50% within 72h.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
