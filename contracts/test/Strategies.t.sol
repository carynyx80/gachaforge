// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {GachaForgeFactory} from "../src/GachaForgeFactory.sol";
import {MachineVault} from "../src/MachineVault.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {GachaTypes} from "../src/libraries/GachaTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract StrategyTest is Base {
    bytes32 constant SNAP = keccak256("snapshot");
    bytes32 constant SEED = keccak256("seed");

    // ---------------------------------------------------------------- RAFFLE
    function test_Raffle_RecordEmitsProof() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.RAFFLE);
        uint256 id = _pullAndSettle(v, 5);
        vm.expectEmit(address(v));
        emit MachineVault.RaffleRecorded(id, block.number - 1, SNAP, SEED, trader);
        vm.prank(operator);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, trader);
        (,,,,,, MachineVault.PullStatus st) = v.pulls(id);
        assertEq(uint8(st), uint8(MachineVault.PullStatus.WON));
        // cannot also deposit proceeds or record again
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.BadPullStatus.selector, id));
        v.depositProceeds{value: 1 ether}(id);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.BadPullStatus.selector, id));
        v.recordRaffle(id, block.number - 1, SNAP, SEED, trader);
    }

    function test_Raffle_InvalidInputs() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.RAFFLE);
        uint256 id = _pullAndSettle(v, 5);
        vm.startPrank(operator);
        vm.expectRevert(MachineVault.InvalidWinner.selector);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, address(0));
        vm.expectRevert(MachineVault.InvalidWinner.selector);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, DEAD);
        vm.expectRevert(MachineVault.InvalidWinner.selector);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, address(v));
        vm.expectRevert(MachineVault.InvalidWinner.selector);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, address(t));
        vm.expectRevert(MachineVault.InvalidSnapshot.selector);
        v.recordRaffle(id, block.number, SNAP, SEED, trader); // future/current block
        vm.expectRevert(MachineVault.InvalidSnapshot.selector);
        v.recordRaffle(id, block.number - 1, bytes32(0), SEED, trader);
        vm.stopPrank();
    }

    function test_Raffle_RequiresSettledPull() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.RAFFLE);
        _tax(v, 1 ether);
        vm.prank(operator);
        uint256 id = v.openPull(_price28());
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.BadPullStatus.selector, id));
        v.recordRaffle(id, block.number - 1, SNAP, SEED, trader);
    }

    function test_Raffle_NoEligibleSellBackToPot() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.RAFFLE);
        uint256 id = _pullAndSettle(v, 5);
        uint256 pot = v.pot();
        vm.prank(operator);
        v.depositProceeds{value: 0.04 ether}(id);
        assertEq(v.pot(), pot + 0.04 ether);
        assertEq(v.burnReserve(), 0);
        assertEq(address(v).balance, v.trackedBalance());
    }

    // ---------------------------------------------------------------- HIT_HUNTER
    function test_HitHunter_HitGoesToRaffle() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.HIT_HUNTER);
        uint256 id = _pullAndSettle(v, 29); // > $28
        vm.prank(operator);
        vm.expectRevert(MachineVault.StrategyMismatch.selector);
        v.depositProceeds{value: 1 ether}(id);
        vm.prank(operator);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, trader);
    }

    function test_HitHunter_MissSellsAndBurns() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.HIT_HUNTER);
        uint256 id = _pullAndSettle(v, 28); // == price -> not a hit
        vm.prank(operator);
        vm.expectRevert(MachineVault.StrategyMismatch.selector);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, trader);
        vm.prank(operator);
        v.depositProceeds{value: 0.02 ether}(id);
        assertEq(v.burnReserve(), 0.02 ether);
        uint256 potBefore = v.pot();

        uint256 out = 0.02 ether * router.rate();
        vm.prank(operator);
        v.buybackAndBurn(0.02 ether, out);
        assertEq(t.balanceOf(DEAD), out);
        assertEq(v.burnReserve(), 0);
        assertEq(v.pot(), potBefore);
        assertEq(address(v).balance, v.trackedBalance());
    }

    // ---------------------------------------------------------------- DIVIDEND
    function test_Dividend_ProceedsToPool() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.DIVIDEND);
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        vm.expectRevert(MachineVault.StrategyMismatch.selector);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, trader);
        vm.prank(operator);
        v.depositProceeds{value: 0.05 ether}(id);
        assertEq(v.dividendPool(), 0.05 ether);
        assertEq(v.burnReserve(), 0);
    }

    // ---------------------------------------------------------------- BURN
    function test_Burn_ProceedsBuyAndBurn() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.BURN);
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        vm.expectRevert(MachineVault.StrategyMismatch.selector);
        v.recordRaffle(id, block.number - 1, SNAP, SEED, trader);
        vm.prank(operator);
        v.depositProceeds{value: 0.05 ether}(id);
        assertEq(v.burnReserve(), 0.05 ether);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.InsufficientReserve.selector, 0.05 ether, 0.06 ether));
        v.buybackAndBurn(0.06 ether, 0);

        // partial burns allowed
        vm.startPrank(operator);
        v.buybackAndBurn(0.03 ether, 0);
        v.buybackAndBurn(0.02 ether, 0);
        vm.stopPrank();
        assertEq(t.balanceOf(DEAD), 0.05 ether * router.rate());
        assertEq(v.burnReserve(), 0);
    }

    function test_Burn_Slippage() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.BURN);
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        v.depositProceeds{value: 0.05 ether}(id);
        uint256 tooMuch = 0.05 ether * router.rate() + 1;
        vm.prank(operator);
        vm.expectRevert();
        v.buybackAndBurn(0.05 ether, tooMuch);
        assertEq(v.burnReserve(), 0.05 ether, "reverted, reserve intact");
    }

    function test_Burn_RouterRefundCreditedBack() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.BURN);
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id);
        router.setBuyRefundBps(2_500); // curve fills, 25% refunded
        vm.prank(operator);
        v.buybackAndBurn(1 ether, 0);
        assertEq(v.burnReserve(), 0.25 ether);
        assertEq(t.balanceOf(DEAD), 0.75 ether * router.rate());
        assertEq(address(v).balance, v.trackedBalance());
    }

    // ---------------------------------------------------------------- SPLIT
    function test_Split_RoutesByBps() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.SPLIT); // 50/30/20
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id);
        assertEq(v.dividendPool(), 0.5 ether);
        assertEq(v.burnReserve(), 0.3 ether);
        assertEq(v.lpReserve(), 0.2 ether);
        assertEq(address(v).balance, v.trackedBalance());
    }

    function test_Split_PreGraduationLpShareBurned() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.SPLIT);
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id);
        vm.expectEmit(address(v));
        emit MachineVault.LpShareBurned(0.2 ether, 0.2 ether * router.rate());
        vm.prank(operator);
        v.addLiquidityLocked(0.2 ether, 0, 0, 0);
        assertEq(t.balanceOf(DEAD), 0.2 ether * router.rate());
        assertEq(router.lp().balanceOf(DEAD), 0);
        assertEq(v.lpReserve(), 0);
    }

    function test_Split_PostGraduationLpLocked() public {
        (MachineVault v, MockERC20 t) = _launch(GachaTypes.Strategy.SPLIT);
        router.setGraduated(address(t), true);
        router.setLpTokenUseBps(9_000); // pool absorbs 90%, rest burned
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id);
        vm.prank(operator);
        v.addLiquidityLocked(0.2 ether, 0, 0, 0);
        uint256 bought = 0.1 ether * router.rate();
        assertGt(router.lp().balanceOf(DEAD), 0, "LP locked at dead");
        assertEq(t.balanceOf(address(router)), (bought * 9_000) / 10_000, "pool got tokens");
        assertEq(t.balanceOf(DEAD), bought - (bought * 9_000) / 10_000, "leftover burned");
        assertEq(t.balanceOf(address(v)), 0);
        assertEq(t.allowance(address(v), address(router)), 0);
        assertEq(v.lpReserve(), 0);
        assertEq(address(v).balance, v.trackedBalance());
    }

    function test_Split_LpReserveBound() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.SPLIT);
        uint256 id = _pullAndSettle(v, 100);
        vm.prank(operator);
        v.depositProceeds{value: 1 ether}(id);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.InsufficientReserve.selector, 0.2 ether, 0.3 ether));
        v.addLiquidityLocked(0.3 ether, 0, 0, 0);
    }

    function testFuzz_SplitProceeds(uint16 d, uint16 b, uint96 amt) public {
        d = uint16(bound(d, 0, 10_000));
        b = uint16(bound(b, 0, 10_000 - d));
        uint16 l = 10_000 - d - b;
        uint256 a = bound(uint256(amt), 1, 1_000 ether);
        GachaForgeFactory.LaunchParams memory p = _params(
            GachaTypes.Strategy.SPLIT, GachaTypes.PackId.FORGE_28, 500, GachaTypes.SplitBps(d, b, l)
        );
        (MachineVault v,) = _launchWith(p);
        uint256 id = _pullAndSettle(v, 100);
        vm.deal(operator, a);
        vm.prank(operator);
        v.depositProceeds{value: a}(id);
        assertEq(v.dividendPool() + v.burnReserve() + v.lpReserve(), a);
        assertEq(v.dividendPool(), (a * d) / 10_000);
        assertEq(v.burnReserve(), (a * b) / 10_000);
        assertEq(address(v).balance, v.trackedBalance());
    }

    function test_DepositProceedsRequiresSettled() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.BURN);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.BadPullStatus.selector, 7));
        v.depositProceeds{value: 1}(7);
        uint256 id = _pullAndSettle(v, 1);
        vm.prank(operator);
        vm.expectRevert(MachineVault.ZeroAmount.selector);
        v.depositProceeds(id);
    }

    function test_PotSurvivesFullLifecycle() public {
        (MachineVault v,) = _launch(GachaTypes.Strategy.BURN);
        _tax(v, 1 ether);
        uint256 ts = block.timestamp;
        for (uint256 i; i < 5; i++) {
            uint256 id = _pullAndSettle(v, 10);
            vm.prank(operator);
            v.depositProceeds{value: 0.01 ether}(id);
            ts += 61;
            vm.warp(ts);
            feed.set(BNB_USD, ts);
        }
        assertEq(v.pullCount(), 5);
        assertEq(v.pot(), 0.7 ether - 5 * _price28());
        assertEq(v.burnReserve(), 0.05 ether);
        assertEq(address(v).balance, v.trackedBalance());
    }
}

