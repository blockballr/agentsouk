// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice A prepaid watch balance. The buyer tops up the asset, the agent draws
/// the daily rate it was hired at, and the buyer can withdraw the remainder at
/// any time. The contract never holds authority over a position; it only holds
/// the fee balance, so a lapsed subscription cannot touch anyone's collateral.
contract HealthSubscription {
    struct Plan {
        address agent;
        uint128 dailyRate;
        uint64 expiry;
        uint64 lastCharge;
    }

    address public immutable asset;
    uint256 public constant DAY = 1 days;
    uint64 public constant MAX_TERM = 365 days;

    mapping(address => Plan) private _plans;
    mapping(address => uint256) private _balances;

    uint256 private _lock = 1;

    event Deposited(address indexed buyer, uint256 amount, uint256 balance);
    event Withdrawn(address indexed buyer, uint256 amount, uint256 balance);
    event PlanSet(address indexed buyer, address indexed agent, uint128 dailyRate, uint64 expiry);
    event PlanCancelled(address indexed buyer);
    event Charged(address indexed buyer, address indexed agent, uint256 amount, uint256 balance);

    error BadAmount();
    error BadPlan();
    error BadExpiry();
    error NoPlan();
    error NotTheAgent();
    error PlanExpired();
    error NoBalance();
    error TokenCallFailed();
    error Reentered();

    constructor(address asset_) {
        if (asset_ == address(0)) revert BadPlan();
        asset = asset_;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentered();
        _lock = 2;
        _;
        _lock = 1;
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadAmount();
        _pull(msg.sender, amount);
        _balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount, _balances[msg.sender]);
    }

    // the buyer's money is never locked: whatever has not been charged is
    // withdrawable, including after a plan is cancelled
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > _balances[msg.sender]) revert BadAmount();
        _balances[msg.sender] -= amount;
        _push(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, _balances[msg.sender]);
    }

    /// @notice the buyer names the agent and the daily rate it will pay
    function setPlan(address agent, uint128 dailyRate, uint64 expiry) external {
        if (agent == address(0) || dailyRate == 0) revert BadPlan();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_TERM) revert BadExpiry();
        _plans[msg.sender] = Plan({
            agent: agent,
            dailyRate: dailyRate,
            expiry: expiry,
            lastCharge: uint64(block.timestamp)
        });
        emit PlanSet(msg.sender, agent, dailyRate, expiry);
    }

    function cancel() external {
        if (_plans[msg.sender].agent == address(0)) revert NoPlan();
        delete _plans[msg.sender];
        emit PlanCancelled(msg.sender);
    }

    /// @notice the agent draws what the elapsed time has earned, never more than
    /// the balance, and never after the plan's expiry
    function charge(address buyer) external nonReentrant {
        Plan memory plan = _plans[buyer];
        if (plan.agent == address(0)) revert NoPlan();
        if (msg.sender != plan.agent) revert NotTheAgent();
        if (block.timestamp >= plan.expiry) revert PlanExpired();

        uint256 due = accrued(buyer);
        if (due == 0) revert NoBalance();

        _balances[buyer] -= due;
        // the clock starts again from this charge, so the next draw is only the
        // new elapsed time
        _plans[buyer].lastCharge = uint64(block.timestamp);
        _push(plan.agent, due);
        emit Charged(buyer, plan.agent, due, _balances[buyer]);
    }

    function accrued(address buyer) public view returns (uint256) {
        Plan memory plan = _plans[buyer];
        if (plan.agent == address(0)) return 0;
        uint256 until = block.timestamp < plan.expiry ? block.timestamp : plan.expiry;
        if (until <= plan.lastCharge) return 0;
        uint256 due = (uint256(plan.dailyRate) * (until - plan.lastCharge)) / DAY;
        uint256 balance = _balances[buyer];
        return due > balance ? balance : due;
    }

    function balanceOf(address buyer) external view returns (uint256) {
        return _balances[buyer];
    }

    function planOf(address buyer) external view returns (Plan memory) {
        return _plans[buyer];
    }

    function _pull(address from, uint256 amount) internal {
        uint256 before = IERC20(asset).balanceOf(address(this));
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
        if (IERC20(asset).balanceOf(address(this)) - before != amount) revert TokenCallFailed();
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }
}
