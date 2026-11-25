import { keccak256, parseEther, stringToHex, type Hex } from 'viem';
import { feeSplit, PACK_PRICE_USD, TAX_BPS, TOTAL_SUPPLY_DEFAULT } from '../core/packs.js';
import { excludedFor } from '../indexer/excluded.js';
import { now, round2, type Ledger } from '../ledger.js';
import type { Logger } from '../log.js';
import { planDividend, planPull } from '../operator/settle.js';
import { mulberry32, randomCard, type Rng } from '../renaiss/simulated.js';
import { toCard } from '../renaiss/types.js';
import type { BurnEvent, FeeEvent, Machine, PackId, Pull, Strategy, Trade } from '../types.js';

/** Wallet that holds an eligible bag in every mock machine — handy for testing the rewards UI. */
export const DEMO_WALLET = '0x00000000000000000000000000000000000d3e70';
const E18 = 10n ** 18n;

const NAMES: [string, string, string][] = [
  ['Neon Drake', 'NDRK', 'A dragon that only wakes for holo pulls.'],
  ['Pink Slot', 'PSLOT', 'Pull the lever. Feed the pot. Repeat.'],
  ['Grail Goblin', 'GOBLN', 'Hoards slabs. Shares the shine.'],
  ['Mint Condition', 'MINT', 'Only tens. Only vibes.'],
  ['Booster Bunny', 'BUNNY', 'Hops from pack to pack.'],
  ['Holo Hamster', 'HOLO', 'Spins the wheel all day.'],
  ['Slab City', 'SLAB', 'Population: graded.'],
  ['Arcade Ape', 'AAPE', 'Insert coin, receive card.'],
  ['Chase Card', 'CHASE', 'Always hunting the hit.'],
  ['Pack Rat', 'PRAT', 'Never met a pack it did not rip.'],
  ['Gem Mint Cat', 'GMCAT', 'Nine lives, ten grades.'],
  ['Rip Club', 'RIP', 'First rule: we rip.'],
  ['Foil Frog', 'FOIL', 'Shiny side up.'],
  ['Pot Luck', 'LUCK', 'Every trade feeds the machine.'],
  ['Gacha Ghost', 'BOO', 'Haunts the pull button.'],
  ['Cardboard King', 'KING', 'Rules from a throne of toploaders.'],
  ['Lucky Lynx', 'LYNX', 'Eyes on the pot.'],
  ['Burn Baby', 'BURNB', 'Sells back, burns hard.'],
  ['Forge Fox', 'FFOX', 'Forged in pink neon.'],
];
const STRATS: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];
const PACKS: PackId[] = ['FORGE_28', 'FORGE_48', 'FORGE_88'];

export const addrFrom = (rng: Rng) => '0x' + Array.from({ length: 40 }, () => Math.floor(rng() * 16).toString(16)).join('');
export const txFrom = (rng: Rng) => keccak256(stringToHex(`tx-${rng()}-${rng()}`));
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

export interface MockContext {
  rng: Rng;
  ledger: Ledger;
  bnbUsd: number;
  excluded: string[];
  autoPushMinBnb: number;
  blockNumber: bigint;
}

export function createMockContext(ledger: Ledger, opts: { bnbUsd: number; excluded: string[]; seed?: number }): MockContext {
  return { rng: mulberry32(opts.seed ?? 0x6ac4af06), ledger, bnbUsd: opts.bnbUsd, excluded: opts.excluded, autoPushMinBnb: 0.05, blockNumber: 45_000_000n };
}

