// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {GachaForgeFactory} from "../src/GachaForgeFactory.sol";
import {MachineVault} from "../src/MachineVault.sol";
import {GachaTypes} from "../src/libraries/GachaTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFlapVaultLauncher} from "./mocks/MockFlapLauncher.sol";

contract PullTest is Base {
    MachineVault v;
    MockERC20 t;

    function setUp() public override {
        super.setUp();
        (v, t) = _launch(GachaTypes.Strategy.RAFFLE);
    }

    function test_PackPriceFromFeed() public view {
        assertEq(v.packPriceBnb(), _price28());
        assertEq(v.maxPullAmount(), (_price28() * 11_000) / 10_000);
    }

    function test_PriceFeedDecimalsRespected() public {
        feed.set(600e8, block.timestamp);
        uint256 p8 = v.packPriceBnb();
        // 18-dec feed with same price gives same BNB amount
        vm.mockCall(address(feed), abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        feed.set(600e18, block.timestamp);
        assertEq(v.packPriceBnb(), p8);
    }

    function test_RevertPotBelowPrice() public {
        uint256 price = _price28();
        // pot just below price: tax*0.07 < price
        _tax(v, (price * 10_000) / 700 - 10);
        uint256 pot = v.pot();
        assertLt(pot, price);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.PotTooLow.selector, pot, price));
        v.openPull(price);
    }

    function test_OpenPullAtThreshold() public {
        uint256 price = _price28();
        _tax(v, (price * 10_000) / 700 + 10);
        assertGe(v.pot(), price);
        assertTrue(v.canOpenPull());
        vm.prank(operator);
        uint256 id = v.openPull(price);
        assertEq(id, 1);
        assertEq(address(renaiss).balance, price);
        assertEq(v.openPullId(), 1);
    }

    function test_OpenPullSyncsPendingTaxFirst() public {
        vm.deal(address(this), 1 ether);
        payable(address(v)).transfer(1 ether); // unsynced
        assertEq(v.pot(), 0);
        assertTrue(v.canOpenPull());
        vm.prank(operator);
        v.openPull(_price28());
        assertEq(v.pot(), 0.07 ether - _price28());
    }

    function test_CapAtPlus10Percent() public {
        _tax(v, 10 ether);
        uint256 cap = (_price28() * 11_000) / 10_000;
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.AmountTooHigh.selector, cap + 1, cap));
        v.openPull(cap + 1);
        vm.prank(operator);
        v.openPull(cap);
        assertEq(address(renaiss).balance, cap);
    }

    function test_CapLimitedByPot() public {
        uint256 price = _price28();
        _tax(v, (price * 10_000) / 700 + 1000); // pot ~= price
        uint256 pot = v.pot();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.PotTooLow.selector, pot, pot + 1));
        v.openPull(pot + 1);
    }

    function test_SingleOpenPull() public {
        _tax(v, 10 ether);
        vm.startPrank(operator);
        v.openPull(_price28());
        vm.expectRevert(MachineVault.PullAlreadyOpen.selector);
        v.openPull(_price28());
        vm.stopPrank();
        assertFalse(v.canOpenPull());
    }

    function test_CooldownAfterSettle() public {
        _tax(v, 10 ether);
        vm.startPrank(operator);
        uint256 id = v.openPull(_price28());
        v.settlePull(id, 0, 10);
        uint256 readyAt = block.timestamp + 60;
        vm.expectRevert(abi.encodeWithSelector(MachineVault.CooldownActive.selector, readyAt));
        v.openPull(_price28());
        assertFalse(v.canOpenPull());
        vm.warp(readyAt - 1);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.CooldownActive.selector, readyAt));
        v.openPull(_price28());
        vm.warp(readyAt);
        assertEq(v.openPull(_price28()), 2);
        vm.stopPrank();
    }

    function test_CooldownConfigurableByTimelock() public {
        vm.prank(admin);
        factory.setPullCooldown(300);
        _tax(v, 10 ether);
        vm.startPrank(operator);
        uint256 id = v.openPull(_price28());
        v.settlePull(id, 0, 10);
        vm.warp(vm.getBlockTimestamp() + 299);
        vm.expectRevert();
        v.openPull(_price28());
        vm.warp(vm.getBlockTimestamp() + 1);
        v.openPull(_price28());
        vm.stopPrank();
    }

    function test_RefundReturnsToPot() public {
        _tax(v, 10 ether);
        uint256 cap = v.maxPullAmount();
        vm.prank(operator);
        uint256 id = v.openPull(cap);
        uint256 potAfterOpen = v.pot();
        uint256 refund = cap - _price28();
        vm.prank(operator);
        v.settlePull{value: refund}(id, refund, 50);
        assertEq(v.pot(), potAfterOpen + refund);
        (uint128 sent, uint128 refunded,,, uint128 cardValue,, MachineVault.PullStatus st) = v.pulls(id);
        assertEq(sent, cap);
        assertEq(refunded, refund);
        assertEq(cardValue, 50);
        assertEq(uint8(st), uint8(MachineVault.PullStatus.SETTLED));
        assertEq(v.openPullId(), 0);
        assertEq(address(v).balance, v.trackedBalance());
    }

    function test_RevertBadRefund() public {
        _tax(v, 10 ether);
        vm.prank(operator);
        uint256 id = v.openPull(_price28());
        vm.prank(operator);
        vm.expectRevert(MachineVault.BadRefund.selector);
        v.settlePull{value: 1}(id, 2, 0); // value mismatch
        uint256 tooMuch = _price28() + 1;
        vm.prank(operator);
        vm.expectRevert(MachineVault.BadRefund.selector);
        v.settlePull{value: tooMuch}(id, tooMuch, 0); // more than sent
    }

    function test_RevertSettleTwice() public {
        uint256 id = _pullAndSettle(v, 10);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MachineVault.BadPullStatus.selector, id));
        v.settlePull(id, 0, 10);
    }

    function test_RevertStalePrice() public {
        _tax(v, 10 ether);
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        vm.prank(operator);
        vm.expectRevert(MachineVault.StalePrice.selector);
        v.openPull(_price28());
        assertFalse(v.canOpenPull());
    }

    function test_RevertBadPriceAndRound() public {
        _tax(v, 10 ether);
        feed.set(0, block.timestamp);
        vm.prank(operator);
        vm.expectRevert(MachineVault.InvalidPrice.selector);
        v.openPull(1);
        feed.set(-1, block.timestamp);
        vm.prank(operator);
        vm.expectRevert(MachineVault.InvalidPrice.selector);
        v.openPull(1);
        feed.set(600e8, block.timestamp);
        feed.setRounds(5, 4);
        vm.prank(operator);
        vm.expectRevert(MachineVault.StalePrice.selector);
        v.openPull(1);
    }

    function test_PriceMoveChangesThreshold() public {
        _tax(v, 1 ether); // pot 0.07 BNB
        feed.set(300e8, block.timestamp); // $28 = 0.0933 BNB
        vm.prank(operator);
        vm.expectRevert();
        v.openPull(0.07 ether);
        feed.set(1000e8, block.timestamp); // $28 = 0.028 BNB
        vm.prank(operator);
        v.openPull(0.028 ether);
    }

    function test_RevertZeroAmountAndNoReceiver() public {
        _tax(v, 10 ether);
        vm.prank(operator);
        vm.expectRevert(MachineVault.ZeroAmount.selector);
        v.openPull(0);
    }

    function test_PauseBlocksPullsNotClaims() public {
        _tax(v, 10 ether);
        vm.prank(pauser);
        factory.pause();
        vm.prank(operator);
        vm.expectRevert(MachineVault.Paused.selector);
        v.openPull(_price28());
        assertFalse(v.canOpenPull());
        // tax intake still works while paused
        _tax(v, 1 ether);
        assertEq(v.pot(), 0.77 ether);
        vm.prank(pauser);
        vm.expectRevert();
        factory.unpause();
        vm.prank(admin);
        factory.unpause();
        vm.prank(operator);
        v.openPull(_price28());
    }

    function test_EventPullOpened() public {
        _tax(v, 10 ether);
        uint256 p = _price28();
        vm.expectEmit(address(v));
        emit MachineVault.PullOpened(1, p, p, address(renaiss));
        vm.prank(operator);
        v.openPull(p);
    }
}

