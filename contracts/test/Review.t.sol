// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {MachineVault} from "../src/MachineVault.sol";
import {GachaTypes} from "../src/libraries/GachaTypes.sol";
import {ILaunchpadRouter} from "../src/interfaces/ILaunchpadRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Test} from "forge-std/Test.sol";

/// @dev Stand-in for flap's TaxProcessor: forwards tax to the tax receiver when dispatched.
contract MockTaxProcessor {
    function dispatch(address to) external payable {
        (bool ok,) = to.call{value: msg.value}("");
        require(ok);
    }
}

/// @dev Router that, like a flap tax token whose TaxProcessor dispatches synchronously, sends the
///      buy tax back to the tax receiver (the vault) in the middle of the vault's own buyback.
///      The tax arrives from the TaxProcessor (not the router), as on flap.sh.
contract SelfTaxRouter is ILaunchpadRouter {
    MockTaxProcessor public immutable processor = new MockTaxProcessor();
    uint256 public refundBps;

    function setRefundBps(uint256 b) external {
        refundBps = b;
    }

    uint256 public taxBps = 200;
    address public taxReceiver;

    function setTaxReceiver(address r) external {
        taxReceiver = r;
    }

    function isGraduated(address) external pure returns (bool) {
        return false;
    }

    function buyTokens(address token, uint256, address recipient) external payable returns (uint256 out) {
        uint256 tax = (msg.value * taxBps) / 10_000;
        out = (msg.value - tax - (msg.value * refundBps) / 10_000) * 1_000_000;
        MockERC20(token).mint(recipient, out);
        processor.dispatch{value: tax}(taxReceiver); // "TaxProcessor.dispatch()"
        uint256 refund = (msg.value * refundBps) / 10_000;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok);
        }
    }

    function addLiquidity(address, uint256, uint256, uint256, address) external payable returns (uint256) {
        revert();
    }

    receive() external payable {}
}

