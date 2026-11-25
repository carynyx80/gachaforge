import type {
  ActivityEvent, BurnEvent, DividendClaim, Health, Machine, MachineQuery, PackId, Paged, Pull, RaffleProof, RewardsView, Stats, Strategy, Trade,
  Transparency, TransparencyMachine, TransparencyTx,
} from './types';
import { mockActivity, mockBurns, mockMachines, mockPulls, mockStats, mockTrades } from './mock';

/** Live backend by default (SPEC: server on :4000). Set NEXT_PUBLIC_USE_MOCK=true for offline sample data. */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const page = <T,>(all: T[], p = 1, size = 20): Paged<T> => ({ items: all.slice((p - 1) * size, p * size), total: all.length });

export async function getStats(): Promise<Stats> {
  return USE_MOCK ? mockStats : get('/stats');
}

export function filterMachines(all: Machine[], q: MachineQuery): Paged<Machine> {
  let items = all.filter(
    (m) => (!q.strategy || m.strategy === q.strategy) && (!q.pack || m.pack === q.pack) && (!q.stage || m.stage === q.stage),
  );
  const sort = q.sort ?? 'trending';
  items = [...items].sort((a, b) =>
    sort === 'new' ? b.createdAt - a.createdAt
      : sort === 'most_pulled' ? b.packsOpened - a.packsOpened
      : sort === 'market_cap' ? b.marketCapUsd - a.marketCapUsd
      : b.volume24hUsd - a.volume24hUsd,
  );
  return page(items, q.page ?? 1, q.pageSize ?? 12);
}

export async function getMachines(q: MachineQuery = {}): Promise<Paged<Machine>> {
  if (USE_MOCK) return filterMachines(mockMachines, q);
  return get(`/machines${qs({ ...q })}`);
}

export async function getAboutToRip(): Promise<Machine[]> {
  if (USE_MOCK) return [...mockMachines].sort((a, b) => b.potUsd / b.packPriceUsd - a.potUsd / a.packPriceUsd).slice(0, 3);
  return get('/machines/about-to-rip');
}

export async function getMachine(address: string): Promise<Machine | undefined> {
  if (USE_MOCK) return mockMachines.find((m) => m.address.toLowerCase() === address.toLowerCase());
  const res = await fetch(`${API_URL}/api/machines/${address}`, { cache: 'no-store' });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`API /machines/${address} → ${res.status}`);
  return res.json() as Promise<Machine>;
}

export async function getMachinePulls(address: string, p = 1): Promise<Paged<Pull>> {
  if (USE_MOCK) return page(mockPulls.filter((x) => x.machine === address), p);
  return get(`/machines/${address}/pulls${qs({ page: p })}`);
}

export async function getMachineTrades(address: string, p = 1): Promise<Paged<Trade>> {
  if (USE_MOCK) return page(mockTrades(address), p);
  return get(`/machines/${address}/trades${qs({ page: p })}`);
}

export async function getRewards(address: string, wallet: string): Promise<RewardsView> {
  if (USE_MOCK) return { address: wallet, eligible: true, balance: 250_000, minBalance: 100_000, oddsPct: 0.42, claimableBnb: 0.0132, totalEarnedBnb: 0.08 };
  return get(`/machines/${address}/rewards/${wallet}`);
}

export async function getClaims(address: string, wallet: string): Promise<Paged<DividendClaim>> {
  if (USE_MOCK) return { items: [], total: 0 };
  return get(`/machines/${address}/claims/${wallet}`);
}

/** GET /api/health. Any failure → mode 'mock' (the safe default: preview banner stays visible). */
export async function getHealth(): Promise<Health> {
  if (USE_MOCK) return { mode: 'mock' };
  try {
    const res = await fetch(`${API_URL}/api/health`, { cache: 'no-store' });
    if (!res.ok) return { mode: 'mock' };
    const j = (await res.json()) as Partial<Health> & { mode?: string };
    // Only an explicit 'mock' (or an unreachable backend) is the preview; 'offchain' / 'vault' / 'live' are real.
    const mode = typeof j.mode === 'string' && j.mode && j.mode !== 'mock' ? (j.mode as Health['mode']) : 'mock';
    return { ...j, mode } as Health;
  } catch {
    return { mode: 'mock' };
  }
}

