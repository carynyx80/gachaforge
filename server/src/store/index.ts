import type { Config } from '../config.js';
import { MemoryRepository } from './memory.js';
import type { Repository } from './repository.js';

export async function createRepository(cfg: Pick<Config, 'DATABASE_URL'>): Promise<Repository> {
  if (cfg.DATABASE_URL) {
    const { PostgresRepository } = await import('./postgres.js');
    const repo = new PostgresRepository(cfg.DATABASE_URL);
    await repo.init();
    return repo;
  }
  const repo = new MemoryRepository();
  await repo.init();
  return repo;
}

export type { Repository } from './repository.js';
export { MemoryRepository } from './memory.js';
