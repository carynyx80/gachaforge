// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {GachaForgeFactory} from "../../src/GachaForgeFactory.sol";
import {MachineVault} from "../../src/MachineVault.sol";
import {GachaTypes} from "../../src/libraries/GachaTypes.sol";
import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";
import {IFlapPortal, IFlapPortalTypes} from "../../src/adapters/flap/IFlapPortal.sol";

interface IFlapTaxTokenV3View {
    function taxProcessor() external view returns (address);
    function buyTaxRate() external view returns (uint16);
    function sellTaxRate() external view returns (uint16);
    function state() external view returns (uint8);
    function totalSupply() external view returns (uint256);
}

interface ITaxProcessorView {
    function marketAddress() external view returns (address);
    function commissionReceiver() external view returns (address);
    function marketQuoteBalance() external view returns (uint256);
    function feeQuoteBalance() external view returns (uint256);
    function dispatch() external;
}

/// @notice BSC mainnet fork tests against real flap.sh + Chainlink state.
///         Skipped unless BSC_RPC_URL is set:
///         BSC_RPC_URL=https://bsc-rpc.publicnode.com forge test --match-path 'test/fork/*' -vv
contract FlapMainnetForkTest is Test {
    address constant FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    address constant PORTAL = 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0;
    address constant VAULT_PORTAL = 0x90497450f2a706f1951b5bdda52B4E5d16f34C06;
    address constant TAX_IMPL = 0x024f18294970B5c76c0691b87f138A0317156422;
    address constant PANCAKE = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant COMPANY = 0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address operator = makeAddr("operator-hot-wallet");
    address renaiss = makeAddr("renaiss-payment-receiver");
    address creator = makeAddr("creator");
    address trader = makeAddr("trader");

    Deploy.Deployed d;

    function setUp() public {
        string memory rpc = vm.envOr("BSC_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 56);

        vm.setEnv("CHAINLINK_BNB_USD", vm.toString(FEED));
        vm.setEnv("TREASURY", vm.toString(COMPANY));
        vm.setEnv("MULTISIG", vm.toString(COMPANY));
        vm.setEnv("OPERATOR", vm.toString(operator));
        vm.setEnv("FORGE_TOKEN", ""); // $FORGE does not exist yet
        vm.setEnv("RENAISS_PAYMENT_RECEIVER", vm.toString(renaiss));
        vm.setEnv("FLAP_PORTAL", vm.toString(PORTAL));
        vm.setEnv("FLAP_VAULT_PORTAL", "0x0000000000000000000000000000000000000000"); // Portal mode
        vm.setEnv("FLAP_TAX_TOKEN_IMPL", vm.toString(TAX_IMPL));
        vm.setEnv("PANCAKE_ROUTER", vm.toString(PANCAKE));
        vm.setEnv("TIMELOCK_DELAY", "172800");
        vm.setEnv("FLAP_TAX_DURATION", vm.toString(uint256(100 * 365 days)));
        vm.setEnv("FLAP_ANTI_FARMER_DURATION", "259200");
        vm.setEnv("PRICE_MAX_AGE", "3600");
        d = new Deploy().run();

        vm.deal(creator, 10 ether);
        vm.deal(trader, 100 ether);
    }

    // ------------------------------------------------------------------ (b) deploy script on fork

    function test_DeployScriptOnFork() public view {
        assertTrue(d.factory.hasRole(0x00, address(d.timelock)));
        assertTrue(d.burner.hasRole(0x00, address(d.timelock)));
        assertTrue(d.timelock.hasRole(d.timelock.PROPOSER_ROLE(), COMPANY));
        assertTrue(d.timelock.hasRole(d.timelock.EXECUTOR_ROLE(), COMPANY));
        assertTrue(d.factory.hasRole(d.factory.UNPAUSER_ROLE(), COMPANY));
        assertTrue(d.factory.hasRole(d.factory.OPERATOR_ROLE(), operator));
        assertEq(d.factory.treasury(), COMPANY);
        assertEq(address(d.factory.priceFeed()), FEED);
        assertEq(address(d.burner.forge()), address(0));
        assertEq(address(d.launcher.vaultPortal()), address(0));
        assertEq(d.timelock.getMinDelay(), 2 days);
    }

    // ------------------------------------------------------------------ (a) Chainlink via vault + (c) launch

    function test_LaunchBuySellTaxSplit() public {
        // Chainlink feed sanity (raw)
        AggregatorV3Interface feed = AggregatorV3Interface(FEED);
        assertEq(feed.decimals(), 8, "feed decimals");
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertGt(answer, 100e8, "BNB > $100");
        assertLt(answer, 10_000e8, "BNB < $10k");
        assertLe(block.timestamp - updatedAt, 3600, "feed fresh");
        console2.log("Chainlink BNB/USD (8d):", uint256(answer));

        // mine a salt so the Portal CREATE2 clone ends in 0x7777
        bytes32 salt = _mineSalt();
        address predicted = d.launcher.predictToken(salt);
        console2.log("predicted token:", predicted);

        GachaForgeFactory.LaunchParams memory p;
        p.name = "GachaForge Fork Test";
        p.symbol = "GFFT";
        p.meta = "bafkreigachaforgeforktest";
        p.packId = GachaTypes.PackId.FORGE_28;
        p.strategy = GachaTypes.Strategy.RAFFLE;
        p.taxBps = 500;
        p.salt = salt;

        vm.prank(creator);
        (address token, address vault) = d.factory.launch(p);
        MachineVault v = MachineVault(payable(vault));
        assertEq(token, predicted, "token == predicted");
        assertEq(uint160(token) & 0xFFFF, 0x7777, "vanity 7777");
        assertGt(vault.code.length, 0, "vault deployed");
        assertEq(v.token(), token);

        // (a) price through the vault
        uint256 expected = (28 * 1e18 * 1e8) / uint256(answer);
        assertEq(v.packPriceBnb(), expected, "packPriceBnb");
        console2.log("FORGE_28 price (wei):", v.packPriceBnb());

        // token state on flap
        IFlapPortalTypes.TokenStateV8Safe memory st = IFlapPortal(PORTAL).getTokenV8Safe(token);
        assertEq(st.status, 1, "on bonding curve");
        assertEq(st.tokenVersion, 6, "TOKEN_TAXED_V3");
        assertEq(st.buyTaxRate, 500);
        assertEq(st.sellTaxRate, 500);
        assertEq(st.quoteTokenAddress, address(0), "BNB quote");
        IFlapTaxTokenV3View t = IFlapTaxTokenV3View(token);
        assertEq(t.buyTaxRate(), 500);
        assertEq(t.sellTaxRate(), 500);
        assertEq(t.totalSupply(), 1_000_000_000e18, "1B supply");
        ITaxProcessorView tp = ITaxProcessorView(t.taxProcessor());
        assertEq(tp.marketAddress(), vault, "vault is tax beneficiary");
        assertEq(tp.commissionReceiver(), address(0), "no commission");

        // ---- buy 1 BNB via Portal.swapExactInput
        uint256 buyIn = 1 ether;
        vm.prank(trader);
        uint256 got = IFlapPortal(PORTAL).swapExactInput{value: buyIn}(
            IFlapPortalTypes.ExactInputParams(address(0), token, buyIn, 0, "")
        );
        assertGt(got, 0, "bought tokens");
        assertEq(IERC20(token).balanceOf(trader), got);
        uint256 vaultAfterBuy = _dispatch(tp, vault);
        console2.log("vault BNB after buy+dispatch:", vaultAfterBuy);
        assertGt(vaultAfterBuy, 0, "buy taxed -> vault");

        // ---- sell half via Portal.swapExactInput
        vm.startPrank(trader);
        IERC20(token).approve(PORTAL, got / 2);
        uint256 bnbOut = IFlapPortal(PORTAL).swapExactInput(
            IFlapPortalTypes.ExactInputParams(token, address(0), got / 2, 0, "")
        );
        vm.stopPrank();
        assertGt(bnbOut, 0, "sold for BNB");
        uint256 vaultAfterSell = _dispatch(tp, vault);
        uint256 sellTax = vaultAfterSell - vaultAfterBuy;
        console2.log("sell BNB out:", bnbOut);
        console2.log("vault BNB from sell tax:", sellTax);
        assertGt(sellTax, 0, "sell taxed -> vault");

        // share of nominal 5% tax that reached the vault (buy leg)
        console2.log("buy-leg vault share of nominal tax (bps):", (vaultAfterBuy * 10_000) / (buyIn * 500 / 10_000));

        // ---- sync splits 70/20/10
        uint256 treasuryBefore = COMPANY.balance;
        uint256 burnerBefore = address(d.burner).balance;
        v.sync();
        uint256 total = vaultAfterSell;
        assertEq(v.pot(), (total * 7000) / 10_000, "70% pot");
        assertEq(address(d.burner).balance - burnerBefore, (total * 2000) / 10_000, "20% burner");
        assertEq(COMPANY.balance - treasuryBefore, total - (total * 7000) / 10_000 - (total * 2000) / 10_000, "10%");
        assertEq(address(vault).balance, v.pot(), "only pot left");
        assertEq(d.burner.totalBnbReceived(), (total * 2000) / 10_000);
        console2.log("pot after sync:", v.pot());

        // burner holds BNB while $FORGE is unset; buyback reverts cleanly
        vm.prank(operator);
        vm.expectRevert();
        d.burner.buybackAndBurn(1, 0);
    }

    /// @notice Informational: does the VaultPortal flow (our launcher as IVaultFactory) work?
    ///         Not used for the mainnet config (Portal mode), so failure here is reported, not fatal.
    function test_VaultPortalFlowProbe() public {
        vm.setEnv("FLAP_VAULT_PORTAL", vm.toString(VAULT_PORTAL));
        Deploy.Deployed memory d2 = new Deploy().run();
        vm.setEnv("FLAP_VAULT_PORTAL", "0x0000000000000000000000000000000000000000");
        GachaForgeFactory.LaunchParams memory p;
        p.name = "GachaForge VP Probe";
        p.symbol = "GFVP";
        p.meta = "bafkreigachaforgevpprobe";
        p.packId = GachaTypes.PackId.FORGE_28;
        p.strategy = GachaTypes.Strategy.RAFFLE;
        p.taxBps = 500;
        p.salt = _mineSalt();
        vm.prank(creator);
        try d2.factory.launch(p) returns (address token, address vault) {
            console2.log("VaultPortal flow OK, token:", token);
            assertEq(ITaxProcessorView(IFlapTaxTokenV3View(token).taxProcessor()).marketAddress(), vault);
        } catch (bytes memory err) {
            console2.log("VaultPortal flow REVERTED:");
            console2.logBytes(err);
        }
    }

    function _dispatch(ITaxProcessorView tp, address vault) internal returns (uint256) {
        tp.dispatch(); // permissionless (called from this test contract, no role)
        return vault.balance;
    }

    function _mineSalt() internal view returns (bytes32 salt) {
        bytes32 initHash = keccak256(
            abi.encodePacked(hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", TAX_IMPL, hex"5af43d82803e903d91602b57fd5bf3")
        );
        bytes32 seed = keccak256(abi.encode(block.number, block.timestamp, "gachaforge"));
        for (uint256 i;; ++i) {
            salt = keccak256(abi.encode(seed, i));
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), PORTAL, salt, initHash)))));
            if (uint160(a) & 0xFFFF == 0x7777 && a.code.length == 0) return salt;
        }
    }
}
