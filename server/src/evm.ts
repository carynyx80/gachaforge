import type { Abi, Hex, Log, TransactionReceipt } from 'viem';
import type { ChainCtx } from './chain.js';

/**
 * Minimal operator-wallet surface used by the Renaiss provider, the swapper and the release job.
 * Kept tiny so tests can fake it without a node; `evmWalletFromChain` adapts the real viem clients.
 */
export interface EvmWallet {
  readonly address: Hex;
  read<T = unknown>(p: { address: Hex; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<T>;
  /** Sends the tx, waits for the receipt, throws if it reverted. */
  write(p: { address: Hex; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }): Promise<Pick<TransactionReceipt, 'transactionHash' | 'status' | 'blockNumber'> & { logs: Log[] }>;
  signTypedData(p: { domain: Record<string, unknown>; types: Record<string, readonly { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }): Promise<Hex>;
}

export function evmWalletFromChain(chain: ChainCtx): EvmWallet {
  const wc = chain.walletClient;
  const account = chain.account;
  if (!wc || !account) throw new Error('operator wallet not configured');
  return {
    address: account.address,
    read: (p) => chain.publicClient.readContract(p as any) as Promise<any>,
    async write(p) {
      const hash = await wc.writeContract({ ...(p as any), chain: chain.chain, account });
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`${p.functionName} reverted: ${hash}`);
      return receipt;
    },
    signTypedData: (p) => wc.signTypedData({ ...(p as any), account }),
  };
}

export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
