import { parseAbi } from 'viem';

// flap.sh Portal + VaultPortal (CONFIRMED in docs/flap-integration.md §3, §6 — from flap-sh/FlapVaultExample).
export const FLAP_ADDRESSES = {
  56: { portal: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0', vaultPortal: '0x90497450f2a706f1951b5bdda52B4E5d16f34C06' },
  97: { portal: '0x5bEacaF7ABCbB3aB280e80D007FD31fcE26510e9', vaultPortal: '0x027e3704fC5C16522e9393d04C60A3ac5c0d775f' },
} as const satisfies Record<56 | 97, { portal: `0x${string}`; vaultPortal: `0x${string}` }>;

/** Portal.getTokenV8Safe status */
export const FLAP_STATUS = { Invalid: 0, Tradable: 1, InDuel: 2, Killed: 3, DEX: 4, Staged: 5 } as const;

export const portalAbi = parseAbi([
  'struct TokenStateV8Safe { uint8 status; uint256 reserve; uint256 circulatingSupply; uint256 price; uint8 tokenVersion; uint256 r; uint256 h; uint256 k; uint256 dexSupplyThresh; address quoteTokenAddress; bool nativeToQuoteSwapEnabled; bytes32 extensionID; uint256 buyTaxRate; uint256 sellTaxRate; address pool; uint256 progress; uint8 lpFeeProfile; uint8 dexId; }',
  'function getTokenV8Safe(address token) view returns (TokenStateV8Safe state)',
  'event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)',
  'event TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)',
  'event TokenSold(uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)',
  'event FlapTokenProgressChanged(address token, uint256 newProgress)',
  'event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)',
  'event TaxTokenAddressesUpdated(address indexed token, address beneficiary, address feeReceiver)',
]);

export const vaultPortalAbi = parseAbi([
  'event FlapTaxVaultTokenCreated(address indexed token, address indexed vault, address indexed vaultFactory)',
  'event TokenVaultRefreshed(address indexed token, address indexed oldVault, address indexed newVault)',
]);

/**
 * Portal launch + trade entry points (struct field order verified against FlapVaultExample IPortal.sol and fork-tested in
 * contracts/test/fork/FlapMainnetFork.t.sol). quoteExactInput is non-view on-chain; declared `view` here so it can be
 * eth_call'ed with readContract.
 */
export const portalOpsAbi = parseAbi([
  'struct NewTokenV6Params { string name; string symbol; string meta; uint8 dexThresh; bytes32 salt; uint8 migratorType; address quoteToken; uint256 quoteAmt; address beneficiary; bytes permitData; bytes32 extensionID; bytes extensionData; uint8 dexId; uint8 lpFeeProfile; uint16 buyTaxRate; uint16 sellTaxRate; uint64 taxDuration; uint64 antiFarmerDuration; uint16 mktBps; uint16 deflationBps; uint16 dividendBps; uint16 lpBps; uint256 minimumShareBalance; address dividendToken; address commissionReceiver; uint8 tokenVersion; }',
  'struct ExactInputParams { address inputToken; address outputToken; uint256 inputAmount; uint256 minOutputAmount; bytes permitData; }',
  'struct QuoteExactInputParams { address inputToken; address outputToken; uint256 inputAmount; }',
  'function newTokenV6(NewTokenV6Params params) payable returns (address token)',
  'function swapExactInput(ExactInputParams params) payable returns (uint256 outputAmount)',
  'function quoteExactInput(QuoteExactInputParams params) view returns (uint256 outputAmount)',
]);

/** Tax Token V3 implementation (CREATE2 clone base; vanity suffix 7777) per chain. */
export const FLAP_TAX_TOKEN_IMPL = {
  56: '0x024f18294970B5c76c0691b87f138A0317156422',
  97: '0xE6Ff967a887084c16D0fD71548CF709542cc1557',
} as const satisfies Record<56 | 97, `0x${string}`>;
