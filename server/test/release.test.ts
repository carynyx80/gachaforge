import { describe, expect, it } from 'vitest';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { enqueueCardReleases, ReleaseJob } from '../src/operator/release.js';
import type { ReleaseStatus } from '../src/renaiss/types.js';
import { MemoryRepository } from '../src/store/memory.js';

const OP = '0x00000000000000000000000000000000000000aa';
const WINNER = '0x00000000000000000000000000000000000000Bb';
const silent = { info() {}, warn() {}, error() {}, debug() {} };

function harness() {
  let t = 1_000;
  const repo = new MemoryRepository();
  const ledger = new Ledger(repo, new Bus());
  const owners: Record<string, string> = { '1': 'inventory', '2': 'inventory' };
  const transfers: [string, string][] = [];
  let failTransfers = 0;
  const provider = {
    async releaseStatus({ tokenId }: { tokenId: string }): Promise<ReleaseStatus> {
      return { released: owners[tokenId] === OP, owner: owners[tokenId] };
    },
    async transferCard(tokenId: string, to: string) {
      if (failTransfers > 0) {
        failTransfers--;
        throw new Error('nonce too low');
      }
      transfers.push([tokenId, to]);
      owners[tokenId] = to.toLowerCase();
      return '0x' + 'cd'.repeat(32);
    },
  };
  const job = new ReleaseJob(ledger, provider, silent, { now: () => t, notReleasedRecheckSec: 300, retryBaseSec: 60, maxAttempts: 3 });
  return { repo, ledger, owners, transfers, job, clock: { get: () => t, add: (s: number) => (t += s) }, failNext: (n: number) => (failTransfers = n) };
}

describe('card release queue', () => {
  it('waits for release, transfers each card to the winner, records activity', async () => {
    const h = harness();
    await enqueueCardReleases(h.ledger, { pullKey: 'm-1', machine: '0xM', ticker: 'T', winner: WINNER, cards: [{ tokenId: '1', name: 'Volt Fox', releaseAt: 1_000 + 259_200 }, { tokenId: '2', name: 'Moss Golem', releaseAt: 1_000 + 259_200 }] }, h.clock.get());
    // idempotent
    await enqueueCardReleases(h.ledger, { pullKey: 'm-1', machine: '0xM', ticker: 'T', winner: WINNER, cards: [{ tokenId: '1', name: 'Volt Fox', releaseAt: 5 }] }, h.clock.get());
    expect(await h.repo.listCardReleases()).toHaveLength(2);
    expect((await h.repo.getCardRelease('m-1', '1'))!.releaseAt).toBe(260_200);

    await h.job.tick(); // not due yet
    expect(h.transfers).toEqual([]);

    h.clock.add(259_200);
    await h.job.tick(); // due but Renaiss has not released yet → recheck later
    expect(h.transfers).toEqual([]);
    expect((await h.repo.getCardRelease('m-1', '1'))!.nextAttemptAt).toBe(h.clock.get() + 300);

    h.owners['1'] = OP;
    h.owners['2'] = OP;
    h.clock.add(300);
    await h.job.tick();
    expect(h.transfers).toEqual([
      ['1', WINNER.toLowerCase()],
      ['2', WINNER.toLowerCase()],
    ]);
    const rows = await h.repo.listCardReleases({ status: 'DELIVERED' });
    expect(rows.map((r) => r.txHash)).toEqual(['0x' + 'cd'.repeat(32), '0x' + 'cd'.repeat(32)]);
    const acts = await h.repo.listActivity(10);
    expect(acts.map((a) => a.text)).toContain('card delivered to 0x0000…00bb · Volt Fox');
    await h.job.tick();
    expect(h.transfers).toHaveLength(2);
  });

  it('retries failed transfers with backoff, then marks FAILED', async () => {
    const h = harness();
    await enqueueCardReleases(h.ledger, { pullKey: 'm-2', machine: '0xM', ticker: 'T', winner: WINNER, cards: [{ tokenId: '1', name: 'A', releaseAt: 1_000 }] }, h.clock.get());
    h.owners['1'] = OP;
    h.failNext(1);
    await h.job.tick();
    let r = (await h.repo.getCardRelease('m-2', '1'))!;
    expect(r).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'nonce too low', nextAttemptAt: h.clock.get() + 60 });
    h.clock.add(60);
    await h.job.tick();
    r = (await h.repo.getCardRelease('m-2', '1'))!;
    expect(r.status).toBe('DELIVERED');
    expect(r.lastError).toBeUndefined();

    await enqueueCardReleases(h.ledger, { pullKey: 'm-3', machine: '0xM', ticker: 'T', winner: WINNER, cards: [{ tokenId: '2', name: 'B', releaseAt: 1_000 }] }, h.clock.get());
    h.owners['2'] = OP;
    h.failNext(99);
    for (let i = 0; i < 3; i++) {
      await h.job.tick();
      h.clock.add(10_000);
    }
    r = (await h.repo.getCardRelease('m-3', '2'))!;
    expect(r).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(await h.repo.listDueCardReleases(h.clock.get() + 1e9, 10)).toEqual([]);
  });

  it('marks delivered without a second transfer when the winner already owns the card', async () => {
    const h = harness();
    await enqueueCardReleases(h.ledger, { pullKey: 'm-4', machine: '0xM', ticker: 'T', winner: WINNER, cards: [{ tokenId: '1', name: 'A', releaseAt: 0 }] }, h.clock.get());
    h.owners['1'] = WINNER.toLowerCase();
    await h.job.tick();
    expect(h.transfers).toEqual([]);
    expect((await h.repo.getCardRelease('m-4', '1'))!.status).toBe('DELIVERED');
  });
});
