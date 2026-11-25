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
- Trading tax: **fixed 2% buy / 2% sell** for every token (`taxBps = 200`). Not creator-configurable. Locked forever.
- Tax split of what reaches the token's vault (flap.sh keeps ~10% of the tax first at a 2% tax (≈0.2% of volume, set by flap.sh); the vault receives ~90%): **90% platform treasury (`0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c`) / 7% gacha pot / 3% $FORGE buyback & burn**. Creator gets 0%.
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

## Live fee flow (added)
Every trade produces a fee event, pushed on WebSocket `/ws` as `{ type: 'fee', data: FeeEvent }` and listed by `GET /api/fees/recent?machine=&limit=`:
```ts
interface FeeEvent {
  id: string; machine: string; ticker: string; side: 'BUY'|'SELL';
  trader: string; amountBnb: number; txHash: string; timestamp: number;
  taxUsd: number;        // 2% of the trade
  flapUsd: number;       // flap.sh's cut (~10% of tax)
  platformUsd: number;   // 90% of the rest -> company wallet
  potUsd: number;        // 7% of the rest -> this machine's gacha pot
  buybackUsd: number;    // 3% of the rest -> $FORGE buyback
  potAfterUsd: number;   // machine pot incl. this trade (estimate until vault sync)
  packPriceUsd: number;  // next pack price for this machine
  pending: boolean;      // true until the tax has been dispatched + synced into the vault on-chain
}
```
`GET /api/fees/summary` → `{ totalTaxUsd, flapUsd, platformUsd, potUsd, buybackUsd, last24h: { same fields } }`.
In live mode these are computed from indexed flap trades (amount × 2%, split by the constants) and reconciled with the vault's TaxReceived events (pending → false). In mock mode the simulator emits them.

## $FORGE token page (added)
$FORGE is created by the owner DIRECTLY on flap.sh (not via our factory). The backend auto-discovers it: it watches the flap.sh Portal on BSC mainnet (always real chain, independent of MOCK_MODE) for the first token whose creator == `FORGE_DEPLOYER` (env, public address). Optional override `FORGE_TOKEN_ADDRESS`. Once found it is persisted and never re-discovered.
- `GET /api/forge` → `{ status: 'waiting'|'live', deployer, token?: ForgeToken }`
- `GET /api/forge/trades?limit=` → recent flap trades of $FORGE `{ side, trader, amountBnb, tokens, priceUsd, txHash, timestamp }[]`
- `GET /api/forge/candles?interval=1m|5m|15m|1h|4h|1d` → `{ t, o, h, l, c, v }[]` (USD) built from indexed trades
- WS `/ws`: `{ type: 'forge', data: ForgeToken }` on discovery and on every trade; `{ type: 'forgeTrade', data: trade }`.
```ts
interface ForgeToken {
  address: string; name: string; symbol: string; image?: string; description?: string;
  links?: { website?: string; x?: string; telegram?: string };
  creator: string; createdAt: number; createdTx: string;
  stage: 'CURVE'|'GRADUATED'; bondingCurvePct: number; pool?: string; // PancakeSwap pair after graduation
  priceUsd: number; priceBnb: number; marketCapUsd: number; change24hPct: number; volume24hUsd: number;
  holders: number; buyTaxBps: number; sellTaxBps: number; taxRecipient?: string;
  burnedTokens: number;            // $FORGE sent to dead address (by our BuybackBurner or anyone)
  buybackPendingBnb: number;       // BNB waiting in BuybackBurner (3% share of machine taxes)
  buybackTotalBnb: number;         // BNB spent buying back $FORGE so far
}
```
Frontend page: `/forge` (nav label "$FORGE"); trading via flap Portal `swapExactInput`/`quoteExactInput` (works pre- and post-graduation), enabled as soon as the token is live (does NOT depend on our factory being deployed).

