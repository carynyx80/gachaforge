// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ILaunchpadRouter} from "./interfaces/ILaunchpadRouter.sol";
import {GachaTypes} from "./libraries/GachaTypes.sol";

/// @title BuybackBurner
/// @notice Accumulates the $FORGE buyback share (MachineVault.BUYBACK_BPS) from every MachineVault, buys $FORGE and burns it
///         (sends to the dead address). BNB can only leave this contract through a $FORGE buy.
/// @dev $FORGE may not exist at deploy time: deploy with forge = address(0). BNB then simply
///      accumulates (buybacks revert with ForgeUnset) until the admin (TimelockController) calls
///      setForge() once. The token address can never be changed after that.
contract BuybackBurner is AccessControl, ReentrancyGuardTransient {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    address public constant DEAD = GachaTypes.DEAD;

    IERC20 public forge; // zero until setForge() (one-shot, admin only)
    ILaunchpadRouter public router;

    uint256 public totalBnbReceived;
    uint256 public totalBnbSpent;
    uint256 public totalForgeBurned;

    event Received(address indexed from, uint256 amount);
    event Buyback(uint256 bnbSpent, uint256 forgeBought);
    event Burn(uint256 amount);
    event RouterUpdated(address router);
    event ForgeSet(address forge);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error Slippage();
    error ForgeUnset();
    error ForgeAlreadySet();

    constructor(address admin, address forge_, address router_) {
        if (admin == address(0) || router_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (forge_ != address(0)) {
            forge = IERC20(forge_);
            emit ForgeSet(forge_);
        }
        router = ILaunchpadRouter(router_);
    }

    /// @dev Router refunds during buybackAndBurn (guard entered) are not revenue.
    receive() external payable {
        if (_reentrancyGuardEntered()) return;
        totalBnbReceived += msg.value;
        emit Received(msg.sender, msg.value);
    }

    /// @notice Buy $FORGE with `bnbAmount` and burn everything bought.
    function buybackAndBurn(uint256 bnbAmount, uint256 minOut) external onlyRole(OPERATOR_ROLE) nonReentrant {
        if (address(forge) == address(0)) revert ForgeUnset();
        if (bnbAmount == 0) revert ZeroAmount();
        if (bnbAmount > address(this).balance) revert InsufficientBalance();
        uint256 before = forge.balanceOf(DEAD);
        uint256 bnbBefore = address(this).balance;
        router.buyTokens{value: bnbAmount}(address(forge), minOut, DEAD);
        uint256 bought = forge.balanceOf(DEAD) - before;
        if (bought < minOut) revert Slippage();
        uint256 spent = bnbBefore - address(this).balance; // net of refunds
        totalBnbSpent += spent;
        totalForgeBurned += bought;
        emit Buyback(spent, bought);
        emit Burn(bought);
    }

    /// @notice One-shot: set the $FORGE token once it exists (admin = TimelockController).
    function setForge(address forge_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (forge_ == address(0)) revert ZeroAddress();
        if (address(forge) != address(0)) revert ForgeAlreadySet();
        forge = IERC20(forge_);
        emit ForgeSet(forge_);
    }

    /// @notice Timelock can repoint the router adapter (e.g. $FORGE graduates to a new DEX).
    function setRouter(address router_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (router_ == address(0)) revert ZeroAddress();
        router = ILaunchpadRouter(router_);
        emit RouterUpdated(router_);
    }
}
