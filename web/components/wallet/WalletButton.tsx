'use client';
import { useEffect, useRef, useState } from 'react';
import { useBalance, useDisconnect } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { formatUnits } from 'viem';
import { short } from '@/lib/format';
import { addrUrl } from '@/lib/chain';
import { useWallet } from './useWallet';

export function WalletButton({ label }: { label: string }) {
  const w = useWallet();
  const { disconnect } = useDisconnect();
  const { data: bal } = useBalance({ address: w.address, chainId: bsc.id, query: { enabled: !!w.address, refetchInterval: 30_000 } });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!w.connected || !w.address) {
    return (
      <button className="btn-chunky px-4 py-2 text-sm" onClick={w.openConnect} disabled={w.connecting} aria-busy={w.connecting}>
        {w.connecting ? '…' : label}
      </button>
    );
  }

  if (w.wrongChain) {
    return (
      <button className="btn-chunky whitespace-nowrap px-3 py-2 text-sm" onClick={w.switchToBsc} disabled={w.switching}>
        {w.switching ? 'Switching…' : 'Switch to BNB Chain'}
      </button>
    );
  }

  const bnb = bal ? Number(formatUnits(bal.value, bal.decimals)) : undefined;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-2 rounded-md border-2 border-accent/60 bg-surface px-3 py-1.5 font-mono text-sm transition hover:border-accent">
        <span className="hidden text-muted sm:inline">{bnb === undefined ? '— BNB' : `${bnb.toFixed(bnb < 1 ? 4 : 3)} BNB`}</span>
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_#B6FF2E]" />
        <span>{short(w.address)}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-line bg-surface shadow-[0_12px_40px_-12px_#000]">
          <div className="border-b border-line px-3 py-2.5 text-xs text-muted">
            <div className="font-mono text-fg">{short(w.address)}</div>
            <div className="mt-0.5">{bnb === undefined ? '—' : `${bnb.toFixed(5)} BNB`} · BNB Chain</div>
          </div>
          <button role="menuitem" className="block w-full px-3 py-2.5 text-left text-sm hover:bg-accent-soft"
            onClick={async () => { await navigator.clipboard?.writeText(w.address!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? 'Copied ✓' : 'Copy address'}
          </button>
          <a role="menuitem" href={addrUrl(w.address)} target="_blank" rel="noreferrer" className="block px-3 py-2.5 text-sm hover:bg-accent-soft" onClick={() => setOpen(false)}>
            View on BscScan ↗
          </a>
          <button role="menuitem" className="block w-full border-t border-line px-3 py-2.5 text-left text-sm text-danger hover:bg-danger/10"
            onClick={() => { disconnect(); setOpen(false); }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
