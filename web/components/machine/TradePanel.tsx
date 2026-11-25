'use client';
import { isAddress } from 'viem';
import type { Machine } from '@/lib/types';
import { SPLIT } from '@/lib/economics';
import { SLIPPAGE_BPS } from '@/lib/chain';
import { ActionButton } from '../wallet/ActionButton';
import { TxStatus } from '../wallet/tx';
import { fmtUnits as fmt, useFlapTrade } from '../trade/useFlapTrade';
import { useHealth, useOffT } from '../useOffchain';

/**
 * Machine Buy/Sell via the flap.sh Portal — same implementation as the $FORGE trade bar (useFlapTrade).
 * Enabled for real tokens: backend not in mock mode (simulated machines have no on-chain token).
 */
export function TradePanel({ m }: { m: Machine }) {
  const t = useOffT();
  const health = useHealth();
  const real = isAddress(m.address) && !!health.data && health.data.mode !== 'mock';
  const ft = useFlapTrade({ token: m.address, symbol: m.ticker, enabled: real, slipBps: Number(SLIPPAGE_BPS), refetchMs: 15_000 });
  const { wallet: w, side, switchSide, amt, setAmt, pick, quoteOut, minOut, balance, tx, submit } = ft;

  const label = ft.status === 'enter' ? t('tp_enter')
    : ft.status === 'insufficient' ? `${t('tp_insufficient')} ${side === 'BUY' ? 'BNB' : m.ticker}`
    : ft.status === 'quote_na' ? t('tp_quote_na')
    : ft.status === 'fetching' ? t('tp_fetching')
    : ft.status === 'approve' ? t('tp_approve') : `${side === 'BUY' ? t('tp_buy') : t('tp_sell')} $${m.ticker}`;

  return (
    <div className="panel p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
        {(['BUY', 'SELL'] as const).map((s) => (
          <button key={s} onClick={() => switchSide(s)} className={`rounded-md py-2 font-display font-bold tracking-wide ${side === s ? (s === 'BUY' ? 'bg-success text-black' : 'bg-danger text-black') : 'text-muted'}`}>{s === 'BUY' ? t('tp_buy') : t('tp_sell')}</button>
        ))}
      </div>
      <div className="mt-4 flex justify-between text-xs text-muted">
        <label htmlFor="trade-amt">{t('tp_amount')} ({side === 'BUY' ? 'BNB' : `$${m.ticker}`})</label>
        {w.connected && real && <span className="font-mono">{t('tp_bal')} {fmt(balance)}</span>}
      </div>
      <div className="mt-1 flex items-center rounded-md border border-line bg-bg px-3 focus-within:border-accent">
        <input id="trade-amt" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.0" className="w-full bg-transparent py-2.5 font-mono outline-none" />
        <span className="text-xs text-muted">{side === 'BUY' ? 'BNB' : m.ticker}</span>
      </div>
      <div className="mt-2 flex gap-1">{(side === 'BUY' ? ['0.05', '0.1', '0.5', '1'] : ['25%', '50%', '75%', 'Max']).map((q) => (
        <button key={q} onClick={() => pick(q)} className="flex-1 rounded border border-line py-1 font-mono text-xs text-muted hover:border-accent hover:text-fg">{q}</button>
      ))}</div>
      <div className="mt-3 space-y-1 text-xs text-muted">
        {real && (
          <>
            <div className="flex justify-between"><span>{t('tp_receive')}</span><span className="font-mono text-fg">{fmt(quoteOut)} {side === 'BUY' ? m.ticker : 'BNB'}</span></div>
            <div className="flex justify-between"><span>{t('tp_min')}</span><span className="font-mono">{fmt(minOut)}</span></div>
          </>
        )}
        <div className="flex justify-between"><span>{t('tp_tax')}</span><span className="font-mono text-fg">{t('tp_tax_val')}</span></div>
        <div className="flex justify-between"><span>{SPLIT.platform}% {t('tp_of_tax')}</span><span>{t('tp_platform')}</span></div>
        <div className="flex justify-between"><span>{SPLIT.pot}% {t('tp_of_tax')}</span><span className="text-glow">{t('tp_pot')}</span></div>
        <div className="flex justify-between"><span>{SPLIT.buyback}% {t('tp_of_tax')}</span><span>{t('tp_buyback')}</span></div>
      </div>
      <ActionButton className="mt-4" onClick={submit} busy={tx.busy}
        disabledLabel={real ? undefined : t('tp_preview')}
        disabled={!ft.canSubmit}>
        {tx.busy ? t('tp_working') : label}
      </ActionButton>
      <TxStatus state={tx.state} />
      <p className="mt-2 text-center text-[10px] text-muted">{m.stage === 'CURVE' ? t('tp_route_curve') : t('tp_route_pool')}</p>
    </div>
  );
}
