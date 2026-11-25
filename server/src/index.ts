import { buildApp } from './app.js';
import { Bus } from './bus.js';
import { loadConfig } from './config.js';
import { Ledger } from './ledger.js';
import { createProvider } from './renaiss/index.js';
import { createRepository } from './store/index.js';

const cfg = loadConfig();
const bus = new Bus();
const repo = await createRepository(cfg);
const ledger = new Ledger(repo, bus);
const app = await buildApp({
  ledger,
  bus,
  corsOrigin: cfg.CORS_ORIGINS,
  excluded: cfg.EXCLUDED_ADDRESSES,
  logger: { level: cfg.LOG_LEVEL },
  health: { mode: cfg.MOCK_MODE ? 'mock' : 'live', chainId: cfg.CHAIN_ID, version: cfg.VERSION, treasury: cfg.TREASURY_ADDRESS },
});
const log = app.log;
const stops: (() => void)[] = [];

if (cfg.MOCK_MODE) {
  const { createMockContext, seedMock, startSimulator } = await import('./mock/seed.js');
  const opts = { bnbUsd: cfg.BNB_USD_PRICE, excluded: cfg.EXCLUDED_ADDRESSES, log };
  // Postgres may already hold seeded data from a previous run — don't double-seed.
  const ctx = (await repo.listMachines()).length ? createMockContext(ledger, opts) : await seedMock(ledger, opts);
  stops.push(startSimulator(ctx, cfg.SIM_INTERVAL_MS, log));
  log.info({ store: cfg.DATABASE_URL ? 'postgres' : 'memory' }, 'MOCK_MODE on: seeded data + simulator running');
} else {
  const { createChain } = await import('./chain.js');
  const { Indexer } = await import('./indexer/index.js');
  const { Operator } = await import('./operator/index.js');
  const { Keeper } = await import('./operator/keeper.js');
  const chain = createChain(cfg);
  const provider = createProvider(cfg);
  const indexer = new Indexer(cfg, chain, ledger, log);
  const operator = new Operator(cfg, chain, ledger, provider, log);
  const keeper = new Keeper(chain, ledger, indexer, log, cfg.BNB_USD_PRICE);
  await indexer.start();
  operator.start();
  keeper.start();
  stops.push(() => indexer.stop(), () => operator.stop(), () => keeper.stop());
  log.info({ chainId: cfg.CHAIN_ID, factory: cfg.FACTORY_ADDRESS, provider: provider.name, operatorEnabled: cfg.OPERATOR_ENABLED, operator: chain.account?.address ?? null, treasury: cfg.TREASURY_ADDRESS }, 'chain mode');
}

await app.listen({ port: cfg.PORT, host: cfg.HOST });

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const s of stops) s();
  await app.close();
  await repo.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
