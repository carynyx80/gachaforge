import type { Strategy } from './types';

export const STRATEGY_INFO: Record<Strategy, { icon: string; title: string; short: string; long: string }> = {
  RAFFLE: {
    icon: '🎟',
    title: 'Raffle',
    short: 'Every card goes to one holder.',
    long: 'Each pulled card is raffled to one eligible holder, with odds weighted by balance. If nobody is eligible, the card is sold back and the BNB returns to the pot.',
  },
  HIT_HUNTER: {
    icon: '🎯',
    title: 'Hit Hunter',
    short: 'Only real hits get raffled.',
    long: 'If the card is worth more than the pack price it is raffled to a holder. Otherwise it is sold back and the BNB buys and burns the token.',
  },
  DIVIDEND: {
    icon: '💸',
    title: 'Dividend',
    short: 'Cards become BNB for holders.',
    long: 'Every card is sold back and the BNB is shared pro-rata between eligible holders. Claim any time; large balances are pushed automatically.',
  },
  BURN: {
    icon: '🔥',
    title: 'Burn',
    short: 'Cards become buy pressure.',
    long: 'Every card is sold back and the BNB buys the token on the market and sends it to the dead address.',
  },
  SPLIT: {
    icon: '⚖',
    title: 'Split',
    short: 'Mix dividend, burn and LP.',
    long: 'Every card is sold back and the BNB is split by the creator’s fixed ratio between holder dividends, buy & burn, and permanently locked LP (LP share is burned before graduation).',
  },
};
