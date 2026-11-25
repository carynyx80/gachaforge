import { concat, keccak256, toHex, type Address, type Hex } from 'viem';
import { FLAP_PORTAL, FLAP_TAX_TOKEN_V3_IMPL } from './chain';

/** EIP-1167 clone init code hash for the flap Tax Token V3 impl (docs/flap-integration.md §3.1). */
const INIT_HASH = keccak256(
  (`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${FLAP_TAX_TOKEN_V3_IMPL.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`) as Hex,
);
const PREFIX = concat(['0xff', FLAP_PORTAL]);

/**
 * Token address the Portal will deploy for `salt`: CREATE2(from = Portal, salt, keccak(EIP-1167 clone
 * of Tax Token V3 impl)). Same derivation as FlapLauncher.predictToken / FlapMainnetFork._mineSalt.
 */
export function predictFlapToken(salt: Hex): Address {
  return `0x${keccak256(concat([PREFIX, salt, INIT_HASH])).slice(26)}` as Address;
}

/**
 * Mine a CREATE2 salt so the Portal-deployed token address ends in 7777 (required by flap for tax
 * tokens; FlapLauncher reverts with BadVanity otherwise). ~65k tries on average; yields to the UI.
 */
export async function mineVanitySalt(onProgress?: (tries: number) => void, signal?: AbortSignal): Promise<{ salt: Hex; token: Address }> {
  const seed = crypto.getRandomValues(new Uint8Array(24));
  let i = 0;
  for (;;) {
    for (let k = 0; k < 4000; k++, i++) {
      const salt = concat([toHex(seed), toHex(i, { size: 8 })]);
      const h = keccak256(concat([PREFIX, salt, INIT_HASH]));
      if (h.endsWith('7777')) return { salt, token: `0x${h.slice(26)}` as Address };
    }
    onProgress?.(i);
    if (signal?.aborted) throw new Error('Cancelled');
    await new Promise((r) => setTimeout(r, 0));
  }
}
