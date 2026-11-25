'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { USE_MOCK, WS_URL } from '@/lib/api';
import { fetchRecentFees, type FeeEvent } from '@/lib/fees';

/**
 * One shared WebSocket per page (module singleton, ref-counted by subscribers).
 * Keeps the last MAX_EVENTS fee events, the latest pot per machine, and a per-machine
 * "pull" counter (bumped by a WS 'pull' message or a pot drop between fee events).
 * Other components can listen to raw messages through `onLiveMessage`.
 */

const MAX_EVENTS = 60;

/** `at`: ms when this value became known (event time for seeded history, receive time for live). */
export interface LivePot { potUsd: number; packPriceUsd: number; pending: boolean; at: number; ts: number }
export interface LiveFeesState {
  events: FeeEvent[]; // newest first
  pots: Record<string, LivePot>; // key: lowercased machine address
  pulls: Record<string, number>; // per-machine pull counter
  connected: boolean;
  seeded: boolean; // /api/fees/recent answered at least once
}

type Msg = { type: string; data: unknown };
type RawListener = (m: Msg) => void;

let state: LiveFeesState = { events: [], pots: {}, pulls: {}, connected: false, seeded: false };
const listeners = new Set<() => void>();
const rawListeners = new Set<RawListener>();
const feeListeners = new Set<(e: FeeEvent) => void>();
const lastPullAt: Record<string, number> = {};
const seen = new Set<string>();
let refs = 0;
let ws: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let seedTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;

const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<LiveFeesState>) => { state = { ...state, ...patch }; emit(); };
const key = (a: string) => a.toLowerCase();

function bumpPull(machine: string) {
  const k = key(machine);
  lastPullAt[k] = Date.now();
  set({ pulls: { ...state.pulls, [k]: (state.pulls[k] ?? 0) + 1 } });
}

/**
 * The backend does not push pending→false. Clear "pending sync" when (a) a newer event for the
 * machine arrives with pending=false (handled by ingest), (b) a 'machine' WS update for it lands,
 * or (c) PENDING_TTL_MS after the event — whichever comes first.
 */
const PENDING_TTL_MS = 15_000;
function clearPending(k: string, id?: string) {
  let changed = false;
  const events = state.events.map((x) => {
    if (!x.pending || key(x.machine) !== k || (id && x.id !== id)) return x;
    changed = true;
    return { ...x, pending: false };
  });
  const pot = state.pots[k];
  const newest = events.find((x) => key(x.machine) === k);
  const potPending = pot ? Boolean(newest?.pending) : false;
  if (pot && pot.pending !== potPending) changed = true;
  if (changed) set({ events, pots: pot ? { ...state.pots, [k]: { ...pot, pending: potPending } } : state.pots });
}

function ingest(e: FeeEvent, live: boolean) {
  if (!e || typeof e.id !== 'string' || seen.has(e.id)) return;
  seen.add(e.id);
  if (e.pending) {
    const age = live ? 0 : Math.max(0, Date.now() - e.timestamp * 1000);
    if (age >= PENDING_TTL_MS) e = { ...e, pending: false };
    else setTimeout(() => clearPending(key(e.machine), e.id), PENDING_TTL_MS - age);
  }
  const k = key(e.machine);
  const prev = state.pots[k];
  const takePot = live || !prev || e.timestamp >= prev.ts;
  const pot: LivePot = { potUsd: e.potAfterUsd, packPriceUsd: e.packPriceUsd, pending: e.pending, at: live ? Date.now() : e.timestamp * 1000, ts: e.timestamp };
  const events = [e, ...state.events].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_EVENTS);
  state = { ...state, pots: takePot ? { ...state.pots, [k]: pot } : state.pots, events };
  // Pot dropped between two live fee events -> a pull fired (unless the 'pull' message already told us).
  if (live && prev && e.potAfterUsd < prev.potUsd - 0.01 && Date.now() - (lastPullAt[k] ?? 0) > 10_000) {
    bumpPull(e.machine);
    return;
  }
  emit();
}

