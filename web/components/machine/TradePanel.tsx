'use client';
import { useEffect, useMemo, useState } from 'react';
import { erc20Abi, formatUnits, isAddress, maxUint256, parseUnits, type Address } from 'viem';
import { useBalance, useReadContract, useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import type { Machine } from '@/lib/types';
import { SPLIT } from '@/lib/economics';
import { CONTRACTS_LIVE, FLAP_PORTAL, NATIVE, SLIPPAGE_BPS } from '@/lib/chain';
import { flapPortalAbi } from '@/lib/abi/flapPortal';
import { ActionButton } from '../wallet/ActionButton';
import { TxStatus, useTx } from '../wallet/tx';
import { useWallet } from '../wallet/useWallet';

const fmt = (v: bigint | undefined, d = 4) => (v === undefined ? '—' : Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: d }));

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function TradePanel({ m }: { m: Machine }) {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [amt, setAmt] = useState('0.1');
  const w = useWallet();
  const token = m.address as Address;
  const live = CONTRACTS_LIVE && isAddress(m.address);
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  const { data: bnbBal, refetch: refetchBnb } = useBalance({ address: w.address, chainId: bsc.id, query: { enabled: !!w.address } });
  const { data: tokBal, refetch: refetchTok } = useReadContract({
    address: token, abi: erc20Abi, functionName: 'balanceOf', args: w.address ? [w.address] : undefined, chainId: bsc.id,
    query: { enabled: live && !!w.address },
  });
  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: token, abi: erc20Abi, functionName: 'allowance', args: w.address ? [w.address, FLAP_PORTAL] : undefined, chainId: bsc.id,
    query: { enabled: live && !!w.address && side === 'SELL' },
  });

  const amountIn = useMemo(() => {
    try { return amt && Number(amt) > 0 ? parseUnits(amt.trim(), 18) : undefined; } catch { return undefined; }
  }, [amt]);
  const debounced = useDebounced(amountIn);

  const inputToken = side === 'BUY' ? NATIVE : token;
  const outputToken = side === 'BUY' ? token : NATIVE;
  const quote = useReadContract({
    address: FLAP_PORTAL, abi: flapPortalAbi, functionName: 'quoteExactInput', chainId: bsc.id,
    args: debounced ? [{ inputToken, outputToken, inputAmount: debounced }] : undefined,
    query: { enabled: live && !!debounced, refetchInterval: 15_000 },
  });
  const quoteOut = debounced === amountIn ? quote.data : undefined;
  const minOut = quoteOut !== undefined ? (quoteOut * (BigInt(10_000) - SLIPPAGE_BPS)) / BigInt(10_000) : undefined;

  const pick = (q: string) => {
    if (side === 'BUY') return setAmt(q);
    if (tokBal === undefined) return;
    const pct = q === 'Max' ? 100 : Number(q.slice(0, -1));
    setAmt(formatUnits((tokBal * BigInt(pct)) / BigInt(100), 18));
  };

  const balance = side === 'BUY' ? bnbBal?.value : tokBal;
  const over = amountIn !== undefined && balance !== undefined && amountIn > balance;
  const needsApproval = side === 'SELL' && amountIn !== undefined && (allowance ?? BigInt(0)) < amountIn;

  const submit = async () => {
    if (!amountIn || minOut === undefined) return;
    if (needsApproval) {
      const ok = await tx.run(() => writeContractAsync({ address: token, abi: erc20Abi, functionName: 'approve', args: [FLAP_PORTAL, maxUint256], chainId: bsc.id }), `Approve $${m.ticker}`);
      await refetchAllow();
      if (!ok) return;
    }
    const r = await tx.run(() => writeContractAsync({
      address: FLAP_PORTAL, abi: flapPortalAbi, functionName: 'swapExactInput', chainId: bsc.id,
      args: [{ inputToken, outputToken, inputAmount: amountIn, minOutputAmount: minOut, permitData: '0x' }],
      value: side === 'BUY' ? amountIn : BigInt(0),
    }), side === 'BUY' ? `Buy $${m.ticker}` : `Sell $${m.ticker}`);
    if (r) { refetchBnb(); refetchTok(); }
  };

  const label = !amountIn ? 'Enter amount'
    : over ? `Insufficient ${side === 'BUY' ? 'BNB' : m.ticker}`
    : quote.isError ? 'Quote unavailable'
    : minOut === undefined ? 'Fetching quote…'
    : needsApproval ? `Approve & sell` : side === 'BUY' ? `Buy $${m.ticker}` : `Sell $${m.ticker}`;

  return (
    <div className="panel p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
        {(['BUY', 'SELL'] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); setAmt(s === 'BUY' ? '0.1' : ''); tx.reset(); }} className={`rounded-md py-2 font-display font-bold tracking-wider ${side === s ? (s === 'BUY' ? 'bg-success text-black' : 'bg-danger text-black') : 'text-muted'}`}>{s}</button>
        ))}
      </div>
      <div className="mt-4 flex justify-between text-xs text-muted">
        <label htmlFor="trade-amt">Amount ({side === 'BUY' ? 'BNB' : `$${m.ticker}`})</label>
        {w.connected && live && <span className="font-mono">Bal {fmt(balance)}</span>}
      </div>
      <div className="mt-1 flex items-center rounded-md border border-line bg-bg px-3 focus-within:border-accent">
        <input id="trade-amt" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.0" className="w-full bg-transparent py-2.5 font-mono outline-none" />
        <span className="text-xs text-muted">{side === 'BUY' ? 'BNB' : m.ticker}</span>
      </div>
      <div className="mt-2 flex gap-1">{(side === 'BUY' ? ['0.05', '0.1', '0.5', '1'] : ['25%', '50%', '75%', 'Max']).map((q) => (
        <button key={q} onClick={() => pick(q)} className="flex-1 rounded border border-line py-1 font-mono text-xs text-muted hover:border-accent hover:text-fg">{q}</button>
      ))}</div>
      <div className="mt-3 space-y-1 text-xs text-muted">
        {live && (
          <>
            <div className="flex justify-between"><span>You receive (est.)</span><span className="font-mono text-fg">{fmt(quoteOut)} {side === 'BUY' ? m.ticker : 'BNB'}</span></div>
            <div className="flex justify-between"><span>Min. after 2% slippage</span><span className="font-mono">{fmt(minOut)}</span></div>
          </>
        )}
        <div className="flex justify-between"><span>Trading tax</span><span className="font-mono text-fg">{m.taxBps / 100}% buy / {m.taxBps / 100}% sell · locked</span></div>
        <div className="flex justify-between"><span>{SPLIT.platform}% of tax →</span><span>GachaForge platform</span></div>
        <div className="flex justify-between"><span>{SPLIT.pot}% of tax →</span><span className="text-glow">gacha pot</span></div>
        <div className="flex justify-between"><span>{SPLIT.buyback}% of tax →</span><span>$FORGE buyback & burn</span></div>
      </div>
      <ActionButton className="mt-4" onClick={submit} busy={tx.busy}
        disabledLabel={live ? undefined : 'Trading opens at mainnet launch'}
        disabled={!amountIn || over || minOut === undefined}>
        {tx.busy ? 'Working…' : label}
      </ActionButton>
      <TxStatus state={tx.state} />
      <p className="mt-2 text-center text-[10px] text-muted">Trades route through flap.sh {m.stage === 'CURVE' ? 'bonding curve' : 'pool'}.</p>
    </div>
  );
}
