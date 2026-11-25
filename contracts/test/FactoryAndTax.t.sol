// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {GachaForgeFactory} from "../src/GachaForgeFactory.sol";
import {MachineVault} from "../src/MachineVault.sol";
import {GachaTypes} from "../src/libraries/GachaTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {RejectingReceiver} from "./mocks/Receivers.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract FactoryTest is Base {
    function test_LaunchWiresVaultAsTaxReceiver() public {
        GachaForgeFactory.LaunchParams memory p =
            _params(GachaTypes.Strategy.RAFFLE, GachaTypes.PackId.FORGE_48, 200, _noSplit());
        address predicted = factory.predictVault(creator, p.salt);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        (address token, address vault) = factory.launch{value: 0.5 ether}(p);

        assertEq(vault, predicted, "CREATE2 prediction");
        assertEq(flap.taxReceiverOf(token), vault, "tax receiver = vault");
        assertEq(flap.taxBpsOf(token), 200);
        assertEq(flap.lastValue(), 0.5 ether, "initial buy forwarded");
        assertEq(factory.vaultOf(token), vault);
        assertEq(factory.tokenOf(vault), token);
        assertTrue(factory.isVault(vault));
        assertEq(factory.machineCount(), 1);
        GachaForgeFactory.Machine memory m = factory.machineAt(0);
        assertEq(m.creator, creator);

        MachineVault v = MachineVault(payable(vault));
        assertEq(v.token(), token);
        assertEq(v.packPriceUsd(), 48);
        assertEq(uint8(v.strategy()), uint8(GachaTypes.Strategy.RAFFLE));
        assertEq(v.taxBps(), 200);
        assertEq(v.treasury(), treasury);
        assertEq(v.buybackBurner(), address(burner));
        assertEq(address(v.factory()), address(factory));
    }

    function test_LaunchEmitsEvent() public {
        GachaForgeFactory.LaunchParams memory p =
            _params(GachaTypes.Strategy.SPLIT, GachaTypes.PackId.FORGE_88, 200, GachaTypes.SplitBps(4000, 4000, 2000));
        address predicted = factory.predictVault(creator, p.salt);
        vm.expectEmit(false, true, true, true);
        emit GachaForgeFactory.MachineLaunched(
            address(0), predicted, creator, GachaTypes.PackId.FORGE_88, GachaTypes.Strategy.SPLIT, 200, 4000, 4000, 2000, 0
        );
        _launchWith(p);
    }

    function test_PackPrices() public {
        (MachineVault a,) =
            _launchWith(_params(GachaTypes.Strategy.BURN, GachaTypes.PackId.FORGE_28, 200, _noSplit()));
        (MachineVault b,) =
            _launchWith(_params(GachaTypes.Strategy.BURN, GachaTypes.PackId.FORGE_48, 200, _noSplit()));
        (MachineVault c,) =
            _launchWith(_params(GachaTypes.Strategy.BURN, GachaTypes.PackId.FORGE_88, 200, _noSplit()));
        assertEq(a.packPriceUsd(), 28);
        assertEq(b.packPriceUsd(), 48);
        assertEq(c.packPriceUsd(), 88);
    }

    function test_RevertInvalidTax() public {
        uint16[8] memory bad = [uint16(0), 100, 199, 201, 300, 500, 1000, 2000];
        for (uint256 i; i < bad.length; i++) {
            GachaForgeFactory.LaunchParams memory p =
                _params(GachaTypes.Strategy.RAFFLE, GachaTypes.PackId.FORGE_28, bad[i], _noSplit());
            vm.prank(creator);
            vm.expectRevert(GachaForgeFactory.InvalidTax.selector);
            factory.launch(p);
        }
    }

    function test_OnlyFixedTaxAccepted() public {
        (MachineVault v,) =
            _launchWith(_params(GachaTypes.Strategy.RAFFLE, GachaTypes.PackId.FORGE_28, 200, _noSplit()));
        assertEq(v.taxBps(), 200);
    }

    function test_RevertInvalidSplit() public {
        GachaForgeFactory.LaunchParams memory p = _params(
            GachaTypes.Strategy.SPLIT, GachaTypes.PackId.FORGE_28, 200, GachaTypes.SplitBps(5000, 3000, 1000)
        );
        vm.prank(creator);
        vm.expectRevert(GachaForgeFactory.InvalidSplit.selector);
        factory.launch(p);

        // non-SPLIT strategy with a split set
        p = _params(GachaTypes.Strategy.BURN, GachaTypes.PackId.FORGE_28, 200, GachaTypes.SplitBps(10000, 0, 0));
        vm.prank(creator);
        vm.expectRevert(GachaForgeFactory.InvalidSplit.selector);
        factory.launch(p);
    }

    function test_SameSaltDifferentCreatorsDifferentVaults() public {
        GachaForgeFactory.LaunchParams memory p =
            _params(GachaTypes.Strategy.RAFFLE, GachaTypes.PackId.FORGE_28, 200, _noSplit());
        assertTrue(factory.predictVault(creator, p.salt) != factory.predictVault(trader, p.salt));
        _launchWith(p);
        vm.prank(trader);
        factory.launch(p);
        assertEq(factory.machineCount(), 2);
        // same creator + same salt collides
        vm.prank(creator);
        vm.expectRevert();
        factory.launch(p);
    }

    function test_PauseBlocksLaunch() public {
        vm.prank(pauser);
        factory.pause();
        GachaForgeFactory.LaunchParams memory p =
            _params(GachaTypes.Strategy.RAFFLE, GachaTypes.PackId.FORGE_28, 200, _noSplit());
        vm.prank(creator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        factory.launch(p);

        vm.prank(pauser);
        vm.expectRevert();
        factory.unpause();
        vm.prank(admin);
        factory.unpause();
        _launchWith(p);
    }

    function test_OnlyPauserCanPause() public {
        bytes32 role = factory.PAUSER_ROLE();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, creator, role));
        factory.pause();
    }

    function test_AdminSetters() public {
        vm.startPrank(admin);
        factory.setPullCooldown(120);
        assertEq(factory.pullCooldown(), 120);
        vm.expectRevert(GachaForgeFactory.InvalidCooldown.selector);
        factory.setPullCooldown(1);
        factory.setPriceFeed(address(feed), 600);
        assertEq(factory.maxPriceAge(), 600);
        factory.setRouter(address(router));
        factory.setFlapLauncher(address(flap));
        factory.setPaymentReceiver(address(renaiss));
        factory.setTreasury(treasury);
        factory.setBuybackBurner(address(burner));
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert();
        factory.setPullCooldown(120);
    }

    function test_LaunchContextOnlyDuringLaunch() public {
        vm.expectRevert(GachaForgeFactory.NoContext.selector);
        factory.launchContext();
    }

    function test_VaultCannotBeDeployedOutsideFactory() public {
        vm.expectRevert();
        new MachineVault();
    }
}

