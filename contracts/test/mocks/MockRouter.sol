// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILaunchpadRouter} from "../../src/interfaces/ILaunchpadRouter.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Fixed-rate mock of curve + DEX. buyTokens mints `rate` tokens per BNB.
///         Optional refunds emulate curve fill-to-cap and addLiquidity ratio refunds.
contract MockRouter is ILaunchpadRouter {
    uint256 public rate = 1_000_000; // tokens (1e18) per 1 BNB
    uint256 public buyRefundBps; // portion of buy BNB refunded to caller
    uint256 public lpTokenUseBps = 10_000; // portion of offered tokens the pool absorbs
    mapping(address => bool) public graduated;
    MockERC20 public immutable lp;

    constructor() {
        lp = new MockERC20("Mock LP", "MLP");
    }

    function setGraduated(address t, bool g) external {
        graduated[t] = g;
    }

    function setRate(uint256 r) external {
        rate = r;
    }

    function setBuyRefundBps(uint256 b) external {
        buyRefundBps = b;
    }

    function setLpTokenUseBps(uint256 b) external {
        lpTokenUseBps = b;
    }

    function isGraduated(address t) external view override returns (bool) {
        return graduated[t];
    }

    function buyTokens(address token, uint256 minOut, address recipient)
        external
        payable
        override
        returns (uint256 out)
    {
        uint256 refund = (msg.value * buyRefundBps) / 10_000;
        uint256 used = msg.value - refund;
        out = used * rate;
        require(out >= minOut, "MockRouter: slippage");
        MockERC20(token).mint(recipient, out);
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refund");
        }
    }

    function addLiquidity(address token, uint256 tokenAmount, uint256 minToken, uint256 minBnb, address lpRecipient)
        external
        payable
        override
        returns (uint256 liquidity)
    {
        require(graduated[token], "MockRouter: not graduated");
        uint256 useTok = (tokenAmount * lpTokenUseBps) / 10_000;
        require(useTok >= minToken && msg.value >= minBnb, "MockRouter: min");
        MockERC20(token).transferFrom(msg.sender, address(this), useTok);
        liquidity = useTok / 1e9 + msg.value;
        lp.mint(lpRecipient, liquidity);
    }
}