contract ReviewTest is Base {
    // ------------------------------------------------------------------ H/M: LP path DoS by token donation
    /// addLiquidityLocked emits `got - leftover`; any token balance the vault already holds (a donation)
    /// is counted in `leftover`, so once donation > tokens absorbed by the pool the call underflows and
    /// lpReserve can never be spent (no other exit for lpReserve).
    function test_Review_LpReserveBrickedByTokenDonation() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.SPLIT);
        router.setGraduated(address(t), true);
        uint256 id = _pullAndSettle(v, 10);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id); // lpReserve = 0.2 BNB
        uint256 lp = v.lpReserve();
        assertGt(lp, 0);

        // attacker donates tokens worth slightly more than half of the LP spend
        uint256 donation = (lp / 2) * router.rate() + 1;
        vm.prank(creator);
        t.transfer(address(v), donation);

        uint256 deadBefore = t.balanceOf(DEAD);
        vm.prank(operator);
        v.addLiquidityLocked(lp, 0, 0, 0); // fixed: only tokens acquired in this call are counted
        assertEq(v.lpReserve(), 0, "lpReserve spent");
        assertEq(t.balanceOf(address(v)), donation, "donation untouched, not counted as leftover");
        assertEq(t.balanceOf(DEAD), deadBefore, "pool absorbed all bought tokens, nothing extra burned");
        assertGt(router.lp().balanceOf(DEAD), 0, "LP locked");
    }

    // ------------------------------------------------------------------ M: tax received during own buyback
    /// Tax that lands in the vault during buybackAndBurn / addLiquidityLocked (guard entered, receive()
    /// skips _sync) is swept into burnReserve/lpReserve by _creditRefund instead of the 7/3/90 pot/buyback/treasury split.
    function test_Review_TaxDuringBuybackSkipsSplit() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.BURN);
        t; // silence
        SelfTaxRouter sr = new SelfTaxRouter();
        sr.setTaxReceiver(address(v));
        vm.prank(admin);
        factory.setRouter(address(sr));

        uint256 id = _pullAndSettle(v, 10);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id); // burnReserve = 1 BNB
        uint256 potBefore = v.pot();
        uint256 burnerBefore = address(burner).balance;

        vm.prank(operator);
        v.buybackAndBurn(1 ether, 0); // 0.02 BNB (2%) tax comes back mid-call

        // 0.02 BNB of fresh tax: 7% to pot, 3% to $FORGE burner, not swept into burnReserve
        assertEq(v.pot() - potBefore, 0.0014 ether, "pot did not get 7% of tax");
        assertEq(address(burner).balance - burnerBefore, 0.0006 ether, "burner did not get 3%");
        assertEq(v.burnReserve(), 0, "tax not miscredited as refund");
        assertEq(address(v).balance, v.trackedBalance());
    }

    /// Router refunds are still credited to the spent bucket while concurrent tax is split.
    function test_Review_TaxDuringBuybackSkipsSplit_WithRefund() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.BURN);
        SelfTaxRouter sr = new SelfTaxRouter();
        sr.setTaxReceiver(address(v));
        sr.setRefundBps(2_000);
        vm.prank(admin);
        factory.setRouter(address(sr));
        uint256 id = _pullAndSettle(v, 10);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id);
        uint256 potBefore = v.pot();
        vm.prank(operator);
        v.buybackAndBurn(1 ether, 0);
        assertEq(v.burnReserve(), 0.2 ether, "refund back to burnReserve");
        assertEq(v.pot() - potBefore, 0.0014 ether, "tax split");
        assertEq(address(v).balance, v.trackedBalance());
    }

    // ------------------------------------------------------------------ M: receive() can run out of gas
    /// receive() runs the full _sync()+_flush() (two value calls, several cold SSTOREs) whenever
    /// gasleft() > 120k. With a fresh treasury EOA and first-time burner write that path costs more than
    /// 120k, so a sender forwarding e.g. 130k gas has its transfer REVERT instead of deferring to sync().
    function test_Review_ReceiveRevertsJustAboveGasThreshold() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.BURN);
        // fixed: receive() makes no external calls / cold SSTOREs -> succeeds at 2300 gas and above
        uint256[4] memory low = [uint256(2_300), 5_000, 21_000, 60_000];
        for (uint256 i; i < low.length; i++) {
            vm.prank(trader);
            (bool ok,) = address(v).call{value: 1 ether, gas: low[i]}("");
            assertTrue(ok, "low-gas receive");
        }
        for (uint256 g = 100_000; g <= 260_000; g += 1_000) {
            vm.prank(trader);
            (bool ok,) = address(v).call{value: 1 ether, gas: g}("");
            assertTrue(ok, "receive() must never revert");
        }
        uint256 total = 4 ether + 161 ether;
        v.sync(); // permissionless split + forward
        assertEq(v.pot(), (total * 700) / 10000);
        assertEq(address(burner).balance, (total * 300) / 10000);
        assertEq(treasury.balance, total - (total * 700) / 10000 - (total * 300) / 10000);
    }

    // ------------------------------------------------------------------ L: BuybackBurner stats
    /// Router BNB refunds re-enter BuybackBurner.receive(), inflating totalBnbReceived, and
    /// totalBnbSpent books the full bnbAmount although part came back.
    function test_Review_BurnerStatsDoubleCountRefunds() public {
        router.setBuyRefundBps(5_000);
        vm.deal(address(burner), 1 ether);
        vm.prank(operator);
        burner.buybackAndBurn(1 ether, 0);
        assertEq(burner.totalBnbSpent(), 0.5 ether, "spent overstated");
        assertEq(burner.totalBnbReceived(), 0, "refund counted as revenue");
    }

    // ------------------------------------------------------------------ L: cardValueUsd truncation
    /// settlePull stores uint128(cardValueUsd) silently; a 2^128+100 value is stored as 100 (>28) and
    /// a typo'd huge value can flip HIT_HUNTER routing. Should revert on overflow.
    function test_Review_CardValueTruncated() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.HIT_HUNTER);
        _tax(v, 1 ether);
        uint256 price = v.packPriceBnb();
        vm.startPrank(operator);
        uint256 id = v.openPull(price);
        vm.expectRevert();
        v.settlePull(id, 0, (uint256(1) << 128) + 1); // stored as 1 -> sell-back instead of raffle
        vm.stopPrank();
    }
}

contract ReviewDeployTest is Test {
    /// Deploy grants PAUSER_ROLE to the hot operator key; PAUSER_ROLE also gates unpause(), so a
    /// compromised operator can immediately undo an emergency pause by the multisig.
    function test_Review_OperatorCanUndoMultisigPause() public {
        address ms = makeAddr("safe");
        address op = makeAddr("op");
        vm.setEnv("CHAINLINK_BNB_USD", vm.toString(makeAddr("feed")));
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        vm.setEnv("MULTISIG", vm.toString(ms));
        vm.setEnv("OPERATOR", vm.toString(op));
        vm.setEnv("FORGE_TOKEN", vm.toString(makeAddr("forge")));
        vm.setEnv("RENAISS_PAYMENT_RECEIVER", vm.toString(makeAddr("renaiss")));
        vm.setEnv("FLAP_PORTAL", vm.toString(makeAddr("portal")));
        vm.setEnv("FLAP_VAULT_PORTAL", vm.toString(makeAddr("vaultPortal")));
        vm.setEnv("FLAP_TAX_TOKEN_IMPL", vm.toString(makeAddr("impl")));
        vm.setEnv("PANCAKE_ROUTER", vm.toString(makeAddr("pancake")));
        Deploy.Deployed memory d = new Deploy().run();

        vm.prank(ms);
        d.factory.pause();
        vm.prank(op);
        vm.expectRevert(); // fixed: operator cannot unpause
        d.factory.unpause();
        assertTrue(d.factory.paused());
        vm.prank(ms);
        d.factory.unpause(); // multisig holds UNPAUSER_ROLE
        assertFalse(d.factory.paused());
    }
}
