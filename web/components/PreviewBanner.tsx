'use client';
import { useEffect, useState } from 'react';
import { getHealthMode } from '@/lib/api';

/** Shown unless the backend reports mode: 'live'. Defaults to visible (safe) until health answers. */
export function PreviewBanner() {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let on = true;
    getHealthMode().then((m) => { if (on) setLive(m === 'live'); });
    return () => { on = false; };
  }, []);
  if (live) return null;
  return (
    <div role="status" className="sticky top-16 z-40 border-b border-accent/40 bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-center text-xs">
        <span className="rounded-sm border border-accent px-1.5 py-px font-display font-bold uppercase tracking-wide text-accent">Preview</span>
        <span className="text-fg">Simulated activity. Contracts not yet live on BNB Chain.</span>
        <span className="text-muted">预览：模拟数据，合约尚未在 BNB Chain 上线。</span>
      </div>
    </div>
  );
}
