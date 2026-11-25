// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFlapLauncher} from "../../src/interfaces/IFlapLauncher.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Stands in for the flap.sh portal: deploys a plain ERC20 (1B supply) and records the
///         tax receiver so tests can assert the vault was wired as receiver.
contract MockFlapLauncher is IFlapLauncher {
    mapping(address => address) public taxReceiverOf;
    mapping(address => uint16) public taxBpsOf;
    address public lastToken;
    uint256 public lastValue;

    function createToken(TokenParams calldata p) external payable override returns (address token) {
        MockERC20 t = new MockERC20(p.name, p.symbol);
        t.mint(p.creator, 1_000_000_000 ether);
        token = address(t);
        taxReceiverOf[token] = p.taxReceiver;
        taxBpsOf[token] = p.taxBps;
        lastToken = token;
        lastValue = msg.value;
    }
}

interface IDeployPending {
    function deployPendingVault(address token) external returns (address);
}

/// @notice Emulates the flap VaultPortal flow: the vault is deployed via factory callback while
///         the token is being created.
contract MockFlapVaultLauncher is IFlapLauncher {
    address public factory;
    address public lastVault;

    function setFactory(address f) external {
        factory = f;
    }

    function createToken(TokenParams calldata p) external payable override returns (address token) {
        MockERC20 t = new MockERC20(p.name, p.symbol);
        token = address(t);
        lastVault = IDeployPending(factory).deployPendingVault(token);
        require(lastVault == p.taxReceiver, "vault != receiver");
        t.mint(p.creator, 1_000_000_000 ether);
    }
}
