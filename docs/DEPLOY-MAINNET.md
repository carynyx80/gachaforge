# GachaForge: BNB Smart Chain mainnet deploy

You sign this deploy yourself. Nothing in this repo holds, asks for or stores a private key. Use a hardware wallet (Ledger or Trezor), a Foundry keystore, or the interactive prompt. Never put a key in `.env`.

What gets deployed (5 contracts, by `contracts/script/Deploy.s.sol`):

| Contract | Role |
|---|---|
| `TimelockController` | Admin of the factory and the burner. Proposer and executor are the company wallet. Delay is 48 h. Self-administered (admin = 0). |
| `FlapLauncher` | flap.sh adapter. Uses Portal mode (`Portal.newTokenV6`, beneficiary = vault). |
| `FlapRouter` | Buys through `Portal.swapExactInput` and adds LP through PancakeSwap V2. |
| `BuybackBurner` | Collects the 3% $FORGE-buyback share of every vault's tax. `$FORGE` is unset at deploy, so BNB accumulates. |
| `GachaForgeFactory` | Launches machines and deploys one `MachineVault` per token. |

The deployer wallet keeps **no** role after the script. It grants every admin role to the timelock and then renounces its own.

## 1. Prerequisites

- Foundry ≥ 1.0 (`forge --version`). The build uses solc 0.8.28, via-IR, cancun.
- A deployer wallet with about **0.05 BNB** (see cost below; this leaves headroom). Any wallet works. It can be the company wallet.
- A BscScan/Etherscan **V2** API key for `--verify`. This is an API key, not a wallet key.
- The **backend hot wallet address** (public address only) to use as `OPERATOR`. It must differ from the company wallet.
- Optional: the Renaiss BNB payment address. If you leave it empty, the timelock can set it later with `setPaymentReceiver`. Pulls revert until it is set.

```bash
cd contracts
cp .env.mainnet.example .env      # .env is gitignored
# edit .env: set OPERATOR=<backend hot wallet address>, ETHERSCAN_API_KEY=..., optionally RENAISS_PAYMENT_RECEIVER
set -a; source .env; set +a
```

Fixed config in `.env.mainnet.example`, verified on a mainnet fork on 2026-11-25:

| Key | Value |
|---|---|
| `TREASURY`, `MULTISIG` | `0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c` (company wallet) |
| `CHAINLINK_BNB_USD` | `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` (decimals 8, "BNB / USD", fresh) |
| `FLAP_PORTAL` | `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0` (v5.27.2) |
| `FLAP_VAULT_PORTAL` | empty (Portal mode) |
| `FLAP_TAX_TOKEN_IMPL` | `0x024f18294970B5c76c0691b87f138A0317156422` |
| `PANCAKE_ROUTER` | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| `FORGE_TOKEN` | empty (`$FORGE` does not exist yet) |
| `TIMELOCK_DELAY` | 172800 (48 h; the script refuses less than 1 day on chain 56) |

On chain 56 the script also checks that the feed, the Portal, the implementation and the router have code, that the feed has 8 decimals and is fresh, and that `OPERATOR != MULTISIG`.

## 2. Test and simulate first (no transactions)

```bash
forge test                                                        # unit tests (fork tests skip)
BSC_RPC_URL=https://bsc-rpc.publicnode.com forge test --match-path 'test/fork/*' -vv   # real flap.sh + Chainlink
forge script script/Deploy.s.sol --fork-url $BSC_RPC_URL --sender <DEPLOYER_ADDRESS>  # dry run
```

The dry run prints every address and writes `deployments/56.dryrun.json`, which is gitignored. Note: forge auto-loads `contracts/.env`. If it contains `BSC_RPC_URL`, a plain `forge test` will run the fork tests too.

## 3. Deploy (you sign)

**Ledger** (recommended). Open the BNB/Ethereum app and enable blind signing or contract data:

```bash
forge script script/Deploy.s.sol \
  --rpc-url $BSC_RPC_URL --broadcast --verify \
  --ledger --sender <YOUR_LEDGER_ADDRESS>
# add --mnemonic-derivation-paths "m/44'/60'/0'/0/N" (or --hd-paths) if it is not the first account
```

The Ledger asks for about 10 confirmations, one per transaction.