/** A fee event may update its pending flag later (same id). */
function update(e: FeeEvent) {
  const i = state.events.findIndex((x) => x.id === e.id);
  if (i < 0) return ingest(e, true);
  const events = state.events.slice();
  events[i] = e;
  const k = key(e.machine);
  const pot = state.pots[k];
  set({ events, pots: pot ? { ...state.pots, [k]: { ...pot, pending: e.pending } } : state.pots });
}

async function seed() {
  const recent = await fetchRecentFees(undefined, 40);
  if (refs === 0) return;
  if (recent) {
    // oldest first so the newest one ends up setting the pot
    recent.forEach((e) => ingest(e, false));
    set({ seeded: true });
  } else {
    // Fee API not deployed yet: keep polling quietly.
    seedTimer = setTimeout(seed, 15_000);
  }
}

function connect() {
  if (USE_MOCK || typeof window === 'undefined') return;
  const sock = new WebSocket(WS_URL);
  ws = sock;
  sock.onopen = () => { backoff = 1000; set({ connected: true }); };
  sock.onmessage = (ev) => {
    let m: Msg;
    try { m = JSON.parse(String(ev.data)) as Msg; } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'fee') {
      const e = m.data as FeeEvent;
      if (!e || typeof e.id !== 'string') return;
      if (seen.has(e.id)) update(e);
      else { ingest(e, true); feeListeners.forEach((l) => l(e)); }
    } else if (m.type === 'machine') {
      const d = m.data as { address?: string };
      if (d?.address) clearPending(key(d.address));
    } else if (m.type === 'pull') {
      const p = m.data as { machine?: string };
      if (p?.machine) bumpPull(p.machine);
    }
    rawListeners.forEach((l) => l(m));
  };
  sock.onclose = () => {
    if (ws !== sock) return; // superseded / torn down
    ws = null;
    if (state.connected) set({ connected: false });
    if (refs > 0) { retry = setTimeout(() => { retry = null; connect(); }, backoff); backoff = Math.min(backoff * 2, 15_000); }
  };
  sock.onerror = () => sock.close();
}

function retain() {
  if (++refs === 1 && !ws && !retry) { connect(); seed(); }
}
function release() {
  if (--refs > 0) return;
  // Defer teardown a tick: route changes / StrictMode remount re-retain immediately, so the socket survives.
  setTimeout(teardown, 0);
}
function teardown() {
  if (refs > 0) return;
  if (retry) clearTimeout(retry);
  if (seedTimer) clearTimeout(seedTimer);
  retry = seedTimer = null;
  const s = ws; ws = null; s?.close();
  if (state.connected) set({ connected: false });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;
const SERVER: LiveFeesState = { events: [], pots: {}, pulls: {}, connected: false, seeded: false };
const getServerSnapshot = () => SERVER;

/** Live fee feed. `machine` filters `events` and exposes that machine's pot / pull counter. */
export function useLiveFees(machine?: string, limit = 20) {
  useEffect(() => { retain(); return release; }, []);
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const k = machine ? key(machine) : '';
  const events = machine ? s.events.filter((e) => key(e.machine) === k) : s.events;
  return {
    events: events.slice(0, limit),
    pots: s.pots,
    pot: machine ? s.pots[k] : undefined,
    pulls: machine ? s.pulls[k] ?? 0 : 0,
    allPulls: s.pulls,
    connected: s.connected,
    seeded: s.seeded,
  };
}

/** Raw WS messages on the shared socket (keeps the socket alive while mounted). */
export function onLiveMessage(l: RawListener) {
  retain();
  rawListeners.add(l);
  return () => { rawListeners.delete(l); release(); };
}

/** Subscribe to every *new* fee event as it arrives (for one-shot effects like particles/chips). */
export function onFeeEvent(l: (e: FeeEvent) => void) {
  retain();
  feeListeners.add(l);
  return () => { feeListeners.delete(l); release(); };
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}
