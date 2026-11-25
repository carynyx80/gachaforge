'use client';
import { useCallback, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { bsc } from 'wagmi/chains';
import type { Hash, TransactionReceipt } from 'viem';
import { txErrorMessage, txUrl } from '@/lib/chain';

export type TxState =
  | { s: 'idle' }
  | { s: 'wallet'; label?: string }
  | { s: 'confirming'; hash: Hash; label?: string }
  | { s: 'success'; hash: Hash; label?: string }
  | { s: 'error'; message: string };

/** Runs `send()` (a writeContractAsync call), then waits for the receipt, tracking each phase. */
export function useTx() {
  const client = usePublicClient({ chainId: bsc.id });
  const [state, setState] = useState<TxState>({ s: 'idle' });
  const run = useCallback(async (send: () => Promise<Hash>, label?: string): Promise<TransactionReceipt | undefined> => {
    try {
      setState({ s: 'wallet', label });
      const hash = await send();
      setState({ s: 'confirming', hash, label });
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') { setState({ s: 'error', message: 'Transaction reverted on-chain.' }); return undefined; }
      setState({ s: 'success', hash, label });
      return receipt;
    } catch (e) {
      setState({ s: 'error', message: txErrorMessage(e) });
      return undefined;
    }
  }, [client]);
  const reset = useCallback(() => setState({ s: 'idle' }), []);
  return { state, run, reset, busy: state.s === 'wallet' || state.s === 'confirming' };
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.s === 'idle') return null;
  const box = 'mt-3 rounded-md border px-3 py-2 text-xs';
  if (state.s === 'wallet')
    return <div className={`${box} border-accent/40 bg-accent-soft text-fg`}><Spinner /> {state.label ? `${state.label}: ` : ''}confirm in your wallet…</div>;
  if (state.s === 'confirming')
    return <div className={`${box} border-accent/40 bg-accent-soft text-fg`}><Spinner /> Confirming on BNB Chain… <a className="text-accent underline" href={txUrl(state.hash)} target="_blank" rel="noreferrer">view tx ↗</a></div>;
  if (state.s === 'success')
    return <div className={`${box} border-success/40 bg-success/10 text-success`}>✓ {state.label ? `${state.label} confirmed. ` : 'Confirmed. '}<a className="underline" href={txUrl(state.hash)} target="_blank" rel="noreferrer">View on BscScan ↗</a></div>;
  return <div className={`${box} border-danger/40 bg-danger/10 text-danger`} role="alert">✕ {state.message}</div>;
}

function Spinner() {
  return <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent align-[-2px]" />;
}