export async function seedMock(ledger: Ledger, opts: { bnbUsd: number; excluded: string[]; seed?: number; log?: Logger }): Promise<MockContext> {
  const ctx = createMockContext(ledger, opts);
  const { rng } = ctx;
  const repo = ledger.repo;
  const t0 = now();

  for (let i = 0; i < NAMES.length; i++) {
    const [name, ticker, description] = NAMES[i];
    const strategy = STRATS[i % STRATS.length];
    const pack = PACKS[i % 3];
    const address = addrFrom(rng);
    const graduated = rng() < 0.35;
    const createdAt = t0 - int(rng, 3600, 21 * 86400);
    const m: Machine = {
      address,
      vault: addrFrom(rng),
      name,
      ticker,
      description,
      image: `https://picsum.photos/seed/${ticker.toLowerCase()}/512/512`,
      creator: addrFrom(rng),
      createdAt,
      pack,
      packPriceUsd: PACK_PRICE_USD[pack],
      strategy,
      taxBps: TAX_BPS,
      ...(strategy === 'SPLIT' ? { split: { dividendBps: 5000, burnBps: 3000, lpBps: 2000 } } : {}),
      stage: graduated ? 'GRADUATED' : 'CURVE',
      bondingCurvePct: graduated ? 100 : round2(5 + rng() * 90),
      marketCapUsd: round2(graduated ? 80_000 + rng() * 2_000_000 : 4_000 + rng() * 60_000),
      change24hPct: round2(-40 + rng() * 140),
      volume24hUsd: round2(1_000 + rng() * 250_000),
      holders: 0,
      eligibleHolders: 0,
      potUsd: round2(rng() * PACK_PRICE_USD[pack] * 0.98),
      packsOpened: 0,
      round: 0,
      paidToHoldersBnb: 0,
      burnedTokens: 0,
      ...(i % 2 === 0 ? { links: { website: `https://example.com/${ticker.toLowerCase()}`, x: `https://x.com/${ticker.toLowerCase()}` } } : {}),
    };
    await repo.upsertMachine(m);

    // Holder book: curve/pool share + long tail; total == 1B.
    const nHolders = int(rng, 25, 160);
    let remaining = TOTAL_SUPPLY_DEFAULT;
    const poolShare = (TOTAL_SUPPLY_DEFAULT * BigInt(int(rng, 20, 60))) / 100n;
    await repo.setMeta(`pools:${address}`, JSON.stringify([m.vault.replace(/.$/, 'f')]));
    await repo.setBalance(address, m.vault.replace(/.$/, 'f'), poolShare);
    remaining -= poolShare;
    const demo = 500_000n * E18 + BigInt(int(rng, 0, 4_000_000)) * E18;
    await repo.setBalance(address, DEMO_WALLET, demo);
    remaining -= demo;
    for (let h = 0; h < nHolders && remaining > 0n; h++) {
      const pct = rng() ** 3 * 0.08; // heavy tail
      let bal = BigInt(Math.floor(Number(remaining / E18) * pct)) * E18;
      if (bal > remaining) bal = remaining;
      await repo.setBalance(address, addrFrom(rng), bal);
      remaining -= bal;
    }
    if (remaining > 0n) await repo.setBalance(address, m.creator, remaining);
    await refreshCounts(ctx, address);

    await ledger.activity(m, 'NEW_MACHINE', `$${ticker} launched · ${pack} · ${strategy}`, undefined, createdAt);

    // Trades
    const nTrades = int(rng, 10, 40);
    for (let k = 0; k < nTrades; k++) await repo.addTrade(address, mockTrade(ctx, m, createdAt + Math.floor(((t0 - createdAt) * (k + 1)) / (nTrades + 1))));

    // Past pulls
    const nPulls = int(rng, 0, 24);
    for (let k = 0; k < nPulls; k++) {
      const ts = createdAt + Math.floor(((t0 - createdAt) * (k + 1)) / (nPulls + 2));
      await simulatePull(ctx, address, ts, false);
    }
  }

  // Platform $FORGE buybacks
  for (let k = 0; k < 30; k++) {
    const ts = t0 - int(rng, 60, 14 * 86400);
    const b: BurnEvent = { id: `seed-burn-${k}`, kind: rng() < 0.7 ? 'BUYBACK' : 'BURN', amount: round2(50_000 + rng() * 1_500_000), txHash: txFrom(rng), timestamp: ts };
    await ledger.burn(b, round2(20 + rng() * 400));
  }
  opts.log?.info({ machines: NAMES.length }, 'mock data seeded');
  return ctx;
}

/**
 * Simulated live trades are sized in USD so the cadence doesn't depend on BNB_USD_PRICE: ~$200 avg (12 + U²·560).
 * The pot gets 7% of the 90% left after flap.sh's 10% cut of a 2% tax (0.126% of volume): ≈ $0.25/trade.
 * At ~5 trades/s (default SIM_INTERVAL_MS=400, 1–3 trades/tick) that's ≈ $75/min into pots → roughly one pull
 * every ~45s (30–90s) across all machines, while hot machines' meters move every second or so.
 */
const simTradeUsd = (rng: Rng) => 12 + rng() ** 2 * 560;
/** Share of simulated trades that go to the "hot" machines. */
const HOT_SHARE = 0.45;
const HOT_COUNT = 3;
/** Mock fee events flip pending → false after this long, mimicking dispatch + vault sync. */
export const MOCK_SYNC_MS = 10_000;

