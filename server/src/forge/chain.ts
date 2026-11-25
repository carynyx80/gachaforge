import { createPublicClient, fallback, http, parseAbi, type PublicClient } from 'viem';
import { bsc } from 'viem/chains';
import { FLAP_ADDRESSES, portalAbi } from '../abi/flap.js';
import { tokenAbi, taxProcessorAbi } from '../abi/token.js';
import { buybackBurnerAbi } from '../abi/generated/buybackBurner.js';

/** $FORGE is always on BSC mainnet, whatever CHAIN_ID the rest of the backend uses. */
export const FORGE_CHAIN_ID = 56 as const;
export const PORTAL = FLAP_ADDRESSES[56].portal;
export const VAULT_PORTAL = FLAP_ADDRESSES[56].vaultPortal;
/** Chainlink BNB/USD on BSC mainnet (8 decimals). */
export const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE' as const;
export const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
export const ZERO = '0x0000000000000000000000000000000000000000' as const;
/** USD stablecoins flap.sh tokens may use as quote (priced at $1). */
export const USD_QUOTES = new Set(
  [
    '0x55d398326f99059fF775485246999027B3197955', // USDT
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
    '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d', // USD1
  ].map((a) => a.toLowerCase()),
);

export const pairAbi = parseAbi([
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
  'function token0() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]);

export const chainlinkAbi = parseAbi(['function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)']);

export const tokenCreatedEvent = portalAbi.find((x) => x.type === 'event' && x.name === 'TokenCreated')!;
export const portalTradeEvents = portalAbi.filter(
  (x) => x.type === 'event' && ['TokenBought', 'TokenSold', 'LaunchedToDEX', 'TaxTokenAddressesUpdated', 'FlapTokenProgressChanged'].includes(x.name),
);
export const transferEvent = tokenAbi.find((x) => x.type === 'event' && x.name === 'Transfer')!;
export const swapEvent = pairAbi.find((x) => x.type === 'event' && x.name === 'Swap')!;
export const buybackEvent = buybackBurnerAbi.find((x) => x.type === 'event' && x.name === 'Buyback')!;

export { portalAbi, tokenAbi, taxProcessorAbi };

/**
 * Subset of viem's PublicClient the forge module uses (lets tests pass a fake).
 * Decoded logs come back with `eventName` + `args` (viem getLogs with `event`/`events`).
 */
export type ForgeClient = Pick<PublicClient, 'getBlockNumber' | 'getLogs' | 'readContract' | 'getTransaction' | 'getBalance' | 'getBlock'>;

export function createForgeClient(urls: string[]): ForgeClient {
  const transports = urls.map((u) => http(u, { retryCount: 1, timeout: 20_000 }));
  return createPublicClient({ chain: bsc, transport: transports.length > 1 ? fallback(transports) : transports[0] }) as PublicClient;
}
