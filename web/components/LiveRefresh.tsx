'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { USE_MOCK, WS_URL } from '@/lib/api';

/**
 * Subscribes to the backend WebSocket and re-renders the current server page
 * (router.refresh) when new activity, pulls, stats or machine updates arrive.
 * Refreshes are throttled so a burst of events causes at most one refresh per `minIntervalMs`.
 */
export function LiveRefresh({ minIntervalMs = 4000 }: { minIntervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (USE_MOCK) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let lastRefresh = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (pending) return;
      const wait = Math.max(0, lastRefresh + minIntervalMs - Date.now());
      pending = setTimeout(() => {
        pending = null;
        lastRefresh = Date.now();
        router.refresh();
      }, wait);
    };

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onmessage = () => schedule();
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      closed = true;
      if (pending) clearTimeout(pending);
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [router, minIntervalMs]);

  return null;
}