contract TaxSplitTest is Base {
    MachineVault v;
    MockERC20 t;

    function setUp() public override {
        super.setUp();
        (v, t) = _launch(GachaTypes.Strategy.RAFFLE);
    }

    function test_SplitOnReceiveThenSync() public {
        _tax(v, 1 ether);
        assertEq(v.pot(), 0.07 ether);
        assertEq(address(burner).balance, 0.03 ether);
        assertEq(treasury.balance, 0.9 ether);
        assertEq(address(v).balance, 0.07 ether);
        assertEq(v.buybackOwed(), 0);
        assertEq(v.treasuryOwed(), 0);
        assertEq(burner.totalBnbReceived(), 0.03 ether);
    }

    function test_LowGasTransferDoesNotRevert_ThenSync() public {
        vm.deal(address(this), 1 ether);
        payable(address(v)).transfer(1 ether); // 2300 gas stipend
        assertEq(v.pot(), 0, "not split yet");
        assertEq(address(v).balance, 1 ether);
        v.sync();
        assertEq(v.pot(), 0.07 ether);
        assertEq(address(burner).balance, 0.03 ether);
        assertEq(treasury.balance, 0.9 ether);
    }

    function test_SyncIdempotent() public {
        _tax(v, 1 ether);
        v.sync();
        v.sync();
        assertEq(v.pot(), 0.07 ether);
        assertEq(treasury.balance, 0.9 ether);
    }

    function test_EmitsTaxReceived() public {
        vm.prank(trader);
        (bool ok,) = address(v).call{value: 1 ether}("");
        assertTrue(ok);
        vm.expectEmit(address(v));
        emit MachineVault.TaxReceived(1 ether, 0.07 ether, 0.03 ether, 0.9 ether);
        v.sync();
    }

    function test_SplitConstants() public view {
        assertEq(v.POT_BPS() + v.BUYBACK_BPS() + v.TREASURY_BPS(), 10_000);
        assertEq(v.TREASURY_BPS(), 9_000);
        assertEq(v.POT_BPS() + v.BUYBACK_BPS(), 1_000);
    }

    function test_ForwardFailureKeepsOwedAndDoesNotRevert() public {
        // new factory whose treasury rejects BNB
        RejectingReceiver bad = new RejectingReceiver();
        vm.prank(admin);
        factory.setTreasury(address(bad));
        GachaForgeFactory.LaunchParams memory p =
            _params(GachaTypes.Strategy.BURN, GachaTypes.PackId.FORGE_28, 200, _noSplit());
        (MachineVault v2,) = _launchWith(p);
        _tax(v2, 1 ether);
        assertEq(v2.pot(), 0.07 ether);
        assertEq(v2.treasuryOwed(), 0.9 ether);
        assertEq(v2.buybackOwed(), 0);
        assertEq(address(v2).balance, 0.97 ether);
        // more tax still accounted correctly
        _tax(v2, 1 ether);
        assertEq(v2.pot(), 0.14 ether);
        assertEq(v2.treasuryOwed(), 1.8 ether);
        assertEq(v2.trackedBalance(), address(v2).balance);
    }

    function testFuzz_SplitMath(uint256 amount) public view {
        amount = bound(amount, 0, type(uint128).max);
        (uint256 p, uint256 b, uint256 tr) = v.splitTax(amount);
        assertEq(p + b + tr, amount, "conservation");
        assertEq(p, (amount * 700) / 10000);
        assertEq(b, (amount * 300) / 10000);
        assertLe(tr, (amount * 9000) / 10000 + 2);
        assertGe(tr, (amount * 9000) / 10000);
    }

    function testFuzz_TaxIntakeConservation(uint96 a, uint96 b) public {
        uint256 x = bound(uint256(a), 1, 1_000 ether);
        uint256 y = bound(uint256(b), 1, 1_000 ether);
        vm.deal(trader, x + y);
        _tax(v, x);
        _tax(v, y);
        (uint256 p1,,) = v.splitTax(x);
        (uint256 p2,,) = v.splitTax(y);
        assertEq(v.pot(), p1 + p2);
        assertEq(address(v).balance, v.trackedBalance());
        assertEq(address(v).balance + address(burner).balance + treasury.balance, x + y);
    }
}