## OFF-CHAIN MODE (owner decision 2026-11-25) — supersedes the vault/factory contracts for launch
No GachaForge smart contracts are deployed. Everything custodial, run by the backend with a hot wallet.
- **Wallets:** `TREASURY_ADDRESS` = company wallet 0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c (tax recipient of every machine token). `OPS_PRIVATE_KEY` (set by the owner on Railway, never in code) = the hot wallet that pays for everything; it MAY be the company wallet itself or a separate ops wallet. If `OPS_ADDRESS` != TREASURY_ADDRESS, the tax still lands in TREASURY; the backend needs the ops wallet funded — add an optional auto top-up rule note in docs; and if the ops wallet IS the treasury, an optional `SWEEP_TO_ADDRESS` can move the 90% platform share to a cold wallet on a schedule.
- **Launch:** the creator's own wallet calls flap.sh `Portal.newTokenV6` directly from our Launch page with: buyTax = sellTax = 200 bps, beneficiary/tax recipient = TREASURY_ADDRESS (mktBps=10000), commission receiver 0, native BNB quote, Tax Token V3 impl, vanity salt ending 7777. Then the frontend POSTs `/api/machines/register { txHash, pack, strategy, split? }`; the backend verifies on-chain that the token was created in that tx by the Portal with tax 200/200 and tax recipient == TREASURY_ADDRESS, then registers the machine with its pack/strategy (stored off-chain, immutable once registered; reject mismatches). Backend ALSO auto-detects Portal TokenCreated whose tax recipient == TREASURY and registers with defaults (pack FORGE_28, strategy RAFFLE) if not registered within 10 min.
- **Ledger:** for every indexed trade of a registered token, tax = 2% of trade BNB; flap cut ≈10% (measured from actual receipts where possible: TREASURY balance deltas from the TaxProcessor dispatch); remainder split 90% platform / 7% that machine's pot / 3% $FORGE buyback — all as BNB accounting entries in Postgres (append-only `ledger_entries`). Pot balances are virtual (funds physically sit in the treasury/ops wallet).
- **Dispatch:** keeper calls each token's TaxProcessor `dispatch()` when pending so tax actually reaches the treasury.
- **Pulls:** when a machine's virtual pot ≥ pack price (Chainlink BNB/USD), the ops wallet swaps BNB→USDT on PancakeSwap and buys via Renaiss; pot debited by the BNB actually spent. One pull at a time per machine + cooldown. If RENAISS_API_KEY is missing, mark machine `pullQueued` and wait (UI shows "Pull queued — card buying starts soon").
- **Strategies:** RAFFLE (snapshot holders ≥0.01% at the pull block from indexed balances / archive RPC, deterministic seed = keccak(blockhash, pullId), published proof, card NFT transferred from ops wallet to winner after Renaiss release); HIT_HUNTER (hit → raffle, miss or no eligible → sell back → buy & burn token); DIVIDEND (sell back → BNB pushed directly to each eligible holder pro-rata from the ops wallet, dust < `DIVIDEND_MIN_BNB` accumulates for the next round, every payout tx recorded); BURN (sell back → buy token via flap Portal from ops wallet → send to dead); SPLIT (creator ratio of dividend/burn; LP share is burned). $FORGE buyback: when buyback ledger ≥ `BUYBACK_MIN_BNB` and $FORGE is discovered, ops wallet buys $FORGE via flap Portal and sends to dead.
- **Safety rails:** daily spend cap `OPS_DAILY_CAP_BNB`; per-pull cap pack price +10%; kill switch `OPS_PAUSED=true`; every outgoing tx recorded and shown publicly on a `/transparency` page (ledger totals per machine, all ops wallet txs with BscScan links, treasury balance vs total owed to pots+buyback).
- **APIs added:** `POST /api/machines/register`, `GET /api/transparency` (`{ treasury, ops, balances, owed: { pots, buyback, dividendsPending }, txs: [...] }`), machine fields `pullQueued: boolean`.
- Contracts in contracts/ are kept in the repo for a possible future trustless version but are NOT used.
