// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFlapLauncher
/// @notice Adapter boundary for creating a tax token on the flap.sh launchpad.
/// @dev All flap.sh-specific encoding (portal address, vanity salts, fee params, meta format,
///      initial-buy semantics) lives in the concrete adapter. Core contracts only rely on this.
interface IFlapLauncher {
    struct TokenParams {
        string name;
        string symbol;
        string meta; // metadata URI / IPFS CID as required by flap.sh
        uint16 taxBps; // buy & sell tax, always 200 (2%)
        address taxReceiver; // MachineVault (receives 100% of tax in BNB)
        address creator; // receives any initial-buy tokens
        bytes32 salt; // optional vanity / uniqueness salt, adapter-defined
        bytes extraData; // adapter-specific opaque data
    }

    /// @notice Create the token. msg.value is an optional initial buy forwarded to flap.sh.
    /// @return token the new token address
    function createToken(TokenParams calldata params) external payable returns (address token);
}
