import { erc20Abi, parseAbi } from 'viem';

export const tokenAbi = [
  ...erc20Abi,
  // flap.sh IFlapTaxTokenV3 (docs/flap-integration.md §4)
  ...parseAbi([
    'function taxRate() view returns (uint16)',
    'function buyTaxRate() view returns (uint16)',
    'function sellTaxRate() view returns (uint16)',
    'function taxProcessor() view returns (address)',
    'function mainPool() view returns (address)',
    'function state() view returns (uint8)',
    'event PoolStateChanged(uint8 fromState, uint8 toState)',
  ]),
] as const;

// flap.sh IFlapTaxProcessor — dispatch() pushes pending tax (incl. vault's market share).
export const taxProcessorAbi = parseAbi([
  'function dispatch()',
  'function marketAddress() view returns (address)',
  'function marketQuoteBalance() view returns (uint256)',
  'function totalQuoteSentToMarketing() view returns (uint256)',
  'function feeReceiver() view returns (address)',
  'function commissionReceiver() view returns (address)',
]);
