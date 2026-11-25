import { z } from 'zod';

export const FORGE_DEFAULT_RPC = 'https://bsc-rpc.publicnode.com';
export const FORGE_FALLBACK_RPC = 'https://bsc-dataseed.bnbchain.org';
/** flap.sh's indexer reads only its own Pinata gateway (docs/flap-integration.md §3.1, §7). */
export const FLAP_IPFS_GATEWAY = 'https://flap.mypinata.cloud/ipfs/';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte address');
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  /** Comma-separated; the public fallback is always appended. Always BSC mainnet (chainId 56). */
  FORGE_RPC_URL: z.string().default(FORGE_DEFAULT_RPC),
  FORGE_DEPLOYER: address.optional(),
  FORGE_TOKEN_ADDRESS: address.optional(),
  FORGE_START_BLOCK: z.coerce.bigint().nonnegative().optional(),
  FORGE_PREVIEW: boolish.default(false),
  BUYBACK_BURNER_ADDRESS: address.optional(),
  FORGE_POLL_MS: z.coerce.number().int().positive().default(5000),
  /** Upper bound for one eth_getLogs block range (public RPCs accept ~1000–5000). */
  FORGE_MAX_RANGE: z.coerce.number().int().min(10).max(50_000).default(5000),
  FORGE_IPFS_GATEWAY: z.string().url().default(FLAP_IPFS_GATEWAY),
  /** With FORGE_TOKEN_ADDRESS and no FORGE_START_BLOCK: how far back to look for its TokenCreated log. */
  FORGE_OVERRIDE_LOOKBACK: z.coerce.bigint().positive().default(200_000n),
});

export interface ForgeConfig {
  rpcUrls: string[];
  deployer?: `0x${string}`;
  tokenOverride?: `0x${string}`;
  startBlock?: bigint;
  preview: boolean;
  buybackBurner?: `0x${string}`;
  pollMs: number;
  maxRange: number;
  ipfsGateway: string;
  overrideLookback: bigint;
}

/** Independent of MOCK_MODE / CHAIN_ID: $FORGE always lives on BSC mainnet. */
export function loadForgeConfig(env: Record<string, string | undefined> = process.env): ForgeConfig {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v.trim() !== '') cleaned[k] = v.trim();
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const c = parsed.data;
  const rpcUrls = c.FORGE_RPC_URL.split(',').map((s) => s.trim()).filter(Boolean);
  for (const u of rpcUrls) if (!/^https?:\/\//.test(u)) throw new Error(`Invalid configuration: FORGE_RPC_URL: ${u} is not an http(s) URL`);
  if (!rpcUrls.includes(FORGE_FALLBACK_RPC)) rpcUrls.push(FORGE_FALLBACK_RPC);
  return {
    rpcUrls,
    deployer: c.FORGE_DEPLOYER as `0x${string}` | undefined,
    tokenOverride: c.FORGE_TOKEN_ADDRESS as `0x${string}` | undefined,
    startBlock: c.FORGE_START_BLOCK,
    preview: c.FORGE_PREVIEW,
    buybackBurner: c.BUYBACK_BURNER_ADDRESS as `0x${string}` | undefined,
    pollMs: c.FORGE_POLL_MS,
    maxRange: c.FORGE_MAX_RANGE,
    ipfsGateway: c.FORGE_IPFS_GATEWAY.endsWith('/') ? c.FORGE_IPFS_GATEWAY : `${c.FORGE_IPFS_GATEWAY}/`,
    overrideLookback: c.FORGE_OVERRIDE_LOOKBACK,
  };
}
