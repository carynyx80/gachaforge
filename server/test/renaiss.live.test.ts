/**
 * Opt-in live smoke test: RENAISS_LIVE=1 npx vitest run test/renaiss.live.test.ts
 * Public catalog GETs only (no key, no signing, no writes) on testnet and mainnet.
 */
import { describe, expect, it } from 'vitest';
import { RenaissCatalog } from '../src/renaiss/catalog.js';
import { RenaissClient } from '../src/renaiss/client.js';
import { RENAISS_NETWORKS } from '../src/renaiss/networks.js';
import { PACKS } from '../src/types.js';

const live = process.env.RENAISS_LIVE === '1';

describe.skipIf(!live)('Renaiss live catalog (public GETs)', () => {
  for (const net of Object.values(RENAISS_NETWORKS)) {
    it(`${net.name}: pandora slugs exist at the expected USDT prices`, async () => {
      const client = new RenaissClient({ baseUrl: net.apiBaseUrl, timeoutMs: 20_000 });
      const list = await client.listPacks({ stage: 'active', limit: 50 });
      const slugs = list.cardPacks.map((p) => p.slug);
      for (const s of Object.values(net.slugs)) expect(slugs).toContain(s);
      const cat = new RenaissCatalog(client, net);
      for (const pack of PACKS) {
        const r = await cat.resolve(pack);
        expect(r.priceInUsdt).toBe(BigInt(pack.slice(6)) * 10n ** 18n);
        expect(r.vendingMachine.toLowerCase()).toBe(net.vendingMachine.toLowerCase());
        expect(r.onChainPackId).toMatch(/^0x[0-9a-f]{64}$/i);
        expect(r.releaseAfterSeconds).toBeGreaterThan(0);
      }
    }, 60_000);
  }
});
