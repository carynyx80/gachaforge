// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {MachineVault} from "../src/MachineVault.sol";
import {GachaTypes} from "../src/libraries/GachaTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract DividendTest is Base {
    MachineVault v;
    address[4] holders;
    uint256[4] amounts = [uint256(0.4 ether), 0.3 ether, 0.2 ether, 0.1 ether];
    bytes32 root;
    bytes32[][] proofs;

    function setUp() public override {
        super.setUp();
        (v,) = _launch(GachaTypes.Strategy.DIVIDEND);
        holders = [makeAddr("h0"), makeAddr("h1"), makeAddr("h2"), makeAddr("h3")];
        uint256 id = _pullAndSettle(v, 10);
        vm.prank(operator);
        v.depositProceeds{value: 1.5 ether}(id);
        bytes32[4] memory l;
        for (uint256 i; i < 4; i++) {
            l[i] = _leaf(holders[i], amounts[i]);
        }
        (root, proofs) = _tree4(l);
    }

    function test_SetRootMovesPoolToLiability() public {
        vm.prank(operator);
        v.setDividendRoot(1, root, 1 ether);
        assertEq(v.dividendPool(), 0.5 ether);
        assertEq(v.dividendLiability(), 1 ether);
        assertEq(address(v).balance, v.trackedBalance());
    }

    function test_RevertRootExceedsPool() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.InsufficientReserve.selector, 1.5 ether, 2 ether));
        v.setDividendRoot(1, root, 2 ether);
    }

    function test_RevertRootReuseAndZero() public {
        vm.startPrank(operator);
        v.setDividendRoot(1, root, 1 ether);
        vm.expectRevert(MachineVault.RoundExists.selector);
        v.setDividendRoot(1, root, 0.1 ether);
        vm.expectRevert(MachineVault.ZeroAmount.selector);
        v.setDividendRoot(2, bytes32(0), 0.1 ether);
        vm.expectRevert(MachineVault.ZeroAmount.selector);
        v.setDividendRoot(2, root, 0);
        vm.stopPrank();
    }

    function test_AllClaim() public {
        vm.prank(operator);
        v.setDividendRoot(1, root, 1 ether);
        for (uint256 i; i < 4; i++) {
            vm.prank(holders[i]);
            v.claim(1, amounts[i], proofs[i]);
            assertEq(holders[i].balance, amounts[i]);
            assertTrue(v.claimed(1, holders[i]));
        }
        (, uint128 total, uint128 claimedAmt,,) = v.rounds(1);
        assertEq(total, claimedAmt);
        assertEq(v.dividendLiability(), 0);
        assertEq(address(v).balance, v.trackedBalance());
    }

    function test_NoDoubleClaim() public {
        vm.prank(operator);
        v.setDividendRoot(1, root, 1 ether);
        vm.prank(holders[0]);
        v.claim(1, amounts[0], proofs[0]);
        vm.prank(holders[0]);
        vm.expectRevert(MachineVault.AlreadyClaimed.selector);
        v.claim(1, amounts[0], proofs[0]);
        // push after self-claim also blocked
        vm.prank(operator);
        vm.expectRevert(MachineVault.AlreadyClaimed.selector);
        v.pushClaim(1, holders[0], amounts[0], proofs[0]);
    }

    function test_InvalidProofOrAmount() public {
        vm.prank(operator);
        v.setDividendRoot(1, root, 1 ether);
        vm.prank(holders[0]);
        vm.expectRevert(MachineVault.InvalidProof.selector);
        v.claim(1, amounts[0] + 1, proofs[0]);
        vm.prank(trader); // not in tree
        vm.expectRevert(MachineVault.InvalidProof.selector);
        v.claim(1, amounts[0], proofs[0]);
        vm.prank(holders[1]);
        vm.expectRevert(MachineVault.InvalidProof.selector);
        v.claim(1, amounts[1], proofs[0]);
        vm.prank(holders[0]);
        vm.expectRevert(MachineVault.RoundUnknown.selector);
        v.claim(9, amounts[0], proofs[0]);
    }

    function test_NeverPaysMoreThanSetAside() public {
        // operator sets a root whose leaves sum to 1 BNB, but only sets aside 0.75
        vm.prank(operator);
        v.setDividendRoot(1, root, 0.75 ether);
        vm.prank(holders[0]);
        v.claim(1, amounts[0], proofs[0]); // 0.4
        vm.prank(holders[1]);
        v.claim(1, amounts[1], proofs[1]); // 0.7
        vm.prank(holders[2]);
        vm.expectRevert(MachineVault.RoundOverpaid.selector);
        v.claim(1, amounts[2], proofs[2]); // would be 0.9 > 0.75
        // other buckets untouched
        assertEq(v.dividendPool(), 0.75 ether);
        assertEq(v.dividendLiability(), 0.05 ether);
        assertEq(address(v).balance, v.trackedBalance());
        vm.prank(holders[3]);
        vm.expectRevert(MachineVault.RoundOverpaid.selector);
        v.claim(1, amounts[3], proofs[3]); // 0.8 > 0.75
        (, uint128 total, uint128 paid,,) = v.rounds(1);
        assertLe(paid, total);
    }

    function test_PushClaimForLargeHolder() public {
        vm.prank(operator);
        v.setDividendRoot(1, root, 1 ether);
        vm.expectEmit(address(v));
        emit MachineVault.DividendClaimed(1, holders[0], amounts[0], true);
        vm.prank(operator);
        v.pushClaim(1, holders[0], amounts[0], proofs[0]);
        assertEq(holders[0].balance, amounts[0]);
        vm.prank(holders[0]);
        vm.expectRevert(MachineVault.AlreadyClaimed.selector);
        v.claim(1, amounts[0], proofs[0]);
    }

    function test_ExpireRoundReturnsToPool() public {
        vm.prank(operator);
        v.setDividendRoot(1, root, 1 ether);
        vm.prank(holders[0]);
        v.claim(1, amounts[0], proofs[0]);
        vm.prank(operator);
        vm.expectRevert(MachineVault.RoundNotExpirable.selector);
        v.expireRound(1);
        vm.warp(vm.getBlockTimestamp() + 180 days);
        vm.prank(operator);
        v.expireRound(1);
        assertEq(v.dividendPool(), 0.5 ether + 0.6 ether);
        assertEq(v.dividendLiability(), 0);
        vm.prank(holders[1]);
        vm.expectRevert(MachineVault.RoundIsExpired.selector);
        v.claim(1, amounts[1], proofs[1]);
        vm.prank(operator);
        vm.expectRevert(MachineVault.RoundIsExpired.selector);
        v.expireRound(1);
    }

    function test_RoundsIndependent() public {
        vm.startPrank(operator);
        v.setDividendRoot(1, root, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.InsufficientReserve.selector, 0.5 ether, 1 ether));
        v.setDividendRoot(2, root, 1 ether);
        vm.stopPrank();
    }

    function testFuzz_SingleLeafClaim(address who, uint96 amt) public {
        vm.assume(who != address(0) && who.code.length == 0 && uint160(who) > 0x100);
        uint256 a = bound(uint256(amt), 1, 1.5 ether);
        bytes32 r = _leaf(who, a);
        bytes32[] memory empty;
        vm.prank(operator);
        v.setDividendRoot(5, r, a);
        uint256 before = who.balance;
        vm.prank(who);
        v.claim(5, a, empty);
        assertEq(who.balance - before, a);
        vm.prank(who);
        vm.expectRevert(MachineVault.AlreadyClaimed.selector);
        v.claim(5, a, empty);
    }
}
