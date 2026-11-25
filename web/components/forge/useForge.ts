'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../LangProvider';
import { onLiveMessage } from '../live/useLiveFees';
import { fillEconomics } from '@/lib/economics';
import { forgeDict, type ForgeKey } from '@/lib/forge-i18n';
import {
  FIXTURE_ALLOWED, fetchForge, fetchForgeTrades, fixtureState, fixtureTrade, fixtureTrades,
  type ForgeState, type ForgeToken, type ForgeTrade,
} from '@/lib/forge';

export function useForgeT() {
  const { lang } = useT();
  return useCallback((k: ForgeKey) => fillEconomics(forgeDict[lang][k]), [lang]);
}

/** Dev-only `?fixture=preview|waiting` (ignored in production builds). */
export function readFixture(): 'preview' | 'waiting' | null {
  if (!FIXTURE_ALLOWED || typeof window === 'undefined') return null;
  const f = new URLSearchParams(window.location.search).get('fixture');
  return f === 'preview' || f === 'waiting' ? f : null;
}

const tradeKey = (t: ForgeTrade) => `${t.txHash}:${t.side}:${t.tokens}`;

/**
 * $FORGE live state: polls GET /api/forge (fast while waiting so the page flips live on its own,
 * and keeps polling if the endpoint is not deployed yet), and listens on the shared socket for
 * `forge` (token snapshot) and `forgeTrade` messages.
 */
export function useForge({ withTrades = true } = {}) {
  const [state, setState] = useState<ForgeState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [trades, setTrades] = useState<ForgeTrade[]>([]);
  const [fixture, setFixture] = useState<'preview' | 'waiting' | null>(null);
  const seen = useRef(new Set<string>());
  const tradeSubs = useRef(new Set<(t: ForgeTrade) => void>());
  const subscribeTrades = useCallback((cb: (t: ForgeTrade) => void) => { tradeSubs.current.add(cb); return () => { tradeSubs.current.delete(cb); }; }, []);
  const live = state?.status === 'live' && !!state.token;

  const pushTrade = useCallback((t: ForgeTrade) => {
    const k = tradeKey(t);
    if (seen.current.has(k)) return;
    seen.current.add(k);
    setTrades((prev) => [t, ...prev].sort((a, b) => b.timestamp - a.timestamp).slice(0, 60));
    tradeSubs.current.forEach((cb) => cb(t));
  }, []);

  // Snapshot polling (or fixture).
  useEffect(() => {
    const fx = readFixture();
    let on = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const s = fx ? fixtureState(fx) : await fetchForge();
      if (!on) return;
      setFixture(fx);
      if (s && (s.status === 'waiting' || s.status === 'live')) setState(s);
      setLoaded(true);
      if (!fx) timer = setTimeout(tick, s?.status === 'live' ? 30_000 : 8_000);
    };
    tick();
    return () => { on = false; clearTimeout(timer); };
  }, []);

  // WS updates.
  useEffect(() => {
    if (readFixture()) return;
    return onLiveMessage((m) => {
      if (m.type === 'forge') {
        const tok = m.data as ForgeToken;
        if (tok?.address) setState((s) => ({ ...(s ?? {}), status: 'live', token: { ...s?.token, ...tok } as ForgeToken }));
      } else if (m.type === 'forgeTrade' && withTrades) {
        const t = m.data as ForgeTrade;
        if (t?.txHash) pushTrade(t);
      }
    });
  }, [pushTrade, withTrades]);

  // Initial trades once live.
  const livePrice = live ? state!.token!.priceUsd : 0;
  const livePriceRef = useRef(livePrice);
  useEffect(() => { livePriceRef.current = livePrice; }, [livePrice]);
  useEffect(() => {
    if (!withTrades || !live) return;
    let on = true;
    (async () => {
      const rows = fixture === 'preview' ? fixtureTrades(livePrice) : await fetchForgeTrades(40);
      if (!on || !rows) return;
      rows.forEach((t) => seen.current.add(tradeKey(t)));
      setTrades((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => tradeKey(p) === tradeKey(r)))].sort((a, b) => b.timestamp - a.timestamp).slice(0, 60));
    })();
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, withTrades, fixture]);

  // Fixture: simulate the live stream.
  useEffect(() => {
    if (fixture !== 'preview' || !withTrades) return;
    const start = setTimeout(() => { price = livePriceRef.current; }, 0);
    let price = 0;
    const id = setInterval(() => {
      if (!price) return;
      const t = fixtureTrade(price);
      const k = t.priceUsd / price;
      price = t.priceUsd;
      pushTrade(t);
      setState((s) => (s?.token ? { ...s, token: { ...s.token, priceUsd: t.priceUsd, marketCapUsd: s.token.marketCapUsd * k, volume24hUsd: s.token.volume24hUsd + t.amountBnb * 620, buybackPendingBnb: s.token.buybackPendingBnb + 0.0004 } } : s));
    }, 3500);
    return () => { clearInterval(id); clearTimeout(start); };
  }, [fixture, withTrades, pushTrade]);

  return { state, loaded, live, trades, subscribeTrades, fixture };
}
