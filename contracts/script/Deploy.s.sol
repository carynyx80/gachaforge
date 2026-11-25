// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {GachaForgeFactory} from "../src/GachaForgeFactory.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {FlapLauncher} from "../src/adapters/FlapLauncher.sol";
import {FlapRouter} from "../src/adapters/FlapRouter.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/// @notice Deploys TimelockController (proposer/executor = MULTISIG), flap adapters,
///         BuybackBurner and GachaForgeFactory; wires roles, then hands admin to the timelock.
///         The deployer keeps NO role afterwards.
///
/// Dry run (no tx):   forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL
/// Mainnet (signed by the user, e.g. Ledger):
///   forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL --broadcast --verify --ledger --sender <addr>
/// See docs/DEPLOY-MAINNET.md. Never put a private key in .env.
///
/// FORGE_TOKEN may be empty / zero: BuybackBurner then accumulates BNB until the timelock
/// calls BuybackBurner.setForge(token) (one-shot).
contract Deploy is Script {
    struct Deployed {
        TimelockController timelock;
        FlapLauncher launcher;
        FlapRouter router;
        BuybackBurner burner;
        GachaForgeFactory factory;
    }

    struct Config {
        address feed;
        address treasury;
        address multisig;
        address operator;
        address forge;
        address paymentReceiver;
        address portal;
        address vaultPortal;
        address taxImpl;
        address pancake;
        uint256 delay;
        uint64 taxDuration;
        uint64 antiFarmer;
        uint256 maxPriceAge;
    }

    error ConfigInvalid(string what);

    function _config() internal view returns (Config memory c) {
        c.feed = vm.envAddress("CHAINLINK_BNB_USD");
        c.treasury = vm.envAddress("TREASURY");
        c.multisig = vm.envAddress("MULTISIG");
        c.operator = vm.envAddress("OPERATOR");
        c.forge = _envAddrOrZero("FORGE_TOKEN");
        c.paymentReceiver = _envAddrOrZero("RENAISS_PAYMENT_RECEIVER");
        c.portal = vm.envAddress("FLAP_PORTAL");
        c.vaultPortal = _envAddrOrZero("FLAP_VAULT_PORTAL"); // 0 => Portal.newTokenV6 mode
        c.taxImpl = vm.envAddress("FLAP_TAX_TOKEN_IMPL");
        c.pancake = vm.envAddress("PANCAKE_ROUTER");
        c.delay = vm.envOr("TIMELOCK_DELAY", uint256(2 days));
        c.taxDuration = uint64(vm.envOr("FLAP_TAX_DURATION", uint256(100 * 365 days)));
        c.antiFarmer = uint64(vm.envOr("FLAP_ANTI_FARMER_DURATION", uint256(3 days)));
        c.maxPriceAge = vm.envOr("PRICE_MAX_AGE", uint256(1 hours));
    }

    /// @dev Treats unset, empty ("FORGE_TOKEN=") and 0x0 the same.
    function _envAddrOrZero(string memory key) internal view returns (address) {
        string memory raw = vm.envOr(key, string(""));
        if (bytes(raw).length == 0) return address(0);
        return vm.parseAddress(raw);
    }

    function _validate(Config memory c) internal view {
        if (c.treasury == address(0)) revert ConfigInvalid("TREASURY");
        if (c.multisig == address(0)) revert ConfigInvalid("MULTISIG");
        if (c.operator == address(0)) revert ConfigInvalid("OPERATOR");
        if (c.operator == c.multisig) revert ConfigInvalid("OPERATOR must differ from MULTISIG");
        if (block.chainid == 56) {
            if (c.feed.code.length == 0) revert ConfigInvalid("CHAINLINK_BNB_USD has no code");
            if (AggregatorV3Interface(c.feed).decimals() != 8) revert ConfigInvalid("feed decimals");
            (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(c.feed).latestRoundData();
            if (answer <= 0 || block.timestamp - updatedAt > c.maxPriceAge) revert ConfigInvalid("feed stale");
            if (c.portal.code.length == 0) revert ConfigInvalid("FLAP_PORTAL has no code");
            if (c.taxImpl.code.length == 0) revert ConfigInvalid("FLAP_TAX_TOKEN_IMPL has no code");
            if (c.pancake.code.length == 0) revert ConfigInvalid("PANCAKE_ROUTER has no code");
            if (c.vaultPortal != address(0) && c.vaultPortal.code.length == 0) revert ConfigInvalid("VaultPortal");
            if (c.forge != address(0) && c.forge.code.length == 0) revert ConfigInvalid("FORGE_TOKEN has no code");
            if (c.delay < 1 days) revert ConfigInvalid("TIMELOCK_DELAY < 1 day on mainnet");
        }
    }

    function run() external returns (Deployed memory d) {
        Config memory c = _config();
        _validate(c);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        address[] memory ms = new address[](1);
        ms[0] = c.multisig;
        // admin = address(0): the timelock administers itself (role changes go through the delay)
        d.timelock = new TimelockController(c.delay, ms, ms, address(0));

        d.launcher = new FlapLauncher(c.portal, c.vaultPortal, c.taxImpl, c.taxDuration, c.antiFarmer);
        d.router = new FlapRouter(c.portal, c.pancake);

        d.burner = new BuybackBurner(deployer, c.forge, address(d.router));
        d.factory = new GachaForgeFactory(
            deployer, c.feed, address(d.router), address(d.launcher), c.paymentReceiver, c.treasury, address(d.burner)
        );
        d.launcher.setFactory(address(d.factory));
        if (c.maxPriceAge != 1 hours) d.factory.setPriceFeed(c.feed, c.maxPriceAge);

        // roles
        d.factory.grantRole(d.factory.OPERATOR_ROLE(), c.operator);
        d.factory.grantRole(d.factory.PAUSER_ROLE(), c.multisig);
        d.factory.grantRole(d.factory.PAUSER_ROLE(), c.operator); // fast emergency pause (cannot unpause)
        d.factory.grantRole(d.factory.UNPAUSER_ROLE(), c.multisig);
        d.burner.grantRole(d.burner.OPERATOR_ROLE(), c.operator);

        // admin -> timelock, deployer renounces
        bytes32 adminRole = d.factory.DEFAULT_ADMIN_ROLE();
        d.factory.grantRole(adminRole, address(d.timelock));
        d.burner.grantRole(adminRole, address(d.timelock));
        d.factory.renounceRole(adminRole, deployer);
        d.burner.renounceRole(adminRole, deployer);
        vm.stopBroadcast();

        _report(d, c, deployer);
    }

    function _report(Deployed memory d, Config memory c, address deployer) internal {
        console2.log("chainId           ", block.chainid);
        console2.log("deployer          ", deployer);
        console2.log("TimelockController", address(d.timelock));
        console2.log("FlapLauncher      ", address(d.launcher));
        console2.log("FlapRouter        ", address(d.router));
        console2.log("BuybackBurner     ", address(d.burner));
        console2.log("GachaForgeFactory ", address(d.factory));
        console2.log("treasury          ", c.treasury);
        console2.log("multisig/admin    ", c.multisig);
        console2.log("operator          ", c.operator);
        console2.log("forge (0 = unset) ", c.forge);
        console2.log("launch mode       ", c.vaultPortal == address(0) ? "Portal.newTokenV6" : "VaultPortal");

        // Only real broadcasts write deployments/<chainId>.json; dry runs write *.dryrun.json;
        // unit tests write nothing.
        string memory path;
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        } else if (vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) {
            path = string.concat("deployments/", vm.toString(block.chainid), ".dryrun.json");
        } else {
            return;
        }

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "block", block.number);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "TimelockController", address(d.timelock));
        vm.serializeAddress(k, "FlapLauncher", address(d.launcher));
        vm.serializeAddress(k, "FlapRouter", address(d.router));
        vm.serializeAddress(k, "BuybackBurner", address(d.burner));
        vm.serializeAddress(k, "GachaForgeFactory", address(d.factory));
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "multisig", c.multisig);
        vm.serializeAddress(k, "operator", c.operator);
        vm.serializeAddress(k, "forgeToken", c.forge);
        vm.serializeAddress(k, "renaissPaymentReceiver", c.paymentReceiver);
        vm.serializeAddress(k, "chainlinkBnbUsd", c.feed);
        vm.serializeAddress(k, "flapPortal", c.portal);
        vm.serializeAddress(k, "flapVaultPortal", c.vaultPortal);
        vm.serializeAddress(k, "flapTaxTokenImpl", c.taxImpl);
        vm.serializeAddress(k, "pancakeRouter", c.pancake);
        vm.serializeUint(k, "timelockDelay", c.delay);
        vm.serializeUint(k, "taxDuration", c.taxDuration);
        string memory json = vm.serializeUint(k, "antiFarmerDuration", c.antiFarmer);
        vm.createDir("deployments", true);
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
