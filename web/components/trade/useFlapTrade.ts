'use client';
import { useEffect, useMemo, useState } from 'react';
import { erc20Abi, formatUnits, isAddress, maxUint256, parseUnits, type Address } from 'viem';
import { useBalance, useReadContract, useWriteContract } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { FLAP_PORTAL, NATIVE } from '@/lib/chain';
import { flapPortalAbi } from '@/lib/abi/flapPortal';
import { useTx } from '../wallet/tx';
import { useWallet } from '../wallet/useWallet';

export type Side = 'BUY' | 'SELL';

export const fmtUnits = (v: bigint | undefined, d = 4, locale = 'en-US') =>
  (v === undefined ? '—' : Number(formatUnits(v, 18)).toLocaleString(locale, { maximumFractionDigits: d }));

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/**
 * Shared flap.sh Portal trade logic for any flap token ($FORGE and every machine token):
 * quoteExactInput (eth_call) → optional ERC-20 approve to the Portal → swapExactInput.
 * Works on the bonding curve and after graduation to PancakeSwap.
 */
export function useFlapTrade({ token, symbol, enabled, slipBps, refetchMs = 12_000 }: {
  token: string; symbol: string; enabled: boolean; slipBps: number; refetchMs?: number;
}) {
  const [side, setSide] = useState<Side>('BUY');
  const [amt, setAmt] = useState('0.1');
  const w = useWallet();
  const addr = token as Address;
  const on = enabled && isAddress(token);
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  const { data: bnbBal, refetch: refetchBnb } = useBalance({ address: w.address, chainId: bsc.id, query: { enabled: on && !!w.address } });
  const { data: tokBal, refetch: refetchTok } = useReadContract({
    address: addr, abi: erc20Abi, functionName: 'balanceOf', args: w.address ? [w.address] : undefined, chainId: bsc.id,
    query: { enabled: on && !!w.address },
  });
  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: addr, abi: erc20Abi, functionName: 'allowance', args: w.address ? [w.address, FLAP_PORTAL] : undefined, chainId: bsc.id,
    query: { enabled: on && !!w.address && side === 'SELL' },
  });

  const amountIn = useMemo(() => {
    try { return amt && Number(amt) > 0 ? parseUnits(amt.trim(), 18) : undefined; } catch { return undefined; }
  }, [amt]);
  const debounced = useDebounced(amountIn);
  const inputToken = side === 'BUY' ? NATIVE : addr;
  const outputToken = side === 'BUY' ? addr : NATIVE;
  const quote = useReadContract({
    address: FLAP_PORTAL, abi: flapPortalAbi, functionName: 'quoteExactInput', chainId: bsc.id,
    args: debounced ? [{ inputToken, outputToken, inputAmount: debounced }] : undefined,
    query: { enabled: on && !!debounced, refetchInterval: refetchMs },
  });
  const quoteOut = debounced === amountIn ? quote.data : undefined;
  const minOut = quoteOut !== undefined ? (quoteOut * BigInt(10_000 - slipBps)) / BigInt(10_000) : undefined;

  const balance = side === 'BUY' ? bnbBal?.value : tokBal;
  const over = amountIn !== undefined && balance !== undefined && amountIn > balance;
  const needsApproval = side === 'SELL' && amountIn !== undefined && (allowance ?? BigInt(0)) < amountIn;

  /** Quick-amount chips: BNB values on BUY, "25%"/"Max" of token balance on SELL. */
  const pick = (q: string) => {
    if (side === 'BUY') return setAmt(q);
    if (tokBal === undefined) return;
    const pct = q === 'Max' ? 100 : Number(q.slice(0, -1));
    setAmt(formatUnits((tokBal * BigInt(pct)) / BigInt(100), 18));
  };

  const switchSide = (s: Side) => { setSide(s); setAmt(s === 'BUY' ? '0.1' : ''); tx.reset(); };

  const submit = async () => {
    if (!on || !amountIn || minOut === undefined) return;
    if (needsApproval) {
      const ok = await tx.run(() => writeContractAsync({ address: addr, abi: erc20Abi, functionName: 'approve', args: [FLAP_PORTAL, maxUint256], chainId: bsc.id }), `Approve $${symbol}`);
      await refetchAllow();
      if (!ok) return;
    }
    const r = await tx.run(() => writeContractAsync({
      address: FLAP_PORTAL, abi: flapPortalAbi, functionName: 'swapExactInput', chainId: bsc.id,
      args: [{ inputToken, outputToken, inputAmount: amountIn, minOutputAmount: minOut, permitData: '0x' }],
      value: side === 'BUY' ? amountIn : BigInt(0),
    }), side === 'BUY' ? `Buy $${symbol}` : `Sell $${symbol}`);
    if (r) { refetchBnb(); refetchTok(); }
  };

  /** Button label state (callers translate). */
  const status: 'enter' | 'insufficient' | 'quote_na' | 'fetching' | 'approve' | 'ready' =
    !amountIn ? 'enter' : over ? 'insufficient' : quote.isError ? 'quote_na' : minOut === undefined ? 'fetching' : needsApproval ? 'approve' : 'ready';

  return {
    enabled: on, wallet: w, side, setSide, switchSide, amt, setAmt, pick, amountIn, quoteOut, minOut, balance, over,
    needsApproval, quote, submit, tx, status, canSubmit: !!amountIn && !over && minOut !== undefined,
  };
}
