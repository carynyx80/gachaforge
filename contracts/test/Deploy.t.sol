// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {FlapLauncher} from "../src/adapters/FlapLauncher.sol";
import {IFlapLauncher} from "../src/interfaces/IFlapLauncher.sol";

contract DeployScriptTest is Test {
    function test_DeployWiresTimelockAndRoles() public {
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
        bytes32 adminRole = 0x00;
        assertTrue(d.factory.hasRole(adminRole, address(d.timelock)));
        assertTrue(d.burner.hasRole(adminRole, address(d.timelock)));
        assertFalse(d.factory.hasRole(adminRole, address(this)));
        assertFalse(d.factory.hasRole(adminRole, msg.sender));
        assertTrue(d.factory.hasRole(d.factory.OPERATOR_ROLE(), op));
        assertTrue(d.factory.hasRole(d.factory.PAUSER_ROLE(), ms));
        assertTrue(d.timelock.hasRole(d.timelock.PROPOSER_ROLE(), ms));
        assertTrue(d.timelock.hasRole(d.timelock.EXECUTOR_ROLE(), ms));
        assertEq(d.timelock.getMinDelay(), 2 days);
        assertEq(address(d.launcher.factory()), address(d.factory));
    }
}

contract FlapLauncherUnitTest is Test {
    function test_OnlyFactoryAndVanity() public {
        FlapLauncher l = new FlapLauncher(makeAddr("portal"), address(0), makeAddr("impl"), 1, 1);
        l.setFactory(address(this));
        vm.expectRevert(FlapLauncher.AlreadySet.selector);
        l.setFactory(address(1));

        IFlapLauncher.TokenParams memory p;
        p.taxBps = 500; // only the fixed 2% is accepted
        vm.expectRevert(FlapLauncher.InvalidTax.selector);
        l.createToken(p);
        p.taxBps = 200;
        // find a salt whose predicted address does NOT end in 7777 (almost any)
        p.salt = bytes32(uint256(1));
        address pred = l.predictToken(p.salt);
        if (uint160(pred) & 0xFFFF != 0x7777) {
            vm.expectRevert(abi.encodeWithSelector(FlapLauncher.BadVanity.selector, pred));
            l.createToken(p);
        }
        vm.prank(makeAddr("rando"));
        vm.expectRevert(FlapLauncher.NotFactory.selector);
        l.createToken(p);
    }

    function test_NewVaultOnlyVaultPortal() public {
        FlapLauncher l = new FlapLauncher(makeAddr("portal"), makeAddr("vp"), makeAddr("impl"), 1, 1);
        vm.expectRevert(FlapLauncher.NotVaultPortal.selector);
        l.newVault(address(1), address(0), address(2), "");
    }
}
