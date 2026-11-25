import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { minEligibleBalance, selectEligible, TOTAL_SUPPLY_DEFAULT } from '../core/index.js';
import { excludedFor } from '../indexer/excluded.js';
import type { Ledger } from '../ledger.js';
import { PACKS, STAGES, STRATEGIES, type Machine, type RewardsView } from '../types.js';

const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);

const machinesQuery = z.object({
  sort: z.preprocess(emptyToUndef, z.enum(['trending', 'new', 'most_pulled', 'market_cap']).default('trending')),
  strategy: z.preprocess(emptyToUndef, z.enum(STRATEGIES as [string, ...string[]]).optional()),
  pack: z.preprocess(emptyToUndef, z.enum(PACKS as [string, ...string[]]).optional()),
  stage: z.preprocess(emptyToUndef, z.enum(STAGES as [string, ...string[]]).optional()),
  page,
  pageSize: pageSize.default(12),
});
const pageQuery = z.object({ page, pageSize: pageSize.default(20) });
const limitQuery = (d: number, max: number) => z.object({ limit: z.coerce.number().int().min(1).max(max).default(d) });
const feesQuery = z.object({
  machine: z.preprocess(emptyToUndef, address.optional()),
  limit: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(100).default(30)),
});

/** Unit helper: base units (18 decimals) → whole tokens with 2dp. */
const units = (b: bigint) => Number(b / 10n ** 16n) / 100;

function trendingScore(m: Machine) {
  return m.volume24hUsd * (1 + Math.max(-0.9, m.change24hPct / 100)) + m.potUsd * 10;
}

const sorters: Record<string, (a: Machine, b: Machine) => number> = {
  trending: (a, b) => trendingScore(b) - trendingScore(a),
  new: (a, b) => b.createdAt - a.createdAt,
  most_pulled: (a, b) => b.packsOpened - a.packsOpened || b.potUsd - a.potUsd,
  market_cap: (a, b) => b.marketCapUsd - a.marketCapUsd,
};

