# Renaiss API: research notes (2026-11-25)

Legend: **CONFIRMED** (source URL given), **INFERRED** (reasoned from sources, not stated), **UNKNOWN**.

## TL;DR
- Public API docs **exist** (Mintlify): https://docs.renaiss.xyz (index: https://docs.renaiss.xyz/llms.txt). CONFIRMED.
- The catalog is public. Every write (pull, buyback) needs a **partner "builder API key"** (`x-builder-api-key`) **plus an EIP-712 signature from the buyer wallet**. Payment is **USDT (BEP-20, 18 decimals) pulled through Permit2** by the TokenVendingMachineV3 contract. It is not a BNB transfer and not a tx hash we send. CONFIRMED.
- Our guessed client (`server/src/renaiss/endpoints.ts`) is wrong on base path (`/v1` should be `/v2/gacha/...`), auth header, ID scheme, purchase flow (two steps, signed), sell-back model (signed batch by settlement IDs) and transfer (no such endpoint). Details are at the bottom.

## Official links
| What | URL | Status |
|---|---|---|
| Website | https://www.renaiss.xyz (gacha: https://renaiss.xyz/gacha) | CONFIRMED |
| Docs (EN / CN) | https://docs.renaiss.xyz, https://docs.renaiss.xyz/cn | CONFIRMED |
| API landing (v1 stable, v2 preview) | https://api.renaiss.xyz/ | CONFIRMED |
| OpenAPI (prod, v2) | https://api.renaiss.xyz/v2/openapi.json (also https://docs.renaiss.xyz/api-reference/openapi.json) | CONFIRMED |
| OpenAPI (testnet) | https://dev-api.renaiss.xyz/v2/openapi.json | CONFIRMED (per docs) |
| TypeScript SDK | npm `@renaiss-protocol/client` (0.1.0-beta.5), https://github.com/Renaiss-Protocol/renaiss-sdk | CONFIRMED (`npm view`) |
| X | https://x.com/renaissxyz | CONFIRMED (docs footer) |
| Binance Square | https://www.binance.com/en/square/profile/renaissprotocol | CONFIRMED (search) |
| Contact / builder access | **info@renaiss.xyz** (we have not contacted them) | CONFIRMED, https://docs.renaiss.xyz/builder-program.md |