/** Backend mode ('offchain' | 'vault' | 'live' | 'mock'). */
export async function getHealthMode(): Promise<Health['mode']> {
  return (await getHealth()).mode;
}

export interface RegisterBody {
  txHash: string;
  pack: PackId;
  strategy: Strategy;
  split?: { dividendBps: number; burnBps: number; lpBps: number };
  /** TAX MODEL v3: creator-chosen tax (100–1000 bps each side, verified on-chain by the backend). */
  buyTaxBps: number;
  sellTaxBps: number;
  /** Gacha pot share of the creator's 90%, 2000–10000 bps. */
  potShareBps: number;
  /** Creator payout address (defaults to the launching wallet). */
  payout: string;
  /** personal_sign by the launch tx sender over buildRegisterMessage(...) (lib/registerMessage.ts). */
  signature?: string;
}
/** POST /api/machines/register — backend verifies the Portal launch tx on-chain, then records pack/strategy. */
export async function registerMachine(body: RegisterBody): Promise<{ address?: string; machine?: Machine }> {
  const res = await fetch(`${API_URL}/api/machines/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { address?: string; token?: string; machine?: Machine; error?: string; message?: string };
  if (!res.ok) {
    const err = new Error(j.message || j.error || `Register failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return { address: j.address ?? j.token ?? j.machine?.address, machine: j.machine };
}

// ------------------------------------------------------------------ transparency (normaliser)
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
/** Number in BNB from a number, decimal string, or integer wei string/bigint-ish. */
export function bnbOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+$/.test(v) && v.length > 12) return Number(BigInt(v)) / 1e18; // wei
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
const pick = (o: Raw | undefined, ...keys: string[]) => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const pickBnb = (o: Raw | undefined, ...keys: string[]) => {
  for (const k of keys) { const v = bnbOf(o?.[k]); if (v !== undefined) return v; }
  if (o) for (const k of keys) {
    const w = o[k.replace(/Bnb$/, 'Wei')];
    if (typeof w === 'string' && /^\d+$/.test(w)) return Number(BigInt(w)) / 1e18;
    if (typeof w === 'number') return w / 1e18;
  }
  return undefined;
};
const tsOf = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === 'string') { const n = Number(v); if (Number.isFinite(n)) return tsOf(n); const d = Date.parse(v); return Number.isFinite(d) ? Math.floor(d / 1000) : undefined; }
  return undefined;
};

function wallet(raw: unknown, balances: Raw | undefined, key: 'treasury' | 'ops') {
  const o = isObj(raw) ? raw : undefined;
  const address = typeof raw === 'string' ? raw : (pick(o, 'address') as string | undefined);
  const bal = pickBnb(o, 'balanceBnb', 'balance', 'bnb')
    ?? pickBnb(balances, `${key}Bnb`, key, `${key}Balance`, `${key}BalanceBnb`)
    ?? (isObj(balances?.[key]) ? pickBnb(balances![key] as Raw, 'balanceBnb', 'balance', 'bnb') : undefined);
  return { address, balanceBnb: bal };
}