contract BuybackBurnerTest is Base {
    function test_AccumulatesFromVaults() public {
        (MachineVault a,) = _launch(GachaTypes.Strategy.BURN);
        (MachineVault b,) = _launch(GachaTypes.Strategy.RAFFLE);
        _tax(a, 1 ether);
        _tax(b, 2 ether);
        assertEq(address(burner).balance, 0.6 ether);
        assertEq(burner.totalBnbReceived(), 0.6 ether);
    }

    function test_BuybackBurnsForge() public {
        (MachineVault a,) = _launch(GachaTypes.Strategy.BURN);
        _tax(a, 1 ether);
        uint256 out = 0.2 ether * router.rate();
        vm.expectEmit(address(burner));
        emit BuybackBurner.Buyback(0.2 ether, out);
        vm.expectEmit(address(burner));
        emit BuybackBurner.Burn(out);
        vm.prank(operator);
        burner.buybackAndBurn(0.2 ether, out);
        assertEq(forge.balanceOf(DEAD), out);
        assertEq(address(burner).balance, 0);
        assertEq(burner.totalForgeBurned(), out);
        assertEq(burner.totalBnbSpent(), 0.2 ether);
    }

    function test_BuybackGuards() public {
        vm.deal(address(burner), 1 ether);
        vm.prank(creator);
        vm.expectRevert();
        burner.buybackAndBurn(1 ether, 0);
        vm.prank(operator);
        vm.expectRevert(BuybackBurner.InsufficientBalance.selector);
        burner.buybackAndBurn(2 ether, 0);
        vm.prank(operator);
        vm.expectRevert(BuybackBurner.ZeroAmount.selector);
        burner.buybackAndBurn(0, 0);
        vm.prank(operator);
        vm.expectRevert();
        burner.setRouter(address(1));
        vm.prank(admin);
        burner.setRouter(address(router));
    }

    function test_UnsetForgeAccumulatesThenTimelockSetsOnce() public {
        BuybackBurner b = new BuybackBurner(admin, address(0), address(router));
        assertEq(address(b.forge()), address(0));
        bytes32 opRole = b.OPERATOR_ROLE();
        vm.prank(admin);
        b.grantRole(opRole, operator);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(b).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(b.totalBnbReceived(), 1 ether);

        vm.prank(operator);
        vm.expectRevert(BuybackBurner.ForgeUnset.selector);
        b.buybackAndBurn(0.5 ether, 0);

        vm.prank(operator);
        vm.expectRevert();
        b.setForge(address(forge));
        vm.prank(admin);
        vm.expectRevert(BuybackBurner.ZeroAddress.selector);
        b.setForge(address(0));

        vm.prank(admin);
        b.setForge(address(forge));
        assertEq(address(b.forge()), address(forge));
        vm.prank(admin);
        vm.expectRevert(BuybackBurner.ForgeAlreadySet.selector);
        b.setForge(address(1));

        vm.prank(operator);
        b.buybackAndBurn(0.5 ether, 0);
        assertEq(forge.balanceOf(DEAD), 0.5 ether * router.rate());
    }

    function test_ForgeSetAtConstructionCannotBeChanged() public {
        vm.prank(admin);
        vm.expectRevert(BuybackBurner.ForgeAlreadySet.selector);
        burner.setForge(address(1));
    }
}
