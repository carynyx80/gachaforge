import DocsView, { type DocAddress } from '@/components/docs/DocsView';
import { TransparencyLink } from '@/components/transparency/TransparencyLink';
import { FLAP_PORTAL, FLAP_TAX_TOKEN_V3_IMPL } from '@/lib/chain';
import { TREASURY_ADDRESS } from '@/lib/docs-i18n';

export const metadata = {
  title: 'Docs — GachaForge',
  description: 'How GachaForge machines work: creator-set tax, the GachaForge / creator split, packs, strategies, rewards, creator payouts, $FORGE and trust (custodial, off-chain mode).',
};

/** Chainlink BNB/USD aggregator on BSC. */
const BNB_USD_FEED = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';
/** PancakeSwap V2 router on BSC. */
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

const env = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : undefined);

const ADDRESSES: DocAddress[] = [
  { key: 'treasury', address: TREASURY_ADDRESS },
  { key: 'company', address: env(process.env.NEXT_PUBLIC_SWEEP_TO_ADDRESS) },
  { key: 'portal', address: FLAP_PORTAL },
  { key: 'taxImpl', address: FLAP_TAX_TOKEN_V3_IMPL },
  { key: 'feed', address: BNB_USD_FEED },
  { key: 'router', address: PANCAKE_ROUTER },
  { key: 'forge', address: env(process.env.NEXT_PUBLIC_FORGE_ADDRESS) },
];

export default function DocsPage() {
  return (
    <>
      <TransparencyLink />
      <DocsView addresses={ADDRESSES} />
    </>
  );
}
