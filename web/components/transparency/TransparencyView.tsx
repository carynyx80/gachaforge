'use client';
import { useQuery } from '@tanstack/react-query';
import { isAddress, type Address } from 'viem';
import { useBalance } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { getAllMachines, getTransparency } from '@/lib/api';
import { TREASURY_ADDRESS, addrUrl, txUrl } from '@/lib/chain';
import { ago, short, usd } from '@/lib/format';
import type { TransparencyMachine } from '@/lib/types';
import { useHealth, useOffT } from '../useOffchain';

const REFRESH = 15_000;
const bnb = (n: number | undefined, d = 4) => (n === undefined ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) })} BNB`);

const KIND_STYLE: [RegExp, string][] = [
  [/PACK|PULL|RENAISS|USDT|CARD/i, 'bg-accent text-black'],
  [/DIVIDEND|PAYOUT/i, 'bg-success text-black'],
  [/BURN|BUYBACK|FORGE/i, 'bg-danger text-black'],
  [/DISPATCH/i, 'border border-glow/50 text-glow'],
];
const kindCls = (k: string) => KIND_STYLE.find(([r]) => r.test(k))?.[1] ?? 'border border-line text-muted';

function WalletCard({ title, desc, address, balance, note }: { title: string; desc: string; address?: string; balance?: number; note?: string }) {
  const t = useOffT();
  return (
    <div className="panel p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold uppercase">{title}</h2>
        {address && <a href={addrUrl(address)} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted hover:text-fg">{short(address)} ↗</a>}
      </div>
      <p className="text-xs text-muted">{desc}</p>
      <div className="mt-4 text-[11px] uppercase tracking-widest text-muted">{t('tr_balance')}</div>
      <div className="font-display text-3xl font-extrabold text-accent">{bnb(balance)}</div>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function TransparencyView() {
  const t = useOffT();
  const health = useHealth();
  const q = useQuery({ queryKey: ['transparency'], queryFn: getTransparency, refetchInterval: REFRESH, retry: false });
  const d = q.data;

  const treasuryAddr = (d?.treasury.address && isAddress(d.treasury.address) ? d.treasury.address : health.data?.treasury && isAddress(health.data.treasury) ? health.data.treasury : TREASURY_ADDRESS) as Address;
  const opsAddr = d?.ops.address && isAddress(d.ops.address) ? (d.ops.address as Address) : undefined;
  const sameWallet = !!opsAddr && opsAddr.toLowerCase() === treasuryAddr.toLowerCase();

  // On-chain fallback when the backend doesn't report a balance.
  const tBal = useBalance({ address: treasuryAddr, chainId: bsc.id, query: { enabled: d?.treasury.balanceBnb === undefined, refetchInterval: REFRESH } });
  const oBal = useBalance({ address: opsAddr, chainId: bsc.id, query: { enabled: !!opsAddr && !sameWallet && d?.ops.balanceBnb === undefined, refetchInterval: REFRESH } });
  const treasuryBnb = d?.treasury.balanceBnb ?? (tBal.data ? Number(tBal.data.value) / 1e18 : undefined);
  const opsBnb = sameWallet ? 0 : !opsAddr ? undefined : d?.ops.balanceBnb ?? (oBal.data ? Number(oBal.data.value) / 1e18 : undefined);

  // Machine ledger: backend rows, else the public machine list (USD pots).
  const fallback = useQuery({
    queryKey: ['transparency-machines'], queryFn: getAllMachines, refetchInterval: REFRESH,
    enabled: !d?.machines,
  });
  const rows: TransparencyMachine[] = d?.machines ?? (fallback.data ?? []).map((m) => ({
    address: m.address, ticker: m.ticker, name: m.name, potUsd: m.potUsd, packPriceUsd: m.packPriceUsd, pulls: m.packsOpened, pullQueued: m.pullQueued,
  }));

  const owed = d?.owed;
  const owedTotal = owed ? owed.total ?? owed.pots + owed.buyback + owed.dividendsPending + (owed.burnsPending ?? 0) : undefined;
  const held = treasuryBnb !== undefined ? treasuryBnb + (opsBnb ?? 0) : undefined;
  const coverage = owedTotal !== undefined && held !== undefined ? (owedTotal > 0 ? (held / owedTotal) * 100 : Infinity) : undefined;
  const covered = coverage !== undefined && coverage >= 100;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-display text-xs font-bold uppercase tracking-[0.2em] text-glow">{t('tr_kicker')}</div>
          <h1 className="mt-1 font-display text-3xl font-extrabold uppercase sm:text-[2.6rem]"><span className="neon-text text-accent">{t('tr_title_1')}</span></h1>
          <p className="mt-2 max-w-2xl text-muted">{t('tr_sub')}</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${q.isError ? 'bg-danger' : 'animate-pulse bg-accent'}`} />
          {t('tr_live')}
          {q.dataUpdatedAt > 0 && <span>· {t('tr_updated')} {new Date(q.dataUpdatedAt).toLocaleTimeString()}</span>}
        </div>
      </div>

      {q.isError && !d && (
        <div role="status" className="mt-6 rounded-md border border-accent/40 bg-accent-soft/40 px-4 py-3 text-sm">{t('tr_unavailable')}</div>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <WalletCard title={t('tr_treasury')} desc={t('tr_treasury_d')} address={treasuryAddr} balance={treasuryBnb} />
        <WalletCard title={t('tr_ops')} desc={t('tr_ops_d')} address={opsAddr} balance={sameWallet ? treasuryBnb : opsBnb} note={sameWallet ? t('tr_same') : d && !opsAddr ? t('tr_ops_none') : undefined} />
      </div>

      <section className="panel panel-strong mt-6 p-5">
        <h2 className="font-display text-lg font-extrabold uppercase">{t('tr_owed')}</h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <ul className="space-y-2 font-mono text-sm">
            <li className="flex justify-between"><span className="text-muted">{t('tr_owed_pots')}</span><span>{bnb(owed?.pots)}</span></li>
            <li className="flex justify-between"><span className="text-muted">{t('tr_owed_buyback')}</span><span>{bnb(owed?.buyback)}</span></li>
            <li className="flex justify-between"><span className="text-muted">{t('tr_owed_div')}</span><span>{bnb(owed?.dividendsPending)}</span></li>
            {owed?.burnsPending !== undefined && <li className="flex justify-between"><span className="text-muted">{t('tr_owed_burns')}</span><span>{bnb(owed.burnsPending)}</span></li>}
            <li className="flex justify-between border-t border-line pt-2 font-bold"><span>{t('tr_owed_total')}</span><span>{bnb(owedTotal)}</span></li>
            <li className="flex justify-between font-bold text-accent"><span>{t('tr_held')}</span><span>{bnb(held)}</span></li>
          </ul>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-widest text-muted">{t('tr_coverage')}</span>
              <span className={`font-display text-3xl font-extrabold ${coverage === undefined ? 'text-muted' : covered ? 'text-accent' : 'text-danger'}`}>
                {coverage === undefined ? '—' : coverage === Infinity ? '∞' : `${coverage.toFixed(0)}%`}
              </span>
            </div>
            <div className="relative mt-2 h-5 overflow-hidden rounded-sm bg-black/60 ring-1 ring-line">
              <div className={`h-full rounded-sm meter-fill ${covered ? 'bg-gradient-to-r from-accent to-glow' : 'bg-danger'}`} style={{ width: `${coverage === undefined ? 0 : Math.min(100, coverage)}%` }} />
              <span className="absolute inset-y-0 right-0 w-px bg-fg/60" title="100%" />
            </div>
            <p className="mt-2 text-xs text-muted">{t('tr_coverage_note')}</p>
          </div>
        </div>
      </section>

      <section className="panel mt-6 overflow-hidden">
        <h2 className="border-b border-line px-5 py-4 font-display text-lg font-extrabold uppercase">{t('tr_ledger')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted">
              <tr><th className="px-5 py-2">{t('tr_col_machine')}</th><th>{t('tr_col_pot')}</th><th>{t('tr_col_in')}</th><th>{t('tr_col_out')}</th><th>{t('tr_col_pulls')}</th><th className="pr-5 text-right">{t('tr_col_status')}</th></tr>
            </thead>
            <tbody className="divide-y divide-line font-mono">
              {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center font-sans text-muted">{t('tr_no_machines')}</td></tr>}
              {rows.map((m) => {
                const ready = m.potUsd !== undefined && m.packPriceUsd !== undefined && m.potUsd >= m.packPriceUsd;
                return (
                  <tr key={m.address}>
                    <td className="px-5 py-2.5"><a href={`/m/${m.address}`} className="font-display font-bold text-glow hover:underline">${m.ticker ?? short(m.address)}</a> <span className="text-xs text-muted">{short(m.address)}</span></td>
                    <td>{m.potBnb !== undefined ? <>{bnb(m.potBnb)}{m.potUsd !== undefined && <span className="text-muted"> · {usd(m.potUsd)}</span>}</> : m.potUsd !== undefined ? <>{usd(m.potUsd)}{m.packPriceUsd ? <span className="text-muted"> / {usd(m.packPriceUsd)}</span> : null}</> : '—'}</td>
                    <td className="text-muted">{bnb(m.taxBnb ?? m.creditedBnb)}</td>
                    <td className="text-muted">{bnb(m.dividendsPendingBnb)}</td>
                    <td>{m.pulls ?? '—'}</td>
                    <td className="pr-5 text-right">
                      <span className={`rounded-sm px-1.5 py-0.5 font-display text-[10px] font-bold uppercase ${m.pullQueued ? 'bg-accent text-black' : ready ? 'border border-accent text-accent' : 'border border-line text-muted'}`}>
                        {m.pullQueued ? t('tr_queued') : ready ? t('tr_ready') : t('tr_filling')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">{t('tr_note')}</p>
      </section>

      <section className="panel mt-6 overflow-hidden">
        <h2 className="border-b border-line px-5 py-4 font-display text-lg font-extrabold uppercase">{t('tr_txs')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted">
              <tr><th className="px-5 py-2">{t('tr_col_kind')}</th><th>{t('tr_col_amount')}</th><th>{t('tr_col_machine')}</th><th>{t('tr_col_to')}</th><th>{t('tr_col_tx')}</th><th className="pr-5 text-right">{t('tr_col_time')}</th></tr>
            </thead>
            <tbody className="divide-y divide-line font-mono">
              {(d?.txs ?? []).length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center font-sans text-muted">{t('tr_no_txs')}</td></tr>}
              {(d?.txs ?? []).slice(0, 50).map((x, i) => (
                <tr key={`${x.hash}:${i}`}>
                  <td className="px-5 py-2.5"><span title={x.label} className={`rounded-sm px-1.5 py-0.5 font-display text-[10px] font-bold uppercase ${kindCls(x.kind)}`}>{x.kind.replace(/_/g, ' ')}</span>{x.status && x.status !== 'confirmed' && x.status !== 'success' && <span className="ml-2 text-[10px] text-muted">{x.status}</span>}</td>
                  <td>{bnb(x.valueBnb)}</td>
                  <td>{x.machine ? <a href={`/m/${x.machine}`} className="text-glow hover:underline">{x.ticker ? `$${x.ticker}` : short(x.machine)}</a> : <span className="text-muted">—</span>}</td>
                  <td className="text-muted">{x.to ? <a href={addrUrl(x.to)} target="_blank" rel="noreferrer" className="hover:text-fg">{short(x.to)}</a> : '—'}</td>
                  <td>{x.hash ? <a href={txUrl(x.hash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">{short(x.hash)} ↗</a> : '—'}</td>
                  <td className="pr-5 text-right text-muted">{x.timestamp ? ago(x.timestamp) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
