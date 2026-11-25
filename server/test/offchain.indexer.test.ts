import { describe, expect, it } from 'vitest';
import { ALICE, E18, PORTAL, TOKEN, TP, h32, harness, verified } from './helpers/offchain.js';

const T2 = '0x00000000000000000000000000000000000b7777';

describe('offchain indexer (N tokens, one shared scanner)', () => {
  it('batches address filters, catches up new tokens from their creation block, then joins the shared cursor', async () => {
    const h = harness({ env: { LOGS_ADDRESS_BATCH: '1', START_BLOCK: '1000' } });
    const calls: { address: unknown; from: bigint; to: bigint }[] = [];
    const logs = [
      { address: PORTAL, eventName: 'TokenBought', args: { ts: 1n, token: TOKEN, buyer: ALICE, amount: E18, eth: E18, fee: 0n, postPrice: 0n }, blockNumber: 950n, logIndex: 0, transactionHash: h32(1) },
      { address: TOKEN, eventName: 'Transfer', args: { from: '0x0000000000000000000000000000000000000000', to: ALICE, value: 5n * E18 }, blockNumber: 950n, logIndex: 1, transactionHash: h32(1) },
      { address: PORTAL, eventName: 'TokenBought', args: { ts: 2n, token: T2, buyer: ALICE, amount: E18, eth: 2n * E18, fee: 0n, postPrice: 0n }, blockNumber: 1005n, logIndex: 0, transactionHash: h32(2) },
      { address: PORTAL, eventName: 'TokenCreated', args: { ts: 3n, creator: ALICE, nonce: 1n, token: '0x00000000000000000000000000000000000c7777', name: 'x', symbol: 'x', meta: '' }, blockNumber: 1006n, logIndex: 0, transactionHash: h32(3) },
    ];
    (h.chain as any).getLogs = async (p: any) => {
      calls.push({ address: p.address, from: p.fromBlock, to: p.toBlock });
      const addrs = (Array.isArray(p.address) ? p.address : [p.address]).map((a: string) => a.toLowerCase());
      return logs.filter((l) => addrs.includes(l.address.toLowerCase()) && l.blockNumber >= p.fromBlock && l.blockNumber <= p.toBlock);
    };
    h.chain.head = 1010n; // safe head = 1008
    await h.engine.adopt(verified({ createdBlock: 900 }), { pack: 'FORGE_28', strategy: 'RAFFLE' }, 'api');
    await h.engine.adopt(verified({ token: T2, createdBlock: 1001, txHash: h32(9) }), { pack: 'FORGE_48', strategy: 'BURN' }, 'api');
    await h.svc.indexer.tick();
    // TOKEN was caught up from 900 on its own, both tokens then advanced together to the safe head
    expect((await h.store.getRegistration(TOKEN))!.syncedTo).toBe(1008);
    expect((await h.store.getRegistration(T2))!.syncedTo).toBe(1008);
    expect(await h.svc.indexer.cursor()).toBe(1008n);
    expect(await h.accounts.balance('TAX', TOKEN)).toBe(E18 / 50n);
    expect(await h.accounts.balance('TAX', T2)).toBe((2n * E18) / 50n);
    expect(await h.repo.getBalance(TOKEN, ALICE)).toBe(5n * E18);
    // batched: one token/pair getLogs per address in the shared pass (batch size 1)
    const shared = calls.filter((c) => c.from === 1000n && Array.isArray(c.address));
    expect(shared.map((c) => (c.address as string[]).length)).toEqual([1, 1]);
    // TokenCreated of an unknown token becomes an auto-registration candidate
    expect((await h.svc.indexer.candidates()).map((c) => c.token)).toEqual(['0x00000000000000000000000000000000000c7777']);
    // re-running is a no-op (cursor at head)
    const n = calls.length;
    await h.svc.indexer.tick();
    expect(calls.length).toBe(n);
    expect(await h.accounts.balance('TAX', TOKEN)).toBe(E18 / 50n);
    expect(TP).toBeTruthy();
  });
});
