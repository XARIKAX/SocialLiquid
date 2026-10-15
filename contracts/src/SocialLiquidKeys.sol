// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title socialLiquid Keys
 * @notice A key is a share in a trader on socialLiquid. Each trader who lists gets their own capped supply on a
 *         linear bonding curve, priced in USDC on HyperEVM.
 *
 *         Buying pays the curve price plus a protocol fee. TRADER_CUT of the curve price goes to the trader at
 *         once; the rest stays in that trader's reserve. Selling refunds exactly the reserve share of the same
 *         curve range, minus the protocol fee, so the reserve always covers every outstanding key and any holder
 *         can always exit. The trader cut is immutable for that reason: changing it would change what the reserve
 *         owes.
 *
 *         Holders also earn: anyone (in practice the socialLiquid distributor) deposits USDC against a trader, and
 *         it is split across that trader's holders pro rata to the keys held at the moment of the deposit.
 *
 *         Buying can be paused in an emergency. Selling and claiming never can.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract SocialLiquidKeys {
    // ---------------------------------------------------------------- config
    IERC20 public immutable usdc;
    /// price of the first key, in USDC base units (6 decimals)
    uint256 public immutable basePrice;
    /// price added per key already in supply
    uint256 public immutable slope;
    /// share of the curve price paid to the trader on every buy, in basis points. immutable: see contract notes
    uint256 public immutable traderCutBps;
    uint256 public constant SUPPLY_CAP = 2000;
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 500;
    uint256 private constant BPS = 10_000;
    uint256 private constant ACC = 1e18;

    address public owner;
    address public treasury;
    uint256 public protocolFeeBps;
    bool public buysPaused;

    // ---------------------------------------------------------------- state
    struct Trader {
        bool listed;
        uint256 supply;
        /// USDC held to buy back every outstanding key
        uint256 reserve;
        /// cumulative fee share per key, scaled by 1e18
        uint256 accPerKey;
    }

    mapping(address => Trader) public traders;
    mapping(address => mapping(address => uint256)) public balanceOf;
    mapping(address => mapping(address => uint256)) private rewardDebt;
    mapping(address => mapping(address => uint256)) private owed;

    uint256 private locked = 1;

    // ---------------------------------------------------------------- events
    event Listed(address indexed trader);
    event Trade(address indexed trader, address indexed account, bool isBuy, uint256 amount, uint256 curve, uint256 traderCut, uint256 protocolFee, uint256 supply);
    event FeesDeposited(address indexed trader, address indexed from, uint256 amount);
    event Claimed(address indexed trader, address indexed holder, uint256 amount);
    event OwnerChanged(address owner);
    event TreasuryChanged(address treasury);
    event ProtocolFeeChanged(uint256 bps);
    event BuysPaused(bool paused);

    error NotOwner();
    error NotListed();
    error AlreadyListed();
    error ZeroAmount();
    error SupplyCap();
    error Slippage();
    error Insufficient();
    error NoHolders();
    error Paused();
    error Reentrant();
    error BadConfig();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrant();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(IERC20 usdc_, address treasury_, uint256 basePrice_, uint256 slope_, uint256 traderCutBps_, uint256 protocolFeeBps_) {
        if (address(usdc_) == address(0) || treasury_ == address(0) || basePrice_ == 0) revert BadConfig();
        if (traderCutBps_ >= BPS || protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert BadConfig();
        // the trader's cut of any curve range must be exact, so the reserve always equals the sum of what each
        // outstanding key put in and every seller is refunded exactly that, in any order and any chunk size
        if ((basePrice_ * traderCutBps_) % BPS != 0 || (slope_ * traderCutBps_) % BPS != 0) revert BadConfig();
        usdc = usdc_;
        treasury = treasury_;
        basePrice = basePrice_;
        slope = slope_;
        traderCutBps = traderCutBps_;
        protocolFeeBps = protocolFeeBps_;
        owner = msg.sender;
    }

    // ---------------------------------------------------------------- views

    /// @notice the curve price of `amount` keys starting at `supply`
    function curveCost(uint256 supply, uint256 amount) public view returns (uint256) {
        // sum over k = supply .. supply + amount - 1 of (basePrice + slope * k)
        return amount * basePrice + slope * (amount * supply + (amount * (amount - 1)) / 2);
    }

    /// @notice the part of a curve cost the trader keeps; the reserve holds the rest
    function traderCutOf(uint256 cost) public view returns (uint256) {
        return (cost * traderCutBps) / BPS;
    }

    function buyQuote(address trader, uint256 amount) external view returns (uint256 total, uint256 curve, uint256 traderCut, uint256 protocolFee) {
        curve = curveCost(traders[trader].supply, amount);
        traderCut = traderCutOf(curve);
        protocolFee = (curve * protocolFeeBps) / BPS;
        total = curve + protocolFee;
    }

    function sellQuote(address trader, uint256 amount) public view returns (uint256 net, uint256 refund, uint256 protocolFee) {
        Trader storage t = traders[trader];
        if (amount > t.supply) revert Insufficient();
        uint256 curve = curveCost(t.supply - amount, amount);
        refund = curve - traderCutOf(curve);
        protocolFee = (refund * protocolFeeBps) / BPS;
        net = refund - protocolFee;
    }

    /// @notice the next key's price
    function price(address trader) external view returns (uint256) {
        return basePrice + slope * traders[trader].supply;
    }

    /// @notice fee share a holder can claim from a trader right now
    function pending(address trader, address holder) public view returns (uint256) {
        return owed[trader][holder] + (balanceOf[trader][holder] * traders[trader].accPerKey) / ACC - rewardDebt[trader][holder];
    }

    // ---------------------------------------------------------------- trading

    /// @notice a trader opts in. only the trader's own address can list it
    function list() external {
        Trader storage t = traders[msg.sender];
        if (t.listed) revert AlreadyListed();
        t.listed = true;
        emit Listed(msg.sender);
    }

    function buy(address trader, uint256 amount, uint256 maxTotal) external nonReentrant {
        if (buysPaused) revert Paused();
        Trader storage t = traders[trader];
        if (!t.listed) revert NotListed();
        if (amount == 0) revert ZeroAmount();
        if (t.supply + amount > SUPPLY_CAP) revert SupplyCap();

        uint256 curve = curveCost(t.supply, amount);
        uint256 cut = traderCutOf(curve);
        uint256 fee = (curve * protocolFeeBps) / BPS;
        uint256 total = curve + fee;
        if (total > maxTotal) revert Slippage();

        _settle(trader, msg.sender);
        t.supply += amount;
        t.reserve += curve - cut;
        balanceOf[trader][msg.sender] += amount;
        _checkpoint(trader, msg.sender);

        _pull(msg.sender, total);
        _push(trader, cut);
        _push(treasury, fee);
        emit Trade(trader, msg.sender, true, amount, curve, cut, fee, t.supply);
    }

    function sell(address trader, uint256 amount, uint256 minNet) external nonReentrant {
        Trader storage t = traders[trader];
        if (amount == 0) revert ZeroAmount();
        if (balanceOf[trader][msg.sender] < amount) revert Insufficient();

        (uint256 net, uint256 refund, uint256 fee) = sellQuote(trader, amount);
        if (net < minNet) revert Slippage();

        _settle(trader, msg.sender);
        t.supply -= amount;
        t.reserve -= refund;
        balanceOf[trader][msg.sender] -= amount;
        _checkpoint(trader, msg.sender);

        _push(msg.sender, net);
        _push(treasury, fee);
        emit Trade(trader, msg.sender, false, amount, refund, 0, fee, t.supply);
    }

    // ---------------------------------------------------------------- fee share

    /// @notice split `amount` USDC across the trader's current holders, pro rata to keys held
    function depositFees(address trader, uint256 amount) external nonReentrant {
        Trader storage t = traders[trader];
        if (amount == 0) revert ZeroAmount();
        if (t.supply == 0) revert NoHolders();
        t.accPerKey += (amount * ACC) / t.supply;
        _pull(msg.sender, amount);
        emit FeesDeposited(trader, msg.sender, amount);
    }

    function claim(address trader) public nonReentrant returns (uint256 amount) {
        _settle(trader, msg.sender);
        _checkpoint(trader, msg.sender);
        amount = owed[trader][msg.sender];
        if (amount == 0) return 0;
        owed[trader][msg.sender] = 0;
        _push(msg.sender, amount);
        emit Claimed(trader, msg.sender, amount);
    }

    function claimMany(address[] calldata list_) external returns (uint256 total) {
        for (uint256 i = 0; i < list_.length; i++) total += claim(list_[i]);
    }

    // ---------------------------------------------------------------- owner

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert BadConfig();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setProtocolFee(uint256 bps) external onlyOwner {
        if (bps > MAX_PROTOCOL_FEE_BPS) revert BadConfig();
        protocolFeeBps = bps;
        emit ProtocolFeeChanged(bps);
    }

    function setBuysPaused(bool paused) external onlyOwner {
        buysPaused = paused;
        emit BuysPaused(paused);
    }

    function transferOwnership(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert BadConfig();
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    // ---------------------------------------------------------------- internal

    /// move everything accrued since the last checkpoint into `owed`, before a balance changes
    function _settle(address trader, address holder) private {
        uint256 accrued = (balanceOf[trader][holder] * traders[trader].accPerKey) / ACC;
        owed[trader][holder] += accrued - rewardDebt[trader][holder];
    }

    function _checkpoint(address trader, address holder) private {
        rewardDebt[trader][holder] = (balanceOf[trader][holder] * traders[trader].accPerKey) / ACC;
    }

    function _pull(address from, uint256 amount) private {
        if (amount == 0) return;
        _call(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
    }

    function _push(address to, uint256 amount) private {
        if (amount == 0) return;
        _call(abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    /// tolerate tokens that return nothing; reject ones that return false or revert
    function _call(bytes memory data) private {
        (bool ok, bytes memory ret) = address(usdc).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
