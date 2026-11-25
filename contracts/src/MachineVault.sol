// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {GachaTypes} from "./libraries/GachaTypes.sol";
import {IGachaForgeFactory} from "./interfaces/IGachaForgeFactory.sol";
import {ILaunchpadRouter} from "./interfaces/ILaunchpadRouter.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title MachineVault
/// @notice One vault per GachaForge token. Receives 100% of the token's trading tax (fixed 2% buy /
///         2% sell) in BNB and splits it 90% treasury / 7% gacha pot / 3% $FORGE buyback
///         (POT_BPS / BUYBACK_BPS; treasury takes the remainder). Runs the pull
///         lifecycle (Renaiss packs) and routes results by the token's immutable strategy.
/// @dev The creator has no privileged rights here. All privileged actions are OPERATOR_ROLE on the
///      factory (revocable by the timelock admin). Config is immutable and read from the factory
///      during construction so the init code is constant (=> CREATE2 address known pre-token).
contract MachineVault is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant BPS = 10_000;
    // Tax split. Only POT_BPS / BUYBACK_BPS are set; treasury takes the remainder (incl. rounding).
    uint256 public constant POT_BPS = 700; // 7% gacha pot
    uint256 public constant BUYBACK_BPS = 300; // 3% $FORGE buyback (BuybackBurner)
    uint256 public constant TREASURY_BPS = BPS - POT_BPS - BUYBACK_BPS; // 90% treasury, for readability
    uint256 public constant SLIPPAGE_CAP_BPS = 11_000; // pull may spend up to price * 1.10
    uint256 public constant CLAIM_WINDOW = 180 days;
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    address public constant DEAD = GachaTypes.DEAD;

    // ---------------------------------------------------------------- immutables
    IGachaForgeFactory public immutable factory;
    address public immutable token;
    address public immutable treasury;
    address public immutable buybackBurner;
    GachaTypes.PackId public immutable packId;
    uint256 public immutable packPriceUsd;
    GachaTypes.Strategy public immutable strategy;
    uint16 public immutable taxBps;
    uint16 public immutable splitDividendBps;
    uint16 public immutable splitBurnBps;
    uint16 public immutable splitLpBps;

    // ---------------------------------------------------------------- accounting buckets (BNB)
    uint256 public pot; // gacha pot
    uint256 public dividendPool; // proceeds earmarked for dividends, not yet assigned to a round
    uint256 public dividendLiability; // assigned to rounds, unclaimed
    uint256 public burnReserve; // BNB to buy back & burn this token
    uint256 public lpReserve; // BNB to add as locked LP (SPLIT)
    uint256 public buybackOwed; // BUYBACK_BPS share not yet forwarded to BuybackBurner
    uint256 public treasuryOwed; // treasury share not yet forwarded to treasury

    // transient: router refund tracking during our own router calls (TLOAD/TSTORE fit in 2300 gas)
    address internal transient _refundSource;
    uint256 internal transient _refundReceived;

    // ---------------------------------------------------------------- pulls
    enum PullStatus {
        NONE,
        OPEN,
        SETTLED,
        WON,
        SOLD
    }

    struct Pull {
        uint128 amountSent;
        uint128 refunded;
        uint64 openedAt;
        uint64 settledAt;
        uint128 cardValueUsd;
        uint128 proceeds;
        PullStatus status;
    }

    uint256 public pullCount;
    uint256 public openPullId; // 0 = none open
    uint256 public lastPullClosedAt;
    mapping(uint256 => Pull) public pulls;
    /// @notice HIT_HUNTER pulls whose hit card had no eligible holder at the snapshot (sell-back allowed).
    mapping(uint256 => bool) public noEligibleHolder;

    // ---------------------------------------------------------------- dividends
    struct Round {
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 createdAt;
        bool expired;
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => bool)) public claimed;

    // ---------------------------------------------------------------- events
    event TaxReceived(uint256 amount, uint256 toPot, uint256 toBuyback, uint256 toTreasury);
    event Forwarded(address indexed to, uint256 amount);
    event ForwardFailed(address indexed to, uint256 amount);
    event PullOpened(uint256 indexed pullId, uint256 amountSent, uint256 priceBnb, address paymentReceiver);
    event PullSettled(uint256 indexed pullId, uint256 refund, uint256 cardValueUsd);
    event RaffleRecorded(
        uint256 indexed pullId, uint256 snapshotBlock, bytes32 snapshotHash, bytes32 seed, address indexed winner
    );
    event ProceedsDeposited(
        uint256 indexed pullId, uint256 amount, uint256 toPot, uint256 toDividend, uint256 toBurn, uint256 toLp
    );
    event DividendRootSet(uint256 indexed roundId, bytes32 root, uint256 totalBnb);
    event DividendClaimed(uint256 indexed roundId, address indexed account, uint256 amount, bool pushed);
    event DividendRoundExpired(uint256 indexed roundId, uint256 returned);
    event BuybackBurn(uint256 bnbSpent, uint256 tokensBurned);
    event LpShareBurned(uint256 bnbSpent, uint256 tokensBurned);
    event LiquidityLocked(uint256 bnbSpent, uint256 tokensAdded, uint256 liquidity, uint256 tokensBurned);

    // ---------------------------------------------------------------- errors
    error NotOperator();
    error Paused();
    error InvalidConfig();
    error PullAlreadyOpen();
    error CooldownActive(uint256 readyAt);
    error PotTooLow(uint256 pot, uint256 required);
    error AmountTooHigh(uint256 amount, uint256 cap);
    error BadPullStatus(uint256 pullId);
    error BadRefund();
    error StrategyMismatch();
    event NoEligibleRecorded(uint256 indexed pullId, uint256 snapshotBlock, bytes32 snapshotHash);
    error InvalidWinner();
    error InvalidSnapshot();
    error ZeroAmount();
    error InsufficientReserve(uint256 have, uint256 want);
    error RoundExists();
    error RoundUnknown();
    error RoundIsExpired();
    error RoundNotExpirable();
    error AlreadyClaimed();
    error InvalidProof();
    error RoundOverpaid();
    error TransferFailed();
    error StalePrice();
    error InvalidPrice();
    error Slippage();
    error PaymentReceiverUnset();

    modifier onlyOperator() {
        if (!factory.hasRole(OPERATOR_ROLE, msg.sender)) revert NotOperator();
        _;
    }

    modifier whenNotPaused() {
        if (factory.paused()) revert Paused();
        _;
    }

    constructor() {
        factory = IGachaForgeFactory(msg.sender);
        GachaTypes.VaultConfig memory c = factory.launchContext();
        if (c.token == address(0) || c.treasury == address(0) || c.buybackBurner == address(0)) {
            revert InvalidConfig();
        }
        if (c.taxBps != GachaTypes.TAX_BPS) revert InvalidConfig();
        if (c.packPriceUsd != GachaTypes.packPriceUsd(c.packId)) revert InvalidConfig();
        if (c.strategy == GachaTypes.Strategy.SPLIT) {
            if (uint256(c.split.dividendBps) + c.split.burnBps + c.split.lpBps != BPS) revert InvalidConfig();
        } else if (c.split.dividendBps != 0 || c.split.burnBps != 0 || c.split.lpBps != 0) {
            revert InvalidConfig();
        }
        token = c.token;
        treasury = c.treasury;
        buybackBurner = c.buybackBurner;
        packId = c.packId;
        packPriceUsd = c.packPriceUsd;
        strategy = c.strategy;
        taxBps = c.taxBps;
        splitDividendBps = c.split.dividendBps;
        splitBurnBps = c.split.burnBps;
        splitLpBps = c.split.lpBps;
    }

    // =================================================================== tax intake

    /// @notice Tax arrives here. receive() makes no external calls and no cold SSTOREs, so it
    ///         succeeds with a 2300-gas stipend and with any gas above. Incoming BNB stays
    ///         unaccounted until sync()/flush() (permissionless; openPull and buyback/LP ops also sync).
    ///         Only BNB sent back by the router during our own router call is tracked as a refund;
    ///         everything else (including tax dispatched mid-call) is treated as fresh tax.
    receive() external payable {
        if (_reentrancyGuardEntered() && msg.sender == _refundSource) _refundReceived += msg.value;
    }

    /// @notice Split any unaccounted BNB (tax) and forward the buyback / treasury shares.
    function sync() external nonReentrant {
        _sync();
    }

    /// @notice Alias of sync().
    function flush() external nonReentrant {
        _sync();
    }

    /// @notice Sum of all accounted buckets. Any balance above this is fresh tax.
    function trackedBalance() public view returns (uint256) {
        return pot + dividendPool + dividendLiability + burnReserve + lpReserve + buybackOwed + treasuryOwed;
    }

    /// @notice Pure split math (exposed for tests / UI). Treasury takes the rounding remainder.
    function splitTax(uint256 amount) public pure returns (uint256 toPot, uint256 toBuyback, uint256 toTreasury) {
        toPot = (amount * POT_BPS) / BPS;
        toBuyback = (amount * BUYBACK_BPS) / BPS;
        toTreasury = amount - toPot - toBuyback;
    }

    function _sync() internal {
        uint256 tracked = trackedBalance();
        uint256 bal = address(this).balance;
        if (bal > tracked) {
            uint256 fresh = bal - tracked;
            (uint256 p, uint256 b, uint256 t) = splitTax(fresh);
            pot += p;
            buybackOwed += b;
            treasuryOwed += t;
            emit TaxReceived(fresh, p, b, t);
        }
        _flush();
    }

    function _flush() internal {
        uint256 b = buybackOwed;
        if (b > 0) {
            buybackOwed = 0;
            (bool ok,) = buybackBurner.call{value: b}("");
            if (ok) {
                emit Forwarded(buybackBurner, b);
            } else {
                buybackOwed = b;
                emit ForwardFailed(buybackBurner, b);
            }
        }
        uint256 t = treasuryOwed;
        if (t > 0) {
            treasuryOwed = 0;
            (bool ok,) = treasury.call{value: t}("");
            if (ok) {
                emit Forwarded(treasury, t);
            } else {
                treasuryOwed = t;
                emit ForwardFailed(treasury, t);
            }
        }
    }

    // =================================================================== pricing

    /// @notice Pack price in BNB wei using Chainlink BNB/USD with a staleness check.
    function packPriceBnb() public view returns (uint256) {
        AggregatorV3Interface feed = factory.priceFeed();
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (updatedAt == 0 || answeredInRound < roundId) revert StalePrice();
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > factory.maxPriceAge()) revert StalePrice();
        uint8 dec = feed.decimals();
        return (packPriceUsd * 1e18 * (10 ** dec)) / uint256(answer);
    }

    /// @notice Max BNB a single pull may spend (price + 10%).
    function maxPullAmount() public view returns (uint256) {
        return (packPriceBnb() * SLIPPAGE_CAP_BPS) / BPS;
    }

    // =================================================================== pulls

    /// @notice Open a pull: sends `amount` BNB (<= price*1.10) from the pot to the payment receiver.
    function openPull(uint256 amount) external onlyOperator whenNotPaused nonReentrant returns (uint256 pullId) {
        if (openPullId != 0) revert PullAlreadyOpen();
        uint256 readyAt = lastPullClosedAt + factory.pullCooldown();
        if (lastPullClosedAt != 0 && block.timestamp < readyAt) revert CooldownActive(readyAt);
        address receiver = factory.paymentReceiver();
        if (receiver == address(0)) revert PaymentReceiverUnset();
        if (amount == 0) revert ZeroAmount();

        _sync();
        uint256 price = packPriceBnb();
        if (pot < price) revert PotTooLow(pot, price);
        uint256 cap = (price * SLIPPAGE_CAP_BPS) / BPS;
        if (amount > cap) revert AmountTooHigh(amount, cap);
        if (amount > pot) revert PotTooLow(pot, amount);

        pot -= amount;
        pullId = ++pullCount;
        openPullId = pullId;
        pulls[pullId] = Pull({
            amountSent: uint128(amount),
            refunded: 0,
            openedAt: uint64(block.timestamp),
            settledAt: 0,
            cardValueUsd: 0,
            proceeds: 0,
            status: PullStatus.OPEN
        });

        (bool ok,) = receiver.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PullOpened(pullId, amount, price, receiver);
    }

    /// @notice Close the open pull. Leftover BNB (`refund`, sent as msg.value) returns to the pot.
    /// @param cardValueUsd graded card value reported by Renaiss (whole USD), used by HIT_HUNTER.
    function settlePull(uint256 pullId, uint256 refund, uint256 cardValueUsd) external payable onlyOperator {
        Pull storage p = pulls[pullId];
        if (p.status != PullStatus.OPEN) revert BadPullStatus(pullId);
        if (msg.value != refund || refund > p.amountSent) revert BadRefund();
        p.refunded = uint128(refund);
        p.cardValueUsd = SafeCast.toUint128(cardValueUsd);
        p.settledAt = uint64(block.timestamp);
        p.status = PullStatus.SETTLED;
        pot += refund;
        openPullId = 0;
        lastPullClosedAt = block.timestamp;
        emit PullSettled(pullId, refund, cardValueUsd);
    }

    /// @notice Publish a raffle result so anyone can re-derive the winner off-chain.
    function recordRaffle(uint256 pullId, uint256 snapshotBlock, bytes32 snapshotHash, bytes32 seed, address winner)
        external
        onlyOperator
    {
        Pull storage p = pulls[pullId];
        if (p.status != PullStatus.SETTLED) revert BadPullStatus(pullId);
        if (!_raffleAllowed(p)) revert StrategyMismatch();
        if (winner == address(0) || winner == DEAD || winner == address(this) || winner == token) {
            revert InvalidWinner();
        }
        if (snapshotBlock == 0 || snapshotBlock >= block.number || snapshotHash == bytes32(0)) {
            revert InvalidSnapshot();
        }
        p.status = PullStatus.WON;
        emit RaffleRecorded(pullId, snapshotBlock, snapshotHash, seed, winner);
    }

    /// @notice HIT_HUNTER only: publish that a hit card had no eligible holder at the snapshot,
    ///         which unlocks selling it back (proceeds buy & burn, as for a miss).
    function recordNoEligible(uint256 pullId, uint256 snapshotBlock, bytes32 snapshotHash) external onlyOperator {
        Pull storage p = pulls[pullId];
        if (p.status != PullStatus.SETTLED) revert BadPullStatus(pullId);
        if (strategy != GachaTypes.Strategy.HIT_HUNTER || p.cardValueUsd <= packPriceUsd) revert StrategyMismatch();
        if (snapshotBlock == 0 || snapshotBlock >= block.number || snapshotHash == bytes32(0)) {
            revert InvalidSnapshot();
        }
        noEligibleHolder[pullId] = true;
        emit NoEligibleRecorded(pullId, snapshotBlock, snapshotHash);
    }

    /// @notice Sell-back proceeds for a settled pull, routed by strategy.
    function depositProceeds(uint256 pullId) external payable onlyOperator {
        Pull storage p = pulls[pullId];
        if (p.status != PullStatus.SETTLED) revert BadPullStatus(pullId);
        if (!_sellBackAllowed(pullId, p)) revert StrategyMismatch();
        uint256 amt = msg.value;
        if (amt == 0) revert ZeroAmount();
        p.status = PullStatus.SOLD;
        p.proceeds = uint128(amt);

        uint256 toPot;
        uint256 toDiv;
        uint256 toBurn;
        uint256 toLp;
        GachaTypes.Strategy s = strategy;
        if (s == GachaTypes.Strategy.RAFFLE) {
            toPot = amt; // no eligible holder -> back to pot
        } else if (s == GachaTypes.Strategy.HIT_HUNTER || s == GachaTypes.Strategy.BURN) {
            toBurn = amt;
        } else if (s == GachaTypes.Strategy.DIVIDEND) {
            toDiv = amt;
        } else {
            toDiv = (amt * splitDividendBps) / BPS;
            toBurn = (amt * splitBurnBps) / BPS;
            toLp = amt - toDiv - toBurn;
        }
        pot += toPot;
        dividendPool += toDiv;
        burnReserve += toBurn;
        lpReserve += toLp;
        emit ProceedsDeposited(pullId, amt, toPot, toDiv, toBurn, toLp);
    }

    function _raffleAllowed(Pull storage p) internal view returns (bool) {
        if (strategy == GachaTypes.Strategy.RAFFLE) return true;
        if (strategy == GachaTypes.Strategy.HIT_HUNTER) return p.cardValueUsd > packPriceUsd;
        return false;
    }

    function _sellBackAllowed(uint256 pullId, Pull storage p) internal view returns (bool) {
        if (strategy == GachaTypes.Strategy.HIT_HUNTER) return p.cardValueUsd <= packPriceUsd || noEligibleHolder[pullId];
        return true; // RAFFLE (no eligible holder), DIVIDEND, BURN, SPLIT
    }

    // =================================================================== dividends (merkle)

    /// @notice Assign `totalBnb` of the dividend pool to a round with a merkle root of
    ///         leaves keccak256(bytes.concat(keccak256(abi.encode(account, amount)))).
    function setDividendRoot(uint256 roundId, bytes32 root, uint256 totalBnb) external onlyOperator {
        if (root == bytes32(0) || totalBnb == 0) revert ZeroAmount();
        if (rounds[roundId].root != bytes32(0)) revert RoundExists();
        if (totalBnb > dividendPool) revert InsufficientReserve(dividendPool, totalBnb);
        dividendPool -= totalBnb;
        dividendLiability += totalBnb;
        rounds[roundId] = Round({
            root: root, total: uint128(totalBnb), claimed: 0, createdAt: uint64(block.timestamp), expired: false
        });
        emit DividendRootSet(roundId, root, totalBnb);
    }

    function claim(uint256 roundId, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        _claim(roundId, msg.sender, amount, proof, false);
    }

    /// @notice Operator pushes a claim to a holder (used for large balances).
    function pushClaim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof)
        external
        onlyOperator
        nonReentrant
    {
        _claim(roundId, account, amount, proof, true);
    }

    /// @notice After CLAIM_WINDOW, unclaimed BNB of a round returns to the dividend pool.
    function expireRound(uint256 roundId) external onlyOperator {
        Round storage r = rounds[roundId];
        if (r.root == bytes32(0)) revert RoundUnknown();
        if (r.expired) revert RoundIsExpired();
        if (block.timestamp < r.createdAt + CLAIM_WINDOW) revert RoundNotExpirable();
        r.expired = true;
        uint256 remaining = uint256(r.total) - r.claimed;
        dividendLiability -= remaining;
        dividendPool += remaining;
        emit DividendRoundExpired(roundId, remaining);
    }

    function _claim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof, bool pushed)
        internal
    {
        Round storage r = rounds[roundId];
        if (r.root == bytes32(0)) revert RoundUnknown();
        if (r.expired) revert RoundIsExpired();
        if (claimed[roundId][account]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verifyCalldata(proof, r.root, leaf)) revert InvalidProof();
        if (uint256(r.claimed) + amount > r.total) revert RoundOverpaid();
        claimed[roundId][account] = true;
        r.claimed += uint128(amount);
        dividendLiability -= amount;
        (bool ok,) = account.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit DividendClaimed(roundId, account, amount, pushed);
    }

    // =================================================================== buyback / LP

    /// @notice Spend burn reserve to buy this token and send it to the dead address.
    function buybackAndBurn(uint256 bnbAmount, uint256 minOut) external onlyOperator nonReentrant {
        if (bnbAmount == 0) revert ZeroAmount();
        if (bnbAmount > burnReserve) revert InsufficientReserve(burnReserve, bnbAmount);
        burnReserve -= bnbAmount;
        uint256 burned = _buyTo(bnbAmount, minOut, DEAD, true);
        emit BuybackBurn(bnbAmount, burned);
        _sync(); // split any tax that arrived during the buy
    }

    /// @notice Spend LP reserve. Post-graduation: half buys tokens, both sides added as LP with LP
    ///         tokens sent to dead (locked forever). Pre-graduation: the LP share is burned instead.
    function addLiquidityLocked(uint256 bnbAmount, uint256 minTokensOut, uint256 minTokenLp, uint256 minBnbLp)
        external
        onlyOperator
        nonReentrant
    {
        if (bnbAmount == 0) revert ZeroAmount();
        if (bnbAmount > lpReserve) revert InsufficientReserve(lpReserve, bnbAmount);
        lpReserve -= bnbAmount;
        ILaunchpadRouter r = factory.router();

        if (!r.isGraduated(token)) {
            uint256 burned = _buyTo(bnbAmount, minTokensOut, DEAD, false);
            emit LpShareBurned(bnbAmount, burned);
            _sync();
            return;
        }

        IERC20 t = IERC20(token);
        uint256 tokBefore = t.balanceOf(address(this)); // pre-existing (e.g. donated) tokens are ignored
        uint256 half = bnbAmount / 2;
        uint256 got = _buyTo(half, minTokensOut, address(this), false);

        uint256 bnbSide = bnbAmount - half;
        t.forceApprove(address(r), got);
        _refundSource = address(r);
        _refundReceived = 0;
        uint256 liquidity = r.addLiquidity{value: bnbSide}(token, got, minTokenLp, minBnbLp, DEAD);
        _takeRefund(false);
        t.forceApprove(address(r), 0);

        // tokens from this call not absorbed by the pool are burned (balance delta only)
        uint256 balNow = t.balanceOf(address(this));
        uint256 leftover = balNow > tokBefore ? balNow - tokBefore : 0;
        if (leftover > got) leftover = got;
        if (leftover > 0) t.safeTransfer(DEAD, leftover);
        emit LiquidityLocked(bnbAmount, got - leftover, liquidity, leftover);
        _sync();
    }

    /// @dev Buys via router; returns tokens actually received by `to` (balance delta).
    ///      BNB refunded during the call (e.g. curve fill) goes back to the source bucket.
    function _buyTo(uint256 bnbAmount, uint256 minOut, address to, bool fromBurn) internal returns (uint256 received) {
        IERC20 t = IERC20(token);
        uint256 tokBefore = t.balanceOf(to);
        ILaunchpadRouter r = factory.router();
        _refundSource = address(r);
        _refundReceived = 0;
        r.buyTokens{value: bnbAmount}(token, minOut, to);
        _takeRefund(fromBurn);
        received = t.balanceOf(to) - tokBefore;
        if (received < minOut) revert Slippage();
    }

    /// @dev Credit BNB the router sent back during the call to the bucket it was spent from.
    function _takeRefund(bool toBurn) internal {
        uint256 refund = _refundReceived;
        _refundReceived = 0;
        _refundSource = address(0);
        if (refund > 0) {
            if (toBurn) burnReserve += refund;
            else lpReserve += refund;
        }
    }

    // =================================================================== views

    function splitBps() external view returns (uint16, uint16, uint16) {
        return (splitDividendBps, splitBurnBps, splitLpBps);
    }

    function canOpenPull() external view returns (bool) {
        if (openPullId != 0 || factory.paused()) return false;
        if (lastPullClosedAt != 0 && block.timestamp < lastPullClosedAt + factory.pullCooldown()) return false;
        uint256 bal = address(this).balance;
        uint256 tracked = trackedBalance();
        uint256 projectedPot = pot + (bal > tracked ? ((bal - tracked) * POT_BPS) / BPS : 0);
        try this.packPriceBnb() returns (uint256 price) {
            return projectedPot >= price;
        } catch {
            return false;
        }
    }
}
