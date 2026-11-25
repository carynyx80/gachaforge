import type { Repository } from '../store/repository.js';
import { ALWAYS_EXCLUDED } from '../core/snapshot.js';

/** Addresses never eligible for a machine: token, vault, pools/pairs, launchpad contracts, router, dead. */
export async function excludedFor(
  repo: Repository,
  machine: { address: string; vault: string },
  global: string[],
): Promise<string[]> {
  const pools = JSON.parse((await repo.getMeta(`pools:${machine.address.toLowerCase()}`)) ?? '[]') as string[];
  return [...new Set([...ALWAYS_EXCLUDED, machine.address, machine.vault, ...pools, ...global].map((a) => a.toLowerCase()))];
}

export async function addPool(repo: Repository, token: string, pool: string) {
  const k = `pools:${token.toLowerCase()}`;
  const pools = new Set(JSON.parse((await repo.getMeta(k)) ?? '[]') as string[]);
  pools.add(pool.toLowerCase());
  await repo.setMeta(k, JSON.stringify([...pools]));
}
