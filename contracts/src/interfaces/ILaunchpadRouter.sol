// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILaunchpadRouter
/// @notice Adapter boundary for trading a token: flap.sh bonding curve pre-graduation,
///         PancakeSwap (or whatever DEX flap.sh migrates to) after graduation.
interface ILaunchpadRouter {
    /// @notice True once the token has left the bonding curve and has a DEX pool.
    function isGraduated(address token) external view returns (bool);

    /// @notice Buy `token` with msg.value BNB, sending output to `recipient`.
    /// @return amountOut tokens delivered to recipient (adapter-reported)
    function buyTokens(address token, uint256 minOut, address recipient)
        external
        payable
        returns (uint256 amountOut);

    /// @notice Add `tokenAmount` (pulled from msg.sender via allowance) + msg.value BNB as liquidity.
    ///         LP tokens are sent to `lpRecipient` (vaults pass the dead address => locked forever).
    ///         Unused BNB / tokens are refunded to msg.sender.
    /// @dev Only valid post-graduation.
    function addLiquidity(address token, uint256 tokenAmount, uint256 minToken, uint256 minBnb, address lpRecipient)
        external
        payable
        returns (uint256 liquidity);
}
