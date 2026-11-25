import { encodePacked, hexToBigInt, keccak256, type Hex } from 'viem';
import { snapshotHash, sortHolders, type HolderBalance } from './snapshot.js';

/** seed = keccak256(abi.encodePacked(bytes32 blockHash, uint256 pullId)) */
export function deriveSeed(blockHash: Hex, pullId: bigint): Hex {
  return keccak256(encodePacked(['bytes32', 'uint256'], [blockHash, pullId]));
}

export interface DrawResult {
  winner: string;
  index: number;
  ticket: bigint;
  totalWeight: bigint;
}

/**
 * Deterministic balance-weighted draw.
 * ticket = uint256(seed) % totalWeight; winner = first holder (canonical order) whose
 * cumulative balance exceeds ticket. Returns null when there is no weight.
 */
export function weightedDraw(eligible: HolderBalance[], seed: Hex): DrawResult | null {
  const sorted = sortHolders(eligible).filter((h) => h.balance > 0n);
  const totalWeight = sorted.reduce((s, h) => s + h.balance, 0n);
  if (totalWeight === 0n) return null;
  const ticket = hexToBigInt(seed) % totalWeight;
  let cum = 0n;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i].balance;
    if (ticket < cum) return { winner: sorted[i].address, index: i, ticket, totalWeight };
  }
  /* c8 ignore next */
  throw new Error('unreachable: ticket outside cumulative range');
}

export interface RaffleCheck {
  eligible: HolderBalance[];
  seed: Hex;
  snapshotHash: Hex;
  winner: string | null;
  blockHash?: Hex;
  pullId?: bigint;
}

/** Re-derives everything a published proof claims. */
export function verifyRaffle(p: RaffleCheck): boolean {
  if (snapshotHash(p.eligible) !== p.snapshotHash) return false;
  if (p.blockHash !== undefined && p.pullId !== undefined && deriveSeed(p.blockHash, p.pullId) !== p.seed) return false;
  const r = weightedDraw(p.eligible, p.seed);
  if (!r) return p.winner === null;
  return p.winner !== null && r.winner === p.winner.toLowerCase();
}
