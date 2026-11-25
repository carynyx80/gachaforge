# OFF-CHAIN MODE: operations guide

Off-chain mode (SPEC "OFF-CHAIN MODE") uses no GachaForge contracts. Each machine token is a flap.sh Tax Token V3 whose tax recipient is the company treasury. The backend keeps the books in an append-only ledger. A hot "ops" wallet pays for every pull, payout, burn and buyback, plus the keeper's gas.

- `MODE=offchain` is the default when `FACTORY_ADDRESS` is empty.
- `MOCK_MODE=true` (or `MODE=mock`) gives the preview with seeded data.
- `MODE=vault` (or `FACTORY_ADDRESS` set) runs the old on-chain vault path.
- `GET /api/health` returns `mode` (`offchain`, `mock` or `vault`), `opsReady` (an ops key is loaded) and `renaissReady` (a Renaiss key is present).

## Money flow

1. **Launch.** The creator calls `Portal.newTokenV6` with these settings:
   - buy and sell tax chosen by the creator, each 100–1000 bps in whole % (TAX MODEL v3)
   - `beneficiary = TREASURY_ADDRESS`, `mktBps = 10000`
   - no commission receiver
   - native BNB quote
   - Tax Token V3, vanity address ending in `7777`

   The frontend then asks the launch tx sender to `personal_sign` the canonical message (`server/src/offchain/message.ts`, mirrored in `web/lib/registerMessage.ts`):
   ```
   GachaForge register
   token:<lowercase token>
   pack:<PACK>
   strategy:<STRATEGY>
   split:<dividendBps>/<burnBps>/<lpBps>   (0/0/0 unless SPLIT)
   buyTaxBps:<100–1000>
   sellTaxBps:<100–1000>
   potShareBps:<2000–10000>               (pot share of the creator share)
   payout:<lowercase payout address>      (default: the launch wallet)
   chainId:56
   ```
   and calls `POST /api/machines/register { txHash, pack, strategy, split?, buyTaxBps, sellTaxBps, potShareBps, payout?, signature }`. Older clients that send none of the four tax fields sign the pre-v3 message (no tax lines) and get the auto-registration defaults. A signature that does not recover to the tx's `from` is rejected with `bad_signature` (401). The backend rejects the registration with a clear error code unless all of these hold:
   - the receipt contains a Portal `TokenCreated`
   - `getTokenV8Safe` shows a buy/sell tax of 1–10% (whole %) equal to the signed `buyTaxBps`/`sellTaxBps`, and a BNB quote
   - `taxProcessor().marketAddress()` equals `TREASURY_ADDRESS`
   - `commissionReceiver()` is `0x0`

   The error codes are `invalid_params` (bad tax / pot share / payout values), `bad_signature`, `tx_not_found`, `tx_reverted`, `no_token_created`, `bad_tax`, `bad_quote`, `wrong_recipient`, `commission_set`, `already_registered` and `forge_token`. Pack, strategy, split, tax rates, pot share and payout address are immutable after registration. A launch whose tax goes to the treasury but that is not registered within `AUTO_REGISTER_DELAY_SEC` (default 600 s) is registered automatically as FORGE_28 / RAFFLE with its on-chain tax rates, `potShareBps` 10000 (the whole creator share goes to the pot) and payout = the launch tx sender.

   **$FORGE** is registered automatically as a machine once it is discovered, if its tax recipient is `TREASURY_ADDRESS`, with `FORGE_PACK` / `FORGE_STRATEGY` and the $FORGE split (below). Any tax rate is accepted for it. If its tax goes elsewhere it stays display/trade-only.