export function normalizeTransparency(j: Raw): Transparency {
  const balances = isObj(j.balances) ? j.balances : undefined;
  const owedRaw = isObj(j.owed) ? j.owed : {};
  const machinesRaw = (Array.isArray(j.machines) ? j.machines : Array.isArray(j.pots) ? j.pots : Array.isArray(j.ledger) ? j.ledger : undefined) as unknown[] | undefined;
  const machines: TransparencyMachine[] | undefined = machinesRaw?.filter(isObj).map((m) => ({
    address: String(pick(m, 'address', 'machine', 'token') ?? ''),
    ticker: pick(m, 'ticker', 'symbol') as string | undefined,
    name: pick(m, 'name') as string | undefined,
    potBnb: pickBnb(m, 'potBnb', 'pot', 'balanceBnb'),
    potUsd: bnbOf(pick(m, 'potUsd')),
    packPriceUsd: bnbOf(pick(m, 'packPriceUsd')),
    creditedBnb: pickBnb(m, 'creditedBnb', 'inBnb', 'totalInBnb', 'potInBnb'),
    taxBnb: pickBnb(m, 'taxBnb'),
    dividendsPendingBnb: pickBnb(m, 'dividendsPendingBnb'),
    spentBnb: pickBnb(m, 'spentBnb', 'outBnb', 'totalOutBnb', 'potOutBnb'),
    pulls: bnbOf(pick(m, 'pulls', 'packsOpened')),
    pullQueued: pick(m, 'pullQueued') === true,
  }));
  const txsRaw = (Array.isArray(j.txs) ? j.txs : Array.isArray(j.transactions) ? j.transactions : []) as unknown[];
  const txs: TransparencyTx[] = txsRaw.filter(isObj).map((t) => ({
    hash: typeof pick(t, 'hash', 'txHash', 'tx') === 'string' ? (pick(t, 'hash', 'txHash', 'tx') as string) : '',
    kind: String(pick(t, 'kind', 'type', 'purpose') ?? 'TX'),
    valueBnb: pickBnb(t, 'valueBnb', 'amountBnb', 'value', 'amount'),
    to: (pick(t, 'to', 'recipient') as string | undefined) || undefined,
    machine: (pick(t, 'machine', 'token') as string | undefined) || undefined,
    label: (pick(t, 'label') as string | undefined) || undefined,
    ticker: pick(t, 'ticker', 'symbol') as string | undefined,
    timestamp: tsOf(pick(t, 'timestamp', 'ts', 'createdAt', 'time')),
    status: pick(t, 'status') as string | undefined,
  }));
  return {
    treasury: wallet(j.treasury, balances, 'treasury'),
    ops: wallet(j.ops, balances, 'ops'),
    owed: {
      pots: pickBnb(owedRaw, 'pots', 'potsBnb') ?? 0,
      buyback: pickBnb(owedRaw, 'buyback', 'buybackBnb') ?? 0,
      dividendsPending: pickBnb(owedRaw, 'dividendsPending', 'dividendsPendingBnb', 'dividends') ?? 0,
      burnsPending: pickBnb(owedRaw, 'burnsPending', 'burnsPendingBnb'),
      total: pickBnb(owedRaw, 'total', 'totalBnb'),
    },
    machines,
    txs,
    updatedAt: tsOf(pick(j, 'updatedAt', 'timestamp', 'asOf')),
  };
}

/** GET /api/transparency. Throws (incl. 404 while the backend is being deployed). */
export async function getTransparency(): Promise<Transparency> {
  return normalizeTransparency(await get<Raw>('/transparency'));
}

export async function getRecentPulls(limit = 20): Promise<Pull[]> {
  return USE_MOCK ? mockPulls.slice(0, limit) : get(`/pulls/recent${qs({ limit })}`);
}

export async function getActivity(limit = 40): Promise<ActivityEvent[]> {
  return USE_MOCK ? mockActivity.slice(0, limit) : get(`/activity${qs({ limit })}`);
}

export async function getBurns(p = 1): Promise<{ totalBurned: number; pctOfSupply: number } & Paged<BurnEvent>> {
  if (USE_MOCK) return { totalBurned: 41_200_000, pctOfSupply: 4.12, ...page(mockBurns, p) };
  return get(`/burns${qs({ page: p })}`);
}

export async function getRaffle(pullId: string): Promise<RaffleProof> {
  if (USE_MOCK) return { snapshotBlock: 44_120_331, snapshotHash: '0x' + 'ab'.repeat(32), seed: '0x' + 'cd'.repeat(32), eligible: [], winner: mockPulls.find((x) => x.id === pullId)?.winner ?? '' };
  return get(`/raffles/${pullId}`);
}

/** All machines (for client-side filtering on the board in mock mode). */
export async function getAllMachines(): Promise<Machine[]> {
  if (USE_MOCK) return mockMachines;
  const first = await get<Paged<Machine>>('/machines?pageSize=100&page=1');
  const items = [...first.items];
  for (let p = 2; items.length < first.total; p++) {
    const next = await get<Paged<Machine>>(`/machines?pageSize=100&page=${p}`);
    if (!next.items.length) break;
    items.push(...next.items);
  }
  return items;
}
