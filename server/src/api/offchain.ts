import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Mode } from '../config.js';
import { RegistrationError } from '../offchain/register.js';
import type { OffchainApi } from '../offchain/service.js';
import { PACKS, STRATEGIES } from '../types.js';

const registerBody = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a 0x-prefixed 32-byte hash'),
  pack: z.enum(PACKS as [string, ...string[]]),
  strategy: z.enum(STRATEGIES as [string, ...string[]]),
  split: z
    .object({ dividendBps: z.number().int().min(0).max(10_000), burnBps: z.number().int().min(0).max(10_000), lpBps: z.number().int().min(0).max(10_000) })
    .optional(),
  /** EIP-191 personal_sign by the launch tx sender over the canonical registration message (src/offchain/message.ts). */
  signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/, 'signature must be a 0x-prefixed personal_sign signature'),
});

/** Tiny fixed-window limiter: registration does several RPC reads per call. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; at: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.at > windowMs) {
      hits.set(key, { n: 1, at: now });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    return ++h.n <= max;
  };
}

/** SPEC "OFF-CHAIN MODE": POST /api/machines/register, GET /api/transparency. */
export async function registerOffchainRoutes(app: FastifyInstance, deps: { mode: Mode; chainId: number; treasury: string; offchain?: OffchainApi }) {
  const allow = limiter(10, 60_000);

  app.post('/api/machines/register', async (req, reply) => {
    if (!deps.offchain) return reply.code(409).send({ error: 'not_available', message: `registration is only available in offchain mode (server mode: ${deps.mode})` });
    if (!allow(req.ip)) return reply.code(429).send({ error: 'rate_limited', message: 'too many registrations, retry in a minute' });
    const b = registerBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request', issues: b.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    try {
      const { machine, created } = await deps.offchain.register(b.data as never);
      return reply.code(created ? 201 : 200).send({ ok: true, created, machine });
    } catch (err) {
      if (err instanceof RegistrationError) return reply.code(err.status).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
      req.log.error({ err }, 'register failed');
      return reply.code(502).send({ error: 'chain_error', message: 'could not verify the launch on-chain right now; retry shortly' });
    }
  });

  app.get('/api/transparency', async () => {
    if (deps.offchain) return deps.offchain.transparency();
    const zero = { pots: 0, buyback: 0, dividendsPending: 0, burnsPending: 0, total: 0 };
    return { mode: deps.mode, chainId: deps.chainId, treasury: { address: deps.treasury, balanceBnb: 0, url: null }, ops: null, balances: {}, owed: zero, ledger: null, machines: [], txs: [], updatedAt: Math.floor(Date.now() / 1000) };
  });
}
