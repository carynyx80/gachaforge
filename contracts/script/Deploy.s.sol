// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {GachaForgeFactory} from "../src/GachaForgeFactory.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {FlapLauncher} from "../src/adapters/FlapLauncher.sol";
import {FlapRouter} from "../src/adapters/FlapRouter.sol";

/// @notice Deploys TimelockController (proposer/executor = 2-of-3 Safe), flap adapters,
///         BuybackBurner and GachaForgeFactory; wires roles, then hands admin to the timelock.
/// forge script script/Deploy.s.sol --rpc-url bsc --broadcast --verify
contract Deploy is Script {
    struct Deployed {
        TimelockController timelock;
        FlapLauncher launcher;
        FlapRouter router;
        BuybackBurner burner;
        GachaForgeFactory factory;
    }

    function run() external returns (Deployed memory d) {
        address feed = vm.envAddress("CHAINLINK_BNB_USD");
        address treasury = vm.envAddress("TREASURY");
        address multisig = vm.envAddress("MULTISIG");
        address operator = vm.envAddress("OPERATOR");
        address forge = vm.envAddress("FORGE_TOKEN");
        address paymentReceiver = vm.envAddress("RENAISS_PAYMENT_RECEIVER");
        address portal = vm.envAddress("FLAP_PORTAL");
        address vaultPortal = vm.envOr("FLAP_VAULT_PORTAL", address(0)); // 0 => Portal.newTokenV6 mode
        address taxImpl = vm.envAddress("FLAP_TAX_TOKEN_IMPL");
        address pancake = vm.envAddress("PANCAKE_ROUTER");
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(2 days));
        uint64 taxDuration = uint64(vm.envOr("FLAP_TAX_DURATION", uint256(100 * 365 days)));
        uint64 antiFarmer = uint64(vm.envOr("FLAP_ANTI_FARMER_DURATION", uint256(3 days)));
        uint256 maxPriceAge = vm.envOr("PRICE_MAX_AGE", uint256(1 hours));

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        address[] memory ms = new address[](1);
        ms[0] = multisig;
        d.timelock = new TimelockController(delay, ms, ms, address(0));

        d.launcher = new FlapLauncher(portal, vaultPortal, taxImpl, taxDuration, antiFarmer);
        d.router = new FlapRouter(portal, pancake);

        d.burner = new BuybackBurner(deployer, forge, address(d.router));
        d.factory = new GachaForgeFactory(
            deployer, feed, address(d.router), address(d.launcher), paymentReceiver, treasury, address(d.burner)
        );
        d.launcher.setFactory(address(d.factory));
        if (maxPriceAge != 1 hours) d.factory.setPriceFeed(feed, maxPriceAge);

        // roles
        d.factory.grantRole(d.factory.OPERATOR_ROLE(), operator);
        d.factory.grantRole(d.factory.PAUSER_ROLE(), multisig);
        d.factory.grantRole(d.factory.PAUSER_ROLE(), operator); // fast emergency pause (cannot unpause)
        d.factory.grantRole(d.factory.UNPAUSER_ROLE(), multisig);
        d.burner.grantRole(d.burner.OPERATOR_ROLE(), operator);

        // admin -> timelock, deployer renounces
        bytes32 adminRole = d.factory.DEFAULT_ADMIN_ROLE();
        d.factory.grantRole(adminRole, address(d.timelock));
        d.burner.grantRole(adminRole, address(d.timelock));
        d.factory.renounceRole(adminRole, deployer);
        d.burner.renounceRole(adminRole, deployer);
        vm.stopBroadcast();

        console2.log("TimelockController", address(d.timelock));
        console2.log("FlapLauncher      ", address(d.launcher));
        console2.log("FlapRouter        ", address(d.router));
        console2.log("BuybackBurner     ", address(d.burner));
        console2.log("GachaForgeFactory ", address(d.factory));
    }
}
