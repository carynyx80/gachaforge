// Mirrored verbatim in server/src/offchain/message.ts — keep both identical.
export interface RegisterMessageInput {
  token: string;
  pack: string;
  strategy: string;
  split?: { dividendBps: number; burnBps: number; lpBps: number } | null;
  chainId: number;
}

/** Canonical EIP-191 (personal_sign) message the launch tx sender signs to register a machine. */
export function registerMessage(p: RegisterMessageInput): string {
  const s = p.strategy === 'SPLIT' && p.split ? p.split : { dividendBps: 0, burnBps: 0, lpBps: 0 };
  return [
    'GachaForge register',
    `token:${p.token.toLowerCase()}`,
    `pack:${p.pack}`,
    `strategy:${p.strategy}`,
    `split:${s.dividendBps}/${s.burnBps}/${s.lpBps}`,
    `chainId:${p.chainId}`,
  ].join('\n');
}
