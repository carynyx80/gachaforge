import type { ActivityEvent, BurnEvent, Machine, PackId, Pull, Stats, Strategy, Trade } from './types';
import { PACK_PRICE } from './types';

// Deterministic PRNG so server and client render identical mock data.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const r = rng(42);
const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
const addr = () => `0x${hex(40)}`;

// Fixed reference time keeps SSR/CSR consistent.
export const MOCK_NOW = 1764072000; // 2025-11-25T12:00:00Z-ish

const NAMES: [string, string][] = [
  ['Neon Nibbler', 'NIBBL'], ['Capsule Cat', 'CAPCAT'], ['Lime Anvil', 'ANVIL'], ['Mochi Rocket', 'MOCHI'],
  ['Glitch Goblin', 'GLTCH'], ['Lucky Sprocket', 'SPROK'], ['Pixel Pharaoh', 'PHARO'], ['Turbo Tofu', 'TOFU'],
  ['Ramen Ronin', 'RONIN'], ['Chrome Koi', 'KOI'], ['Hyper Hamster', 'HAMMY'], ['Void Vending', 'VEND'],
  ['Bubble Baron', 'BARON'], ['Laser Llama', 'LLAMA'], ['Disco Dango', 'DANGO'], ['Static Shiba', 'STATIC'],
  ['Moonlit Mantis', 'MANTIS'], ['Forge Frog', 'FROGE'], ['Candy Kaiju', 'KAIJU'], ['Arcade Axolotl', 'AXOL'],
  ['Prism Pug', 'PRISM'], ['Sugar Sentinel', 'SUGAR'], ['Retro Raccoon', 'RACC'], ['Velvet Volt', 'VOLT'],
];
const STRATS: Strategy[] = ['RAFFLE', 'HIT_HUNTER', 'DIVIDEND', 'BURN', 'SPLIT'];
const PACKS: PackId[] = ['FORGE_28', 'FORGE_48', 'FORGE_88'];
const HUES = [84, 72, 96, 110, 64, 120, 78, 104, 90, 68];

export const mockMachines: Machine[] = NAMES.map(([name, ticker], i) => {
  const pack = pick(PACKS);
  const strategy = STRATS[i % STRATS.length];
  const bondingCurvePct = i % 4 === 0 ? 100 : Math.round(r() * 95 + 3);
  const stage = bondingCurvePct >= 100 ? 'GRADUATED' : 'CURVE';
  const holders = Math.round(80 + r() * 4200);
  return {
    address: addr(),
    vault: addr(),
    name,
    ticker,
    description: `${name} — a GachaForge machine. Trade tax fuels real graded card pulls.`,
    image: `hue:${HUES[i % HUES.length]}`,
    creator: addr(),
    createdAt: MOCK_NOW - Math.round(r() * 86400 * 20),
    pack,
    packPriceUsd: PACK_PRICE[pack],
    strategy,
    taxBps: (1 + Math.floor(r() * 10)) * 100,
    split: strategy === 'SPLIT' ? { dividendBps: 5000, burnBps: 3000, lpBps: 2000 } : undefined,
    stage,
    bondingCurvePct,
    marketCapUsd: Math.round(4000 + r() * (stage === 'GRADUATED' ? 2_400_000 : 90_000)),
    change24hPct: Math.round((r() * 80 - 25) * 10) / 10,
    volume24hUsd: Math.round(500 + r() * 180_000),
    holders,
    eligibleHolders: Math.round(holders * (0.2 + r() * 0.5)),
    potUsd: Math.round(r() * PACK_PRICE[pack] * 100) / 100,
    packsOpened: Math.round(r() * 320),
    round: Math.round(r() * 300) + 1,
    paidToHoldersBnb: Math.round(r() * 4000) / 100,
    burnedTokens: Math.round(r() * 30_000_000),
    links: { x: 'https://x.com/', website: undefined, telegram: undefined },
  } satisfies Machine;
});