### Access (partner key)
CONFIRMED (https://docs.renaiss.xyz/builder-program.md, https://docs.renaiss.xyz/builder-tiers.md):
- To request a builder key, email info@renaiss.xyz with: the app name, the flows (Gacha / Marketplace / Redeem), the environments and networks, the expected volume, and the exact frontend signing origins (including localhost ports).
- After onboarding, a builder portal offers "API keys → Create API key". The key is shown once. It has an expiry and a rate limit.
- Tiers are Unverified, Verified and Partner. Rate limits are "Standard" or "Highest", and exact quotas are given at provisioning. All tiers get gasless (sponsored) execution. A wallet's own USDT `approve` still costs BNB gas.
- The key must stay server-side. The builder code (on-chain attribution) is derived from the key.

## Base URLs and auth
| Item | Value | Status |
|---|---|---|
| Prod (BSC mainnet, chain 56) | `https://api.renaiss.xyz` | CONFIRMED, https://docs.renaiss.xyz/api-reference.md |
| Testnet (BSC testnet, chain 97) | `https://dev-api.renaiss.xyz` | CONFIRMED (same) |
| Version prefix | `/v2/...` (v2 is "Preview: direct EOA gacha for builders"; v1 is "Stable", but its routes are not documented publicly) | CONFIRMED, https://api.renaiss.xyz/ |
| Builder auth | header `x-builder-api-key: <key>` (apiKey scheme `builderAuth`) | CONFIRMED (openapi securitySchemes) |
| Wallet session (Redeem/shipping only) | `Authorization: Bearer <accessToken>` from `POST /v2/auth/wallet/nonce` → `personal_sign` → `/verify`. The access token lasts 15 min and the session 7 days. | CONFIRMED, https://docs.renaiss.xyz/authentication.md |
| Action signatures | Pull = Permit2 `PermitWitnessTransferFrom` typed data (witness: packId, builder, numOfTokens). Buyback = `BuybackUserAuthorization` signed by the wallet. EOA or ERC-1271 contract wallets (the contract must accept ERC-721 safe transfers). | CONFIRMED (authentication.md, gacha.md) |
| Amounts | Decimal strings. USDT has 18 decimals (`priceInUsdt: "28000000000000000000"` = $28). `*InUsd` values are **USD cents** strings. | CONFIRMED (live catalog + gacha.md) |
| Rate limits | Per key. HTTP 429 with `Retry-After` (exposed header seen). No numbers are published. | CONFIRMED that 429 and Retry-After exist; numbers UNKNOWN |
| Webhooks | None. `"webhooks": {}` in the OpenAPI spec. The docs say to poll about once per second or use SSE. | CONFIRMED (openapi.json) |

## Gacha endpoints (v2)
Source for all: https://api.renaiss.xyz/v2/openapi.json and https://docs.renaiss.xyz/gacha.md. CONFIRMED.

| Purpose | Method + path | Auth |
|---|---|---|
| List packs | `GET /v2/gacha/packs?stage=active&limit&offset` → `{cardPacks[], pagination}` | none (key optional, shows builder-exclusive packs) |
| Pack detail | `GET /v2/gacha/packs/{slug}` → `cardPack` incl. `tiers[]` (odds, price range in cents), `buybackConfig[]`, `activeSetExpectedValueInUsd` | none |
| Pack contents | `GET /v2/gacha/packs/{slug}/content` (images, tiers, `buybackBaseValueInUsd`) | none |
| Public pull history | `GET /v2/gacha/packs/{slug}/pull-history` | none |
| **Prepare pull** | `POST /v2/gacha/pull/prepare` body `{buyerWalletAddress, packId (catalog UUID), quantity}` → `{chainId, pack{id,onChainPackId,priceInUsdt,vendingMachineAddress}, permit2TypedData, unsignedPullPayload{packId,builderCode,numOfTokens,amountPerToken,nonce,deadline}, approval{token,spender,requiredAmount}}` | key |
| **Submit pull (poll)** | `POST /v2/gacha/pull/request` body `{packId, numOfTokens, amountPerToken, nonce, deadline, buyerWalletAddress, permitSignature}` → **202** `{requestId, status, ...}`. Resending the same signed body is idempotent and recovers `requestId`. | key + Permit2 sig |
| Submit pull (SSE) | `POST /v2/gacha/pull/stream` (same body). Events: `pull_started` (requestId), `payment_confirmed` (permitFundTxHash), `draws_resolved` (cards). | key + sig |
| Pull status | `GET /v2/gacha/pull/status?requestId=` → status `PENDING_PAYMENT, PENDING_RESOLUTION, RESOLVED, FAILED`; `result.draws[]` | key |
| Draw by funding tx | `GET /v2/gacha/draw-status?buyerWalletAddress&permitFundTxHash` | key |
| Wallet pull history | `GET /v2/gacha/pull-history` (by wallet, this builder) | key |
| **Buyback offers (quote)** | `GET /v2/gacha/buyback/offers?buyerWalletAddress&limit&offset` → `offers[{cardPackId, settlementId, tokenId, vendingMachineAddress, buybackTiers[{buybackPercentage, amountInUsdt, expiresAt}]}]` | key |
| **Settle buyback (sync)** | `POST /v2/gacha/buyback` body `{buyerWalletAddress, cardPackId, buybackAuth{buybackIds[1..10], token, amount}, userSignature}` → `{txHash, totalAmountInUsdt, itemCount}` | key + wallet sig |
| Settle buyback (async) | `POST /v2/gacha/buyback/request` (same body) → `requestId`. Then `GET /v2/gacha/buyback/status?requestId=` gives `PENDING, COMPLETED, FAILED`. | key + sig |

**Draw (card) object** (CONFIRMED, spec): `settlementId, tokenId, releaseTxHash, buybackTxHash, buybackTiers[], tier (TOP/S/A/B/C/D or epic/rare/...), buybackBaseValueInUSD (cents), buybackBonus{originalBuybackBaseValueInUSD, bonusBps}, type (POKEMON/ONE_PIECE/SPORTS), name, frontImageUrl ("graded slab in its Renaiss frame"), attributes[{key,value}]`. Grade, grader and set have no dedicated fields. INFERRED: they are in `attributes` key/value pairs.

**Payment flow** (CONFIRMED, gacha.md and contracts.md): the buyer wallet holds USDT, approves Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) once (this costs BNB gas), then signs the typed data. Renaiss and the vending machine pull the USDT. There is no credit balance and no BNB payment. (boosterpack.cards swaps BNB→USDT itself first: "sends the pack price in BNB … plus at most 10% to cover swap fees", from its bundle. INFERRED that it swaps into USDT for a Permit2 pull.)

