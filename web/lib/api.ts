import type {
  ActivityEvent, BurnEvent, Machine, MachineQuery, Paged, Pull, RaffleProof, RewardsView, Stats, Trade,
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
