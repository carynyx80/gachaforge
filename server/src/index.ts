import { buildApp } from './app.js';
import { Bus } from './bus.js';
import { loadConfig } from './config.js';
import { ForgeService, loadForgeConfig } from './forge/index.js';
import { Ledger } from './ledger.js';
import type { Logger } from './log.js';
import { createProvider } from './renaiss/index.js';
import { createRepository } from './store/index.js';

const cfg = loadConfig();
const bus = new Bus();
const repo = await createRepository(cfg);
const ledger = new Ledger(repo, bus);
// $FORGE watcher: always BSC mainnet, independent of MOCK_MODE / CHAIN_ID.
const forgeCfg = loadForgeConfig();
// Delegates to app.log (created by buildApp below); only called after start().
const forgeLog: Logger = {
  info: (o, m) => app.log.info(o as object, m),
  warn: (o, m) => app.log.warn(o as object, m),
  error: (o, m) => app.log.error(o as object, m),
  debug: (o, m) => app.log.debug(o as object, m),
};
const forge = new ForgeService({ cfg: forgeCfg, repo, bus, log: forgeLog, bnbUsdFallback: cfg.BNB_USD_PRICE });
// OFF-CHAIN MODE (default without FACTORY_ADDRESS): custodial ops wallet + off-chain ledger, no GachaForge contracts.
// Safety: a signing ops wallet needs the durable ledger (pots, payout queue, daily cap) — refuse to sign on the memory store.
const memoryOps = cfg.MODE === 'offchain' && !!cfg.OPS_PRIVATE_KEY && !cfg.DATABASE_URL && !cfg.OPS_ALLOW_MEMORY;
const offCfg = memoryOps ? { ...cfg, OPS_PRIVATE_KEY: undefined } : cfg;
const offchain = cfg.MODE === 'offchain' ? await (await import('./offchain/service.js')).OffchainService.create({ cfg: offCfg, ledger, log: forgeLog, forge }) : undefined;
const app = await buildApp({
  ledger,
  bus,
  corsOrigin: cfg.CORS_ORIGINS,
  excluded: cfg.EXCLUDED_ADDRESSES,
  logger: { level: cfg.LOG_LEVEL },
  forge,
  offchain,
  health: {
    mode: cfg.MODE,
    chainId: cfg.CHAIN_ID,
    version: cfg.VERSION,
    treasury: cfg.TREASURY_ADDRESS,
    opsReady: cfg.MODE === 'offchain' ? !!cfg.OPS_PRIVATE_KEY : cfg.MODE === 'vault' && cfg.OPERATOR_ENABLED && !!cfg.OPERATOR_PRIVATE_KEY,
    renaissReady: !!cfg.RENAISS_API_KEY,
  },
});
const log = app.log;
const stops: (() => void)[] = [];

if (offchain) {
  if (memoryOps) log.error({}, 'OPS_PRIVATE_KEY ignored: no DATABASE_URL (set DATABASE_URL, or OPS_ALLOW_MEMORY=true for local tests). Running read-only.');
  offchain.start();
  stops.push(() => offchain.stop());
  log.info({ chainId: cfg.CHAIN_ID, rpc: cfg.RPC_URLS.map((u) => new URL(u).host), treasury: cfg.TREASURY_ADDRESS, ops: offchain.ops.address, opsPaused: cfg.OPS_PAUSED, dailyCapBnb: cfg.OPS_DAILY_CAP_BNB, renaissReady: offchain.renaissReady, store: cfg.DATABASE_URL ? 'postgres' : 'memory' }, 'OFF-CHAIN mode');
} else if (cfg.MOCK_MODE) {
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
  const { ReleaseJob } = await import('./operator/release.js');
  const chain = createChain(cfg);
  const { provider, swapper, catalog } = createProvider(cfg, chain, log);
  const indexer = new Indexer(cfg, chain, ledger, log);
  const operator = new Operator(cfg, chain, ledger, provider, log, swapper);
  const keeper = new Keeper(chain, ledger, indexer, log, cfg.BNB_USD_PRICE);
  // Resolve slugs → pack ids/prices now so a missing slug or price change is loud at boot (buys refuse until fixed).
  if (catalog) await catalog.refresh().catch((err) => log.error({ err }, 'Renaiss catalog check failed at startup; pulls will refuse until it passes'));
  await indexer.start();
  operator.start();
  keeper.start();
  stops.push(() => indexer.stop(), () => operator.stop(), () => keeper.stop());
  if (chain.walletClient) {
    const releases = new ReleaseJob(ledger, provider, log, { intervalMs: cfg.RELEASE_POLL_MS });
    releases.start();
    stops.push(() => releases.stop());
  }
  log.info({ mode: 'vault', chainId: cfg.CHAIN_ID, factory: cfg.FACTORY_ADDRESS, provider: provider.name, swapper: swapper.name, renaissNetwork: cfg.RENAISS_NETWORK, operatorEnabled: cfg.OPERATOR_ENABLED, operator: chain.account?.address ?? null, treasury: cfg.TREASURY_ADDRESS }, 'chain mode');
}

await forge.start();
stops.push(() => forge.stop());
log.info({ deployer: forgeCfg.deployer ?? null, tokenOverride: forgeCfg.tokenOverride ?? null, preview: forgeCfg.preview, buybackBurner: forgeCfg.buybackBurner ?? null }, '$FORGE watcher (BSC mainnet)');

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
