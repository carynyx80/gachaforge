'use client';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';

/**
 * Shared wallet state for every "Connect wallet" entry point (they all open the same modal).
 * Hydration-safe: with `ssr: true` wagmi starts disconnected on server and first client render,
 * then reconnects from cookieStorage after mount.
 */
export function useWallet() {
  const { address, isConnected, chainId, status } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const connected = isConnected && !!address;
  return {
    address: connected ? address : undefined,
    connected,
    connecting: status === 'connecting' || status === 'reconnecting',
    wrongChain: connected && chainId !== bsc.id,
    openConnect: () => openConnectModal?.(),
    switchToBsc: () => switchChain({ chainId: bsc.id }),
    switching,
  };
}
