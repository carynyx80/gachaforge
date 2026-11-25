/**
 * Opt-in live test against BSC mainnet: FORGE_LIVE=1 npx vitest run test/forge.live.test.ts
 * Picks the most recent flap.sh launch from Portal TokenCreated logs, takes its deployer (tx.from),
 * then runs the real discovery + indexing pipeline for that deployer and checks the result.
 * Read-only public RPC calls only.
 */
import { describe, expect, it } from 'vitest';
import { Bus } from '../src/bus.js';
import { createForgeClient, PORTAL, tokenAbi, tokenCreatedEvent } from '../src/forge/chain.js';
import { loadForgeConfig } from '../src/forge/config.js';
import { ForgeService } from '../src/forge/service.js';
import { MemoryRepository } from '../src/store/memory.js';

const live = process.env.FORGE_LIVE === '1';
const quiet = { info() {}, warn: (o: unknown, m?: string) => console.warn(m, o), error: (o: unknown, m?: string) => console.error(m, o), debug() {} };

describe.skipIf(!live)('$FORGE discovery (live BSC mainnet)', () => {
  it('discovers a recent flap.sh token by its deployer with correct name/symbol and a nonzero price', async () => {
    const cfg0 = loadForgeConfig({});
    const client = createForgeClient(cfg0.rpcUrls);
    const head = await client.getBlockNumber();
    const logs = (await client.getLogs({ address: PORTAL, event: tokenCreatedEvent, fromBlock: head - 3000n, toBlock: head })) as any[];
    expect(logs.length).toBeGreaterThan(0);
    // Newest launch that is the first launch of its deployer in its block (so "first match wins" is unambiguous).
    const target = logs[logs.length - 1];
    const tx = await client.getTransaction({ hash: target.transactionHash });
    const deployer = tx.from;
    const expectedBy = target.args.creator.toLowerCase() === deployer.toLowerCase() ? 'creator' : 'txFrom';

    const repo = new MemoryRepository();
    const cfg = loadForgeConfig({ FORGE_DEPLOYER: deployer, FORGE_START_BLOCK: String(target.blockNumber) });
    const svc = new ForgeService({ cfg, repo, bus: new Bus(), log: quiet, client });
    await svc.init();
    for (let i = 0; i < 5 && (await svc.status()).status === 'waiting'; i++) await svc.tick();
    const s = await svc.status();
    expect(s.status).toBe('live');
    const t = s.token!;
    const [name, symbol] = await Promise.all([
      client.readContract({ address: target.args.token, abi: tokenAbi, functionName: 'name' }),
      client.readContract({ address: target.args.token, abi: tokenAbi, functionName: 'symbol' }),
    ]);
    expect(t.address).toBe(target.args.token.toLowerCase());
    expect(t.name).toBe(name);
    expect(t.symbol).toBe(symbol);
    expect(t.creator).toBe(deployer.toLowerCase());
    expect(t.priceUsd).toBeGreaterThan(0);
    expect(t.marketCapUsd).toBeGreaterThan(0);
    const rec = await repo.getForgeRecord();
    expect(rec?.discoveredBy).toBe(expectedBy);
    // index trades from creation to head
    await svc.tick();
    const trades = await svc.trades(50);
    console.info(
      `[forge live] ${t.symbol} ${t.address} by ${deployer} (matched by ${rec?.discoveredBy}; event creator ${target.args.creator}) ` +
        `priceUsd=${t.priceUsd} mcap=$${t.marketCapUsd} stage=${t.stage} tax=${t.buyTaxBps}/${t.sellTaxBps} holders=${t.holders} trades=${trades.length} image=${t.image ?? '-'}`,
    );
  }, 180_000);
});