2. **Indexing.** One shared log scanner covers all tokens. It reads Portal `TokenBought`/`TokenSold`, PancakeSwap pair `Swap` after graduation, `Transfer` for holder balances, and `LaunchedToDEX`. It uses adaptive block ranges and batched address filters.
3. **Ledger.** The `ledger_entries` table is append-only; a Postgres trigger rejects UPDATE and DELETE. Each trade books these entries:
   - **TAX:** the trade × that side's tax (`buyTaxBps` for buys, `sellTaxBps` for sells).
   - **FLAP:** flap.sh's cut, from the token's own measured treasury share (falls back to the global measured share, then to `FLAP_CUT_ESTIMATE_BPS`).
   - **The rest (creator machines, TAX MODEL v3):** PLATFORM (company) 5%, BUYBACK 5%, and the 90% creator share split into POT (`potShareBps`) and CREATOR (the rest, owed to the payout address).
   - **The rest ($FORGE, and machines registered before v3):** PLATFORM 90%, POT 7%, BUYBACK 3%. Pre-v3 registrations keep this split; nothing is changed retroactively.

   Each trade's FeeEvent stays `pending` until a dispatch is seen. The keeper calls `TaxProcessor.dispatch()` when gas is at most `DISPATCH_MAX_GAS_PCT` of the pending tax. It then reads the cumulative `totalQuoteSentToMarketing()`, which is the BNB that really reached the treasury, books `RECONCILE` corrections, settles the FeeEvents and stores the measured treasury share. Later estimates use that measured share. On the mainnet fork it was 9052 bps, so flap.sh keeps about 9.5% of the tax.
4. **Pull.** When the virtual pot is at least the pack price (Chainlink BNB/USD), the ops wallet does the following:
   1. Swaps BNB→USDT on PancakeSwap, capped at pack price + `OPS_PULL_BUFFER_BPS`.
   2. Buys the pack from Renaiss.
   3. Debits the pot by the BNB the swap actually spent.

   Only one pull runs per machine at a time, with a `PULL_COOLDOWN_SEC` cooldown. Holders are snapshotted from indexed balances at the token's synced block. When the RPC serves that block, the balances are checked with `balanceOf` multicalls. Proofs are published at `/api/raffles/:pullId`.
5. **Creator payouts.** Every `CREATOR_PAYOUT_INTERVAL_MS` the ops wallet sends each creator's whole CREATOR balance to its payout address once it is at least `CREATOR_PAYOUT_MIN_BNB`. The debit is booked before sending and reversed if nothing was sent, so a payout never exceeds the ledger balance and is never paid twice. Payouts are `ops_txs` kind `CREATOR_PAYOUT`; they are exempt from `OPS_DAILY_CAP_BNB` and not counted in it. Machines expose `creatorOwedBnb` / `creatorPaidBnb`.
6. **Strategies:**

   | Strategy | What happens |
   |---|---|
   | RAFFLE | The card goes to a holder through the release queue: Renaiss releases the NFT after 72 h, then the ops wallet `safeTransferFrom`s it to the winner. If no holder is eligible, the card is sold back and the BNB returns to the pot. |
   | HIT_HUNTER | A miss, or no eligible holder: sell back, then buy and burn. |
   | DIVIDEND | Sell back, then push BNB directly to each eligible holder. |
   | BURN | Sell back, then buy the token through `Portal.swapExactInput` and send it to `0x…dEaD`. |
   | SPLIT | Dividend/burn in the creator's ratio; the LP share is burned. |

   Dividend payouts are queued and sent in batches of `DIVIDEND_BATCH_SIZE`. Shares below `DIVIDEND_MIN_BNB` stay in the DIVIDEND bucket for the next round. When the BUYBACK ledger reaches `BUYBACK_MIN_BNB` and $FORGE has been discovered, the ops wallet buys $FORGE and sends it to dead.
7. **Sweep (optional).** This needs `SWEEP_TO_ADDRESS` set and the ops wallet to be the treasury. The keeper moves `min(platform share, balance − owed − OPS_RESERVE_BNB)` to the cold wallet. Owed means pots + creator balances + buyback + pending dividends + pending burns (`/api/transparency → owed`, incl. `owed.creators`), so the sweep never moves creator money.

Pots are virtual: the BNB sits in the treasury or ops wallet. The pot includes tax that has not been dispatched yet (an estimate), so the ops wallet pays for a pull before flap.sh has dispatched the tax.

## Wallets and funding

| Wallet | Env | Needs |
|---|---|---|
| Treasury | `TREASURY_ADDRESS` (public) | Nothing. It receives all tax. |
| Ops (hot) | `OPS_PRIVATE_KEY` (**Railway secret only**) | BNB for everything it pays. Size the balance as described below. USDT approval for Permit2 happens automatically on the first pull. |
| Cold (optional) | `SWEEP_TO_ADDRESS` (public) | Nothing. |

