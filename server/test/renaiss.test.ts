import { describe, expect, it, vi } from 'vitest';
import { RenaissProvider } from '../src/renaiss/http.js';
import { SimulatedProvider, mulberry32, randomCard } from '../src/renaiss/simulated.js';
import { PACK_MAX_MULTIPLIER, PACK_PRICE_USD } from '../src/core/packs.js';

describe('SimulatedProvider', () => {
  it('produces cards within the pack value band', () => {
    const rng = mulberry32(1);
    for (const pack of ['FORGE_28', 'FORGE_48', 'FORGE_88'] as const) {
      for (let i = 0; i < 300; i++) {
        const c = randomCard(pack, rng);
        expect(c.valueUsd).toBeGreaterThan(0);
        expect(c.valueUsd).toBeLessThanOrEqual(PACK_PRICE_USD[pack] * PACK_MAX_MULTIPLIER[pack] + 0.01);
        expect(['PSA', 'CGC', 'BGS']).toContain(c.grader);
      }
    }
  });
  it('buy → quote → sell with time-based rate', async () => {
    let t = 1000;
    const p = new SimulatedProvider(mulberry32(2), () => t);
    const { card, pullId } = await p.buyPack('FORGE_48', '0xabc');
    expect((await p.getPull(pullId)).card!.id).toBe(card.id);
    expect((await p.quoteSellBack(card.id)).rate).toBe(0.9);
    t += 7200;
    const s = await p.sellBack(card.id);
    expect(s.rate).toBe(0.85);
    expect(s.proceedsUsd).toBeCloseTo(card.valueUsd * 0.85, 1);
    await expect(p.sellBack(card.id)).rejects.toThrow(/already sold/);
  });
});

describe('RenaissProvider', () => {
  it('sends auth + maps responses', async () => {
    const fetchMock = vi.fn(async (_url: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify({ pullId: 'p1', card: { id: 'c1', name: 'Volt Fox', set: 'S', grader: 'PSA', grade: '10', imageUrl: 'i', fmv: 55 }, purchasedAt: 10 }), { status: 200 }),
    );
    const p = new RenaissProvider('https://api.example.test', 'k', fetchMock as unknown as typeof fetch);
    const r = await p.buyPack('FORGE_28', '0xtx');
    expect(r).toEqual({ pullId: 'p1', purchasedAt: 10, card: { id: 'c1', name: 'Volt Fox', set: 'S', grader: 'PSA', grade: '10', image: 'i', valueUsd: 55 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.example.test/v1/packs/pack-28/purchase');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(String(init!.body))).toEqual({ paymentTxHash: '0xtx', chain: 'bsc' });
  });
  it('throws RenaissError on non-2xx', async () => {
    const p = new RenaissProvider('https://api.example.test', 'k', (async () => new Response('{"e":1}', { status: 503 })) as unknown as typeof fetch);
    await expect(p.getPull('x')).rejects.toMatchObject({ status: 503 });
  });
});
