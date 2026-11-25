'use client';
import '@rainbow-me/rainbowkit/styles.css';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { darkTheme, RainbowKitProvider, type Theme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from '@/lib/wagmi';

const base = darkTheme({ accentColor: '#B6FF2E', accentColorForeground: '#050505', borderRadius: 'medium', overlayBlur: 'small' });
const theme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    modalBackground: '#0E0F0C',
    modalBorder: '#1F2419',
    modalText: '#F4F7EE',
    modalTextSecondary: '#8E9686',
    profileForeground: '#0E0F0C',
    actionButtonSecondaryBackground: '#1F2419',
    generalBorder: '#1F2419',
    connectButtonBackground: '#0E0F0C',
    selectedOptionBorder: '#B6FF2E',
  },
  fonts: { body: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif' },
};

export function Web3Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} initialChain={bsc} modalSize="compact" appInfo={{ appName: 'GachaForge' }}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