The ops wallet balance should be at least the total owed plus `OPS_RESERVE_BNB`. The total owed is `owed.total` on `/api/transparency`. As a rule of thumb, plan about 0.05 BNB per FORGE_28 pull and about 0.0002 BNB of gas per dividend transfer, Portal burn or dispatch. `/api/transparency → balances.coverageBnb` is the paying wallet's balance minus everything owed. Top up when it goes negative or drops close to the reserve.

**Ops wallet ≠ treasury.** The tax still lands in the treasury, so the ops wallet must be topped up from it. Suggested rule, done by hand or by a cron on the treasury side, never by this server: when `coverageBnb < OPS_RESERVE_BNB`, send `owed.total + 2 × OPS_RESERVE_BNB − ops.balanceBnb`. `SWEEP_TO_ADDRESS` is ignored in this setup.

**Ops wallet = treasury.** Nothing needs topping up. Use `SWEEP_TO_ADDRESS` to move the company (platform) share to cold storage.

Without `OPS_PRIVATE_KEY` the server runs read-only:
- everything is indexed and booked;
- full pots show `pullQueued: true`;
- dispatch, pull and payout actions are recorded once as `QUEUED` in `ops_txs`.

A key with no `DATABASE_URL` is ignored. Pots, the payout queue and the daily cap must survive restarts; `OPS_ALLOW_MEMORY=true` overrides this for local development only.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `MODE` | auto | `offchain`, `vault` or `mock` |
| `RPC_URL` | public BSC | BSC RPC. An archive RPC is not required. A paid RPC is recommended for volume. |
| `CHAIN_ID` | 56 | 97 needs `RPC_URL` |
| `DATABASE_URL` | none | Postgres. Required for a signing ops wallet. Tables: `offchain_machines`, `ledger_entries`, `ops_txs`. Migration `0005_tax_v3` adds `fee_events.creator_usd` (default 0) and an `ops_txs(kind, machine)` index. |
| `TREASURY_ADDRESS` | company wallet | Must be every machine's tax recipient |
| `OPS_PRIVATE_KEY` | none | Ops hot wallet. Unset means read-only. |
| `OPS_PAUSED` | false | Kill switch |
| `OPS_DAILY_CAP_BNB` | 1 | Rolling 24 h of value + gas leaving the ops wallet. Sweeps and creator payouts are excluded. |
| `OPS_RESERVE_BNB` | 0.05 | Gas buffer that the sweep never touches |
| `OPS_PULL_BUFFER_BPS` | 1000 | Per-pull cap: pack price + 10% |
| `OPS_TX_RETRIES` / `OPS_TX_TIMEOUT_MS` | 3 / 180000 | Send retries on transient or nonce errors; receipt wait |
| `RENAISS_API_KEY` | none | Missing means full pots wait with `pullQueued: true` |
| `PULL_COOLDOWN_SEC` | 60 | |
| `DIVIDEND_MIN_BNB` / `DIVIDEND_BATCH_SIZE` | 0.0005 / 25 | |
| `BUYBACK_MIN_BNB` / `BURN_MIN_BNB` / `BURN_SLIPPAGE_BPS` | 0.05 / 0.0005 / 300 | |
| `DISPATCH_MAX_GAS_PCT` | 10 | |
| `AUTO_REGISTER_DELAY_SEC` | 600 | |
| `SWEEP_TO_ADDRESS` / `SWEEP_INTERVAL_MS` / `SWEEP_MIN_BNB` | none / 6 h / 0.05 | |
| `FLAP_CUT_ESTIMATE_BPS` | 1000 | Used until a dispatch has been measured |
| `CREATOR_PAYOUT_MIN_BNB` | 0.01 | A creator's owed balance is paid out once it reaches this |
| `CREATOR_PAYOUT_INTERVAL_MS` | 60000 | How often creator payouts are checked |
| `FORGE_PACK` / `FORGE_STRATEGY` | FORGE_28 / RAFFLE | Pack and strategy of the $FORGE machine. Set before $FORGE is discovered; fixed after. SPLIT is not allowed. |
| `LOGS_ADDRESS_BATCH` / `LOGS_MAX_RANGE` | 50 / 2000 | Public RPC limits |
| `START_BLOCK` | head at first boot | Where the shared scanner starts. Registered tokens always backfill from their own creation block. |
| `INDEXER_POLL_MS` / `OPERATOR_POLL_MS` / `KEEPER_POLL_MS` | 3 s / 5 s / 60 s | |

