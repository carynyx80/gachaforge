import { mapLimit } from './scan.js';

/**
 * Decoded flap.sh Portal `TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)`.
 * NOTE: none of its fields are indexed — `creator` lives in the event DATA, so it cannot be a topic filter.
 * `creator` is the Portal's msg.sender: the EOA for direct launches, but a CONTRACT (VaultPortal
 * 0x9049…4C06, or a third-party router) for vault/router launches. In that case the human deployer is
 * the transaction's `from`, so matching falls back to tx.from.
 */
export interface CreationLog {
  token: string;
  creator?: string | null;
  name: string;
  symbol: string;
  meta: string;
  ts?: bigint;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
}

export interface CreationMatch extends CreationLog {
  matchedBy: 'creator' | 'txFrom';
  deployer: string;
}

const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';

/** viem decoded log → CreationLog (returns null for anything that isn't a well-formed TokenCreated). */
export function toCreationLog(l: { eventName?: string; args?: any; blockNumber?: bigint | null; logIndex?: number | null; transactionHash?: string | null }): CreationLog | null {
  if (l.eventName !== 'TokenCreated' || !l.args?.token || l.blockNumber == null || !l.transactionHash) return null;
  const a = l.args;
  return {
    token: a.token,
    creator: a.creator && a.creator !== ZERO ? a.creator : null,
    name: a.name ?? '',
    symbol: a.symbol ?? '',
    meta: a.meta ?? '',
    ts: a.ts,
    blockNumber: l.blockNumber,
    logIndex: Number(l.logIndex ?? 0),
    transactionHash: l.transactionHash,
  };
}

/**
 * First (block, logIndex) creation whose creator == deployer, or — when the event's creator is
 * missing or is a different address (a contract calling the Portal) — whose tx.from == deployer.
 */
export async function matchCreation(logs: CreationLog[], deployer: string, txFrom: (hash: string) => Promise<string | null>): Promise<CreationMatch | null> {
  const sorted = [...logs].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  // Direct hit on the event's creator wins without any RPC.
  const direct = sorted.findIndex((l) => eq(l.creator, deployer));
  const candidates = direct === -1 ? sorted : sorted.slice(0, direct);
  // Look up tx.from only for creations that precede a direct hit (order matters: first match wins).
  const hashes = [...new Set(candidates.map((l) => l.transactionHash))];
  const froms = new Map<string, string | null>();
  await mapLimit(hashes, 6, async (h) => froms.set(h, await txFrom(h).catch(() => null)));
  for (const [i, l] of sorted.entries()) {
    if (i === direct) return { ...l, matchedBy: 'creator', deployer };
    if (eq(froms.get(l.transactionHash), deployer)) return { ...l, matchedBy: 'txFrom', deployer };
  }
  return null;
}
