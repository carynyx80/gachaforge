import { Suspense } from 'react';
import { getBurns, getStats } from '@/lib/api';
import { LiveRefresh } from '@/components/LiveRefresh';
import { PageLoading } from '@/components/PageLoading';
import { BurnCounter } from '@/components/BurnCounter';
import { ago, num, short } from '@/lib/format';

export const metadata = { title: 'Buyback & Burn — GachaForge' };

export default function BurnPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-10">
      <LiveRefresh />
      <h1 className="font-display text-4xl font-bold uppercase sm:text-5xl">Buyback <span className="neon-text text-accent">&</span> Burn</h1>
      <p className="mt-2 max-w-2xl text-muted">20% of every machine&apos;s trading tax buys $FORGE on the market and sends it to the dead address. Forever.</p>
      <Suspense fallback={<PageLoading label="Loading burns…" />}>
        <BurnData />
      </Suspense>
    </div>
  );
}

async function BurnData() {
  const [burns, stats] = await Promise.all([getBurns(1), getStats()]);
  return (
    <>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="panel relative overflow-hidden p-6 md:col-span-2">
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-accent/25 blur-3xl" />
          <div className="text-xs uppercase tracking-widest text-muted">Total $FORGE burned</div>
          <div className="mt-2 font-mono text-4xl font-bold sm:text-6xl"><BurnCounter target={burns.totalBurned} /></div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/60 ring-1 ring-line"><div className="rip-bar h-full rounded-full" style={{ width: `${Math.max(2, burns.pctOfSupply)}%` }} /></div>
          <div className="mt-2 font-mono text-sm text-muted"><span className="text-accent">{burns.pctOfSupply}%</span> of 1,000,000,000 supply</div>
        </div>
        <div className="panel p-6">
          <div className="text-xs uppercase tracking-widest text-muted">Burned (USD)</div>
          <div className="mt-2 font-mono text-3xl font-bold">${stats.burnedUsd.toLocaleString('en-US')}</div>
          <div className="mt-4 text-xs uppercase tracking-widest text-muted">Burn address</div>
          <div className="mt-1 break-all font-mono text-xs text-muted">0x000000000000000000000000000000000000dEaD</div>
        </div>
      </div>

      <div className="panel mt-8 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-widest text-muted">
            <tr><th className="px-4 py-3">Type</th><th>Amount ($FORGE)</th><th>Tx</th><th className="pr-4 text-right">Time</th></tr>
          </thead>
          <tbody className="divide-y divide-line font-mono">
            {burns.items.map((b) => (
              <tr key={b.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3"><span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${b.kind === 'BURN' ? 'border-danger/40 bg-danger/15 text-danger' : 'border-accent/40 bg-accent-soft text-glow'}`}>{b.kind === 'BURN' ? '🔥 BURN' : 'BUYBACK'}</span></td>
                <td>{num(b.amount)}</td>
                <td><a href={`https://bscscan.com/tx/${b.txHash}`} target="_blank" rel="noreferrer" className="text-glow hover:underline">{short(b.txHash)} ↗</a></td>
                <td className="pr-4 text-right text-muted">{ago(b.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line px-4 py-2 text-xs text-muted">{burns.total} events</div>
      </div>
    </>
  );
}
