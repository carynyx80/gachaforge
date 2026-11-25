import type { ChainCtx } from '../chain.js';
import type { Config } from '../config.js';
import { evmWalletFromChain } from '../evm.js';
import type { Logger } from '../log.js';
import { PancakeSwapper, SimulatedSwapper, type Swapper } from '../swap/pancake.js';
import { RenaissCatalog } from './catalog.js';
import { RenaissClient } from './client.js';
import { RENAISS_NETWORKS, type RenaissNetwork } from './networks.js';
import { RenaissProvider } from './provider.js';
import { SimulatedProvider } from './simulated.js';
import type { CardProvider } from './types.js';

export * from './types.js';
export { RenaissProvider, RenaissFlowError } from './provider.js';
export { RenaissClient, RenaissApiError } from './client.js';
export { RenaissCatalog, CatalogError } from './catalog.js';
export { RENAISS_NETWORKS, type RenaissNetwork, type RenaissNetworkName } from './networks.js';
export { SimulatedProvider, randomCard, mulberry32 } from './simulated.js';


/** Network constants with config overrides applied. */
export function resolveNetwork(cfg: Pick<Config, 'RENAISS_NETWORK' | 'RENAISS_API_URL' | 'PANCAKE_ROUTER' | 'USDT_ADDRESS' | 'RENAISS_REGISTRY'>): RenaissNetwork {
  const base = RENAISS_NETWORKS[cfg.RENAISS_NETWORK];
  return {
    ...base,
    apiBaseUrl: cfg.RENAISS_API_URL ?? base.apiBaseUrl,
    pancakeRouter: (cfg.PANCAKE_ROUTER as `0x${string}`) ?? base.pancakeRouter,
    usdt: (cfg.USDT_ADDRESS as `0x${string}`) ?? base.usdt,
    registry: (cfg.RENAISS_REGISTRY as `0x${string}`) ?? base.registry,
  };
}

/**
 * Real Renaiss provider + PancakeSwap swapper when the operator runs live with a builder key;
 * SimulatedProvider + fixed-price swapper otherwise (MOCK_MODE, or indexer-only without a key).
 */
export function createProvider(cfg: Config, chain: ChainCtx | null, log: Logger): { provider: CardProvider; swapper: Swapper; catalog: RenaissCatalog | null } {
  if (cfg.MOCK_MODE || !cfg.RENAISS_API_KEY || !chain?.walletClient || !chain.account) {
    return { provider: new SimulatedProvider(), swapper: new SimulatedSwapper(cfg.BNB_USD_PRICE), catalog: null };
  }
  const network = resolveNetwork(cfg);
  const client = new RenaissClient({ baseUrl: network.apiBaseUrl, apiKey: cfg.RENAISS_API_KEY, timeoutMs: cfg.RENAISS_TIMEOUT_MS, log });
  const catalog = new RenaissCatalog(client, network, log);
  const wallet = evmWalletFromChain(chain);
  const provider = new RenaissProvider({ client, catalog, network, wallet, log });
  const swapper = new PancakeSwapper(wallet, { router: network.pancakeRouter, usdt: network.usdt, slippageBps: cfg.SWAP_SLIPPAGE_BPS, deadlineSeconds: cfg.SWAP_DEADLINE_SECONDS, log });
  return { provider, swapper, catalog };
}