## Runbook

All money movements are listed on `GET /api/transparency` (`txs[]`, with BscScan links) and in the `ops_txs` table. `npm run ops -- status` (on Railway: `node dist/offchain/cli.js status`) prints the bucket totals, per-machine state and the last 20 ops txs.

### Pause everything
1. In Railway, set `OPS_PAUSED=true` and redeploy (or restart).
2. Nothing is sent after that. Indexing and accounting keep running, and attempted actions are recorded as `QUEUED`.
3. To resume, set it back to `false`. Queued work (pots, payout queue, burn and buyback buckets) is picked up automatically.

For a suspected key leak, also move the funds out of the ops wallet with your own wallet. Then remove `OPS_PRIVATE_KEY`, which puts the server in read-only mode.

### Daily cap reached
`ops_txs` rows show `BLOCKED` with the reason, and machines show `pullQueued` with reason `daily_cap`. Actions resume as the rolling 24 h window frees up. To raise the limit, change `OPS_DAILY_CAP_BNB`.

### Recover a stuck pull
`transparency.machines[].openPull` shows the stage: `STARTED`, `SWAPPED`, `BOUGHT` or `SOLD`. The pot was debited at `SWAPPED`.

| Stage | Meaning and action |
|---|---|
| `STARTED` | Nothing was spent. Run `npm run ops -- clear-pull <token>`. |
| `SWAPPED` | Renaiss failed and selling the USDT back failed too (`openPull.error`). The USDT sits in the ops wallet and the next pull will use it. Either clear the pull, which lets the next pull reuse the USDT for almost no BNB, or sell the USDT by hand and run `clear-pull <token> --refund-wei <BNB received>`. |
| `BOUGHT` | A card exists (`openPull.requestId` is the Renaiss requestId; look it up with `GET /v2/gacha/pull/status`). For a raffle machine, queue the delivery by hand or sell back. Then run `clear-pull <token> --bump-round`. |
| `SOLD` | The proceeds were booked. Run `clear-pull <token> --bump-round`. |

Corrections never edit ledger rows. Use `npm run ops -- adjust <bucket> <token|global> <signedWei> <reason>`, which appends an `ADJUST` entry.

### Top up the ops wallet
Send BNB to `ops.address`. Check `balances.coverageBnb` on `/api/transparency`. Failed actions (`FAILED`, "insufficient ops wallet balance") are retried on the next tick.

### Failed dividend or burn
A failed dividend payout stays in the payout queue. A failed burn or buyback leaves its bucket balance in place. Both retry every ops tick (5 s). If the Portal buy succeeded but the transfer to dead failed, the next tick sends the ops wallet's whole token balance to dead.

### Tax not arriving / alerts
`GET /api/alerts` lists flap.sh admin re-routes (`TaxTokenAddressesUpdated`). `ledger.treasuryShareBps` falling well below about 9000 means tax is being lost; check the token on flap.sh.

## Trust assumptions (disclose to users)
- **Custodial.** Pots are ledger entries, not on-chain balances. The ops wallet key holder can move the funds. Every tx is public on `/transparency`.
- **flap.sh admins can re-route** a token's tax recipient (`updateTaxTokenAddresses`). This is monitored, not prevented.
- **Only the launcher can choose pack/strategy** (signature by the launch tx sender). A treasury-taxed launch without a valid registration gets the defaults (FORGE_28 / RAFFLE) after 10 minutes.

## Tests
- `npm test` runs the unit tests: registration checks, ledger math and reconciliation, pulls, caps and pause, dividends, burns, buyback, sweep and transparency.
- `npm run test:fork` (or `BSC_RPC_URL=… npx vitest run test/offchain.fork.test.ts`) forks BSC with anvil and runs the full flow:
  1. launches a real `newTokenV6` token with a test treasury;
  2. registers it through the API;
  3. trades on the Portal and calls `dispatch()`;
  4. checks that treasury receipts equal the reconciled ledger;
  5. runs a pot-full pull with a real PancakeSwap swap and a mocked Renaiss;
  6. runs a Portal buy & burn.

  On BSC mainnet the well-known anvil addresses carry EIP-7702 sweeper delegations, so the test clears their code on the fork first.
