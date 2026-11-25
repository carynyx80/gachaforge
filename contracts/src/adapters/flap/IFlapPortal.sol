// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Trimmed flap.sh interfaces, transcribed from docs/flap-integration.md
///         (source: github.com/flap-sh/FlapVaultExample src/flap/IPortal.sol, IVaultPortal.sol).
/// @dev VERIFIED 2026-11-25: field order diffed against the official FlapVaultExample sources
///      (IPortal.sol, IVaultPortal.sol), selectors 8cb5772c / ef7ec2e7 / 62fafcca / 1b806220 found
///      in the deployed Portal (v5.27.2) and VaultPortal implementations, and newTokenV6,
///      newTokenV6WithVault, swapExactInput and getTokenV8Safe exercised on a BSC mainnet fork
///      (test/fork/FlapMainnetFork.t.sol).
interface IFlapPortalTypes {
    enum DexThreshType {
        TWO_THIRDS,
        FOUR_FIFTHS,
        HALF,
        _95_PERCENT,
        _81_PERCENT,
        _1_PERCENT
    }

    enum TokenVersion {
        TOKEN_LEGACY_MINT_NO_PERMIT,
        TOKEN_LEGACY_MINT_NO_PERMIT_DUPLICATE,
        TOKEN_V2_PERMIT,
        TOKEN_GOPLUS,
        TOKEN_TAXED,
        TOKEN_TAXED_V2,
        TOKEN_TAXED_V3,
        TOKEN_V3_PERMIT
    }

    enum MigratorType {
        V3_MIGRATOR,
        V2_MIGRATOR,
        V4_UNI_MIGRATOR,
        PCS_INFINITY_CL_MIGRATOR
    }

    enum V3LPFeeProfile {
        LP_FEE_PROFILE_STANDARD,
        LP_FEE_PROFILE_LOW,
        LP_FEE_PROFILE_HIGH
    }

    enum DEXId {
        DEX0,
        DEX1,
        DEX2
    }

    struct NewTokenV6Params {
        string name;
        string symbol;
        string meta;
        DexThreshType dexThresh;
        bytes32 salt;
        MigratorType migratorType;
        address quoteToken;
        uint256 quoteAmt;
        address beneficiary;
        bytes permitData;
        bytes32 extensionID;
        bytes extensionData;
        DEXId dexId;
        V3LPFeeProfile lpFeeProfile;
        uint16 buyTaxRate;
        uint16 sellTaxRate;
        uint64 taxDuration;
        uint64 antiFarmerDuration;
        uint16 mktBps;
        uint16 deflationBps;
        uint16 dividendBps;
        uint16 lpBps;
        uint256 minimumShareBalance;
        address dividendToken;
        address commissionReceiver;
        TokenVersion tokenVersion;
    }

    /// @dev Matches FlapVaultExample/src/flap/IVaultPortal.sol exactly (verified + fork-tested).
    struct NewTokenV6WithVaultParams {
        string name;
        string symbol;
        string meta;
        DexThreshType dexThresh;
        bytes32 salt;
        MigratorType migratorType;
        address quoteToken;
        uint256 quoteAmt;
        bytes permitData;
        bytes32 extensionID;
        bytes extensionData;
        DEXId dexId;
        V3LPFeeProfile lpFeeProfile;
        uint16 buyTaxRate;
        uint16 sellTaxRate;
        uint64 taxDuration;
        uint64 antiFarmerDuration;
        uint16 mktBps;
        uint16 deflationBps;
        uint16 dividendBps;
        uint16 lpBps;
        uint256 minimumShareBalance;
        address dividendToken;
        address commissionReceiver;
        TokenVersion tokenVersion;
        address vaultFactory;
        bytes vaultData;
    }

    struct ExactInputParams {
        address inputToken; // address(0) = native
        address outputToken; // address(0) = native
        uint256 inputAmount;
        uint256 minOutputAmount;
        bytes permitData;
    }

    struct TokenStateV8Safe {
        uint8 status; // 1 = curve, 4 = DEX
        uint256 reserve;
        uint256 circulatingSupply;
        uint256 price;
        uint8 tokenVersion;
        uint256 r;
        uint256 h;
        uint256 k;
        uint256 dexSupplyThresh;
        address quoteTokenAddress;
        bool nativeToQuoteSwapEnabled;
        bytes32 extensionID;
        uint256 buyTaxRate;
        uint256 sellTaxRate;
        address pool;
        uint256 progress;
        uint8 lpFeeProfile;
        uint8 dexId;
    }
}

interface IFlapPortal is IFlapPortalTypes {
    function newTokenV6(NewTokenV6Params calldata params) external payable returns (address token);
    function swapExactInput(ExactInputParams calldata params) external payable returns (uint256 outputAmount);
    function getTokenV8Safe(address token) external view returns (TokenStateV8Safe memory state);
}

interface IFlapVaultPortal is IFlapPortalTypes {
    function newTokenV6WithVault(NewTokenV6WithVaultParams calldata params) external payable returns (address token);
}

interface IFlapTaxTokenV3 {
    function taxProcessor() external view returns (address);
}

interface IFlapTaxProcessor {
    function dispatch() external;
}

interface IPancakeRouter02 {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}