**Trezor:** same command with `--trezor --sender <addr>`.

**Interactive prompt.** Foundry asks for the key in the terminal. The key is not saved, but it is in memory and the terminal is a weaker boundary than a hardware wallet:

```bash
forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL --broadcast --verify --interactives 1 --sender <addr>
```

**Encrypted keystore:** run `cast wallet import deployer --interactive` once, then use `--account deployer --sender <addr>`.

After the broadcast, the script writes **`contracts/deployments/56.json`** with all addresses and config. Commit that file, since it holds no secrets.

If verification failed or was skipped, verify afterwards. Each contract command takes its constructor args from `broadcast/Deploy.s.sol/56/run-latest.json`:

```bash
forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL --resume --verify --ledger --sender <addr>
# or per contract:
forge verify-contract <ADDR> src/GachaForgeFactory.sol:GachaForgeFactory --chain 56 --watch \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address,address,address)" <deployer> <feed> <router> <launcher> <renaiss> <treasury> <burner>)
```

Vaults are deployed later, one per launch, through CREATE2 from the factory. Verify one of them with `forge verify-contract <vault> src/MachineVault.sol:MachineVault --chain 56`. It has no constructor args, and all vaults share the same bytecode, so BscScan matches the rest.

## 4. Estimated cost

Fork simulation at block 135,687,596 (2026-11-25):

- **Gas:** 12,308,706 for all 10 transactions.
- **BNB** at the then-current 0.05 gwei: **≈ 0.00062 BNB**. At 1 gwei it is ≈ 0.0123 BNB, and at 3 gwei ≈ 0.037 BNB.
- Verification is free.
- Each machine launch later costs the creator gas only (no flap launch fee was charged on the fork) plus any optional first buy. The `$FORGE` launch and salt-lock (0.01 BNB) are separate.

## 5. Post-deploy (you do these yourself)

1. Check `deployments/56.json`. On BscScan:
   - the factory `hasRole(0x00, timelock) == true` and `hasRole(0x00, deployer) == false`
   - the timelock proposer and executor are the company wallet.
2. **Vercel (web):** set `NEXT_PUBLIC_FACTORY_ADDRESS=<GachaForgeFactory>` and `NEXT_PUBLIC_CHAIN_ID=56` if used, then redeploy.
3. **Railway (server):** set these in the Railway dashboard, never in git:
   - `FACTORY_ADDRESS=<GachaForgeFactory>`
   - `OPERATOR_PRIVATE_KEY=<backend hot wallet key>`, which must match the `OPERATOR` address used at deploy
   - the Renaiss API keys
   - a mainnet RPC
4. Fund the operator hot wallet with a little BNB for gas only. Keep its balance small.
5. Launch tokens with a salt whose Portal CREATE2 clone address ends in `7777`. `FlapLauncher.predictToken(salt)` predicts it, and the launcher reverts otherwise. Mining takes about 65k hashes. Optionally front-run-protect with `Portal.lockSalt` (0.01 BNB), though note that the salt then belongs to the locker, which is the launcher contract here, not the user.
6. Keeper: periodically call `TaxProcessor.dispatch()` for each token. `FlapLauncher.flushTax(token)` does this. Then call `MachineVault.sync()` so the pot reflects the tax.
7. **When `$FORGE` exists:** the company wallet schedules `BuybackBurner.setForge(<FORGE>)` on the timelock, waits 48 h, then executes it. This is one-shot and cannot be changed after. Until then, the 3% buyback share sits in BuybackBurner as BNB and can only leave through a `$FORGE` buy.

   ```bash
   # calldata for the timelock schedule/execute (sign with your wallet, e.g. in BscScan "Write Contract")
   cast calldata "setForge(address)" <FORGE>
   ```
8. Monitor the flap events `TaxTokenAddressesUpdated` (Portal) and `TokenVaultRefreshed` (VaultPortal) for every GachaForge token. Either one means a Flap admin re-routed the tax.

## 6. What the fork tests verified (2026-11-25)

