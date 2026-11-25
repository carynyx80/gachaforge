'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { USE_MOCK } from '@/lib/api';
import { onLiveMessage } from './live/useLiveFees';

/**
 * Keeps server-rendered lists fresh without thrashing: fee/pot numbers stream through
 * `useLiveFees`, so the page only re-renders (router.refresh) on a slow interval and
 * shortly after a pull lands (new card in the lists). Shares the page's single socket.
 */
export function LiveRefresh({ intervalMs = 30_000, pullDelayMs = 2500 }: { intervalMs?: number; pullDelayMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (USE_MOCK) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const tick = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, intervalMs);
    const off = onLiveMessage((m) => {
      if (m.type !== 'pull' || pending) return;
      pending = setTimeout(() => { pending = null; router.refresh(); }, pullDelayMs);
    });
    return () => { clearInterval(tick); if (pending) clearTimeout(pending); off(); };
  }, [router, intervalMs, pullDelayMs]);

  return null;
}
