import DocsView, { type DocAddress } from '@/components/docs/DocsView';
import { FACTORY_ADDRESS, FLAP_PORTAL, FLAP_TAX_TOKEN_V3_IMPL } from '@/lib/chain';

export const metadata = {
  title: 'Docs — GachaForge',
  description: 'How GachaForge machines work: tax, packs, strategies, rewards, launching and trust.',
};

/** Company treasury that receives the platform share (SPEC.md). */
const TREASURY = '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c';
/** Chainlink BNB/USD aggregator on BSC (docs/DEPLOY-MAINNET.md §6). */
const BNB_USD_FEED = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';

const env = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : undefined);

const ADDRESSES: DocAddress[] = [
  { key: 'factory', address: FACTORY_ADDRESS },
  { key: 'buyback', address: env(process.env.NEXT_PUBLIC_BUYBACK_BURNER_ADDRESS) },
  { key: 'timelock', address: env(process.env.NEXT_PUBLIC_TIMELOCK_ADDRESS) },
  { key: 'launcher', address: env(process.env.NEXT_PUBLIC_FLAP_LAUNCHER_ADDRESS) },
  { key: 'forge', address: env(process.env.NEXT_PUBLIC_FORGE_ADDRESS) },
  { key: 'treasury', address: TREASURY },
  { key: 'portal', address: FLAP_PORTAL },
  { key: 'taxImpl', address: FLAP_TAX_TOKEN_V3_IMPL },
  { key: 'feed', address: BNB_USD_FEED },
];

export default function DocsPage() {
  return <DocsView addresses={ADDRESSES} />;
}
