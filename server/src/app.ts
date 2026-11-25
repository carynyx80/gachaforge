import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerForgeRoutes } from './api/forge.js';
import { registerOffchainRoutes } from './api/offchain.js';
import { registerRoutes } from './api/routes.js';
import { registerWs } from './api/ws.js';
import type { Bus } from './bus.js';
import { VERCEL_PREVIEW_ORIGIN, VERSION } from './config.js';
import type { ForgeApi } from './forge/service.js';
import type { Ledger } from './ledger.js';
import type { OffchainApi } from './offchain/service.js';

export interface HealthInfo {
  mode: 'offchain' | 'mock' | 'vault';
  chainId: number;
  version: string;
  treasury: string;
  /** Ops hot-wallet key present (offchain mode). */
  opsReady: boolean;
  /** Renaiss builder key present. */
  renaissReady: boolean;
  [k: string]: unknown;
}

/** Exact-match allowlist plus `gachaforge[-*].vercel.app` previews. */
export function originAllowed(origin: string | undefined, allow: string[]): boolean {
  if (!origin) return true; // same-origin / curl / server-to-server
  const o = origin.replace(/\/+$/, '');
  return allow.includes(o) || VERCEL_PREVIEW_ORIGIN.test(o);
}

export async function buildApp(opts: {
  ledger: Ledger;
  bus: Bus;
  corsOrigin: string | string[];
  excluded?: string[];
  logger?: boolean | object;
  health?: Partial<HealthInfo>;
  /** $FORGE watcher; omitted → GET /api/forge reports { status: 'waiting', deployer: null }. */
  forge?: ForgeApi;
  /** OFF-CHAIN MODE service (register + transparency); omitted in mock/vault mode. */
  offchain?: OffchainApi;
}): Promise<FastifyInstance> {
  // trustProxy: Railway terminates TLS and forwards via its edge proxy.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const origins = (Array.isArray(opts.corsOrigin) ? opts.corsOrigin : opts.corsOrigin.split(',')).map((s) => s.trim()).filter(Boolean);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, originAllowed(origin, origins)),
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(websocket);
  await registerWs(app, { bus: opts.bus, ledger: opts.ledger });
  const health: HealthInfo = { mode: 'mock', chainId: 97, version: VERSION, treasury: '', opsReady: false, renaissReady: false, ...opts.health };
  const off = opts.offchain;
  await registerRoutes(app, { ledger: opts.ledger, excluded: opts.excluded ?? [], health: off ? () => ({ ...health, ...pick(off.readiness()) }) : health });
  await registerForgeRoutes(app, opts.forge);
  await registerOffchainRoutes(app, { mode: health.mode, chainId: health.chainId, treasury: health.treasury, offchain: off });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not_found', message: `${req.method} ${req.url}` }));
  return app;
}

const pick = (r: ReturnType<OffchainApi['readiness']>) => ({ opsReady: r.opsReady, renaissReady: r.renaissReady, opsPaused: r.opsPaused, ops: r.ops });
