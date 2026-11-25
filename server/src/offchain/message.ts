// Mirrored verbatim in web/lib/registerMessage.ts — keep both identical.
export interface RegisterMessageInput {
  token: string;
  pack: string;
  strategy: string;
  split?: { dividendBps: number; burnBps: number; lpBps: number } | null;
  /** TAX MODEL v3: creator-chosen tax (bps, 100–1000, whole %), pot share of the creator share (2000–10000) and payout address. */
  buyTaxBps?: number | null;
  sellTaxBps?: number | null;
  potShareBps?: number | null;
  payout?: string | null;
  chainId: number;
}

/**
 * Canonical EIP-191 (personal_sign) message the launch tx sender signs to register a machine.
 * v3 (tax fields present) adds buyTaxBps / sellTaxBps / potShareBps / payout lines before chainId; without them the
 * message is the pre-v3 one (kept so older clients still verify).
 */
export function registerMessage(p: RegisterMessageInput): string {
  const s = p.strategy === 'SPLIT' && p.split ? p.split : { dividendBps: 0, burnBps: 0, lpBps: 0 };
  const v3 = p.buyTaxBps != null || p.sellTaxBps != null || p.potShareBps != null || p.payout != null;
  return [
    'GachaForge register',
    `token:${p.token.toLowerCase()}`,
    `pack:${p.pack}`,
    `strategy:${p.strategy}`,
    `split:${s.dividendBps}/${s.burnBps}/${s.lpBps}`,
    ...(v3 ? [`buyTaxBps:${p.buyTaxBps ?? 0}`, `sellTaxBps:${p.sellTaxBps ?? 0}`, `potShareBps:${p.potShareBps ?? 0}`, `payout:${(p.payout ?? '').toLowerCase()}`] : []),
    `chainId:${p.chainId}`,
  ].join('\n');
}
