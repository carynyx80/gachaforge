# flap.sh integration notes (GachaForge)

Research date: 2026-11-25. Sources are linked inline. Legend:

- **[CONFIRMED]**: stated in flap.sh official docs or in Flap's official GitHub interfaces (`github.com/flap-sh/FlapVaultExample`).
- **[DERIVED]**: computed or inferred by us from confirmed facts.
- **[UNVERIFIED]**: not found in docs or interfaces. Check on-chain (BscScan verified source or a fork test) before relying on it.

Primary sources:

- Docs root: https://docs.flap.sh/en/flap (v2 developer docs under `/en/flap/v2/developers/...`)
- Addresses: https://docs.flap.sh/en/flap/v2/developers/deployed-contract-addresses
- Launch: https://docs.flap.sh/en/flap/v2/developers/bonding-curve/launch-tokens
- Vaults: https://docs.flap.sh/en/flap/v2/developers/bonding-curve/build-on-bonding-curve
- Tax Token V3: https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism/bonding-curve-tax-token-v3
- PreBond tax: https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism/pre-bond-tax
- Indexer: https://docs.flap.sh/en/flap/v2/developers/bonding-curve/build-an-indexer
- Economics: https://docs.flap.sh/en/flap/v2/developers/protocol-economics
- Curve: https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism
- Official interfaces and example vault: https://github.com/flap-sh/FlapVaultExample (`src/flap/IPortal.sol`, `IVaultPortal.sol`, `IFlapTaxTokenV3.sol`, `ITaxProcessor.sol`, `IVaultFactory.sol`, `VaultBaseV3.sol`, `VaultFactoryBaseV2.sol`, `src/FreeCoinV3Beacon.sol`, `test/FlapBSCFixture.sol`)
- Other official repos: `flap-sh/flap-vault-component-template` (vault UI), `flap-sh/flap-skills` (agent skills), `flap-sh/FlapPoolLaunchVaultExample`

---

## 1. TL;DR: can GachaForge do what SPEC.md asks?

| Requirement | Verdict |
|---|---|
| Tax fixed at 2%, same buy and sell | **Yes [CONFIRMED].** `buyTaxRate` and `sellTaxRate` accept 100–1000 bps; GachaForge always sets both to 200 (fork-tested). |
| Tax goes to the token's own GachaForge vault contract | **Yes [CONFIRMED].** Use `mktBps = 10000` with `beneficiary = vault` (Portal), or with a vault that our own factory creates (VaultPortal, permissionless). |
| Paid from the first bonding-curve trade | **Yes [CONFIRMED].** On the curve, the tax is charged as an extra fee on top of the 1% curve fee (PreBond Tax). It reaches the TaxProcessor via `processBondingCurveTax`. |
| Keeps flowing after graduation to PancakeSwap | **Yes [CONFIRMED].** After migration (PancakeSwap V2, always V2 for tax tokens) the token taxes main-pool trades, accumulates tokens, liquidates them to the quote token (BNB) and dispatches to the vault. |
| Tax arrives in BNB | **Yes [CONFIRMED]** for a native-quote token. The vault receives the quote token: native BNB by value transfer, or ERC-20 transfer followed by an empty `receive()` wake. |
| "100%" to the vault | **Not literally [CONFIRMED].** A protocol rate of up to 0.3% of trade volume is taken first ("of the tax, after the protocol fee"). An optional `commissionReceiver` takes 0.6–6% of the remainder; set it to `address(0)` to disable. Then `mktBps = 10000` sends all of the remainder to the vault. |
| "Locked forever" | **Partly.** Tax rates are set at creation, and the interfaces expose no rate setter [UNVERIFIED for the implementation]. **`taxDuration` is finite**: the token goes `TaxFree` after it. The V5 struct doc says max 100 years; the V6 max is [UNVERIFIED]. **The recipient is NOT immutable against Flap admins**: `Portal.updateTaxTokenAddresses()` (DEFAULT_ADMIN or TAX_MANAGER_ROLE) can change a tax token's `beneficiary`, and `setTokenBeneficiary` is admin-only [CONFIRMED in IPortal.sol]. |

---

## 2. Addresses [CONFIRMED: deployed-contract-addresses page and `src/FlapDeployed.sol`]

