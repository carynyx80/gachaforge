// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GachaForgeFactory} from "../src/GachaForgeFactory.sol";
import {MachineVault} from "../src/MachineVault.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {GachaTypes} from "../src/libraries/GachaTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {MockFlapLauncher} from "./mocks/MockFlapLauncher.sol";
import {MockRouter} from "./mocks/MockRouter.sol";
import {PaymentReceiver} from "./mocks/Receivers.sol";

abstract contract Base is Test {
    address internal admin = makeAddr("timelock");
    address internal operator = makeAddr("operator");
    address internal pauser = makeAddr("pauser");
    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal trader = makeAddr("trader");
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    GachaForgeFactory internal factory;
    BuybackBurner internal burner;
    MockPriceFeed internal feed;
    MockFlapLauncher internal flap;
    MockRouter internal router;
    MockERC20 internal forge;
    PaymentReceiver internal renaiss;

    int256 internal constant BNB_USD = 600e8; // $600

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        feed = new MockPriceFeed(BNB_USD);
        flap = new MockFlapLauncher();
        router = new MockRouter();
        forge = new MockERC20("Forge", "FORGE");
        renaiss = new PaymentReceiver();
        burner = new BuybackBurner(admin, address(forge), address(router));
        factory = new GachaForgeFactory(
            admin, address(feed), address(router), address(flap), address(renaiss), treasury, address(burner)
        );
        vm.startPrank(admin);
        factory.grantRole(factory.OPERATOR_ROLE(), operator);
        factory.grantRole(factory.PAUSER_ROLE(), pauser);
        factory.grantRole(factory.UNPAUSER_ROLE(), admin);
        burner.grantRole(burner.OPERATOR_ROLE(), operator);
        vm.stopPrank();
        vm.deal(trader, 10_000 ether);
        vm.deal(operator, 1_000 ether);
    }

    function _params(GachaTypes.Strategy s, GachaTypes.PackId pack, uint16 tax, GachaTypes.SplitBps memory split)
        internal
        pure
        returns (GachaForgeFactory.LaunchParams memory p)
    {
        p.name = "Pika Machine";
        p.symbol = "PIKA";
        p.meta = "ipfs://meta";
        p.packId = pack;
        p.strategy = s;
        p.taxBps = tax;
        p.split = split;
        p.salt = keccak256(abi.encode(s, pack, tax));
    }

    function _noSplit() internal pure returns (GachaTypes.SplitBps memory) {
        return GachaTypes.SplitBps(0, 0, 0);
    }

    function _launch(GachaTypes.Strategy s) internal returns (MachineVault v, MockERC20 t) {
        GachaTypes.SplitBps memory sp =
            s == GachaTypes.Strategy.SPLIT ? GachaTypes.SplitBps(5000, 3000, 2000) : _noSplit();
        return _launchWith(_params(s, GachaTypes.PackId.FORGE_28, 200, sp));
    }

    function _launchWith(GachaForgeFactory.LaunchParams memory p) internal returns (MachineVault v, MockERC20 t) {
        vm.prank(creator);
        (address token, address vault) = factory.launch(p);
        v = MachineVault(payable(vault));
        t = MockERC20(token);
    }

    /// @dev Simulate the launchpad paying tax to the vault with plenty of gas.
    function _tax(MachineVault v, uint256 amount) internal {
        vm.prank(trader);
        (bool ok,) = address(v).call{value: amount}("");
        assertTrue(ok, "tax transfer");
        v.sync(); // keeper / anyone applies the split
    }

    function _price28() internal pure returns (uint256) {
        return (28 * 1e18 * 1e8) / uint256(BNB_USD);
    }

    /// @dev Fund pot, open a pull for exactly the pack price, settle with zero refund.
    function _pullAndSettle(MachineVault v, uint256 cardValueUsd) internal returns (uint256 id) {
        if (v.pot() < v.packPriceBnb()) _tax(v, 1 ether);
        uint256 price = v.packPriceBnb();
        vm.prank(operator);
        id = v.openPull(price);
        vm.prank(operator);
        v.settlePull(id, 0, cardValueUsd);
    }

    // ---------------------------------------------------------------- merkle helpers (OZ sorted-pair)

    function _leaf(address a, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, amt))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev 4-leaf tree: returns root and proofs for each leaf.
    function _tree4(bytes32[4] memory l) internal pure returns (bytes32 root, bytes32[][] memory proofs) {
        bytes32 n01 = _hashPair(l[0], l[1]);
        bytes32 n23 = _hashPair(l[2], l[3]);
        root = _hashPair(n01, n23);
        proofs = new bytes32[][](4);
        for (uint256 i; i < 4; i++) {
            proofs[i] = new bytes32[](2);
        }
        proofs[0][0] = l[1];
        proofs[0][1] = n23;
        proofs[1][0] = l[0];
        proofs[1][1] = n23;
        proofs[2][0] = l[3];
        proofs[2][1] = n01;
        proofs[3][0] = l[2];
        proofs[3][1] = n01;
    }
}