function mockTrade(ctx: MockContext, m: Machine, ts: number, live = false): Trade {
  const { rng } = ctx;
  const amountBnb = round4(live ? simTradeUsd(rng) / ctx.bnbUsd : 0.01 + rng() ** 2 * 3);
  const priceUsdPerToken = m.marketCapUsd / 1e9;
  return {
    side: rng() < 0.58 ? 'BUY' : 'SELL',
    trader: addrFrom(rng),
    amountBnb,
    tokens: round2((amountBnb * ctx.bnbUsd) / Math.max(priceUsdPerToken, 1e-9)),
    taxUsd: feeSplit(amountBnb * ctx.bnbUsd, m.taxBps).taxUsd,
    txHash: txFrom(rng),
    timestamp: ts,
  };
}

async function refreshCounts(ctx: MockContext, address: string) {
  const repo = ctx.ledger.repo;
  const m = (await repo.getMachine(address))!;
  const balances = await repo.getBalances(address);
  const excluded = new Set(await excludedFor(repo, m, ctx.excluded));
  const { selectEligible } = await import('../core/snapshot.js');
  const eligible = selectEligible(balances, { totalSupply: TOTAL_SUPPLY_DEFAULT, excluded: [...excluded] });
  await repo.upsertMachine({ ...m, holders: balances.filter((b) => !excluded.has(b.address)).length, eligibleHolders: eligible.length });
}

/** Runs one full pull through the same planner the real operator uses. */
export async function simulatePull(ctx: MockContext, address: string, ts = now(), live = true): Promise<Pull | null> {
  const { rng, ledger } = ctx;
  const repo = ledger.repo;
  const m = await repo.getMachine(address);
  if (!m) return null;
  ctx.blockNumber += BigInt(int(rng, 20, 400));
  const round = m.round + 1;
  const pullId = BigInt(round);
  const pullKey = `${m.address}-${round}`;
  const card = randomCard(m.pack, rng);
  const blockHash = keccak256(stringToHex(`block-${ctx.blockNumber}-${m.address}`)) as Hex;
  const balances = await repo.getBalances(address);
  const excluded = await excludedFor(repo, m, ctx.excluded);
  const plan = planPull({ machine: m, card, balances, totalSupply: TOTAL_SUPPLY_DEFAULT, excluded, blockHash, pullId, pullKey, snapshotBlock: ctx.blockNumber });

  const won = plan.outcome === 'RAFFLE' && plan.winner;
  const proceedsUsd = won ? 0 : round2(card.valueUsd * 0.9);
  const proceedsBnb = round4(proceedsUsd / ctx.bnbUsd);
  const cardData = toCard(card);
  const pull: Pull = {
    id: pullKey,
    machine: m.address,
    ticker: m.ticker,
    pack: m.pack,
    round,
    card: cardData,
    result: won ? 'WON' : m.strategy === 'BURN' || m.strategy === 'HIT_HUNTER' ? 'BURNED' : 'SOLD',
    ...(won ? { winner: plan.winner! } : { proceedsBnb }),
    txHash: txFrom(rng),
    timestamp: ts,
  };
  if (won) await repo.setRaffleProof(plan.proof);
  else await repo.setRaffleProof({ ...plan.proof, winner: null }); // published even when sold (no raffle)

  const patch: Partial<Machine> = {
    round,
    packsOpened: m.packsOpened + 1,
    potUsd: live ? round2(Math.max(0, m.potUsd - m.packPriceUsd)) : m.potUsd,
  };

  if (!won) {
    if (m.strategy === 'DIVIDEND' || m.strategy === 'SPLIT') {
      const d = planDividend({ machine: m, proceedsWei: parseEther(proceedsBnb.toFixed(18)), eligible: plan.eligible, autoPushMinWei: parseEther(String(ctx.autoPushMinBnb)) });
      if (d.tree) {
        for (const c of d.tree.claims) await repo.creditRewards(m.address, c.address, Number(c.amount) / 1e18);
        await repo.saveDividendClaims(d.tree.claims.map((c) => ({ machine: m.address, epoch: round, root: d.tree!.root, wallet: c.address, amountWei: c.amount.toString(), proof: c.proof, pushed: false })));
        const paid = Number(d.dividendWei) / 1e18;
        patch.paidToHoldersBnb = round4(m.paidToHoldersBnb + paid);
        await ledger.payout(m, paid, ctx.bnbUsd, plan.eligible.length, ts);
      }
    }
    if (m.strategy === 'BURN' || m.strategy === 'HIT_HUNTER' || m.strategy === 'SPLIT') {
      const share = m.strategy === 'SPLIT' ? 0.3 : 1;
      const tokens = round2(((proceedsUsd * share) / Math.max(m.marketCapUsd, 1)) * 1e9);
      patch.burnedTokens = round2(m.burnedTokens + tokens);
      await ledger.machineBurn(m.address, tokens, proceedsUsd * share, ts, { updateMachine: false });
    }
  }
  await ledger.saveMachine({ ...m, ...patch }, live);
  await ledger.pull(pull);
  return pull;
}