contract AccessTest is Base {
    MachineVault v;
    MockERC20 t;

    function setUp() public override {
        super.setUp();
        (v, t) = _launch(GachaTypes.Strategy.SPLIT);
        _tax(v, 10 ether);
    }

    function test_NonOperatorRejectedEverywhere() public {
        bytes32[] memory proof;
        address[3] memory who = [creator, trader, admin];
        for (uint256 i; i < who.length; i++) {
            vm.startPrank(who[i]);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.openPull(1);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.settlePull(1, 0, 0);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.recordRaffle(1, 1, bytes32(uint256(1)), bytes32(0), trader);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.depositProceeds(1);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.setDividendRoot(1, bytes32(uint256(1)), 1);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.pushClaim(1, trader, 1, proof);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.expireRound(1);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.buybackAndBurn(1, 0);
            vm.expectRevert(MachineVault.NotOperator.selector);
            v.addLiquidityLocked(1, 0, 0, 0);
            vm.stopPrank();
        }
    }

    function test_CreatorCannotWithdraw() public {
        uint256 before = creator.balance;
        uint256 vaultBal = address(v).balance;
        // creator holds no role anywhere
        assertFalse(factory.hasRole(factory.OPERATOR_ROLE(), creator));
        assertFalse(factory.hasRole(factory.DEFAULT_ADMIN_ROLE(), creator));
        assertFalse(factory.hasRole(factory.PAUSER_ROLE(), creator));
        // no withdraw-like entrypoints exist
        vm.startPrank(creator);
        (bool ok,) = address(v).call(abi.encodeWithSignature("withdraw()"));
        assertFalse(ok);
        (ok,) = address(v).call(abi.encodeWithSignature("withdraw(uint256)", 1 ether));
        assertFalse(ok);
        (ok,) = address(v).call(abi.encodeWithSignature("rescue(address,uint256)", creator, 1 ether));
        assertFalse(ok);
        v.sync(); // permissionless, harmless
        vm.stopPrank();
        assertEq(creator.balance, before);
        assertEq(address(v).balance, vaultBal);
    }

    function test_RevokeOperator() public {
        vm.prank(operator);
        v.openPull(_price28());
        vm.startPrank(admin);
        factory.revokeRole(factory.OPERATOR_ROLE(), operator);
        vm.stopPrank();
        vm.prank(operator);
        vm.expectRevert(MachineVault.NotOperator.selector);
        v.settlePull(1, 0, 0);

        address op2 = makeAddr("op2");
        vm.startPrank(admin);
        factory.grantRole(factory.OPERATOR_ROLE(), op2);
        vm.stopPrank();
        vm.prank(op2);
        v.settlePull(1, 0, 0);
    }

    function test_OperatorCanRenounce() public {
        bytes32 role = factory.OPERATOR_ROLE();
        vm.prank(operator);
        factory.renounceRole(role, operator);
        vm.prank(operator);
        vm.expectRevert(MachineVault.NotOperator.selector);
        v.openPull(_price28());
    }

    function test_OnlyAdminGrantsRoles() public {
        bytes32 role = factory.OPERATOR_ROLE();
        vm.prank(operator);
        vm.expectRevert();
        factory.grantRole(role, creator);
    }
}

contract VaultPortalFlowTest is Base {
    function test_VaultDeployedViaCallback() public {
        MockFlapVaultLauncher vl = new MockFlapVaultLauncher();
        vm.prank(admin);
        factory.setFlapLauncher(address(vl));
        vl.setFactory(address(factory));
        GachaForgeFactory.LaunchParams memory p =
            _params(GachaTypes.Strategy.DIVIDEND, GachaTypes.PackId.FORGE_48, 200, _noSplit());
        address predicted = factory.predictVault(creator, p.salt);
        (MachineVault v, MockERC20 t) = _launchWith(p);
        assertEq(address(v), predicted);
        assertEq(vl.lastVault(), predicted);
        assertEq(v.token(), address(t));
        assertEq(factory.vaultOf(address(t)), address(v));
        assertEq(factory.machineCount(), 1);
    }

    function test_DeployPendingVaultOnlyLauncherDuringLaunch() public {
        vm.expectRevert(GachaForgeFactory.NotLauncher.selector);
        factory.deployPendingVault(address(1));
        vm.prank(address(flap));
        vm.expectRevert(GachaForgeFactory.NoContext.selector);
        factory.deployPendingVault(address(1));
    }
}
