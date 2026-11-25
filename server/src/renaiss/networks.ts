import type { PackId } from '../types.js';

export type RenaissNetworkName = 'mainnet' | 'testnet';

export interface RenaissNetwork {
  name: RenaissNetworkName;
  chainId: 56 | 97;
  apiBaseUrl: string;
  /** TokenVendingMachineV3: Permit2 spender for pulls and EIP-712 verifyingContract for buybacks. */
  vendingMachine: `0x${string}`;
  /** RenaissRegistry (card ERC-721). */
  registry: `0x${string}`;
  usdt: `0x${string}`;
  permit2: `0x${string}`;
  /** PancakeSwap V2 router used for BNB <-> USDT. */
  pancakeRouter: `0x${string}`;
  /** Our pack tiers → Renaiss catalog slugs on this network. */
  slugs: Record<PackId, string>;
}

/**
 * Constants confirmed from docs.renaiss.xyz/contracts.md and the network objects bundled in
 * @renaiss-protocol/client@0.1.0-beta.5 (BNB_MAINNET / BNB_TESTNET). Slugs from the live public catalog
 * (2026-11-25): testnet has `pandora-88`, mainnet `pandora-88-plus`.
 */
export const RENAISS_NETWORKS: Record<RenaissNetworkName, RenaissNetwork> = {
  mainnet: {
    name: 'mainnet',
    chainId: 56,
    apiBaseUrl: 'https://api.renaiss.xyz',
    vendingMachine: '0xd4d18607d6111c5fa2f93a4a5b2c0e28f1563f9f',
    registry: '0xF8646A3Ca093e97Bb404c3b25e675C0394DD5b30',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    pancakeRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    slugs: { FORGE_28: 'pandora-28', FORGE_48: 'pandora-48', FORGE_88: 'pandora-88-plus' },
  },
  testnet: {
    name: 'testnet',
    chainId: 97,
    apiBaseUrl: 'https://dev-api.renaiss.xyz',
    vendingMachine: '0xeeddf88d5cb406cc27f6eea4636566b4943e3737',
    registry: '0x57eE95884Ac93E6d081Fd9366AFEF9891C8Eceb4',
    // Renaiss mock USDT on chain 97 (no PancakeSwap liquidity expected: fund the operator directly).
    usdt: '0x3d2745c844cee4a62B66DF18b5Fd93781C26958b',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    pancakeRouter: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    slugs: { FORGE_28: 'pandora-28', FORGE_48: 'pandora-48', FORGE_88: 'pandora-88' },
  },
};

export const networkForChain = (chainId: number): RenaissNetworkName => (chainId === 56 ? 'mainnet' : 'testnet');

export const USDT_DECIMALS = 18;
export const ONE_USDT = 10n ** 18n;
