import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ForgeApi } from '../forge/service.js';
import { CANDLE_INTERVALS, type CandleInterval } from '../forge/types.js';

const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
const tradesQuery = z.object({ limit: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(200).default(50)) });
const candlesQuery = z.object({
  interval: z.preprocess(emptyToUndef, z.enum(Object.keys(CANDLE_INTERVALS) as [CandleInterval, ...CandleInterval[]]).default('15m')),
  limit: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(1000).default(300)),
});

const idle: ForgeApi = {
  status: async () => ({ status: 'waiting', deployer: null }),
  trades: async () => [],
  candles: async () => [],
};

/** SPEC "$FORGE token page": /api/forge, /api/forge/trades, /api/forge/candles. */
export async function registerForgeRoutes(app: FastifyInstance, forge: ForgeApi = idle) {
  const bad = (err: z.ZodError) => ({ error: 'bad_request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

  app.get('/api/forge', async () => forge.status());

  app.get('/api/forge/trades', async (req, reply) => {
    const q = tradesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad(q.error));
    return forge.trades(q.data.limit);
  });

  app.get('/api/forge/candles', async (req, reply) => {
    const q = candlesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad(q.error));
    return forge.candles(q.data.interval, q.data.limit);
  });
}
