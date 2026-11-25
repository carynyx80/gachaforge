# GachaForge — shared spec (all agents read this)

GachaForge is a meme-token launchpad on **BNB Chain** where trading tax buys real graded trading-card gacha packs (via **Renaiss**), and pulled cards become rewards for token holders. Tokens are launched on **flap.sh** (NOT Four.meme). Original code, art and copy only — do not copy boosterpack.cards code, logos, images or text.

## Brand
- Name: **GachaForge**. Platform token: **$FORGE** (placeholder).
- Theme: black background `#050505`, surface `#0E0F0C`, border `#1F2419`, text `#F4F7EE`, muted `#8E9686`.
- Accent: **lime green `#B6FF2E`**, accent-soft `#B6FF2E26`, secondary glow `#D4FF7A`. Text on lime surfaces is black. Success `#3DDC97`, danger `#FF4D4D`.
- Type: bold condensed display font for headings (e.g. "Chakra Petch" or "Rajdhani" from Google Fonts), "Inter" for body, monospace for numbers/addresses.
- Vibe: arcade gacha machine, neon lime glow, grid floor, chunky bordered buttons with offset shadow.
- Languages: English + Chinese (中文) toggle.

## Mechanics (locked at launch, immutable)
- Trading tax: creator chooses 1–10% (integer), same for buy & sell. Locked forever.
- Tax split of what reaches the token's vault: **70% gacha pot / 20% $FORGE buyback & burn / 10% platform treasury**. Creator gets 0%.
- Packs (USD price per pull): `FORGE_28` $28 (max win ~10x), `FORGE_48` $48 (~11x), `FORGE_88` $88 (~9.9x). Pull pays pack price in BNB at Chainlink BNB/USD + up to 10% slippage buffer; leftover returns to pot.
- One open pull per machine at a time; cooldown between pulls (default 60s, configurable by timelock).
- Pulls start as soon as pot >= pack price, even pre-graduation (bonding curve on flap.sh).
- Holder eligibility: balance >= 0.01% of total supply (1B supply → 100,000 tokens) at the round's snapshot block. Excluded: pools/pairs, token contract, vault, launchpad contracts, router, dead address. Creator counts like anyone.
- Strategies (enum, locked):
  - `RAFFLE` (0): card to one eligible holder, weighted by balance. No eligible holder → sell back, BNB to pot.
  - `HIT_HUNTER` (1): card value > pack price → raffle; else sell back, BNB buys & burns token.
  - `DIVIDEND` (2): sell back, BNB credited to eligible holders pro-rata; claimable; large balances auto-pushed.
  - `BURN` (3): sell back, BNB buys token and sends to dead address.
  - `SPLIT` (4): sell back, BNB split by creator ratio (bps) between dividend / burn / LP (LP locked forever; pre-graduation LP share is burned instead).
- Sell-back rate (Renaiss): within 1h 90%, 24h 85%, 72h 50%.
- Raffle record: publish snapshot hash + seed + winner so anyone can re-check.
- Safety: Timelock (2-of-3 multisig owner), operator role (revocable), emergency pause of launches/pulls.

## Data model (JSON, used by backend API and frontend mock data)
```ts
type Strategy = 'RAFFLE'|'HIT_HUNTER'|'DIVIDEND'|'BURN'|'SPLIT';
type PackId = 'FORGE_28'|'FORGE_48'|'FORGE_88';
type Stage = 'CURVE'|'GRADUATED';

interface Machine {
  address: string;            // token address (0x…)
  vault: string;
  name: string; ticker: string; description: string; image: string;
  creator: string; createdAt: number;   // unix seconds
  pack: PackId; packPriceUsd: number;
  strategy: Strategy; taxBps: number;   // 100 = 1%
  split?: { dividendBps: number; burnBps: number; lpBps: number };
  stage: Stage; bondingCurvePct: number; // 0-100
  marketCapUsd: number; change24hPct: number; volume24hUsd: number;
  holders: number; eligibleHolders: number;
  potUsd: number;              // current pot
  packsOpened: number; round: number;
  paidToHoldersBnb: number; burnedTokens: number;
  links?: { website?: string; x?: string; telegram?: string };
}

interface Pull {
  id: string; machine: string; ticker: string; pack: PackId; round: number;
  card: { name: string; set: string; grader: 'PSA'|'CGC'|'BGS'; grade: string; image: string; valueUsd: number };
  result: 'WON'|'SOLD'|'BURNED';
  winner?: string;             // address when WON
  proceedsBnb?: number;
  txHash: string; timestamp: number;
}

interface ActivityEvent {     // ticker feed
  id: string; ticker: string; machine: string; timestamp: number;
  kind: 'TAX'|'PULL_WON'|'PULL_SOLD'|'PAYOUT'|'BURN'|'NEW_MACHINE';
  text: string;               // pre-rendered short text e.g. "tax $3.58 → gacha pot"
  amountUsd?: number;
}

interface Stats { potsUsd: number; packsOpened: number; cardsAwarded: number; burnedUsd: number; launches: number }
interface BurnEvent { id: string; kind: 'BUYBACK'|'BURN'; amount: number; txHash: string; timestamp: number }
interface RewardsView { address: string; eligible: boolean; balance: number; minBalance: number; oddsPct: number; claimableBnb: number; totalEarnedBnb: number }
```

## Backend HTTP API (base `/api`, JSON)
- `GET /api/stats` → `Stats`
- `GET /api/machines?sort=trending|new|most_pulled|market_cap&strategy=&pack=&stage=&page=1&pageSize=12` → `{ items: Machine[], total: number }`
- `GET /api/machines/about-to-rip` → `Machine[]` (top 3 by pot/pack ratio)
- `GET /api/machines/:address` → `Machine`
- `GET /api/machines/:address/pulls?page=` → `{ items: Pull[], total }`
- `GET /api/machines/:address/trades?page=` → `{ items: {side:'BUY'|'SELL', trader, amountBnb, tokens, taxUsd, txHash, timestamp}[], total }`
- `GET /api/machines/:address/rewards/:wallet` → `RewardsView`
- `GET /api/pulls/recent?limit=20` → `Pull[]`
- `GET /api/activity?limit=40` → `ActivityEvent[]`
- `GET /api/burns?page=` → `{ totalBurned: number, pctOfSupply: number, items: BurnEvent[], total }`
- `GET /api/raffles/:pullId` → raffle proof `{ snapshotBlock, snapshotHash, seed, eligible: {address,balance}[], winner }`
- WebSocket `/ws` pushes `{ type: 'activity'|'pull'|'stats'|'machine', data }`.
- Server runs on port **4000**. Frontend dev on **3000**. Frontend reads `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).

## Repo layout
```
contracts/   Foundry (Solidity ^0.8.24)
server/      Node 22 + TypeScript (Fastify), Postgres via Drizzle or Prisma, vitest
web/         Next.js (App Router) + TypeScript + Tailwind + wagmi/viem + RainbowKit
docs/        integration notes (flap.sh, Renaiss)
```
Use **npm** (pnpm is not installed). Secrets only via `.env` (commit `.env.example` only; never write real keys).
