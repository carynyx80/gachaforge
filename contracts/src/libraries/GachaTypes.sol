// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library GachaTypes {
    enum Strategy {
        RAFFLE, // 0
        HIT_HUNTER, // 1
        DIVIDEND, // 2
        BURN, // 3
        SPLIT // 4
    }

    enum PackId {
        FORGE_28,
        FORGE_48,
        FORGE_88
    }

    struct SplitBps {
        uint16 dividendBps;
        uint16 burnBps;
        uint16 lpBps;
    }

    struct VaultConfig {
        address token;
        address treasury;
        address buybackBurner;
        PackId packId;
        uint256 packPriceUsd; // whole USD
        Strategy strategy;
        uint16 taxBps;
        SplitBps split;
    }

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function packPriceUsd(PackId id) internal pure returns (uint256) {
        if (id == PackId.FORGE_28) return 28;
        if (id == PackId.FORGE_48) return 48;
        return 88;
    }
}