### BNB Chain mainnet (chainId 56)

| Contract | Address | Notes |
|---|---|---|
| Portal (bonding curve) | `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0` | Proxy. Docs list v5.23.1 in the table; the launch page cites "Portal v5.27.2" limits. |
| VaultPortal | `0x90497450f2a706f1951b5bdda52B4E5d16f34C06` | Launches a tax token and its vault together |
| Tax Token V3 Impl | `0x024f18294970B5c76c0691b87f138A0317156422` | CREATE2 clone base; vanity suffix **7777** |
| Standard Token V3 Impl | `0x88881b6f03090462a969eC7f48385744Eeb63333` | Non-tax; suffix 8888 |
| Standard Token Impl | `0x8b4329947e34b6d56d71a3385cac122bade7d78d` | Legacy |
| Tax Token Helper | `0x53841c73217735F37BC1775538b03b23feFD8346` | `getTaxTokenInfoV2` |
| SwapRegistry | `0x644A8f560138418bAD4EdEFC7c17878a3c2fBEB6` | Dividend swap paths |
| FlapVaultEx | `0x000048Df69f3d2af22Df6DC2d3B01FB592b90000` | Async MEV-protected swaps for vaults (0.5% fee) |
| Trigger Service | `0xcf4EE25035CF883895110f367F5BA8172416a7F9` | Scheduled callbacks |
| Flap Guardian | `0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b` | Upgrade authority for audited (low-risk) vaults |
| Whitelisted V7 vault factories (non-tax only) | `0x025549F52B03cF36f9e1a337c02d3AA7Af66ab32`, `0x6909aD1822Ece349CDDAb98E6F62EeeD9fAa2e10` | Not relevant to tax tokens |

