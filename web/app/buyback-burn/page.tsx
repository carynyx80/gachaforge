import { permanentRedirect } from 'next/navigation';

/** Buyback & Burn now lives on the $FORGE page. */
export default function BuybackBurnRedirect() {
  permanentRedirect('/forge');
}
