// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IAavePool {
    struct ReserveData {
        uint256 configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate;
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getReserveData(address asset) external view returns (ReserveData memory);
}

/// @notice the venue interface HireVault calls. every position is keyed by the
/// hire that funded it, so concurrent hires accrue separately and closing one
/// can never pay out another hire's interest. type(uint256).max means the whole
/// position, which is what a hire close asks for.
contract AaveV3VenueAdapter {
    address public immutable vault;
    address public immutable asset;
    address public immutable pool;
    address public immutable aToken;

    // principal is what the hire put in. valueAt is what it had grown to at the
    // index stored in indexAt. aave accrues by index, so value is linear:
    // valueAt * currentIndex / indexAt, and a partial withdraw keeps that ratio
    mapping(uint256 => uint256) public principal;
    mapping(uint256 => uint256) public valueAt;
    mapping(uint256 => uint256) public indexAt;

    constructor(address vault_, address asset_, address pool_, address aToken_) {
        require(vault_ != address(0) && asset_ != address(0) && pool_ != address(0) && aToken_ != address(0), "zero");
        vault = vault_;
        asset = asset_;
        pool = pool_;
        aToken = aToken_;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "not vault");
        _;
    }

    function supply(uint256 id, uint256 amount) external onlyVault {
        require(amount > 0, "amount");
        uint256 idx = currentIndex();
        uint256 grown = valueAt[id] == 0 ? 0 : valueAt[id] * idx / indexAt[id];
        principal[id] += amount;
        valueAt[id] = grown + amount;
        indexAt[id] = idx;

        require(IERC20Minimal(asset).transferFrom(vault, address(this), amount), "pull");
        require(IERC20Minimal(asset).approve(pool, amount), "approve");
        IAavePool(pool).supply(asset, amount, address(this), 0);
    }

    function withdraw(uint256 id, uint256 amount) external onlyVault {
        require(amount > 0, "amount");
        uint256 p = principal[id];
        require(p > 0, "no position");
        uint256 idx = currentIndex();
        uint256 value = valueAt[id] * idx / indexAt[id];

        if (amount == type(uint256).max || amount >= p) {
            uint256 held = IERC20Minimal(aToken).balanceOf(address(this));
            uint256 out = value < held ? value : held;
            IAavePool(pool).withdraw(asset, out, vault);
            delete principal[id];
            delete valueAt[id];
            delete indexAt[id];
        } else {
            // the hire asked for part of its principal, so it takes that share
            // of its own value, principal and interest together
            uint256 paid = amount * value / p;
            IAavePool(pool).withdraw(asset, paid, vault);
            principal[id] = p - amount;
            valueAt[id] = value - paid;
            indexAt[id] = idx;
        }
    }

    function valueOf(uint256 id) public view returns (uint256) {
        uint256 v = valueAt[id];
        if (v == 0) return 0;
        return v * currentIndex() / indexAt[id];
    }

    function currentIndex() internal view returns (uint256) {
        IAavePool.ReserveData memory data = IAavePool(pool).getReserveData(asset);
        return uint256(data.liquidityIndex);
    }

    /// @notice the reserve's annual rate in basis points, from Aave's ray figure
    function getYieldRate() external view returns (uint256) {
        IAavePool.ReserveData memory data = IAavePool(pool).getReserveData(asset);
        return uint256(data.currentLiquidityRate) / 1e23;
    }

    function underlying() external view returns (address) {
        return asset;
    }
}
