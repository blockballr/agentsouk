// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IVTokenDebt {
    // Venus and Compound return 0 on success
    function repayBorrowBehalf(address borrower, uint256 repayAmount) external returns (uint256);
}

/// @notice A buyer's lending positions stay in the buyer's own wallets. This
/// contract is the only thing an agent may touch, and only within the mandate
/// the buyer wrote: the defence asset, the positions, the trigger it acts under,
/// the target it aims for, how much per call and per day, and until when. The
/// agent can repay debt on those positions, and nothing else. The buyer can
/// revoke in one transaction.
///
/// Portfolio scope is the point: one mandate covers several accounts, so the
/// agent defends the worst health factor instead of being hired per account.
contract HealthOperator {
    struct Position {
        address account;
        address vTokenDebt;
    }

    struct Mandate {
        address agent;
        address asset;
        // act when coverage falls under triggerBps / 10_000
        uint32 triggerBps;
        // repay until coverage reaches targetBps / 10_000
        uint32 targetBps;
        uint128 maxRepayPerCall;
        uint128 maxRepayPerDay;
        uint64 expiry;
        bool active;
        Position[] positions;
    }

    uint256 public constant DAY = 1 days;
    uint64 public constant MAX_TERM = 90 days;
    uint256 public constant MAX_POSITIONS = 8;
    uint32 public constant MAX_TARGET_BPS = 100_000;

    mapping(address => Mandate) private _mandates;
    // the active buyers, so a watcher can find every portfolio to check. a buyer
    // leaves the list on revoke, so a mandate never outlives the buyer's consent.
    address[] private _buyers;
    mapping(address => uint256) private _buyerSlot;
    // repayment spent today, keyed by buyer, so two calls cannot add up past the
    // daily bound the buyer wrote
    mapping(address => uint256) private _spentDay;
    mapping(address => uint256) private _spentToday;

    uint256 private _lock = 1;

    event MandateSet(
        address indexed buyer,
        address indexed agent,
        address asset,
        uint32 triggerBps,
        uint32 targetBps,
        uint128 maxRepayPerCall,
        uint128 maxRepayPerDay,
        uint64 expiry,
        uint256 positions
    );
    event MandateRevoked(address indexed buyer);
    event Repaid(address indexed buyer, address indexed agent, uint256 indexed index, address account, uint256 amount);

    error NotTheAgent();
    error NoMandate();
    error MandateExpired();
    error BadAmount();
    error BadExpiry();
    error BadMandate();
    error BadPosition();
    error BadTrigger();
    error OverCap();
    error TokenCallFailed();
    error Reentered();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentered();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice the buyer writes the whole mandate. every position repays from
    /// the same defence asset, so one budget covers the portfolio.
    function setMandate(
        address agent,
        address asset,
        uint32 triggerBps,
        uint32 targetBps,
        uint128 maxRepayPerCall,
        uint128 maxRepayPerDay,
        uint64 expiry,
        Position[] calldata positions
    ) external {
        if (agent == address(0) || asset == address(0)) revert BadMandate();
        if (positions.length == 0 || positions.length > MAX_POSITIONS) revert BadPosition();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_TERM) revert BadExpiry();
        if (maxRepayPerCall == 0 || maxRepayPerDay < maxRepayPerCall) revert BadAmount();
        if (triggerBps == 0 || targetBps <= triggerBps || targetBps > MAX_TARGET_BPS) revert BadTrigger();

        Mandate storage m = _mandates[msg.sender];
        delete m.positions;
        m.agent = agent;
        m.asset = asset;
        m.triggerBps = triggerBps;
        m.targetBps = targetBps;
        m.maxRepayPerCall = maxRepayPerCall;
        m.maxRepayPerDay = maxRepayPerDay;
        m.expiry = expiry;
        m.active = true;
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].account == address(0) || positions[i].vTokenDebt == address(0)) revert BadPosition();
            m.positions.push(positions[i]);
        }

        if (_buyerSlot[msg.sender] == 0) {
            _buyers.push(msg.sender);
            _buyerSlot[msg.sender] = _buyers.length;
        }

        emit MandateSet(
            msg.sender,
            agent,
            asset,
            triggerBps,
            targetBps,
            maxRepayPerCall,
            maxRepayPerDay,
            expiry,
            positions.length
        );
    }

    /// @notice the buyer ends the agent's authority at once, and leaves the
    /// watcher's list
    function revoke() external {
        if (!_mandates[msg.sender].active) revert NoMandate();
        delete _mandates[msg.sender];
        _removeBuyer(msg.sender);
        emit MandateRevoked(msg.sender);
    }

    /// @notice repay part of one position's debt from the buyer's own balance.
    /// the operator pulls exactly the amount, approves the vToken, repays on the
    /// position's behalf, then clears the approval.
    function repay(address buyer, uint256 index, uint256 amount) external nonReentrant {
        Mandate storage m = _mandates[buyer];
        if (!m.active) revert NoMandate();
        if (block.timestamp >= m.expiry) revert MandateExpired();
        if (msg.sender != m.agent) revert NotTheAgent();
        if (index >= m.positions.length) revert BadPosition();
        if (amount == 0 || amount > m.maxRepayPerCall) revert BadAmount();

        _rollDay(buyer);
        if (_spentToday[buyer] + amount > m.maxRepayPerDay) revert OverCap();
        _spentToday[buyer] += amount;

        Position memory p = m.positions[index];
        _pull(m.asset, buyer, amount);
        _approve(m.asset, p.vTokenDebt, amount);
        uint256 err = IVTokenDebt(p.vTokenDebt).repayBorrowBehalf(p.account, amount);
        _approve(m.asset, p.vTokenDebt, 0);
        if (err != 0) revert TokenCallFailed();

        emit Repaid(buyer, msg.sender, index, p.account, amount);
    }

    function mandateOf(address buyer) external view returns (Mandate memory) {
        return _mandates[buyer];
    }

    function buyerCount() external view returns (uint256) {
        return _buyers.length;
    }

    function buyerAt(uint256 index) external view returns (address) {
        return _buyers[index];
    }

    function activeBuyers() external view returns (address[] memory) {
        return _buyers;
    }

    function positionCount(address buyer) external view returns (uint256) {
        return _mandates[buyer].positions.length;
    }

    function spentToday(address buyer) external view returns (uint256) {
        if (_spentDay[buyer] != block.timestamp / DAY) return 0;
        return _spentToday[buyer];
    }

    function _removeBuyer(address buyer) internal {
        uint256 slot = _buyerSlot[buyer];
        if (slot == 0) return;
        uint256 last = _buyers.length - 1;
        address moved = _buyers[last];
        _buyers[slot - 1] = moved;
        _buyerSlot[moved] = slot;
        _buyers.pop();
        delete _buyerSlot[buyer];
    }

    function _rollDay(address buyer) internal {
        uint256 today = block.timestamp / DAY;
        if (_spentDay[buyer] != today) {
            _spentDay[buyer] = today;
            _spentToday[buyer] = 0;
        }
    }

    // a token that returns no data on success is still a success, so the return
    // value is only read when the token actually returned one
    function _pull(address token, address from, uint256 amount) internal {
        uint256 before = IERC20(token).balanceOf(address(this));
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
        if (IERC20(token).balanceOf(address(this)) - before != amount) revert TokenCallFailed();
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }
}
