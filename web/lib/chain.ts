import { isAddress, type Address } from 'viem';

export const BSC_RPC = process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.bnbchain.org';
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || '';
export const BSCSCAN = 'https://bscscan.com';

const factoryEnv = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || '';
/** GachaForgeFactory on BSC mainnet. Unset → contracts not live yet; all writes stay disabled. */
export const FACTORY_ADDRESS: Address | undefined = isAddress(factoryEnv) ? (factoryEnv as Address) : undefined;
export const CONTRACTS_LIVE = !!FACTORY_ADDRESS;

/** flap.sh mainnet Portal (docs/flap-integration.md §2). */
export const FLAP_PORTAL: Address = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0';
/** flap.sh Tax Token V3 implementation — CREATE2 clone base; launched token must end in 7777. */
export const FLAP_TAX_TOKEN_V3_IMPL: Address = '0x024f18294970B5c76c0691b87f138A0317156422';

export const NATIVE: Address = '0x0000000000000000000000000000000000000000';
export const SLIPPAGE_BPS = BigInt(200); // 2%

export const txUrl = (h: string) => `${BSCSCAN}/tx/${h}`;
export const addrUrl = (a: string) => `${BSCSCAN}/address/${a}`;

/** Human-readable wallet/tx error. */
export function txErrorMessage(e: unknown): string {
  const err = e as { name?: string; shortMessage?: string; message?: string; cause?: unknown; details?: string };
  const text = [err?.name, err?.shortMessage, err?.message, err?.details].filter(Boolean).join(' ').toLowerCase();
  if (/userrejected|user rejected|user denied|rejected the request|request rejected|4001/.test(text)) return 'Request rejected in wallet.';
  if (/insufficient funds|insufficientfunds|exceeds balance|insufficient balance/.test(text)) return 'Insufficient BNB for amount + gas.';
  if (/chain mismatch|does not match the target chain/.test(text)) return 'Wrong network. Switch to BNB Chain.';
  return err?.shortMessage || err?.message?.split('\n')[0] || 'Transaction failed.';
}
