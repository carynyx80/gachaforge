import { TransparencyView } from '@/components/transparency/TransparencyView';

export const metadata = {
  title: 'Transparency — GachaForge',
  description: 'Treasury and ops-wallet balances vs everything owed to gacha pots, the $FORGE buyback and pending dividends, plus every ops-wallet transaction.',
};

export default function TransparencyPage() {
  return <TransparencyView />;
}
