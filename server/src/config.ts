import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte address');
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

export const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'https://gachaforge.xyz', 'https://www.gachaforge.xyz'];
/** Vercel production + preview deployments of the `gachaforge` project. */
export const VERCEL_PREVIEW_ORIGIN = /^https:\/\/gachaforge(-[a-z0-9-]+)?\.vercel\.app$/;
export const DEFAULT_TREASURY = '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c';

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return process.env.npm_package_version ?? '0.0.0';
  }
}
export const VERSION = readVersion();

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** Comma-separated allowed origins. `CORS_ORIGIN` (singular) is accepted as a legacy alias. */
  CORS_ORIGINS: z
    .string()
    .default(DEFAULT_CORS_ORIGINS.join(','))
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  /** Required in live mode (FACTORY_ADDRESS set and MOCK_MODE off). */
  RPC_URL: z.string().url().optional(),
  CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((v) => v === 56 || v === 97, 'CHAIN_ID must be 56 (BSC) or 97 (BSC testnet)')
    .default(97),
  FACTORY_ADDRESS: address.optional(),
  START_BLOCK: z.coerce.bigint().optional(),
  /** Company treasury wallet. Informational only — NOT excluded from holder eligibility. */
  TREASURY_ADDRESS: address.default(DEFAULT_TREASURY),
  /** Run the operator/keeper (sends txs). Off by default so indexer-only mode needs no hot key. */
  OPERATOR_ENABLED: boolish.default(false),
  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex key')
    .optional(),
  EXCLUDED_ADDRESSES: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(address)),
  /** Renaiss network; defaults from CHAIN_ID (56 → mainnet, 97 → testnet) and must agree with it. */
  RENAISS_NETWORK: z.enum(['mainnet', 'testnet']).optional(),
  /** Override the API base URL (defaults: https://api.renaiss.xyz / https://dev-api.renaiss.xyz). */
  RENAISS_API_URL: z.string().url().optional(),
  /** Builder key (header x-builder-api-key). Required only when the operator runs live (not mock). */
  RENAISS_API_KEY: z.string().optional(),
  RENAISS_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Max slippage on PancakeSwap quotes, in bps (100 = 1%). */
  SWAP_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(2000).default(100),
  /** Extra USDT bought on top of the pack price shortfall, in bps (dust stays in the wallet for the next pull). */
  SWAP_USDT_BUFFER_BPS: z.coerce.number().int().min(0).max(1000).default(10),
  SWAP_DEADLINE_SECONDS: z.coerce.number().int().positive().default(180),
  /** Defaults per network (see src/renaiss/networks.ts). */
  PANCAKE_ROUTER: address.optional(),
  USDT_ADDRESS: address.optional(),
  RENAISS_REGISTRY: address.optional(),
  RELEASE_POLL_MS: z.coerce.number().int().positive().default(60_000),
  DATABASE_URL: z.string().optional(),
  MOCK_MODE: boolish.optional(),
  BNB_USD_PRICE: z.coerce.number().positive().default(600),
  AUTO_PUSH_MIN_BNB: z.coerce.number().nonnegative().default(0.05),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(3000),
  OPERATOR_POLL_MS: z.coerce.number().int().positive().default(5000),
  SIM_INTERVAL_MS: z.coerce.number().int().positive().default(400),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = Omit<z.infer<typeof schema>, 'MOCK_MODE' | 'RENAISS_NETWORK'> & { MOCK_MODE: boolean; VERSION: string; RENAISS_NETWORK: 'mainnet' | 'testnet' };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Treat empty strings as unset so `.env.example` copied verbatim works.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== '') cleaned[k] = v;
  if (!cleaned.CORS_ORIGINS && cleaned.CORS_ORIGIN) cleaned.CORS_ORIGINS = cleaned.CORS_ORIGIN;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const MOCK_MODE = c.MOCK_MODE ?? !c.FACTORY_ADDRESS;
  if (!MOCK_MODE) {
    const missing: string[] = [];
    if (!c.FACTORY_ADDRESS) missing.push('FACTORY_ADDRESS (required when MOCK_MODE=false)');
    if (!c.RPC_URL) missing.push('RPC_URL (required when FACTORY_ADDRESS is set)');
    if (c.OPERATOR_ENABLED && !c.OPERATOR_PRIVATE_KEY) missing.push('OPERATOR_PRIVATE_KEY (required when OPERATOR_ENABLED=true)');
    if (c.OPERATOR_ENABLED && !c.RENAISS_API_KEY) missing.push('RENAISS_API_KEY (required when OPERATOR_ENABLED=true and MOCK_MODE=false)');
    if (missing.length) throw new Error(`Invalid configuration: missing ${missing.join('; ')}`);
  }
  const fromChain = c.CHAIN_ID === 56 ? 'mainnet' : 'testnet';
  const RENAISS_NETWORK = c.RENAISS_NETWORK ?? fromChain;
  if (RENAISS_NETWORK !== fromChain) throw new Error(`Invalid configuration: RENAISS_NETWORK=${RENAISS_NETWORK} does not match CHAIN_ID=${c.CHAIN_ID}`);
  return { ...c, MOCK_MODE, VERSION, RENAISS_NETWORK };
}