| Assumption | Result |
|---|---|
| Chainlink BNB/USD `0x0567…2aeE` | Confirmed: decimals 8, "BNB / USD", fresh. `MachineVault.packPriceBnb()` equals `28e18·1e8/answer`. |
| `NewTokenV6Params`, `NewTokenV6WithVaultParams`, `ExactInputParams`, `TokenStateV8Safe` field order | Confirmed against the official FlapVaultExample sources. The selectors exist in the deployed implementations, and the calls succeed on the fork. No changes were needed. |
| Vanity: EIP-1167 clone of the TaxTokenV3 implementation, CREATE2 from the Portal with the raw salt, ending in `7777` | Confirmed (token == `predictToken(salt)`) |
| Portal mode, `beneficiary` = an undeployed CREATE2 vault | Works. `TaxProcessor.marketAddress() == vault`, commission receiver 0. |
| VaultPortal mode, our launcher as `IVaultFactory` | Also works on the fork. The factory is unregistered, so the flap UI marks it UNVERIFIED. |
| `taxDuration` = 100 years | Accepted |
| Buy tax and sell tax both reach the vault | Confirmed through `swapExactInput` both ways, then `dispatch()` (permissionless) |
| Tax rate | Fixed **2% buy / 2% sell** (200 bps) for every token. The factory, vault and FlapLauncher reject any other value. |
| Share of the nominal tax that reaches the vault | **90%**: the 2% tax gives 1.8% of the buy to the vault. Flap takes 10% of the tax, or 0.2% of volume. |
| `sync()` split | Exactly 7% pot, 3% BuybackBurner, 90% treasury (the company wallet `0x4906…a7c`, takes the rounding remainder). Set by `MachineVault.POT_BPS = 700` / `BUYBACK_BPS = 300`. |
| Supply | 1,000,000,000 × 1e18 |

The fork tests did not check graduation to PancakeSwap or the post-graduation tax liquidation. Test both before relying on them.

## 7. RISKS (read before deploying)

- **Unaudited.** None of the GachaForge contracts has had an external audit. Only unit and fork tests have run. Consider an audit and a cap on early usage.
- **Single-wallet admin.** `0x4906…7a7c` is one EOA, not the 2-of-3 Safe the SPEC asks for. That wallet alone can:
  - propose and execute every timelock action, after 48 h: change the price feed, router, launcher, payment receiver, treasury and burner for new launches; change the cooldown; grant or revoke `OPERATOR`; grant roles; set `$FORGE`.
  - unpause instantly.

  If its key leaks, an attacker gets all of the above, subject only to the 48 h delay, which users can watch. Recommendation: create a Safe and move the timelock roles to it soon. That move is itself a timelock operation: grant the roles to the Safe, then revoke them from the EOA.
- **Operator trust.** The backend hot wallet (`OPERATOR_ROLE`) spends pots on Renaiss packs, settles results, records raffle winners and dividend roots, and runs buybacks. It can mis-report card values, pick raffle winners (verifiable only off-chain through the published snapshot and seed) or set bad dividend roots. Slippage caps (pack price + 10%) bound each pull, but a compromised operator can still drain pots pull by pull to whatever `paymentReceiver` is set. The timelock can revoke the role, but only after 48 h. The operator can pause instantly, and only the company wallet can unpause.
- **Flap admin can reroute tax.** `Portal.updateTaxTokenAddresses` (Flap `DEFAULT_ADMIN`/`TAX_MANAGER`) can change any token's tax beneficiary away from our vault. Flap's own contracts are upgradeable proxies. We cannot prevent either. Monitor the events in §5.8.
- **Tax duration is finite.** Tax stops after `taxDuration` (100 years configured). It does not apply to trades through non-main pools after the anti-farmer window (3 days), so someone could route volume through a different pool untaxed.
- **Protocol fee.** Only about 90% of the nominal tax reaches the vault, because flap takes about 0.2% of volume at the fixed 2% tax.
- **`$FORGE` unset.** The 3% buyback share accumulates in BuybackBurner with no way out other than a `$FORGE` buy once `setForge` is executed. If `$FORGE` never launches, that BNB stays locked.
- **Chainlink dependency.** Pulls revert if the feed is stale (over 1 h old) or invalid. The timelock can repoint the feed.
- **Portal mode and UI.** In Portal mode flap.sh does not show our vault as a "vault" (`isVault=false`). Nothing on-chain stops a third party from launching a non-GachaForge token that names one of our predicted vault addresses as beneficiary. Such a token would not be registered in the factory.
