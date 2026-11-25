// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";
import {ILaunchpadRouter} from "./ILaunchpadRouter.sol";
import {GachaTypes} from "../libraries/GachaTypes.sol";

/// @notice Surface of the factory that vaults depend on (roles, pause, operational config).
interface IGachaForgeFactory {
    function OPERATOR_ROLE() external view returns (bytes32);
    function hasRole(bytes32 role, address account) external view returns (bool);
    function paused() external view returns (bool);

    function priceFeed() external view returns (AggregatorV3Interface);
    function maxPriceAge() external view returns (uint256);
    function router() external view returns (ILaunchpadRouter);
    function paymentReceiver() external view returns (address);
    function pullCooldown() external view returns (uint256);

    /// @notice Config of the vault currently being deployed (read by the vault constructor).
    function launchContext() external view returns (GachaTypes.VaultConfig memory);

    /// @notice Launcher-adapter callback: deploy the pending vault for `token` (VaultPortal flow).
    function deployPendingVault(address token) external returns (address vault);
}
