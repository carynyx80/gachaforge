// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILaunchpadRouter} from "../interfaces/ILaunchpadRouter.sol";
import {IFlapPortal, IFlapPortalTypes, IPancakeRouter02} from "./flap/IFlapPortal.sol";

/// @title FlapRouter
/// @notice ILaunchpadRouter adapter: buys via Portal.swapExactInput (bonding curve and, after
///         graduation, PancakeSwap V2 per flap NatSpec); LP via PancakeSwap V2 router.
contract FlapRouter is ILaunchpadRouter {
    using SafeERC20 for IERC20;

    uint8 internal constant STATUS_DEX = 4;

    IFlapPortal public immutable portal;
    IPancakeRouter02 public immutable pancakeRouter;

    error NotGraduated();
    error Slippage();
    error TransferFailed();

    constructor(address portal_, address pancakeRouter_) {
        portal = IFlapPortal(portal_);
        pancakeRouter = IPancakeRouter02(pancakeRouter_);
    }

    function isGraduated(address token) public view override returns (bool) {
        return portal.getTokenV8Safe(token).status == STATUS_DEX;
    }

    function buyTokens(address token, uint256 minOut, address recipient)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        IERC20 t = IERC20(token);
        uint256 before = t.balanceOf(address(this));
        portal.swapExactInput{value: msg.value}(
            IFlapPortalTypes.ExactInputParams({
                inputToken: address(0),
                outputToken: token,
                inputAmount: msg.value,
                minOutputAmount: minOut,
                permitData: ""
            })
        );
        uint256 got = t.balanceOf(address(this)) - before;
        uint256 rBefore = t.balanceOf(recipient);
        t.safeTransfer(recipient, got);
        amountOut = t.balanceOf(recipient) - rBefore; // net of any transfer tax
        if (amountOut < minOut) revert Slippage();
        _refundNative();
    }

    function addLiquidity(address token, uint256 tokenAmount, uint256 minToken, uint256 minBnb, address lpRecipient)
        external
        payable
        override
        returns (uint256 liquidity)
    {
        if (!isGraduated(token)) revert NotGraduated();
        IERC20 t = IERC20(token);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), tokenAmount);
        uint256 got = t.balanceOf(address(this)) - before;
        t.forceApprove(address(pancakeRouter), got);
        (,, liquidity) =
            pancakeRouter.addLiquidityETH{value: msg.value}(token, got, minToken, minBnb, lpRecipient, block.timestamp);
        t.forceApprove(address(pancakeRouter), 0);
        uint256 left = t.balanceOf(address(this)) - before;
        if (left > 0) t.safeTransfer(msg.sender, left);
        _refundNative();
    }

    function _refundNative() internal {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = msg.sender.call{value: bal}("");
            if (!ok) revert TransferFailed();
        }
    }

    receive() external payable {}
}