**Sell-back** (CONFIRMED): live `GET /v2/gacha/packs/pandora-28` returns `buybackConfig = [{90%, 3600s}, {85%, 86400s}, {50%, 259200s}]`. The offer amounts already include any bonus. Show the first unexpired tier. A batch covers 1–10 settlement IDs from the same pack.
- The exact EIP-712 domain and types for `BuybackUserAuthorization` are not in the OpenAPI spec. They are UNKNOWN. INFERRED: they are in the SDK; the verifyingContract is probably TokenVendingMachineV3.

**Transfer to wallet** (CONFIRMED, gacha.md): **there is no transfer endpoint.** After the buyback window (max `buybackExpiredInSeconds`, 72 h for PANDORA) Renaiss itself releases the ERC-721 to the **buyer wallet** (`releaseTxHash`). To forward it elsewhere, the buyer wallet does a plain ERC-721 `safeTransferFrom` on RenaissRegistry (INFERRED). boosterpack.cards confirms this pattern: "Renaiss holds every pulled card for 72 hours … Once Renaiss returns it, the Keeper sends it to the winner".

## Live pack catalog (prod, public GET, 2026-11-25), CONFIRMED
| Name | slug | catalog `id` (use for prepare) | `onChainPackId` | price |
|---|---|---|---|---|
| PANDORA 28 | `pandora-28` | `4c3263d7-8aab-4498-af7b-2c8a7c484a55` | `0xcf11308cc7c642554a781b039a63a542c2f20b36f904b5b6981d48a2f76a5f90` | 28 USDT |
| PANDORA 48 | `pandora-48` | `7f8f864b-2278-486d-bfb4-445fe73ce7f9` | `0x4de1e3c158c8630faa2db4e6c5250933188c4990ba30640a44a41eb6732d257d` | 48 USDT |
| PANDORA 88 Plus | `pandora-88-plus` | `ff1da6af-a678-4abd-9b03-1594da093e48` | `0x6c2cb6f547d4470786186cac4808dd04ef30f1eb71a94347129d20f5770fb403` | 88 USDT |

All three are `packType: v3`, with vending machine `0xd4d18607d6111c5fa2f93a4a5b2c0e28f1563f9f`. Source: https://api.renaiss.xyz/v2/gacha/packs?stage=active. INFERRED: prefer resolving IDs by slug at runtime rather than hard-coding UUIDs.

