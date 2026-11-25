'use client';
import { useMemo, useState } from 'react';
import type { ForgeToken } from '@/lib/forge';
import { ActionButton } from '../wallet/ActionButton';
import { TxStatus } from '../wallet/tx';
import { fmtUnits as fmt, useFlapTrade } from '../trade/useFlapTrade';
import { useForgeT } from './useForge';

const SLIPS = [50, 100, 200, 500] as const; // bps

/**
 * Full-width $FORGE trade bar. Trade logic is shared with machine pages (components/trade/useFlapTrade):
 * flap Portal quoteExactInput / swapExactInput (works on the curve and after graduation).
 * Enabled whenever the token is live — independent of NEXT_PUBLIC_FACTORY_ADDRESS.
 * Mobile: sticky bottom bar that expands into a sheet. Desktop: prominent inline panel.
 */
export function ForgeTradeBar({ token, preview }: { token: ForgeToken; preview: boolean }) {
  const t = useForgeT();
  const [slip, setSlip] = useState<number>(200);
  const [open, setOpen] = useState(false);
  const sym = token.symbol || 'FORGE';
  const ft = useFlapTrade({ token: token.address, symbol: sym, enabled: !preview, slipBps: slip });
  const { enabled, wallet: w, side, switchSide, amt, setAmt, pick, amountIn, quoteOut, minOut, balance, over, tx, submit } = ft;

  // Preview: rough estimate from the price so the layout reads right (never sent anywhere).
  const estPreview = useMemo(() => {
    if (enabled || !amt || !(Number(amt) > 0) || !(token.priceBnb > 0)) return undefined;
    return side === 'BUY' ? Number(amt) / token.priceBnb : Number(amt) * token.priceBnb;
  }, [enabled, amt, side, token.priceBnb]);

  const label = ft.status === 'enter' ? t('enter_amount')
    : ft.status === 'insufficient' ? `${t('insufficient')} ${side === 'BUY' ? 'BNB' : sym}`
    : ft.status === 'quote_na' ? t('quote_na')
    : ft.status === 'fetching' ? t('fetching')
    : ft.status === 'approve' ? t('approve_sell') : `${side === 'BUY' ? t('buy') : t('sell')} $${sym}`;

  const outSym = side === 'BUY' ? sym : 'BNB';
  const recv = enabled ? fmt(quoteOut) : estPreview !== undefined ? estPreview.toLocaleString('en-US', { maximumFractionDigits: side === 'BUY' ? 0 : 4 }) : '—';
  const minRecv = enabled ? fmt(minOut) : estPreview !== undefined ? (estPreview * (1 - slip / 10_000)).toLocaleString('en-US', { maximumFractionDigits: side === 'BUY' ? 0 : 4 }) : '—';

  return (
    <div className="sticky bottom-0 z-40 -mx-4 order-last border-t-2 border-accent/60 bg-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_-12px_#B6FF2E40] backdrop-blur lg:static lg:order-none lg:mx-0 lg:rounded-md lg:border-2 lg:bg-surface lg:p-5 lg:shadow-[6px_6px_0_0_var(--accent)]">
      {/* Mobile collapsed bar */}
      <div className={`${open ? 'hidden' : 'flex'} items-center gap-2 lg:hidden`}>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold">{t('trade_title')}</div>
          <div className="truncate font-mono text-[11px] text-muted">{preview ? t('preview_trade') : token.stage === 'CURVE' ? t('route_curve') : t('route_pool')}</div>
        </div>
        <button onClick={() => { switchSide('BUY'); setOpen(true); }} className="rounded-md bg-success px-4 py-2.5 font-display text-sm font-bold text-black">{t('buy')}</button>
        <button onClick={() => { switchSide('SELL'); setOpen(true); }} className="rounded-md bg-danger px-4 py-2.5 font-display text-sm font-bold text-black">{t('sell')}</button>
      </div>

      <div className={`${open ? 'block' : 'hidden'} lg:block`}>
        <div className="mb-3 flex items-center justify-between lg:mb-4">
          <h2 className="font-display text-base font-extrabold uppercase lg:text-lg">{t('trade_title')}
            {preview && <span className="ml-2 rounded-sm border border-accent px-1.5 py-px align-middle font-display text-[10px] font-bold uppercase text-accent">{t('preview')}</span>}
          </h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md border border-line text-muted lg:hidden">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </div>
        <div className="grid gap-4 lg:grid-cols-[220px_1.4fr_1fr_260px] lg:items-start">
          <div>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
              {(['BUY', 'SELL'] as const).map((s) => (
                <button key={s} onClick={() => switchSide(s)} className={`rounded-md py-2.5 font-display font-bold tracking-wide transition ${side === s ? (s === 'BUY' ? 'bg-success text-black' : 'bg-danger text-black') : 'text-muted hover:text-fg'}`}>{s === 'BUY' ? t('buy') : t('sell')}</button>
              ))}
            </div>
            <div className="mt-3 hidden text-[11px] text-muted lg:block">{token.stage === 'CURVE' ? t('route_curve') : t('route_pool')}</div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-muted">
              <label htmlFor="forge-amt">{t('amount')} ({side === 'BUY' ? 'BNB' : `$${sym}`})</label>
              {w.connected && enabled && <span className="font-mono">{t('balance')} {fmt(balance)}</span>}
            </div>
            <div className="mt-1 flex items-center rounded-md border-2 border-line bg-bg px-3 focus-within:border-accent">
              <input id="forge-amt" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.0" className="w-full bg-transparent py-2.5 font-mono text-lg outline-none" />
              <span className="font-mono text-xs text-muted">{side === 'BUY' ? 'BNB' : sym}</span>
            </div>
            <div className="mt-2 flex gap-1">{(side === 'BUY' ? ['0.05', '0.1', '0.5', '1'] : ['25%', '50%', '75%', 'Max']).map((q) => (
              <button key={q} onClick={() => pick(q)} className="flex-1 rounded border border-line py-1 font-mono text-xs text-muted transition hover:border-accent hover:text-fg">{q}</button>
            ))}</div>
          </div>

          <div className="space-y-1.5 text-xs text-muted">
            <div className="flex justify-between gap-2"><span>{t('receive')}</span><span className="font-mono text-fg">{recv} {outSym}</span></div>
            <div className="flex justify-between gap-2"><span>{t('min_recv')}</span><span className="font-mono">{minRecv} {outSym}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span>{t('slippage')}</span>
              <span className="flex overflow-hidden rounded border border-line font-mono">
                {SLIPS.map((s) => (
                  <button key={s} onClick={() => setSlip(s)} className={`px-1.5 py-0.5 ${slip === s ? 'bg-accent font-bold text-black' : 'hover:text-fg'}`}>{s / 100}%</button>
                ))}
              </span>
            </div>
            <div className="flex justify-between gap-2"><span>{t('st_tax')}</span><span className="font-mono text-fg">{token.buyTaxBps / 100}% / {token.sellTaxBps / 100}%</span></div>
          </div>

          <div>
            {enabled ? (
              <ActionButton onClick={submit} busy={tx.busy} disabled={!amountIn || over || minOut === undefined}>
                {tx.busy ? t('working') : label}
              </ActionButton>
            ) : (
              <button type="button" disabled className="btn-chunky w-full cursor-not-allowed py-3 text-sm opacity-60">{t('preview_trade')}</button>
            )}
            <TxStatus state={tx.state} />
          </div>
        </div>
      </div>
    </div>
  );
}
