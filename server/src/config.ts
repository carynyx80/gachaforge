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
  /** Default: 56 in offchain mode, 97 otherwise. */
  CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((v) => v === 56 || v === 97, 'CHAIN_ID must be 56 (BSC) or 97 (BSC testnet)')
    .optional(),
  /** offchain (default without FACTORY_ADDRESS) | vault (on-chain contracts, default with FACTORY_ADDRESS) | mock (preview). */
  MODE: z.enum(['offchain', 'vault', 'mock']).optional(),
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

  // ── OFF-CHAIN MODE (SPEC "OFF-CHAIN MODE"; docs/OFFCHAIN-OPS.md) ──
  /** Hot wallet that pays for everything (pulls, payouts, burns, buybacks, dispatch gas). Unset → read-only, actions queued. */
  OPS_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex key')
    .optional(),
  /** Rolling-24h cap on BNB leaving the ops wallet (tx value + gas), sweeps excluded. */
  OPS_DAILY_CAP_BNB: z.coerce.number().nonnegative().default(1),
  /** Allow a signing ops wallet with the in-memory store (dev only: pots, payout queue and the daily cap reset on restart). */
  OPS_ALLOW_MEMORY: boolish.default(false),
  /** Kill switch: no outgoing tx at all (everything is recorded as QUEUED). */
  OPS_PAUSED: boolish.default(false),
  /** Gas buffer kept in the ops wallet on top of everything owed (sweep never touches it). */
  OPS_RESERVE_BNB: z.coerce.number().nonnegative().default(0.05),
  /** Per-pull cap above the pack price at Chainlink BNB/USD, bps (1000 = +10%). */
  OPS_PULL_BUFFER_BPS: z.coerce.number().int().min(0).max(3000).default(1000),
  OPS_TX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  OPS_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  /** Cooldown between two pulls of the same machine. */
  PULL_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(60),
  /** Dividend shares below this stay in the machine's dividend bucket for the next round. */
  DIVIDEND_MIN_BNB: z.coerce.number().nonnegative().default(0.0005),
  /** Max dividend transfers sent per ops tick (the rest wait in the payout queue). */
  DIVIDEND_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  /** $FORGE buyback runs once the buyback ledger holds at least this much. */
  BUYBACK_MIN_BNB: z.coerce.number().nonnegative().default(0.05),
  /** Machine-token burns (BURN/HIT_HUNTER/SPLIT) run once a machine's burn bucket holds at least this much. */
  BURN_MIN_BNB: z.coerce.number().nonnegative().default(0.0005),
  /** Slippage guard for Portal swapExactInput buys (bps below the quote). */
  BURN_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(3000).default(300),
  /** Skip TaxProcessor.dispatch() when its gas would exceed this % of the pending tax. */
  DISPATCH_MAX_GAS_PCT: z.coerce.number().positive().max(100).default(10),
  /** Portal TokenCreated with tax recipient == TREASURY gets auto-registered (FORGE_28 / RAFFLE) after this long. */
  AUTO_REGISTER_DELAY_SEC: z.coerce.number().int().nonnegative().default(600),
  /** Optional cold wallet for the 90% platform share (only when the ops wallet IS the treasury). */
  SWEEP_TO_ADDRESS: address.optional(),
  SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 3600_000),
  SWEEP_MIN_BNB: z.coerce.number().nonnegative().default(0.05),
  KEEPER_POLL_MS: z.coerce.number().int().positive().default(60_000),
  /** Max addresses per eth_getLogs address filter (public RPCs reject long lists). */
  LOGS_ADDRESS_BATCH: z.coerce.number().int().min(1).max(1000).default(50),
  /** Max eth_getLogs block range for the off-chain indexer (adaptive below it). */
  LOGS_MAX_RANGE: z.coerce.number().int().min(10).max(50_000).default(2000),
  /** Off-chain estimate of flap.sh's cut until real treasury receipts have been measured, bps of the tax. */
  FLAP_CUT_ESTIMATE_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
  /** Mainnet RPC fallback (shared with the $FORGE watcher) used by offchain mode when RPC_URL is unset. */
  FORGE_RPC_URL: z.string().optional(),
});

export type Mode = 'offchain' | 'vault' | 'mock';
export type Config = Omit<z.infer<typeof schema>, 'MOCK_MODE' | 'RENAISS_NETWORK' | 'MODE' | 'CHAIN_ID'> & {
  MODE: Mode;
  /** = MODE === 'mock' (kept for the vault/mock code paths). */
  MOCK_MODE: boolean;
  CHAIN_ID: 56 | 97;
  VERSION: string;
  RENAISS_NETWORK: 'mainnet' | 'testnet';
  /** Offchain mode: RPC_URL, else FORGE_RPC_URL's first entry, else the public BSC RPC (chain 56 only). */
  RPC_URLS: string[];
};

/** MODE explicit wins; MOCK_MODE=true → mock; FACTORY_ADDRESS → vault; otherwise offchain. */
export function resolveMode(c: { MODE?: Mode; MOCK_MODE?: boolean; FACTORY_ADDRESS?: string }): Mode {
  if (c.MODE) return c.MODE;
  if (c.MOCK_MODE === true) return 'mock';
  if (c.FACTORY_ADDRESS) return 'vault';
  return 'offchain';
}

export const PUBLIC_BSC_RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'];

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
  const MODE = resolveMode(c);
  const MOCK_MODE = MODE === 'mock';
  const CHAIN_ID = (c.CHAIN_ID ?? (MODE === 'offchain' ? 56 : 97)) as 56 | 97;
  const missing: string[] = [];
  if (MODE === 'vault') {
    if (!c.FACTORY_ADDRESS) missing.push('FACTORY_ADDRESS (required when MODE=vault)');
    if (!c.RPC_URL) missing.push('RPC_URL (required when FACTORY_ADDRESS is set)');
    if (c.OPERATOR_ENABLED && !c.OPERATOR_PRIVATE_KEY) missing.push('OPERATOR_PRIVATE_KEY (required when OPERATOR_ENABLED=true)');
    if (c.OPERATOR_ENABLED && !c.RENAISS_API_KEY) missing.push('RENAISS_API_KEY (required when OPERATOR_ENABLED=true and MOCK_MODE=false)');
  }
  let RPC_URLS: string[] = c.RPC_URL ? [c.RPC_URL] : [];
  if (MODE === 'offchain' && !RPC_URLS.length) {
    if (CHAIN_ID !== 56) missing.push('RPC_URL (required for offchain mode on CHAIN_ID=97)');
    else {
      const forge = (c.FORGE_RPC_URL ?? '').split(',').map((s) => s.trim()).filter((u) => /^https?:\/\//.test(u));
      RPC_URLS = [...new Set([...forge, ...PUBLIC_BSC_RPCS])];
    }
  }
  if (missing.length) throw new Error(`Invalid configuration: missing ${missing.join('; ')}`);
  const fromChain = CHAIN_ID === 56 ? 'mainnet' : 'testnet';
  const RENAISS_NETWORK = c.RENAISS_NETWORK ?? fromChain;
  if (RENAISS_NETWORK !== fromChain) throw new Error(`Invalid configuration: RENAISS_NETWORK=${RENAISS_NETWORK} does not match CHAIN_ID=${CHAIN_ID}`);
  return { ...c, MODE, MOCK_MODE, CHAIN_ID, VERSION, RENAISS_NETWORK, RPC_URLS };
}