## Contracts (BSC mainnet, chain 56), CONFIRMED, https://docs.renaiss.xyz/contracts.md
| Contract | Address |
|---|---|
| TokenVendingMachineV3 (gacha payment + buybacks) | [0xd4d18607d6111c5fa2f93a4a5b2c0e28f1563f9f](https://bscscan.com/address/0xd4d18607d6111c5fa2f93a4a5b2c0e28f1563f9f) |
| RenaissRegistry (card NFT, ERC-721) | [0xF8646A3Ca093e97Bb404c3b25e675C0394DD5b30](https://bscscan.com/address/0xF8646A3Ca093e97Bb404c3b25e675C0394DD5b30) |
| USDT (18 dec) | [0x55d398326f99059fF775485246999027B3197955](https://bscscan.com/address/0x55d398326f99059fF775485246999027B3197955) |
| Permit2 | [0x000000000022D473030F116dDEE9F6B43aC78BA3](https://bscscan.com/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |
| OrderBook (marketplace) | [0xAE3e7268EF5A062946216A44f58A8F685fFD11d0](https://bscscan.com/address/0xAE3e7268EF5A062946216A44f58A8F685fFD11d0) |
| Cashier / Manager (redeem) | [0x3F364C83…63AF](https://bscscan.com/address/0x3F364C839fa0C81485d39E2887917153d95e63AF) / [0xB95F8867…c512](https://bscscan.com/address/0xB95F8867fF54fd16342Cb414c0F57237be7Dc512) |
| CollectibleInventory / TimelockController | [0x14B662fC…ef8c](https://bscscan.com/address/0x14B662fC59f87Ec004c2C25E0A2a49c9f858ef8c) / [0xB4cc2a69…C80a](https://bscscan.com/address/0xB4cc2a69B5E461Dbc76fEf668891D0E1E3b5C80a) |

Testnet (chain 97): vending machine `0xeeddf88d5cb406cc27f6eea4636566b4943e3737`, registry `0x57eE95884Ac93E6d081Fd9366AFEF9891C8Eceb4`, Mock USDT `0x3d2745c844cee4a62B66DF18b5Fd93781C26958b`. Whether these contracts are verified on BscScan was not checked (UNKNOWN).

## Other v2 areas (exist, not needed now), CONFIRMED (spec)
- Users: `GET /v2/users/{wallet}` (FMV total), `/collectibles` (includes undelivered cards in the buyback window, with `state.buybackTiers`), `/activities`.
- Marketplace: `GET /v2/marketplace`, `/collectibles/{tokenId}` (public card metadata and price history), and the asks/bids/buy/sell prepare+submit pairs.
- Redeem/shipping: `/v2/redeem/*` (needs a wallet Bearer token).
- Errors: https://docs.renaiss.xyz/api-reference/errors.md (for example `INSUFFICIENT_USDT_AMOUNT`, `INSUFFICIENT_ALLOWANCE`, `OP_WALLET_BUSY`).

## boosterpack.cards findings (read-only bundle inspection)
- Its frontend calls only its own backend at `https://api.boosterpack.cards` (`/api/packs`, `/api/pulls`, `/api/machines`, `/api/stats`, ...). No Renaiss hostnames appear in the browser bundle, so its Renaiss calls are server-side. CONFIRMED (bundle `assets/app-DgcYbSfr.js`).
- Its docs text: "Renaiss sells packs only through an off-chain API, one signed pull at a time"; "Prices are in USD (USDT) from the Renaiss catalog"; pull detail links "Card NFT" and "Renaiss Fair rip proof" (`fairUrl`). Pack keys are `pandora28`, `pandora48` and `pandora88plus`. CONFIRMED (bundle `chunks/index-D-4dlydd.js`).

## What must change in `server/src/renaiss/endpoints.ts`
1. **Base path / versions**: replace `/v1/...` with `/v2/gacha/...`. The base URL is `https://api.renaiss.xyz` (prod) or `https://dev-api.renaiss.xyz` (testnet), set by an env var.
2. **Auth**: `authHeaders` → `{ 'x-builder-api-key': key }`, not `Authorization: Bearer`. Bearer is only the wallet session for Redeem.
3. **Pack IDs**: `RENAISS_PACK_IDS` → slugs `pandora-28`, `pandora-48`, `pandora-88-plus`. At startup, resolve slug → catalog `id` (UUID, used in prepare) and `onChainPackId` (used to verify the witness) via `GET /v2/gacha/packs/{slug}`.
4. **buyPack is two calls plus a signature, not one POST**:
   - `POST /v2/gacha/pull/prepare {buyerWalletAddress, packId, quantity}`.
   - Our server wallet (the "vault") ensures USDT `approve(Permit2)`, then signs `permit2TypedData` (EIP-712) after checking the domain, spender, amount, nonce, deadline and witness.
   - `POST /v2/gacha/pull/request {…unsignedPullPayload minus builderCode, buyerWalletAddress, permitSignature}` → 202 `requestId`.
   - Remove `bodies.buyPack(paymentTxHash, chain)`: there is no tx hash input. The funding tx (`permitFundTxHash`) is an output.
5. **getPull**: `GET /v2/gacha/pull/status?requestId=` (query parameter, not a path ID). Status enum: `PENDING_PAYMENT | PENDING_RESOLUTION | RESOLVED | FAILED` (not `REVEALED`). Cards are in `result.draws[]`, and one pull can hold several draws (`numOfTokens`). The recovery lookup is `GET /v2/gacha/draw-status`. Optionally use `/pull/stream` (SSE).
6. **mapCard**: `id` → `tokenId` (also keep `settlementId`, which buyback needs). `image` → `frontImageUrl`. `valueUsd` → `Number(buybackBaseValueInUSD)/100` (cents). `grade`, `grader` and `set` come from `attributes[{key,value}]` (key names UNKNOWN; check them on a real draw). Add `tier`, `type`, `releaseTxHash` and `buybackTxHash`. `purchasedAt` → `result.pulledAt`.
7. **quoteSellBack**: `GET /v2/gacha/buyback/offers?buyerWalletAddress=` (by wallet, not per card). Pick the offer whose `settlementId`/`tokenId` matches, then take the first unexpired `buybackTiers[]` entry. `proceedsUsd = amountInUsdt / 1e18`. `rate = buybackPercentage`. Value comes from the draw's `buybackBaseValueInUSD`/100.
8. **sellBack**: `POST /v2/gacha/buyback` (sync, returns `{txHash,totalAmountInUsdt,itemCount}`), or `/buyback/request` plus `/buyback/status`. Body: `{buyerWalletAddress, cardPackId, buybackAuth{buybackIds:[settlementId…], token: USDT, amount}, userSignature}`. The wallet must sign `BuybackUserAuthorization`. Its EIP-712 types are UNKNOWN; get them from the `@renaiss-protocol/client` source. It is batchable (1–10 cards from the same pack). `txRef` = `txHash`.
9. **transferCard**: remove the API call. Renaiss auto-releases the NFT to the buyer wallet after 72 h (`releaseTxHash`). Then our wallet calls `RenaissRegistry.safeTransferFrom(vault, to, tokenId)` on-chain (0xF8646A3C…5b30). Cards cannot be moved during the window.
10. **New concerns**: we need a server-side signer wallet holding USDT plus BNB for gas (or rely on sponsored execution); handling of `Retry-After` on 429; polling about once per second with a 10-minute PENDING cap; idempotent resubmission of the same signed pull; and an env switch for chain 56 / 97 with matching contract constants. Consider using the SDK `@renaiss-protocol/client` (beta) instead of hand-rolled HTTP.
11. **Access**: a builder key is required for all writes. Request it via info@renaiss.xyz with the app name, flows (Gacha), env/network, volume and signing origins. Until then only the public catalog (`/v2/gacha/packs*`) can be called.

## Implementation (2026-11-25)

**Wired** (`server/src`):
- `renaiss/client.ts`: fetch client for v2 with zod-validated responses (`renaiss/schemas.ts`), `x-builder-api-key` only on builder routes, `x-request-id` per call, timeouts, 429 `Retry-After` and backoff (5xx is resent only for idempotent calls: GETs and `POST /pull/request`). We did not use the SDK `@renaiss-protocol/client@0.1.0-beta.5`: it is beta, declares `engines.node >= 24` (we run 22) and is built on fp-ts. Its request shapes and EIP-712 types are mirrored instead.
- `renaiss/networks.ts`: contracts and slugs per network. Testnet's 88 pack slug is **`pandora-88`**; mainnet's is `pandora-88-plus`.
- `renaiss/catalog.ts`: resolves slug → UUID, `onChainPackId`, price and release window, cached for 5 min. It throws if a slug is missing or not active, if the price is not exactly 28/48/88 USDT, or if the vending machine is not the network's.
- `renaiss/provider.ts` (`RenaissProvider`):
  - Pulls: prepare, then verify the response (same checks as the SDK, against our contracts and price). Then the USDT balance check, a one-time max `approve(Permit2)`, signing `PermitWitnessTransferFrom` (rebuilt locally from the verified fields), `/pull/request`, and a status poll every ~1 s with a 10-min cap. `OP_WALLET_BUSY` resends the same signed body.
  - Cards are mapped by `renaiss/mapping.ts`: `valueUsd = buybackBaseValueInUSD/100`, plus Grader, Grade and Set from `attributes`.
  - Sell-back: `/buyback/offers` (first unexpired tier), then `BuybackUserAuthorization` signed with domain `{name:"TokenVendingMachineV3", version:"1", chainId, verifyingContract: offer.vendingMachineAddress}` and types `{buybackIds: bytes32[], token: address, amount: uint256}`, then `/buyback/request`, polled until COMPLETED.
  - Release: `ownerOf` on RenaissRegistry, then `safeTransferFrom(operator, winner, tokenId)`.
- Multi-card pulls: we always request `quantity: 1`. If several draws come back, the value is summed (the pull's `card` is the top card, named "+N more"). A raffle winner gets every card, and a sell-back sends all of them in one signed batch.
- `swap/pancake.ts`: `swapETHForExactTokens` buys the USDT shortfall plus `SWAP_USDT_BUFFER_BPS`, capped at the BNB the vault sent. The BNB spent is read from the WBNB `Deposit` log, and `refund = amountSent − spent` is passed to `settlePull`. After a sell-back, `swapExactTokensForETH` swaps the exact USDT proceeds, and the BNB received (WBNB `Withdrawal` log) is passed to `depositProceeds`. Both swaps have a `SWAP_SLIPPAGE_BPS` guard (default 100) and a deadline.
- `operator/release.ts` with the `card_releases` table (`drizzle/0001_card_releases.sql`) and an in-memory implementation. Each raffled card is queued at `releaseAt` (end of the buyback window). The job checks that the operator owns the card, transfers it, and emits a "card delivered to 0x…" activity. It retries with backoff and marks the row FAILED after 10 attempts.
- `operator/index.ts`: swap and buy run under one wallet lock across machines. The Renaiss `requestId` is saved as meta `provider-request:<pullKey>`. MOCK_MODE (and live mode without a key) uses `SimulatedProvider` and `SimulatedSwapper`.

**Still unverified without a builder key** (built from the spec and SDK, not exercised end-to-end):
1. That the `BuybackUserAuthorization` domain and types copied from the SDK bundle are what the API accepts.
2. That `prepare.approval.requiredAmount` equals the full permit amount (the SDK assumes it does).
3. The real draw `attributes` keys. Today's mapping uses the key names from public `/v2/marketplace/collectibles/{id}`; fallbacks parse the cert number, the image path and the name.
4. How soon buyback offers appear after RESOLVED (we re-read offers for up to 60 s).
5. Rate-limit numbers.
6. Whether the NFT lands in the operator EOA exactly at the last tier's `expiresAt`.
7. Testnet has no PancakeSwap liquidity for Renaiss's mock USDT. On chain 97, fund the operator with mock USDT directly (the swapper then buys nothing) or set `PANCAKE_ROUTER` to a pool you control.

**Testnet checklist once a key exists:**
1. Email info@renaiss.xyz for a **testnet** builder key (server-side use; no browser origins needed).
2. In `server/.env` set: `CHAIN_ID=97`, `RENAISS_NETWORK=testnet`, `RENAISS_API_KEY=<key>`, `OPERATOR_ENABLED=true`, `OPERATOR_PRIVATE_KEY=<throwaway testnet key>`, plus `FACTORY_ADDRESS` and `RPC_URL` for chain 97.
3. Fund the operator with tBNB (gas) and Renaiss mock USDT `0x3d27…958b` (at least 28).
4. Run `RENAISS_LIVE=1 npx vitest run test/renaiss.live.test.ts` (public catalog check).
5. Start the server. The catalog check runs at boot.
6. Trigger one FORGE_28 pull and watch the logs: `approved USDT (max) for Permit2` → `renaiss pull submitted` → `pack bought` → `sold back` or `raffle recorded; delivery queued`.
7. Compare the logged card's Grader, Grade and Set with the raw `/v2/gacha/pull/status` payload and adjust `mapping.ts` if needed.
8. For a raffle, check the `card_releases` row and, after 72 h, the delivery tx.
