// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MachineVault} from "./MachineVault.sol";
import {GachaTypes} from "./libraries/GachaTypes.sol";
import {IFlapLauncher} from "./interfaces/IFlapLauncher.sol";
import {ILaunchpadRouter} from "./interfaces/ILaunchpadRouter.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title GachaForgeFactory (Launcher + registry + role/config hub)
/// @notice Launches a GachaForge machine: predicts the MachineVault CREATE2 address, creates the
///         token on flap.sh (via IFlapLauncher adapter) with that vault as tax receiver, then
///         deploys the vault at the predicted address. Also the single source of roles
///         (OPERATOR/PAUSER, admin = TimelockController), pause state and operational config
///         that vaults read.
contract GachaForgeFactory is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @dev Unpausing is separate from pausing so a hot pauser key cannot undo an emergency pause.
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    uint256 public constant MIN_COOLDOWN = 10 seconds;
    uint256 public constant MAX_COOLDOWN = 1 days;

    struct LaunchParams {
        string name;
        string symbol;
        string meta;
        GachaTypes.PackId packId;
        GachaTypes.Strategy strategy;
        uint16 taxBps; // 100..1000, whole percent
        GachaTypes.SplitBps split; // SPLIT only, must sum to 10000; zero otherwise
        bytes32 salt; // creator-chosen; combined with msg.sender for the vault salt
        bytes extraData; // passed through to the flap.sh adapter
    }

    struct Machine {
        address token;
        address vault;
        address creator;
        uint64 createdAt;
    }

    // ---------------------------------------------------------------- config
    AggregatorV3Interface public priceFeed;
    uint256 public maxPriceAge = 1 hours;
    ILaunchpadRouter public router;
    IFlapLauncher public flapLauncher;
    address public paymentReceiver; // Renaiss payment address for pack purchases
    address public treasury;
    address public buybackBurner;
    uint256 public pullCooldown = 60 seconds;

    // ---------------------------------------------------------------- registry
    Machine[] internal _machines;
    mapping(address => address) public vaultOf; // token => vault
    mapping(address => address) public tokenOf; // vault => token

    GachaTypes.VaultConfig internal _ctx; // populated only during a launch
    bytes32 internal _pendingSalt;
    address internal _pendingVault;

    event MachineLaunched(
        address indexed token,
        address indexed vault,
        address indexed creator,
        GachaTypes.PackId packId,
        GachaTypes.Strategy strategy,
        uint16 taxBps,
        uint16 dividendBps,
        uint16 burnBps,
        uint16 lpBps,
        uint256 index
    );
    event ConfigUpdated(bytes32 indexed key, address addr, uint256 value);

    error ZeroAddress();
    error InvalidTax();
    error InvalidSplit();
    error VaultAddressMismatch();
    error TokenAlreadyRegistered();
    error InvalidCooldown();
    error NoContext();
    error NotLauncher();

    constructor(
        address admin,
        address priceFeed_,
        address router_,
        address flapLauncher_,
        address paymentReceiver_,
        address treasury_,
        address buybackBurner_
    ) {
        if (
            admin == address(0) || priceFeed_ == address(0) || router_ == address(0) || flapLauncher_ == address(0)
                || treasury_ == address(0) || buybackBurner_ == address(0)
        ) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        priceFeed = AggregatorV3Interface(priceFeed_);
        router = ILaunchpadRouter(router_);
        flapLauncher = IFlapLauncher(flapLauncher_);
        paymentReceiver = paymentReceiver_;
        treasury = treasury_;
        buybackBurner = buybackBurner_;
    }

    // =================================================================== launch

    function launch(LaunchParams calldata p)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (address token, address vault)
    {
        if (p.taxBps < 100 || p.taxBps > 1000 || p.taxBps % 100 != 0) revert InvalidTax();
        if (p.strategy == GachaTypes.Strategy.SPLIT) {
            if (uint256(p.split.dividendBps) + p.split.burnBps + p.split.lpBps != 10_000) revert InvalidSplit();
        } else if (p.split.dividendBps != 0 || p.split.burnBps != 0 || p.split.lpBps != 0) {
            revert InvalidSplit();
        }

        bytes32 vaultSalt = _vaultSalt(msg.sender, p.salt);
        address predicted = predictVault(msg.sender, p.salt);

        // Context is populated before the token exists so the adapter may deploy the vault via
        // deployPendingVault() from inside the launchpad call (flap VaultPortal flow).
        _ctx = GachaTypes.VaultConfig({
            token: address(0),
            treasury: treasury,
            buybackBurner: buybackBurner,
            packId: p.packId,
            packPriceUsd: GachaTypes.packPriceUsd(p.packId),
            strategy: p.strategy,
            taxBps: p.taxBps,
            split: p.split
        });
        _pendingSalt = vaultSalt;
        _pendingVault = predicted;

        token = flapLauncher.createToken{value: msg.value}(
            IFlapLauncher.TokenParams({
                name: p.name,
                symbol: p.symbol,
                meta: p.meta,
                taxBps: p.taxBps,
                taxReceiver: predicted,
                creator: msg.sender,
                salt: p.salt,
                extraData: p.extraData
            })
        );
        if (token == address(0)) revert ZeroAddress();

        if (_ctx.token == address(0)) {
            // Portal flow: token was created with beneficiary = predicted vault; deploy it now.
            if (vaultOf[token] != address(0)) revert TokenAlreadyRegistered();
            vault = _deployVault(token);
        } else {
            // VaultPortal flow: vault already deployed during the callback; must match the token.
            if (_ctx.token != token) revert VaultAddressMismatch();
            vault = predicted;
        }
        delete _ctx;
        delete _pendingSalt;
        delete _pendingVault;

        _machines.push(Machine({token: token, vault: vault, creator: msg.sender, createdAt: uint64(block.timestamp)}));

        emit MachineLaunched(
            token,
            vault,
            msg.sender,
            p.packId,
            p.strategy,
            p.taxBps,
            p.split.dividendBps,
            p.split.burnBps,
            p.split.lpBps,
            _machines.length - 1
        );
    }

    /// @notice Called by the flap launcher adapter while it is inside createToken (e.g. as the
    ///         VaultPortal vault factory) once the token address is known.
    function deployPendingVault(address token) external returns (address vault) {
        if (msg.sender != address(flapLauncher)) revert NotLauncher();
        if (_pendingVault == address(0) || _ctx.token != address(0)) revert NoContext();
        if (token == address(0)) revert ZeroAddress();
        if (vaultOf[token] != address(0)) revert TokenAlreadyRegistered();
        vault = _deployVault(token);
    }

    function _deployVault(address token) internal returns (address vault) {
        _ctx.token = token;
        vault = address(new MachineVault{salt: _pendingSalt}());
        if (vault != _pendingVault) revert VaultAddressMismatch();
        vaultOf[token] = vault;
        tokenOf[vault] = token;
    }

    /// @notice Vault address for (creator, salt), known before the token exists.
    function predictVault(address creator, bytes32 salt) public view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                bytes1(0xff), address(this), _vaultSalt(creator, salt), keccak256(type(MachineVault).creationCode)
            )
        );
        return address(uint160(uint256(h)));
    }

    function launchContext() external view returns (GachaTypes.VaultConfig memory) {
        if (_ctx.token == address(0)) revert NoContext();
        return _ctx;
    }

    function _vaultSalt(address creator, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }

    // =================================================================== registry views

    function machineCount() external view returns (uint256) {
        return _machines.length;
    }

    function machineAt(uint256 i) external view returns (Machine memory) {
        return _machines[i];
    }

    function isVault(address v) external view returns (bool) {
        return tokenOf[v] != address(0);
    }

    // =================================================================== pause

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }

    // =================================================================== admin (timelock)

    function setPriceFeed(address feed, uint256 maxAge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feed == address(0) || maxAge == 0) revert ZeroAddress();
        priceFeed = AggregatorV3Interface(feed);
        maxPriceAge = maxAge;
        emit ConfigUpdated("priceFeed", feed, maxAge);
    }

    function setRouter(address r) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (r == address(0)) revert ZeroAddress();
        router = ILaunchpadRouter(r);
        emit ConfigUpdated("router", r, 0);
    }

    function setFlapLauncher(address l) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (l == address(0)) revert ZeroAddress();
        flapLauncher = IFlapLauncher(l);
        emit ConfigUpdated("flapLauncher", l, 0);
    }

    function setPaymentReceiver(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        paymentReceiver = a;
        emit ConfigUpdated("paymentReceiver", a, 0);
    }

    /// @notice Affects future launches only; existing vaults keep their immutable treasury.
    function setTreasury(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        treasury = a;
        emit ConfigUpdated("treasury", a, 0);
    }

    /// @notice Affects future launches only; existing vaults keep their immutable burner.
    function setBuybackBurner(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        buybackBurner = a;
        emit ConfigUpdated("buybackBurner", a, 0);
    }

    function setPullCooldown(uint256 s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (s < MIN_COOLDOWN || s > MAX_COOLDOWN) revert InvalidCooldown();
        pullCooldown = s;
        emit ConfigUpdated("pullCooldown", address(0), s);
    }
}
