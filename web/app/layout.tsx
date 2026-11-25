import type { Metadata } from 'next';
import { Sora, Space_Mono, Unbounded } from 'next/font/google';
import './globals.css';
import { LangProvider } from '@/components/LangProvider';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PreviewBanner } from '@/components/PreviewBanner';
import { Web3Providers } from '@/components/wallet/Providers';

const sora = Sora({ variable: '--font-sora', subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap' });
const unbounded = Unbounded({ variable: '--font-unbounded', subsets: ['latin'], weight: ['700', '800', '900'], display: 'swap' });
const mono = Space_Mono({ variable: '--font-spacemono', subsets: ['latin'], weight: ['400', '700'], display: 'swap' });

export const metadata: Metadata = {
  title: 'GachaForge — Trade memes. Forge real cards.',
  description: 'Meme-token launchpad on BNB Chain where trading tax pulls real graded trading cards for holders.',
  metadataBase: new URL('https://gachaforge.xyz'),
  openGraph: { siteName: 'GachaForge', url: 'https://gachaforge.xyz', type: 'website' },
  twitter: { card: 'summary_large_image', site: '@Gachaforge', creator: '@Gachaforge' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${unbounded.variable} ${mono.variable}`}>
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
