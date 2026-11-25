import { connectorsForWallets, type WalletList } from '@rainbow-me/rainbowkit';
import {
  binanceWallet, coinbaseWallet, injectedWallet, metaMaskWallet, okxWallet, trustWallet, walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { cookieStorage, createConfig, createStorage, http } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { BSC_RPC, WC_PROJECT_ID } from './chain';

const APP_NAME = 'GachaForge';

// Without a WalletConnect project id we only offer connectors that never touch WalletConnect:
// the generic injected wallet + Coinbase Wallet. Installed extensions (MetaMask, Trust, OKX,
// Binance Web3 Wallet, Rabby, …) still appear under "Installed" via EIP-6963 discovery.
const wallets: WalletList = WC_PROJECT_ID
  ? [
      { groupName: 'Popular', wallets: [metaMaskWallet, trustWallet, okxWallet, binanceWallet, coinbaseWallet] },
      { groupName: 'More', wallets: [walletConnectWallet, injectedWallet] },
    ]
  : [{ groupName: 'Wallets', wallets: [injectedWallet, coinbaseWallet] }];

const connectors = connectorsForWallets(wallets, {
  appName: APP_NAME,
  // RainbowKit requires a string; it is only used by WalletConnect-based wallets, which are
  // excluded above when no id is configured.
  projectId: WC_PROJECT_ID || 'unset',
});

export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors,
  transports: { [bsc.id]: http(BSC_RPC) },
  multiInjectedProviderDiscovery: true,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
