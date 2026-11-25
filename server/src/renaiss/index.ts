import type { Config } from '../config.js';
import { RenaissProvider } from './http.js';
import type { CardProvider } from './provider.js';
import { SimulatedProvider } from './simulated.js';

export function createProvider(cfg: Pick<Config, 'RENAISS_API_URL' | 'RENAISS_API_KEY' | 'MOCK_MODE'>): CardProvider {
  if (!cfg.MOCK_MODE && cfg.RENAISS_API_URL && cfg.RENAISS_API_KEY) return new RenaissProvider(cfg.RENAISS_API_URL, cfg.RENAISS_API_KEY);
  return new SimulatedProvider();
}
export * from './provider.js';
export { RenaissProvider } from './http.js';
export { SimulatedProvider, randomCard, mulberry32 } from './simulated.js';
