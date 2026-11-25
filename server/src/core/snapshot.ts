import { keccak256, stringToBytes, type Hex } from 'viem';
import { ELIGIBILITY_BPS } from './packs.js';

export interface HolderBalance {
  address: string;
  balance: bigint;
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';
export const ALWAYS_EXCLUDED = [ZERO_ADDRESS, DEAD_ADDRESS];

export function normalizeAddress(a: string): string {
  return a.toLowerCase();
}

/** Minimum balance (base units) to be eligible: floor(totalSupply * bps / 10_000). Default 1 bps = 0.01%. */
export function minEligibleBalance(totalSupply: bigint, bps: bigint = ELIGIBILITY_BPS): bigint {
  return (totalSupply * bps) / 10_000n;
}

/** Canonical ordering: ascending lowercase address. */
export function sortHolders(holders: HolderBalance[]): HolderBalance[] {
  return [...holders]
    .map((h) => ({ address: normalizeAddress(h.address), balance: h.balance }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}

export interface EligibilityOptions {
  totalSupply: bigint;
  /** pools/pairs, token contract, vault, launchpad, router … (dead/zero always excluded) */
  excluded: string[];
  minBps?: bigint;
}

/**
 * Pure snapshot filter. Merges duplicate addresses (summing), drops excluded
 * addresses and anything below the threshold, returns canonical ordering.
 */
export function selectEligible(holders: HolderBalance[], opts: EligibilityOptions): HolderBalance[] {
  const min = minEligibleBalance(opts.totalSupply, opts.minBps);
  const excluded = new Set([...ALWAYS_EXCLUDED, ...opts.excluded.map(normalizeAddress)]);
  const merged = new Map<string, bigint>();
  for (const h of holders) {
    const a = normalizeAddress(h.address);
    merged.set(a, (merged.get(a) ?? 0n) + h.balance);
  }
  const out: HolderBalance[] = [];
  for (const [address, balance] of merged) {
    if (excluded.has(address)) continue;
    if (balance <= 0n || balance < min) continue;
    out.push({ address, balance });
  }
  return sortHolders(out);
}

/** Exact bytes hashed for snapshotHash: "addr:balance" lines (lowercase addr, decimal base units), sorted by addr, joined by "\n". */
export function snapshotPreimage(eligible: HolderBalance[]): string {
  return sortHolders(eligible)
    .map((h) => `${h.address}:${h.balance.toString()}`)
    .join('\n');
}

export function snapshotHash(eligible: HolderBalance[]): Hex {
  return keccak256(stringToBytes(snapshotPreimage(eligible)));
}

export const SNAPSHOT_HASH_FORMAT =
  'keccak256(utf8(join("\\n", sortAsc(lower(address) + ":" + decimal(balanceBaseUnits)))))';