function bad(reply: FastifyReply, err: z.ZodError) {
  return reply.code(400).send({ error: 'bad_request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
}
const notFound = (reply: FastifyReply, what: string) => reply.code(404).send({ error: 'not_found', message: `${what} not found` });

export async function registerRoutes(
  app: FastifyInstance,
  deps: { ledger: Ledger; excluded: string[]; health?: { mode: 'mock' | 'live'; chainId: number; version: string; treasury: string } },
) {
  const { ledger } = deps;
  const repo = ledger.repo;
  const health = deps.health ?? { mode: 'mock' as const, chainId: 97, version: '0.0.0', treasury: '' };

  app.get('/health', async () => ({ ok: true }));
  // Railway healthcheck + frontend "Preview — simulated activity" banner (mode === 'mock').
  app.get('/api/health', async () => ({ ok: true, ...health }));

  app.get('/api/stats', async () => ledger.stats());

  app.get('/api/machines', async (req, reply) => {
    const q = machinesQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    const { sort, strategy, pack, stage, page, pageSize } = q.data;
    let items = await repo.listMachines();
    if (strategy) items = items.filter((m) => m.strategy === strategy);
    if (pack) items = items.filter((m) => m.pack === pack);
    if (stage) items = items.filter((m) => m.stage === stage);
    items.sort(sorters[sort]);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
  });

  // Registered before :address so the static segment wins.
  app.get('/api/machines/about-to-rip', async () => {
    const items = await repo.listMachines();
    return items.sort((a, b) => b.potUsd / b.packPriceUsd - a.potUsd / a.packPriceUsd).slice(0, 3);
  });

  app.get<{ Params: { address: string } }>('/api/machines/:address', async (req, reply) => {
    const m = await repo.getMachine(req.params.address);
    return m ?? notFound(reply, 'machine');
  });

  app.get<{ Params: { address: string } }>('/api/machines/:address/pulls', async (req, reply) => {
    const q = pageQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    if (!(await repo.getMachine(req.params.address))) return notFound(reply, 'machine');
    return repo.listPulls({ machine: req.params.address, offset: (q.data.page - 1) * q.data.pageSize, limit: q.data.pageSize });
  });

  app.get<{ Params: { address: string } }>('/api/machines/:address/trades', async (req, reply) => {
    const q = pageQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    if (!(await repo.getMachine(req.params.address))) return notFound(reply, 'machine');
    return repo.listTrades(req.params.address, (q.data.page - 1) * q.data.pageSize, q.data.pageSize);
  });

  app.get<{ Params: { address: string; wallet: string } }>('/api/machines/:address/rewards/:wallet', async (req, reply) => {
    if (!address.safeParse(req.params.wallet).success) return reply.code(400).send({ error: 'bad_request', message: 'invalid wallet address' });
    const m = await repo.getMachine(req.params.address);
    if (!m) return notFound(reply, 'machine');
    const wallet = req.params.wallet.toLowerCase();
    const totalSupply = TOTAL_SUPPLY_DEFAULT; // flap.sh tokens: fixed 1B supply, 18 decimals
    const [balances, rewards, excluded] = await Promise.all([repo.getBalances(m.address), repo.getRewards(m.address, wallet), excludedFor(repo, m, deps.excluded)]);
    const eligibleList = selectEligible(balances, { totalSupply, excluded });
    const mine = eligibleList.find((h) => h.address === wallet);
    const weight = eligibleList.reduce((s, h) => s + h.balance, 0n);
    const balance = balances.find((b) => b.address === wallet)?.balance ?? 0n;
    const view: RewardsView = {
      address: wallet,
      eligible: !!mine,
      balance: units(balance),
      minBalance: units(minEligibleBalance(totalSupply)),
      oddsPct: mine && weight > 0n ? Number((mine.balance * 1_000_000n) / weight) / 10_000 : 0,
      claimableBnb: round6(rewards.claimableBnb),
      totalEarnedBnb: round6(rewards.totalEarnedBnb),
    };
    return view;
  });

  // Additive (not in SPEC): merkle proofs needed by the frontend to call vault.claim().
  app.get<{ Params: { address: string; wallet: string } }>('/api/machines/:address/claims/:wallet', async (req, reply) => {
    if (!(await repo.getMachine(req.params.address))) return notFound(reply, 'machine');
    const claims = await repo.getDividendClaims(req.params.address, req.params.wallet);
    return { items: claims.filter((c) => !c.pushed), total: claims.length };
  });

  app.get('/api/pulls/recent', async (req, reply) => {
    const q = limitQuery(20, 100).safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    return (await repo.listPulls({ offset: 0, limit: q.data.limit })).items;
  });

  app.get('/api/activity', async (req, reply) => {
    const q = limitQuery(40, 200).safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    return repo.listActivity(q.data.limit);
  });

  // Live fee flow (SPEC): newest first.
  app.get('/api/fees/recent', async (req, reply) => {
    const q = feesQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    return repo.listFeeEvents({ machine: q.data.machine?.toLowerCase(), limit: q.data.limit });
  });

  app.get('/api/fees/summary', async () => repo.feeSummary(Math.floor(Date.now() / 1000) - 86_400));

  app.get('/api/burns', async (req, reply) => {
    const q = pageQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    const r = await repo.listBurns((q.data.page - 1) * q.data.pageSize, q.data.pageSize);
    // $FORGE supply placeholder = 1B
    return { totalBurned: round2(r.totalBurned), pctOfSupply: round6((r.totalBurned / 1e9) * 100), items: r.items, total: r.total };
  });

  app.get<{ Params: { pullId: string } }>('/api/raffles/:pullId', async (req, reply) => {
    const p = await repo.getRaffleProof(req.params.pullId);
    return p ?? notFound(reply, 'raffle');
  });

  // Additive: flap.sh admin re-route alerts.
  app.get('/api/alerts', async () => JSON.parse((await repo.getMeta('alerts')) ?? '[]'));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
