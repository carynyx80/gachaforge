import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { Hex } from 'viem';
import { sortHolders, type HolderBalance } from './snapshot.js';

export interface Allocation {
  address: string;
  amount: bigint;
}

export const LEAF_ENCODING = ['address', 'uint256'] as const;

/**
 * Pro-rata split of `total` across holders by balance (floor division).
 * Rounding dust goes to the largest holder (ties -> lowest address) so sum(amounts) == total.
 */
export function proRata(holders: HolderBalance[], total: bigint): Allocation[] {
  const sorted = sortHolders(holders).filter((h) => h.balance > 0n);
  const weight = sorted.reduce((s, h) => s + h.balance, 0n);
  if (weight === 0n || total <= 0n) return [];
  const allocs = sorted.map((h) => ({ address: h.address, amount: (total * h.balance) / weight }));
  const dust = total - allocs.reduce((s, a) => s + a.amount, 0n);
  if (dust > 0n) {
    let top = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].balance > sorted[top].balance) top = i;
    allocs[top].amount += dust;
  }
  return allocs.filter((a) => a.amount > 0n);
}

export interface DividendTree {
  root: Hex;
  total: bigint;
  claims: { address: string; amount: bigint; proof: Hex[] }[];
  dump: ReturnType<StandardMerkleTree<[string, string]>['dump']>;
}

/** OpenZeppelin StandardMerkleTree over (address, uint256) leaves — verifiable with MerkleProof.verify in Solidity. */
export function buildDividendTree(allocs: Allocation[]): DividendTree {
  if (allocs.length === 0) throw new Error('cannot build merkle tree with no allocations');
  const seen = new Set<string>();
  for (const a of allocs) {
    const k = a.address.toLowerCase();
    if (seen.has(k)) throw new Error(`duplicate address in allocations: ${k}`);
    seen.add(k);
  }
  const values: [string, string][] = allocs.map((a) => [a.address, a.amount.toString()]);
  const tree = StandardMerkleTree.of(values, [...LEAF_ENCODING]);
  const claims = [];
  for (const [i, v] of tree.entries()) {
    claims.push({ address: v[0].toLowerCase(), amount: BigInt(v[1]), proof: tree.getProof(i) as Hex[] });
  }
  return {
    root: tree.root as Hex,
    total: allocs.reduce((s, a) => s + a.amount, 0n),
    claims,
    dump: tree.dump(),
  };
}

export function verifyClaim(root: Hex, address: string, amount: bigint, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(root, [...LEAF_ENCODING], [address, amount.toString()], proof);
}

/** Allocations large enough to be pushed by the operator instead of waiting for a claim. */
export function selectAutoPush(allocs: Allocation[], thresholdWei: bigint): Allocation[] {
  return allocs.filter((a) => a.amount >= thresholdWei).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}