A third-party source (Bitquery, https://docs.bitquery.io/docs/blockchain/BSC/flap-sh/) also names `0x1de460f363AF910f51726DEf188F9004276Bf4bc` as a "launchpad contract". This address is **[UNVERIFIED]** and is not in the official docs, so ignore it.

### BNB Chain testnet (chainId 97)

| Contract | Address |
|---|---|
| Portal | `0x5bEacaF7ABCbB3aB280e80D007FD31fcE26510e9` (v5.8.5, older than mainnet, so check feature parity) |
| VaultPortal | `0x027e3704fC5C16522e9393d04C60A3ac5c0d775f` |
| Tax Token V3 Impl | `0xE6Ff967a887084c16D0fD71548CF709542cc1557` |
| Tax Token Helper | `0xD64441e5FcD02D342B8cf6eBA10Ef6E40d0dA90f` |
| SwapRegistry | `0xEd62Df92e52b89C8100F8EC3B8Eefea073df3408` |
| FlapVaultEx | `0xa35AE5b62bA52d91F4952EbD3eC015B87BceEF00` (mock prices; WBNB `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` and test USD `0x190C989D5665a0e404B444b53CAE9AbCfb600157` only) |
| Trigger Service | `0x560E9830926C9e0EB98a59c6b9902383Fc0D9Eb2` |

The testnet Guardian address is not listed. Read it from the base contracts (`_getGuardian()`) [UNVERIFIED].

---

## 3. Token creation

### 3.1 Flow [CONFIRMED: launch-tokens page]

1. **Metadata:** upload the image and JSON to `POST https://funcs.flap.sh/api/upload` (GraphQL multipart, `create(file, meta)`). It returns the metadata CID, which becomes `meta`. Upload through Flap, because Flap's indexer only reads its own gateway (`https://flap.mypinata.cloud/ipfs/<CID>`).
2. **Vanity salt:** the token is an EIP-1167 clone deployed by the **Portal** via CREATE2. For tax tokens, the predicted address must end in **`7777`**, using the Tax Token V3 Impl as the clone base. This is true even when launching through VaultPortal, because the deployer is still the Portal. Expect about 65k hashes on average.
   ```ts
   const bytecode = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + impl.slice(2).toLowerCase() + "5af43d82803e903d91602b57fd5bf3";
   predict = getContractAddress({ from: PORTAL, salt, bytecode, opcode: "CREATE2" });
   ```
3. **Optional salt lock** (front-run protection): `Portal.lockSalt(bytes32 salt, TokenVersion v) payable`. `msg.value = SALT_LOCK_FEE()`, which is 0.01 BNB on mainnet. Always lock on the Portal, even when launching via VaultPortal (VaultPortal passes the caller through via `getSaltOwner()`). Only the locker can launch with that salt.
4. **Launch:** use `Portal.newTokenV6` (tax token, no vault) or `VaultPortal.newTokenV6WithVault` (tax token, vault created by a factory). Both are payable. `msg.value = quoteAmt` (the creator's first buy, or 0).

Older entry points (`newTokenV2`–`V5`, `newTaxTokenWithVault`) and Tax Token V1/V2 are **disabled** for new launches [CONFIRMED].

### 3.2 Fees

| Fee | Value | Status |
|---|---|---|
| Bonding curve trading fee | 1% on BNB Chain (curve phase only) | [CONFIRMED] protocol-economics |
| PreBond tax | Added on top: a 3% tax token pays 1% + 3% = 4% on curve trades | [CONFIRMED] pre-bond-tax |
| Tax token protocol rate | "Up to 0.3% of trade volume, regardless of the token's tax rate". The exact value is on-chain (`TaxProcessor.feeConfig()/feeConfigV2()`, `feeReceiver`). | [CONFIRMED] upper bound; exact value [UNVERIFIED] |
| Commission (optional, ours) | `commissionBps = taxBps<=100 ? 600 : floor(60000/taxBps)` of the post-fee remainder | [CONFIRMED] |
| Salt lock | 0.01 BNB | [CONFIRMED] |
| Launch fee | None documented beyond `quoteAmt` | [UNVERIFIED]: check `newTokenV6` on a fork |
| VaultPortal factory audit (optional, for the low-risk badge) | 600 USDT via `VaultPortal.payAudit(orderId)` | [CONFIRMED] |

A third-party report (AICoin) claims a 90:10 tax split to Flap through a "TaxSpliter". This is **[UNVERIFIED]** and probably refers to older Tax V1/V2 tokens. Measure the real vault share on a fork test.

### 3.3 Solidity interfaces (trimmed from official `IPortal.sol` / `IVaultPortal.sol`) [CONFIRMED]

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

address constant MAGIC_DIVIDEND_SELF     = 0xfEEDFEEDfeEDFEedFEEdFEEDFeEdfEEdFeEdFEEd;
address constant MAGIC_DIVIDEND_COMPUTED = 0xC0Dec0dec0DeC0Dec0dEc0DEC0DEC0DEC0DEC0dE;

interface IFlapPortalTypes {
    enum DexThreshType { TWO_THIRDS, FOUR_FIFTHS, HALF, _95_PERCENT, _81_PERCENT, _1_PERCENT } // only FOUR_FIFTHS (1) accepted
    enum TokenVersion {
        TOKEN_LEGACY_MINT_NO_PERMIT, TOKEN_LEGACY_MINT_NO_PERMIT_DUPLICATE, TOKEN_V2_PERMIT, TOKEN_GOPLUS,
        TOKEN_TAXED, TOKEN_TAXED_V2, TOKEN_TAXED_V3 /*6*/, TOKEN_V3_PERMIT /*7*/
    }
    enum TokenStatus { Invalid, Tradable, InDuel, Killed, DEX, Staged }          // 1 = on curve, 4 = on DEX
    enum MigratorType { V3_MIGRATOR, V2_MIGRATOR, V4_UNI_MIGRATOR, PCS_INFINITY_CL_MIGRATOR } // tax tokens: V2 (1)
    enum V3LPFeeProfile { LP_FEE_PROFILE_STANDARD, LP_FEE_PROFILE_LOW, LP_FEE_PROFILE_HIGH }
    enum DEXId { DEX0, DEX1, DEX2 }                                               // BSC: DEX0 = PancakeSwap

    struct NewTokenV6Params {
        string name; string symbol; string meta;
        DexThreshType dexThresh; bytes32 salt; MigratorType migratorType;
        address quoteToken; uint256 quoteAmt; address beneficiary;
        bytes permitData; bytes32 extensionID; bytes extensionData;
        DEXId dexId; V3LPFeeProfile lpFeeProfile;
        uint16 buyTaxRate; uint16 sellTaxRate;      // bps, 100..1000
        uint64 taxDuration; uint64 antiFarmerDuration; // antiFarmer <= 365 days
        uint16 mktBps; uint16 deflationBps; uint16 dividendBps; uint16 lpBps; // sum == 10000
        uint256 minimumShareBalance;                // >= 10_000e18 if dividendBps > 0
        address dividendToken;
        address commissionReceiver;                 // 0 = disabled
        TokenVersion tokenVersion;                  // TOKEN_TAXED_V3
    }

    struct ExactInputParams {
        address inputToken;   // address(0) = native
        address outputToken;  // address(0) = native
        uint256 inputAmount;
        uint256 minOutputAmount;
        bytes permitData;
    }
    struct QuoteExactInputParams { address inputToken; address outputToken; uint256 inputAmount; }

    struct TokenStateV8Safe {
        uint8 status; uint256 reserve; uint256 circulatingSupply; uint256 price; uint8 tokenVersion;
        uint256 r; uint256 h; uint256 k; uint256 dexSupplyThresh; address quoteTokenAddress;
        bool nativeToQuoteSwapEnabled; bytes32 extensionID; uint256 buyTaxRate; uint256 sellTaxRate;
        address pool; uint256 progress; uint8 lpFeeProfile; uint8 dexId;
    }
}

interface IFlapPortal is IFlapPortalTypes {
    // launch
    function newTokenV6(NewTokenV6Params calldata params) external payable returns (address token);
    function lockSalt(bytes32 salt, TokenVersion tokenVersion) external payable;
    function SALT_LOCK_FEE() external view returns (uint256);       // [CONFIRMED in docs text]
    // trade: works on the curve AND after DEX listing (per IPortal NatSpec)
    function swapExactInput(ExactInputParams calldata params) external payable returns (uint256 outputAmount);
    function quoteExactInput(QuoteExactInputParams calldata params) external returns (uint256 outputAmount); // non-view; use eth_call
    // legacy curve-only helpers (still in the interface)
    function buy(address token, address recipient, uint256 minAmount) external payable returns (uint256 amount);
    function sell(address token, uint256 amount, uint256 minEth) external returns (uint256 eth);
    function previewBuy(address token, uint256 eth) external view returns (uint256 amount);
    function previewSell(address token, uint256 amount) external view returns (uint256 eth);
    // lens
    function getTokenV8Safe(address token) external view returns (TokenStateV8Safe memory state);
    function getFeeRate() external view returns (uint256 buyFeeRate, uint256 sellFeeRate);
    function version() external view returns (string memory);
    function enableTaxOnBondingCurve() external view returns (bool);

    // events (fields NOT indexed unless noted)
    event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta);
    event TokenCurveSetV2(address token, uint256 r, uint256 h, uint256 k);
    event TokenDexSupplyThreshSet(address token, uint256 dexSupplyThresh);
    event TokenQuoteSet(address token, address quoteToken);
    event TokenMigratorSet(address token, MigratorType migratorType);
    event TokenDexPreferenceSet(address token, DEXId dexId, V3LPFeeProfile lpFeeProfile);
    event TokenVersionSet(address token, TokenVersion version);
    event FlapTokenTaxSet(address token, uint256 tax);
    event FlapTokenAsymmetricTaxSet(address token, uint256 buyTax, uint256 sellTax);
    event TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice);
    event TokenSold(uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice);
    event FlapTokenCirculatingSupplyChanged(address token, uint256 newSupply);
    event FlapTokenProgressChanged(address token, uint256 newProgress);       // 1e18 = 100%
    event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth); // graduation
    event TaxTokenAddressesUpdated(address indexed token, address beneficiary, address feeReceiver); // admin re-route! monitor this
    event FlapSaltLocked(address locker, bytes32 salt, address tokenAddress, uint8 tokenVersion, uint256 ts);
}

