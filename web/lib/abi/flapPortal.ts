// flap.sh Portal trading surface (docs/flap-integration.md §3.3, from flap-sh/FlapVaultExample IPortal.sol).
// quoteExactInput is non-view on-chain; it is declared `view` here so wagmi/viem run it via eth_call.
export const flapPortalAbi = [
  {
    type: 'function',
    name: 'swapExactInput',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'inputToken', type: 'address' },
          { name: 'outputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'minOutputAmount', type: 'uint256' },
          { name: 'permitData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'outputAmount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteExactInput',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'inputToken', type: 'address' },
          { name: 'outputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'outputAmount', type: 'uint256' }],
  },
  // Launch (IFlapPortal.newTokenV6). Field order copied from contracts/src/adapters/flap/IFlapPortal.sol
  // (fork-tested via FlapLauncher Portal mode). Enum fields are uint8 in the ABI.
  {
    type: 'function',
    name: 'newTokenV6',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'meta', type: 'string' },
          { name: 'dexThresh', type: 'uint8' },
          { name: 'salt', type: 'bytes32' },
          { name: 'migratorType', type: 'uint8' },
          { name: 'quoteToken', type: 'address' },
          { name: 'quoteAmt', type: 'uint256' },
          { name: 'beneficiary', type: 'address' },
          { name: 'permitData', type: 'bytes' },
          { name: 'extensionID', type: 'bytes32' },
          { name: 'extensionData', type: 'bytes' },
          { name: 'dexId', type: 'uint8' },
          { name: 'lpFeeProfile', type: 'uint8' },
          { name: 'buyTaxRate', type: 'uint16' },
          { name: 'sellTaxRate', type: 'uint16' },
          { name: 'taxDuration', type: 'uint64' },
          { name: 'antiFarmerDuration', type: 'uint64' },
          { name: 'mktBps', type: 'uint16' },
          { name: 'deflationBps', type: 'uint16' },
          { name: 'dividendBps', type: 'uint16' },
          { name: 'lpBps', type: 'uint16' },
          { name: 'minimumShareBalance', type: 'uint256' },
          { name: 'dividendToken', type: 'address' },
          { name: 'commissionReceiver', type: 'address' },
          { name: 'tokenVersion', type: 'uint8' },
        ],
      },
    ],
    outputs: [{ name: 'token', type: 'address' }],
  },
  {
    type: 'event',
    name: 'TokenCreated',
    anonymous: false,
    inputs: [
      { name: 'ts', type: 'uint256', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'token', type: 'address', indexed: false },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'meta', type: 'string', indexed: false },
    ],
  },
] as const;
