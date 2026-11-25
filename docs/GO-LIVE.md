# GachaForge go-live checklist

Order matters. Steps marked **YOU** involve keys, signatures or accounts and must be done by the owner. Steps marked **CLAUDE** can be done for you once you send the public values (addresses, never keys).

| # | Step | Who |
|---|------|-----|
| 1 | Get a Renaiss **builder API key** (mainnet) by emailing info@renaiss.xyz (app name GachaForge, flows: gacha pull + buyback, network BSC 56, origin https://gachaforge.xyz). Ask for a testnet key too. | YOU |
| 2 | Create a **new operator hot wallet** (not the company wallet). Send Claude its **public address only**. Fund it with ~0.05 BNB for gas. Keep its private key offline until step 7. | YOU |
| 3 | Get a **BscScan API key** (for contract verification) and, ideally, a paid BSC RPC with archive access (QuickNode/Alchemy/Ankr/NodeReal). Archive access lets raffle/dividend snapshots read balances at the exact block. | YOU |
| 4 | Fill `contracts/.env` from `contracts/.env.mainnet.example`: set `OPERATOR=<operator address>`, `ETHERSCAN_API_KEY`, `BSC_RPC_URL`. Leave `RENAISS_PAYMENT_RECEIVER` empty (defaults to the operator, which swaps BNB→USDT for Renaiss). | YOU (Claude can pre-fill everything except the API key) |
| 5 | Dry run (no transactions): `forge script script/Deploy.s.sol --fork-url $BSC_RPC_URL --sender <YOUR_DEPLOYER_ADDRESS>` | CLAUDE or YOU |
| 6 | **Deploy and sign** with your own wallet: `forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL --broadcast --verify --ledger --sender <addr>` (or `--interactives 1`). Cost ≈ 0.001–0.012 BNB. Writes `contracts/deployments/56.json`. | YOU |
| 7 | Railway → service `server` → Variables: add the **secrets** yourself: `OPERATOR_PRIVATE_KEY`, `RENAISS_API_KEY`, and (if you have one) a private `RPC_URL`. | YOU |
| 8 | Railway non-secret variables: `MOCK_MODE=false`, `FACTORY_ADDRESS`, `OPERATOR_ENABLED=true`, `RPC_URL` (public if you have none), `DATABASE_URL=${{Postgres.DATABASE_URL}}`, start block. | CLAUDE (from `56.json`) |
| 9 | Vercel env: `NEXT_PUBLIC_FACTORY_ADDRESS`, `NEXT_PUBLIC_TIMELOCK_ADDRESS`, `NEXT_PUBLIC_BUYBACK_BURNER_ADDRESS`, `NEXT_PUBLIC_FLAP_LAUNCHER_ADDRESS`, optional `NEXT_PUBLIC_WC_PROJECT_ID` (cloud.reown.com, for mobile wallets). Redeploy. | CLAUDE |
| 10 | Smoke test on mainnet with small money: launch one test token from the site, make a small buy, watch the fee flow and pot fill, confirm the company wallet receives 90%. | YOU + CLAUDE |
| 11 | Operator wallet: one-time USDT approval to Permit2 happens automatically on the first pull; keep ≥0.02 BNB for gas. | auto |

## Already done
- Contracts tested (unit + BNB-mainnet fork with real flap.sh and Chainlink) for the fixed 2% tax and 90/7/3 split.
- Backend on Railway, frontend on Vercel at https://gachaforge.xyz, Postgres provisioned on Railway (connected at step 8 so preview data never enters it).
- Renaiss v2 client, PancakeSwap swaps and card-release queue built; live catalog check passes. Real pulls/sell-backs unverified until the API key exists.

## Not recommended to skip
- An independent audit before significant volume.
- Moving admin from a single wallet to a 2-of-3 multisig (e.g. Safe) — set `MULTISIG` to the Safe address at step 4.
- A legal check for real-money gacha in your target markets.
