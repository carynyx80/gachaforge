'use client';
import { useState } from 'react';
import { addrUrl, txUrl } from '@/lib/chain';
import { ago, short } from '@/lib/format';
import { FORGE_SUPPLY, compact, flapTokenUrl, pancakeUrl, priceFmt, type ForgeToken, type ForgeTrade } from '@/lib/forge';
import { useTween } from '../live/AnimatedNumber';
import { useForgeT } from './useForge';

function Copy({ text }: { text: string }) {
  const t = useForgeT();
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); }); }}
      className={`rounded border px-2 py-0.5 font-display text-[10px] font-bold uppercase transition ${ok ? 'border-success text-success' : 'border-line text-muted hover:border-accent hover:text-fg'}`}>
      {ok ? t('copied') : t('copy')}
    </button>
  );
}

const linkCls = 'inline-flex items-center gap-1 rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-xs text-muted transition hover:border-accent hover:text-fg';

export function ForgeHeader({ token, preview }: { token: ForgeToken; preview: boolean }) {
  const t = useForgeT();
  const curve = token.stage === 'CURVE';
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 border-accent bg-accent shadow-[4px_4px_0_0_var(--fg)] sm:h-20 sm:w-20">
          {token.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={token.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center font-display text-2xl font-black text-black sm:text-3xl">F</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-black uppercase sm:text-4xl">{token.name}</h1>
            <span className="font-display text-lg font-bold text-accent sm:text-2xl">${token.symbol}</span>
            {preview && <span className="rounded-sm border-2 border-accent bg-accent-soft px-2 py-0.5 font-display text-xs font-extrabold uppercase tracking-wide text-accent" title={t('preview_note')}>{t('preview')}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
            <span>{t('contract')}</span>
            <a href={addrUrl(token.address)} target="_blank" rel="noreferrer" className="text-fg hover:text-accent"><span className="sm:hidden">{short(token.address)}</span><span className="hidden sm:inline">{token.address}</span></a>
            <Copy text={token.address} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:items-end">
        <div className="flex flex-wrap items-center gap-2">
          {curve ? (
            <div className="flex items-center gap-2 rounded-md border-2 border-accent/60 bg-accent-soft px-3 py-1.5">
              <span className="font-display text-xs font-bold uppercase text-glow">{t('stage_curve')}</span>
              <span className="h-2 w-20 overflow-hidden rounded-full bg-black/60 ring-1 ring-line"><span className="rip-bar block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, token.bondingCurvePct))}%` }} /></span>
              <span className="font-mono text-xs font-bold">{token.bondingCurvePct.toFixed(1)}%</span>
            </div>
          ) : (
            <a href={token.pool ? addrUrl(token.pool) : pancakeUrl(token.address)} target="_blank" rel="noreferrer" className="rounded-md border-2 border-success/60 bg-success/10 px-3 py-1.5 font-display text-xs font-bold uppercase text-success">{t('stage_grad')} ↗</a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a className={linkCls} href={flapTokenUrl(token.address)} target="_blank" rel="noreferrer">flap.sh ↗</a>
          <a className={linkCls} href={addrUrl(token.address)} target="_blank" rel="noreferrer">BscScan ↗</a>
          {token.links?.x && <a className={linkCls} href={token.links.x} target="_blank" rel="noreferrer">X ↗</a>}
          {token.links?.telegram && <a className={linkCls} href={token.links.telegram} target="_blank" rel="noreferrer">Telegram ↗</a>}
          {token.links?.website && <a className={linkCls} href={token.links.website} target="_blank" rel="noreferrer">Web ↗</a>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, children, sub, accent }: { label: string; children: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`min-w-0 rounded-md border p-3 sm:p-4 ${accent ? 'border-accent/50 bg-accent-soft' : 'border-line bg-surface'}`}>
      <div className="truncate text-[10px] uppercase tracking-widest text-muted sm:text-xs">{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-bold tabular-nums sm:text-xl">{children}</div>
      {sub && <div className="truncate font-mono text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function ForgeStats({ token }: { token: ForgeToken }) {
  const t = useForgeT();
  const price = useTween(token.priceUsd);
  const mcap = useTween(token.marketCapUsd);
  const vol = useTween(token.volume24hUsd);
  const ch = token.change24hPct;
  const burnedPct = (token.burnedTokens / FORGE_SUPPLY) * 100;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <Stat label={t('st_price')} accent sub={`${token.priceBnb.toExponential(3)} BNB`}>{priceFmt(price)}</Stat>
      <Stat label={t('st_mcap')}>${compact(mcap, 2)}</Stat>
      <Stat label={t('st_change')}><span className={ch >= 0 ? 'text-success' : 'text-danger'}>{ch >= 0 ? '+' : ''}{ch.toFixed(2)}%</span></Stat>
      <Stat label={t('st_vol')}>${compact(vol, 2)}</Stat>
      <Stat label={t('st_holders')}>{token.holders.toLocaleString('en-US')}</Stat>
      <Stat label={t('st_burned')} sub={`${burnedPct.toFixed(2)}% ${t('of_supply')}`}><span className="forge-flame">🔥</span> {compact(token.burnedTokens, 2)}</Stat>
      <Stat label={t('st_tax')}>{token.buyTaxBps / 100}% / {token.sellTaxBps / 100}%</Stat>
    </div>
  );
}

export function ForgeTrades({ trades, symbol }: { trades: ForgeTrade[]; symbol: string }) {
  const t = useForgeT();
  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">{t('trades_title')}</h2>
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-accent" /></span>
      </div>
      <div className="max-h-[396px] flex-1 overflow-y-auto">
        {!trades.length && <div className="px-4 py-10 text-center font-mono text-sm text-muted">{t('trades_empty')}</div>}
        <table className="w-full whitespace-nowrap text-xs">
          <tbody className="divide-y divide-line font-mono">
            {trades.map((tr, i) => (
              <tr key={`${tr.txHash}:${tr.side}:${tr.tokens}:${i}`} className="fee-in hover:bg-white/[0.02]">
                <td className="py-2 pl-4"><span className={`font-bold ${tr.side === 'BUY' ? 'text-success' : 'text-danger'}`}>{tr.side === 'BUY' ? t('buy') : t('sell')}</span></td>
                <td className="px-2"><a href={addrUrl(tr.trader)} target="_blank" rel="noreferrer" className="text-muted hover:text-fg">{tr.trader.slice(0, 6)}…{tr.trader.slice(-3)}</a></td>
                <td className="px-2 text-right">{tr.amountBnb < 0.0001 ? '<0.0001' : tr.amountBnb.toLocaleString('en-US', { maximumFractionDigits: tr.amountBnb < 1 ? 4 : 3 })} <span className="text-muted">BNB</span></td>
                <td className="hidden px-2 text-right sm:table-cell lg:hidden">{compact(tr.tokens)} <span className="text-muted">{symbol}</span></td>
                <td className="px-2 text-right text-muted">{ago(tr.timestamp)}</td>
                <td className="pr-4 text-right"><a href={txUrl(tr.txHash)} target="_blank" rel="noreferrer" aria-label="View tx" className="text-glow hover:underline">↗</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
