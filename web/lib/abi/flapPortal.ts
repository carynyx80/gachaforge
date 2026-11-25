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
] as const;
