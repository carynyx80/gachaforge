import type { Hex } from 'viem';
import {
  buildDividendTree,
  decideOutcome,
  deriveSeed,
  proRata,
  selectAutoPush,
  selectEligible,
  snapshotHash,
  SNAPSHOT_HASH_FORMAT,
  splitProceeds,
  weightedDraw,
  type DividendTree,
  type HolderBalance,
  type Outcome,
} from '../core/index.js';
import type { Card, Machine, RaffleProof } from '../types.js';

export interface RafflePlan {
  outcome: Outcome;
  eligible: HolderBalance[];
  snapshotHash: Hex;
  seed: Hex;
  winner: string | null;
  proof: RaffleProof;
}

const toUnits = (b: bigint, decimals = 18) => Number(b / 10n ** BigInt(decimals - 2)) / 100;

/** Snapshot + decide + draw. Pure given its inputs (no chain access). */
export function planPull(p: {
  machine: Pick<Machine, 'address' | 'strategy' | 'packPriceUsd'>;
  card: Pick<Card, 'valueUsd'>;
  balances: HolderBalance[];
  totalSupply: bigint;
  excluded: string[];
  blockHash: Hex;
  pullId: bigint;
  pullKey: string;
  snapshotBlock: bigint;
  decimals?: number;
}): RafflePlan {
  const eligible = selectEligible(p.balances, { totalSupply: p.totalSupply, excluded: p.excluded });
  const outcome = decideOutcome({
    strategy: p.machine.strategy,
    cardValueUsd: p.card.valueUsd,
    packPriceUsd: p.machine.packPriceUsd,
    eligibleCount: eligible.length,
  });
  const seed = deriveSeed(p.blockHash, p.pullId);
  const hash = snapshotHash(eligible);
  const winner = outcome === 'RAFFLE' ? (weightedDraw(eligible, seed)?.winner ?? null) : null;
  return {
    outcome,
    eligible,
    snapshotHash: hash,
    seed,
    winner,
    proof: {
      pullId: p.pullKey,
      machine: p.machine.address.toLowerCase(),
      snapshotBlock: Number(p.snapshotBlock),
      snapshotHash: hash,
      seed,
      eligible: eligible.map((h) => ({ address: h.address, balance: toUnits(h.balance, p.decimals), balanceRaw: h.balance.toString() })),
      winner,
      blockHash: p.blockHash,
      hashFormat: SNAPSHOT_HASH_FORMAT,
    },
  };
}

export interface DividendPlan {
  dividendWei: bigint;
  tree: DividendTree | null;
  autoPush: { address: string; amount: bigint }[];
}

/** For DIVIDEND/SPLIT: how much goes to holders and the merkle tree for it. */
export function planDividend(p: {
  machine: Pick<Machine, 'strategy' | 'split' | 'stage'>;
  proceedsWei: bigint;
  eligible: HolderBalance[];
  autoPushMinWei: bigint;
}): DividendPlan {
  const split = splitProceeds(p.proceedsWei, p.machine.strategy, p.machine.split, p.machine.stage === 'GRADUATED');
  if (split.dividend === 0n) return { dividendWei: 0n, tree: null, autoPush: [] };
  const allocs = proRata(p.eligible, split.dividend);
  if (!allocs.length) return { dividendWei: split.dividend, tree: null, autoPush: [] };
  return { dividendWei: split.dividend, tree: buildDividendTree(allocs), autoPush: selectAutoPush(allocs, p.autoPushMinWei) };
}
