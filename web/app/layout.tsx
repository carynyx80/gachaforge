import type { Metadata } from 'next';
import { Chakra_Petch, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { LangProvider } from '@/components/LangProvider';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PreviewBanner } from '@/components/PreviewBanner';
import { Web3Providers } from '@/components/wallet/Providers';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const chakra = Chakra_Petch({ variable: '--font-chakra', subsets: ['latin'], weight: ['500', '600', '700'] });
const mono = JetBrains_Mono({ variable: '--font-jbmono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'GachaForge — Trade memes. Forge real cards.',
  description: 'Meme-token launchpad on BNB Chain where trading tax pulls real graded trading cards for holders.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${chakra.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Web3Providers>
          <LangProvider>
          <Header />
          <PreviewBanner />
          <main className="flex-1">{children}</main>
          <Footer />
          </LangProvider>
        </Web3Providers>
      </body>
    </html>
  );
}
