import { createPublicClient, createWalletClient, http, type Chain, type PublicClient, type WalletClient, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc, bscTestnet } from 'viem/chains';
import { FLAP_ADDRESSES } from './abi/flap.js';
import type { Config } from './config.js';

export interface ChainCtx {
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient | null;
  account: Account | null;
  factory: `0x${string}`;
  portal: `0x${string}`;
  vaultPortal: `0x${string}`;
  forgeToken?: `0x${string}`;
}

export function createChain(cfg: Config): ChainCtx {
  if (!cfg.FACTORY_ADDRESS) throw new Error('FACTORY_ADDRESS required for chain mode');
  if (!cfg.RPC_URL) throw new Error('RPC_URL required for chain mode');
  const chain = cfg.CHAIN_ID === 56 ? bsc : bscTestnet;
  const transport = http(cfg.RPC_URL, { batch: true, retryCount: 3 });
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  // The hot key is only loaded when the operator is explicitly enabled (indexer-only otherwise).
  const account = cfg.OPERATOR_ENABLED && cfg.OPERATOR_PRIVATE_KEY ? privateKeyToAccount(cfg.OPERATOR_PRIVATE_KEY as `0x${string}`) : null;
  const walletClient = account ? createWalletClient({ chain, transport, account }) : null;
  const flap = FLAP_ADDRESSES[cfg.CHAIN_ID as 56 | 97];
  return {
    chain,
    publicClient,
    walletClient,
    account,
    factory: cfg.FACTORY_ADDRESS as `0x${string}`,
    portal: flap.portal,
    vaultPortal: flap.vaultPortal,
  };
}
