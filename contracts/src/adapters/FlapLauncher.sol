// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFlapLauncher} from "../interfaces/IFlapLauncher.sol";
import {IGachaForgeFactory} from "../interfaces/IGachaForgeFactory.sol";
import {IFlapPortal, IFlapVaultPortal, IFlapPortalTypes, IFlapTaxTokenV3, IFlapTaxProcessor} from "./flap/IFlapPortal.sol";

/// @title FlapLauncher
/// @notice IFlapLauncher adapter for flap.sh. Two modes:
///   - VaultPortal (preferred): VaultPortal.newTokenV6WithVault with this adapter as the vault
///     factory; VaultPortal calls newVault(), which makes GachaForgeFactory deploy the vault.
///   - Portal (fallback): Portal.newTokenV6 with beneficiary = predicted vault address.
///   Both: buyTax == sellTax == taxBps, mktBps = 10000 (100% to the vault), quote = native BNB,
///   commission receiver = 0, Tax Token V3, PancakeSwap V2 migrator. The salt must be pre-mined
///   off-chain so the Portal CREATE2 clone address ends in 0x7777.
contract FlapLauncher is IFlapLauncher {
    using SafeERC20 for IERC20;

    IFlapPortal public immutable portal;
    IFlapVaultPortal public immutable vaultPortal; // zero => Portal mode
    address public immutable taxTokenImpl;
    uint64 public immutable taxDuration;
    uint64 public immutable antiFarmerDuration;
    address public immutable deployer;
    IGachaForgeFactory public factory;

    // in-flight launch (VaultPortal callback guard)
    address internal _expectedToken;
    address internal _expectedVault;

    error NotFactory();
    error NotVaultPortal();
    error AlreadySet();
    error BadVanity(address predicted);
    error UnexpectedToken();
    error VaultMismatch();
    error UnsupportedQuote();
    error TransferFailed();

    constructor(
        address portal_,
        address vaultPortal_,
        address taxTokenImpl_,
        uint64 taxDuration_,
        uint64 antiFarmerDuration_
    ) {
        portal = IFlapPortal(portal_);
        vaultPortal = IFlapVaultPortal(vaultPortal_);
        taxTokenImpl = taxTokenImpl_;
        taxDuration = taxDuration_;
        antiFarmerDuration = antiFarmerDuration_;
        deployer = msg.sender;
    }

    /// @notice One-shot wiring (factory needs this adapter's address in its constructor).
    function setFactory(address f) external {
        if (msg.sender != deployer || address(factory) != address(0)) revert AlreadySet();
        factory = IGachaForgeFactory(f);
    }

    /// @notice CREATE2 address of the EIP-1167 clone the Portal deploys for `salt`.
    function predictToken(bytes32 salt) public view returns (address) {
        bytes memory initCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", taxTokenImpl, hex"5af43d82803e903d91602b57fd5bf3"
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(portal), salt, keccak256(initCode)))))
        );
    }

    function createToken(TokenParams calldata p) external payable override returns (address token) {
        if (msg.sender != address(factory)) revert NotFactory();
        address predicted = predictToken(p.salt);
        if (uint160(predicted) & 0xFFFF != 0x7777) revert BadVanity(predicted);

        if (address(vaultPortal) != address(0)) {
            _expectedToken = predicted;
            _expectedVault = p.taxReceiver;
            token = vaultPortal.newTokenV6WithVault{value: msg.value}(_vaultParams(p));
            delete _expectedToken;
            delete _expectedVault;
        } else {
            token = portal.newTokenV6{value: msg.value}(_portalParams(p));
        }
        if (token != predicted) revert UnexpectedToken();

        // creator's first-buy tokens land on this adapter (caller of the portal): forward them
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(p.creator, bal);
        if (address(this).balance > 0) {
            (bool ok,) = p.creator.call{value: address(this).balance}("");
            if (!ok) revert TransferFailed();
        }
    }

    // ------------------------------------------------------------ VaultPortal vault-factory hooks
    // UNVERIFIED: exact IVaultFactory signature / extra hooks (factorySpecVersion,
    // _validateBeforeLaunch) must be matched to FlapVaultExample/src/flap/IVaultFactory.sol.

    function newVault(address taxToken, address quoteToken, address, bytes calldata)
        external
        returns (address vault)
    {
        if (msg.sender != address(vaultPortal)) revert NotVaultPortal();
        if (taxToken != _expectedToken || taxToken == address(0)) revert UnexpectedToken();
        if (quoteToken != address(0)) revert UnsupportedQuote();
        vault = factory.deployPendingVault(taxToken);
        if (vault != _expectedVault) revert VaultMismatch();
    }

    function isQuoteTokenSupported(address quoteToken) external pure returns (bool) {
        return quoteToken == address(0);
    }

    // ------------------------------------------------------------ keeper helper

    /// @notice Permissionless: push pending tax from the flap TaxProcessor to the vault.
    function flushTax(address token) external {
        IFlapTaxProcessor(IFlapTaxTokenV3(token).taxProcessor()).dispatch();
    }

    // ------------------------------------------------------------ param builders

    function _portalParams(TokenParams calldata p) internal view returns (IFlapPortalTypes.NewTokenV6Params memory q) {
        q.name = p.name;
        q.symbol = p.symbol;
        q.meta = p.meta;
        q.dexThresh = IFlapPortalTypes.DexThreshType.FOUR_FIFTHS;
        q.salt = p.salt;
        q.migratorType = IFlapPortalTypes.MigratorType.V2_MIGRATOR;
        q.quoteToken = address(0);
        q.quoteAmt = msg.value;
        q.beneficiary = p.taxReceiver;
        q.dexId = IFlapPortalTypes.DEXId.DEX0;
        q.lpFeeProfile = IFlapPortalTypes.V3LPFeeProfile.LP_FEE_PROFILE_STANDARD;
        q.buyTaxRate = p.taxBps;
        q.sellTaxRate = p.taxBps;
        q.taxDuration = taxDuration;
        q.antiFarmerDuration = antiFarmerDuration;
        q.mktBps = 10_000;
        q.commissionReceiver = address(0);
        q.tokenVersion = IFlapPortalTypes.TokenVersion.TOKEN_TAXED_V3;
    }

    function _vaultParams(TokenParams calldata p)
        internal
        view
        returns (IFlapPortalTypes.NewTokenV6WithVaultParams memory q)
    {
        q.name = p.name;
        q.symbol = p.symbol;
        q.meta = p.meta;
        q.dexThresh = IFlapPortalTypes.DexThreshType.FOUR_FIFTHS;
        q.salt = p.salt;
        q.migratorType = IFlapPortalTypes.MigratorType.V2_MIGRATOR;
        q.quoteToken = address(0);
        q.quoteAmt = msg.value;
        q.dexId = IFlapPortalTypes.DEXId.DEX0;
        q.lpFeeProfile = IFlapPortalTypes.V3LPFeeProfile.LP_FEE_PROFILE_STANDARD;
        q.buyTaxRate = p.taxBps;
        q.sellTaxRate = p.taxBps;
        q.taxDuration = taxDuration;
        q.antiFarmerDuration = antiFarmerDuration;
        q.mktBps = 10_000;
        q.commissionReceiver = address(0);
        q.tokenVersion = IFlapPortalTypes.TokenVersion.TOKEN_TAXED_V3;
        q.vaultFactory = address(this);
        q.vaultData = abi.encode(p.creator, p.taxReceiver);
    }

    receive() external payable {}
}