const CARD_NAMES = [
  'Ember Drake Holo', 'Tidecaller Mage', 'Thunder Fox Alt Art', 'Crystal Golem', 'Moonblade Samurai',
  'Starlight Sprite', 'Ironclad Pirate Captain', 'Verdant Wyrm', 'Shadow Ninja Rare', 'Celestial Phoenix',
  'Sakura Swordmaiden', 'Volcanic Titan', 'Frostfang Wolf', 'Neon Oni Secret Rare', 'Golden Kitsune',
];
const SETS = ['Arcane Origins', 'Storm Saga', 'Neon Dynasty', 'Pirate Seas', 'Starforge Promo'];
const GRADERS = ['PSA', 'CGC', 'BGS'] as const;
const GRADES = ['10', '9.5', '9', '8.5', '10 Pristine'];

export const mockPulls: Pull[] = Array.from({ length: 24 }, (_, i) => {
  const m = mockMachines[Math.floor(r() * mockMachines.length)];
  const valueUsd = Math.round(m.packPriceUsd * (0.3 + r() * r() * 9) * 100) / 100;
  const result: Pull['result'] = m.strategy === 'RAFFLE' || (m.strategy === 'HIT_HUNTER' && valueUsd > m.packPriceUsd) ? 'WON' : m.strategy === 'BURN' ? 'BURNED' : 'SOLD';
  return {
    id: `pull_${i + 1}`,
    machine: m.address,
    ticker: m.ticker,
    pack: m.pack,
    round: m.round - i,
    card: {
      name: pick(CARD_NAMES), set: pick(SETS), grader: pick(GRADERS), grade: pick(GRADES),
      image: `hue:${Math.floor(r() * 360)}`, valueUsd,
    },
    result,
    winner: result === 'WON' ? addr() : undefined,
    proceedsBnb: result !== 'WON' ? Math.round(valueUsd * 0.9 / 620 * 10000) / 10000 : undefined,
    txHash: `0x${hex(64)}`,
    timestamp: MOCK_NOW - i * 137 - Math.round(r() * 90),
  };
});

const KINDS: ActivityEvent['kind'][] = ['TAX', 'TAX', 'TAX', 'PULL_WON', 'PULL_SOLD', 'PAYOUT', 'BURN', 'NEW_MACHINE'];
export const mockActivity: ActivityEvent[] = Array.from({ length: 40 }, (_, i) => {
  const m = pick(mockMachines);
  const kind = pick(KINDS);
  const amt = Math.round(r() * (kind === 'TAX' ? 12 : 300) * 100) / 100;
  const text = {
    TAX: `tax $${amt.toFixed(2)} → gacha pot`,
    PULL_WON: `pulled a PSA 10 worth $${amt.toFixed(0)} — WON`,
    PULL_SOLD: `card sold back for $${amt.toFixed(2)}`,
    PAYOUT: `$${amt.toFixed(2)} paid to holders`,
    BURN: `$${amt.toFixed(2)} bought & burned`,
    NEW_MACHINE: `new machine launched`,
  }[kind];
  return { id: `act_${i}`, ticker: m.ticker, machine: m.address, timestamp: MOCK_NOW - i * 23, kind, text, amountUsd: amt };
});

export const mockStats: Stats = {
  potsUsd: Math.round(mockMachines.reduce((a, m) => a + m.potUsd, 0) * 100) / 100 + 18342.5,
  packsOpened: mockMachines.reduce((a, m) => a + m.packsOpened, 0),
  cardsAwarded: 2381,
  burnedUsd: 96412,
  launches: mockMachines.length + 1180,
};

export const mockBurns: BurnEvent[] = Array.from({ length: 20 }, (_, i) => ({
  id: `burn_${i}`, kind: i % 2 ? 'BURN' : 'BUYBACK', amount: Math.round(r() * 2_000_000), txHash: `0x${hex(64)}`, timestamp: MOCK_NOW - i * 3600,
}));

export const mockTrades = (machine: string): Trade[] =>
  Array.from({ length: 20 }, (_, i) => ({
    side: r() > 0.45 ? 'BUY' : 'SELL', trader: addr(), amountBnb: Math.round(r() * 300) / 100,
    tokens: Math.round(r() * 5_000_000), taxUsd: Math.round(r() * 800) / 100, txHash: `0x${hex(64)}`,
    timestamp: MOCK_NOW - i * 60 - (machine.length % 7),
  }));