/**
 * One simulated live trade on `address`: trade row, balance drift, FeeEvent (pot += exactly fee.potUsd, broadcast as
 * `fee` + `machine`), and a pull when the pot reaches the pack price (simulatePull keeps the remainder).
 */
export async function simulateTrade(ctx: MockContext, address: string, ts = now()): Promise<{ fee: FeeEvent; pull: Pull | null } | null> {
  const { rng, ledger } = ctx;
  const m = await ledger.repo.getMachine(address);
  if (!m) return null;
  const t = mockTrade(ctx, m, ts, true);
  await ledger.trade(m.address, t);
  // move some balance so holder counts / odds drift
  const tokensBase = BigInt(Math.floor(t.tokens)) * E18;
  const pool = JSON.parse((await ledger.repo.getMeta(`pools:${m.address}`)) ?? '[]')[0] as string;
  if (pool && t.side === 'BUY') await ledger.repo.applyTransfer(m.address, pool, t.trader, tokensBase);
  await refreshCounts(ctx, m.address);
  const drift = 1 + (rng() - 0.48) * 0.04;
  const curveStep = rng() * 0.8;
  const fee = await ledger.recordFee(m.address, t, ctx.bnbUsd, {
    pending: true,
    patch: (cur) => {
      const curve = cur.stage === 'CURVE' ? Math.min(100, round2(cur.bondingCurvePct + curveStep)) : 100;
      return {
        marketCapUsd: round2(cur.marketCapUsd * drift),
        change24hPct: round2(cur.change24hPct + (drift - 1) * 100),
        volume24hUsd: round2(cur.volume24hUsd + t.amountBnb * ctx.bnbUsd),
        bondingCurvePct: curve,
        stage: curve >= 100 ? 'GRADUATED' : cur.stage,
      };
    },
  });
  if (!fee) return null;
  // Keep the ticker readable: the per-trade feed is the `fee` stream; only some trades also get a TAX activity line.
  if (rng() < 0.06) await ledger.activity(m, 'TAX', `tax $${fee.taxUsd.toFixed(2)} → $${fee.potUsd.toFixed(2)} gacha pot`, fee.taxUsd, ts);
  if (rng() < 0.01) {
    // a buyback batches many taxes
    await ledger.burn({ id: `sim-buyback-${fee.id}`, kind: 'BUYBACK', amount: round2(10_000 + rng() * 400_000), txHash: txFrom(rng), timestamp: ts }, round2(fee.buybackUsd * 100));
  }
  const pull = fee.potAfterUsd >= fee.packPriceUsd ? await simulatePull(ctx, m.address) : null;
  return { fee, pull };
}

/** Picks the simulator's "hot" machines (deterministic for a given rng). */
function pickHot(ctx: MockContext, machines: Machine[]): string[] {
  const pool = [...machines].sort((a, b) => a.address.localeCompare(b.address));
  const hot: string[] = [];
  while (hot.length < Math.min(HOT_COUNT, pool.length)) hot.push(pool.splice(Math.floor(ctx.rng() * pool.length), 1)[0].address);
  return hot;
}

/** Live simulator: several trades/s (biased to a few hot machines) → fee events → pots; pulls fire when pot >= pack price. */
export function startSimulator(ctx: MockContext, intervalMs: number, log?: Logger) {
  const { rng, ledger } = ctx;
  let hot: string[] | null = null;
  let busy = false;
  const syncTimers = new Set<NodeJS.Timeout>();
  const tick = async () => {
    if (busy) return; // never overlap ticks (they read-modify-write machines)
    busy = true;
    try {
      const machines = await ledger.repo.listMachines();
      if (!machines.length) return;
      hot ??= pickHot(ctx, machines);
      const burst = int(rng, 1, 3);
      for (let i = 0; i < burst; i++) {
        const address = rng() < HOT_SHARE ? hot[Math.floor(rng() * hot.length)] : machines[Math.floor(rng() * machines.length)].address;
        const r = await simulateTrade(ctx, address);
        if (!r) continue;
        const t = setTimeout(() => {
          syncTimers.delete(t);
          void ledger.settleFees(r.fee.machine, r.fee.timestamp).catch((err) => log?.error({ err }, 'mock fee sync failed'));
        }, MOCK_SYNC_MS);
        t.unref?.();
        syncTimers.add(t);
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick().catch((err) => log?.error({ err }, 'simulator tick failed')), intervalMs);
  return () => {
    clearInterval(timer);
    for (const t of syncTimers) clearTimeout(t);
    syncTimers.clear();
  };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