interface IFlapVaultPortal is IFlapPortalTypes {
    // NewTokenV6WithVaultParams = NewTokenV6Params - beneficiary + { address vaultFactory; bytes vaultData; }
    // Field order: copy the exact struct from FlapVaultExample/src/flap/IVaultPortal.sol (do not hand-order).
    struct VaultInfo { address vault; address vaultFactory; string description; bool isOfficial; uint8 riskLevel; }
    function tryGetVault(address taxToken) external view returns (bool found, VaultInfo memory info);
    function getVault(address taxToken) external view returns (VaultInfo memory info);
    event FlapTaxVaultTokenCreated(address indexed token, address indexed vault, address indexed vaultFactory);
    event FlapTaxVaultFactoryRegistered(address factory, bool enabled, bool official, uint8 riskLevel);
    event TokenVaultRefreshed(address indexed token, address indexed oldVault, address indexed newVault);
}

interface IFlapTaxTokenV3 {
    enum PoolState { BondingCurve, Migrating, TaxEnforcedAntiFarmer, TaxEnforced, TaxFree }
    function taxRate() external view returns (uint16);          // max(buy, sell)
    function buyTaxRate() external view returns (uint16);
    function sellTaxRate() external view returns (uint16);
    function taxProcessor() external view returns (address);
    function dividendContract() external view returns (address);
    function mainPool() external view returns (address);
    function state() external view returns (PoolState);
    function liquidationThreshold() external view returns (uint256);
    event PoolStateChanged(uint8 fromState, uint8 toState);
}

interface IFlapTaxProcessor {
    function dispatch() external;                      // pushes fee / commission / market(vault) / dividend balances
    function marketAddress() external view returns (address);   // == our vault
    function feeReceiver() external view returns (address);
    function commissionReceiver() external view returns (address);
    function commissionBps() external view returns (uint16);
    function marketQuoteBalance() external view returns (uint256); // pending for vault
    function totalQuoteSentToMarketing() external view returns (uint256);
    function requiresMEVProtection() external view returns (bool);
}
```

---

## 4. Tax mechanics [CONFIRMED unless marked]

- **Range:** `buyTaxRate` and `sellTaxRate` are each 100–1000 bps. GachaForge uses a **fixed 200 bps (2%) buy and sell** for every token; the creator no longer chooses. The flap.sh UI only offers 1/3/5/10%, but the contract accepts 200 [CONFIRMED on fork; whether 2% displays correctly on flap.sh is UNVERIFIED].
- **Split of the post-protocol-fee tax:** `mktBps` goes to the beneficiary or vault. `deflationBps` is burned. `dividendBps` goes to the Dividend contract. `lpBps` becomes LP sent to dead. **For GachaForge: `mktBps=10000`, others 0.** With `dividendBps=0` a Dividend contract is still deployed, in tracker-only mode.
- **Currency:** the vault receives the **quote token**. With `quoteToken = address(0)` that is native BNB.
  - **On the curve:** the tax is an extra fee in BNB, handed to the TaxProcessor (`processBondingCurveTax(quoteAmount)`).
  - **On the DEX:** the tax is taken in tokens on main-pool transfers. Tokens accumulate in the token contract until `liquidationThreshold()`, are sold on PancakeSwap for BNB, and the threshold then moves ±1% after each liquidation.
  - In both phases, `TaxProcessor.dispatch()` pushes balances out. It is permissionless [UNVERIFIED that anyone may call it, but the docs say "Call processor.dispatch()" with no role]. **Our keeper should call `dispatch()` periodically**, as the pot only updates when revenue lands.
- **Commission** accrues on curve buys and on DEX buys and sells. The docs do not say whether curve *sells* pay tax to the vault: PreBond says the tax is added to the curve fee for trading generally [UNVERIFIED for sells, so test on a fork].
- **Pool states:** `BondingCurve → Migrating → TaxEnforcedAntiFarmer → TaxEnforced → TaxFree`. During the anti-farmer window, tax applies to any pool transfer. After it, tax applies to main-pool transfers only, so **trades through other pools (e.g. a V3 pool someone creates) are untaxed** [CONFIRMED by enum comment].
- **Duration:** `taxDuration` is in seconds. After it, the token goes `TaxFree`. For "locked forever", pass the maximum allowed. The V5 doc comment says max 100 years; the V6 maximum is [UNVERIFIED], so probe it on a fork.
- **Mutability:**
  - Rates: no setter in the published interfaces [UNVERIFIED in the implementation].
  - Recipient: **mutable by Flap admin** via `updateTaxTokenAddresses` (emits `TaxTokenAddressesUpdated`). VaultPortal's AUDITOR_ROLE can `refreshTokenVault` its record to match. Disclose this trust assumption to users.

## 5. Bonding curve, graduation, DEX

- Supply is 1,000,000,000 tokens (18 decimals). Constant product `(x+h)(y+r)=K`, with `x` = tokens in the curve and `y` = quote reserve [CONFIRMED]. Read `r,h,k` per token from `TokenCurveSetV2` or `getTokenV8Safe` and don't hardcode them. The docs table for latest BSC/BNB shows roughly r≈6.14 BNB, h≈107,036,752, K≈6,797,205,657 (the table renders garbled, so treat these as approximate).
- **Graduation:** at 80% of supply sold (`dexThresh = FOUR_FIFTHS`, the only accepted value). The remaining supply plus the curve reserve go into a **PancakeSwap V2** pair (`migratorType = 1`, `dexId = 0`). Emits `LaunchedToDEX(token, pool, amount, eth)`. `getTokenV8Safe.status` becomes 4 and `.pool` is the pair.
- **[DERIVED]** With the constants above, the reserve at graduation is `K/(2e8+h) − r ≈ 22.14 − 6.14 ≈ 16 BNB` raised on the curve, before fees. Verify on-chain.
- **Programmatic buy and sell (for $FORGE buyback & burn):** `Portal.swapExactInput{value: bnb}({inputToken: address(0), outputToken: FORGE, inputAmount: bnb, minOutputAmount: q, permitData: ""})`. Per the NatSpec this works both on the curve and after DEX listing. Quote first with `quoteExactInput` via `eth_call` (it is non-view), then send the bought tokens to `0x...dEaD`.
  - Buyback is sandwichable, so make it keeper-only with `minOutputAmount`. Flap requires the Guardian to share any such role if you want the low-risk badge.
  - Or use **FlapVaultEx** (`requestSwap`, async off-chain routed, 0.5% fee, callback `onFlapVaultExSettled`). FlapVaultEx rejects fee-on-transfer tokens, so it cannot buy a *tax* token. If $FORGE is itself a flap tax token, use `Portal.swapExactInput`.
- **Agent ID gate:** not needed. Leave `extensionID = 0`.

## 6. Indexer events (Portal + VaultPortal) [CONFIRMED: build-an-indexer]

| Purpose | Event | Contract |
|---|---|---|
| New token | `TokenCreated` (+ `TokenCurveSetV2`, `TokenQuoteSet`, `TokenMigratorSet`, `TokenDexPreferenceSet`, `TokenVersionSet`, `FlapTokenTaxSet`, `FlapTokenAsymmetricTaxSet` in the same tx) | Portal |
| Vault link | `FlapTaxVaultTokenCreated(token indexed, vault indexed, vaultFactory indexed)` | VaultPortal |
| Curve trades | `TokenBought` / `TokenSold` (`eth` = quote, `fee` = fee incl. tax) | Portal |
| Progress | `FlapTokenProgressChanged` (1e18 = 100%), `FlapTokenCirculatingSupplyChanged` | Portal |
| Graduation | `LaunchedToDEX(token, pool, amount, eth)` | Portal |
| DEX trades | PancakeSwap V2 pair `Swap` events on `getTokenV8Safe.pool` / `IFlapTaxTokenV3.mainPool()` | Pair |
| Token state | `PoolStateChanged`, `TokensBurned`, `TaxLiquidationError` | Token |
| Recipient re-route (alert!) | `TaxTokenAddressesUpdated`, `TokenVaultRefreshed` | Portal / VaultPortal |
| Tax revenue in | Our own vault event, e.g. `TaxReceived(amount)` emitted in `receive()` | GachaForge vault |

Reads: `Portal.getTokenV8Safe(token)`, `TaxTokenHelper.getTaxTokenInfoV2(token)` (split, cumulative `totalQuoteSentToMarketing`, vault info), `VaultPortal.tryGetVault(token)`.

**Holder-eligibility exclusions** (SPEC): the Portal, VaultPortal, the V2 pair, the token itself, `taxProcessor()`, `dividendContract()`, the vault, `flapBlackHole()` (from TaxProcessor), the PancakeSwap router, and `0x...dEaD`.

## 7. SDK / API

- **No official npm SDK found.** The official materials are the Solidity interfaces in `flap-sh/FlapVaultExample/src/flap` (use them as the ABI source: compile them or copy the JSON ABIs from BscScan), `flap-sh/flap-skills` (agent skills), and `flap-sh/flap-vault-component-template` (vault UI on flap.sh).
- **Upload API:** `https://funcs.flap.sh/api/upload` [CONFIRMED]. IPFS gateway: `https://flap.mypinata.cloud/ipfs/`.
- Flap also documents a Shared Indexer (FSI) under Flap Infrastructures. We did not read it, so it is [UNVERIFIED] whether it is public or free.
- Third-party options: Bitquery flap.sh GraphQL API (https://docs.bitquery.io/docs/blockchain/BSC/flap-sh/), and the unofficial npm `four-flap-meme-sdk`. Do not depend on either for contracts.

## 8. Vault / partner program [CONFIRMED: build-on-bonding-curve]

- **VaultPortal is permissionless:** any factory implementing `IVaultFactory` can be used. Unregistered factories show as **UNVERIFIED** (risk warning on the Flap UI).
- Low-risk badge requirements:
  - The factory follows the spec (`VaultFactoryBaseV2`, `factorySpecVersion() = "v2.4"`).
  - Vaults sit behind an **UpgradeableBeacon whose only upgrader is the Flap Guardian** (`upgradeVaultImplementation`, `lockVaultUpgrades`).
  - The Guardian shares any permissioned role.
  - Fork tests pass (curve buy → dispatch reaches vault; post-migration sell → dispatch reaches vault).
  - Audit fee 600 USDT via `VaultPortal.payAudit(orderId)`. Contact the Flap team to start.
- Vault spec (`VaultBaseV3`):
  - `receive()` must be light, never revert, and use balance-delta accounting (`accountedQuote`).
  - Provide a permissionless `sync()`.
  - `vaultQuoteToken()` is immutable and equals the token's quote.
  - `description()` must state any commission. The recommended commission is `taxBps<=100 ? 6% : 6/taxBps` of revenue.
  - `vaultUISchema()` describes the generic UI.
  - Factory `newVault(taxToken, quoteToken, creator, vaultData)` is callable **only by VaultPortal**. `taxToken` is the predicted address with no code yet, so never call it. `isQuoteTokenSupported` must be truthful, and `_validateBeforeLaunch(LaunchValidationDataV1)` is checked via staticcall.
- **Commission receiver:** this is Flap's integrator revenue share. Set it to the GachaForge treasury only if we want an extra platform cut *outside* the vault. Otherwise use `address(0)`, so that everything after the protocol fee goes to the vault.

---

## 9. Recommended integration design

### Option A (recommended): our own `GachaVaultFactory` + `VaultPortal.newTokenV6WithVault`

How it works:

- One tx creates the token and its vault. flap.sh shows our vault on `/bnb/{token}/taxinfo`, and the indexer gets `FlapTaxVaultTokenCreated`.
- The factory enforces our rules on-chain via `_validateBeforeLaunch`: `buyTaxRate == sellTaxRate ∈ [100,1000]`, `buyTaxRate % 100 == 0`, `vaultBps == 10000`, other bps 0, `quoteToken == address(0)`, `tokenVersion == 6`.
- Any launch through our factory, even one that bypasses our UI, therefore satisfies SPEC.

Trade-off: the low-risk badge requires Flap Guardian upgradeability of our vaults. This conflicts somewhat with "locked forever", but Guardian-only upgrades can later be frozen by `lockVaultUpgrades()`. Without the badge, the vault works but the token shows as UNVERIFIED.

### Option B (fallback): `Portal.newTokenV6` with `beneficiary = predicted vault`

1. Pick a salt and predict the token address.
2. Deploy our vault with CREATE2 (any deployer we control) bound to that predicted token.
3. Call `newTokenV6` with `beneficiary = vault`, `mktBps = 10000`.

This is simpler and needs no VaultPortal rules, but the flap.sh UI does not treat it as a vault (`isVault=false`), and nothing on-chain stops a creator from launching a non-conforming token outside our launcher.

### Adapter interface (our side)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// GachaForge-side abstraction so the rest of our contracts never touch flap types directly.
interface IFlapLauncher {
    struct LaunchParams {
        string name;
        string symbol;
        string metaCid;        // from funcs.flap.sh/api/upload
        bytes32 salt;          // pre-mined so the token address ends in 7777 (Portal + TaxTokenV3 impl)
        uint16 taxBps;         // must be 200 (fixed 2%); used for both buy and sell
        uint256 creatorBuyWei; // msg.value forwarded as quoteAmt
    }

    event MachineLaunched(address indexed token, address indexed vault, address indexed creator, uint16 taxBps);

    /// Calls VaultPortal.newTokenV6WithVault with:
    ///  dexThresh=1, migratorType=1 (V2), dexId=0, lpFeeProfile=0, quoteToken=address(0),
    ///  buyTaxRate=sellTaxRate=200, taxDuration=MAX_ALLOWED, antiFarmerDuration=X,
    ///  mktBps=10000, deflationBps=dividendBps=lpBps=0, minimumShareBalance=0,
    ///  dividendToken=address(0), commissionReceiver=address(0) (or treasury, see §8),
    ///  tokenVersion=6, vaultFactory=GACHA_VAULT_FACTORY, vaultData=abi.encode(creator, config...).
    /// Forwards the creator's first-buy tokens (VaultPortal sends them to msg.sender = this launcher) to `creator`.
    function launch(LaunchParams calldata p) external payable returns (address token, address vault);

    /// Predict the token address for a salt (CREATE2 from Portal, EIP-1167 clone of TaxTokenV3 impl).
    function predictToken(bytes32 salt) external view returns (address);

    /// Thin trading wrappers over Portal.swapExactInput (works pre- and post-graduation).
    function buy(address token, uint256 minOut, address to) external payable returns (uint256 out);
    function quoteBuy(address token, uint256 bnbIn) external returns (uint256 out); // eth_call only

    /// 1 = bonding curve, 4 = DEX (from Portal.getTokenV8Safe), plus pool and progress.
    function status(address token) external view returns (uint8 status, address pool, uint256 progress);

    /// Permissionless poke: ITaxProcessor(IFlapTaxTokenV3(token).taxProcessor()).dispatch(); vault.sync();
    function flushTax(address token) external;
}
```

### `GachaVault` (one per token, created by `GachaVaultFactory`)

- Inherits `VaultBaseV3`. `vaultQuoteToken() = address(0)`.
- `receive()` runs `_sync()` only: `accountedQuote` delta, split 7/3/90 into internal buckets (`gachaPot`, `forgeBuyback`, `treasury`), emit `TaxReceived`. No external calls, so it never reverts.
- Separate keeper or Guardian functions:
  - `buyPack()`: Renaiss.
  - `buybackAndBurnForge(minOut)`: `Portal.swapExactInput` → transfer to dead.
  - `withdrawTreasury()`.
  - Every outflow decrements `accountedQuote` in the same tx.
- Permissionless `sync()`.
- `description()` states the 7/3/90 (pot/buyback/treasury) split and the protocol fee.
- Factory `newVault` deploys a `BeaconProxy` and stores `taxToken` (predicted). The vault must not call it during init.

### Fork tests to write before mainnet (these resolve the UNVERIFIED items)

1. Launch via VaultPortal on a BSC mainnet fork using `FlapBSCFixture.sol`.
2. A curve buy and a curve sell, then `dispatch()`. Measure vault BNB vs `TokenBought.fee` to get the real share after the protocol fee, and confirm that sells are taxed.
3. Push to 80% and assert `LaunchedToDEX`, PancakeSwap V2 pair, and the BNB reserve amount.
4. A DEX buy and sell, then liquidation and `dispatch()`. Vault receives BNB.
5. Find the max accepted `taxDuration`.
6. Confirm the curve buyback path for $FORGE via `swapExactInput`.
7. Confirm `newTokenV6WithVault` returns the creator's first-buy tokens to the caller (our launcher).
