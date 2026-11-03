// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IVToken {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function supplyRatePerBlock() external view returns (uint256);
}

/// @notice the Venus Core venue, keyed by hire like the Aave adapter. Venus
/// accrues through an exchange rate rather than an index, so a position is a
/// share count and the rate turns it into underlying at read time. The live
/// vUSDT market prices shares at 1e18, measured on a chain 56 fork.
contract VenusCoreVenueAdapter {
    address public immutable vault;
    address public immutable asset;
    address public immutable vToken;
    uint256 public constant RATE_SCALE = 1e18;

    // Venus on BSC produces a block roughly every three seconds
    uint256 public constant BLOCKS_PER_YEAR = 10_512_000;

    mapping(uint256 => uint256) public shares;
    mapping(uint256 => uint256) public principal;

    constructor(address vault_, address asset_, address vToken_) {
        require(vault_ != address(0) && asset_ != address(0) && vToken_ != address(0), "zero");
        vault = vault_;
        asset = asset_;
        vToken = vToken_;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "not vault");
        _;
    }

    function supply(uint256 id, uint256 amount) external onlyVault {
        require(amount > 0, "amount");
        uint256 before = IVToken(vToken).balanceOf(address(this));
        principal[id] += amount;

        require(IERC20Minimal(asset).transferFrom(vault, address(this), amount), "pull");
        require(IERC20Minimal(asset).approve(vToken, amount), "approve");
        require(IVToken(vToken).mint(amount) == 0, "mint");

        shares[id] += IVToken(vToken).balanceOf(address(this)) - before;
    }

    function withdraw(uint256 id, uint256 amount) external onlyVault {
        require(amount > 0, "amount");
        uint256 p = principal[id];
        require(p > 0, "no position");

        if (amount == type(uint256).max || amount >= p) {
            uint256 held = shares[id];
            delete shares[id];
            delete principal[id];
            require(IVToken(vToken).redeem(held) == 0, "redeem");
            _sendHeld();
        } else {
            // the hire takes its share of value, principal and interest together
            uint256 paid = amount * valueOf(id) / p;
            uint256 burned = _sharesFor(paid);
            if (burned > shares[id]) burned = shares[id];
            shares[id] -= burned;
            principal[id] = p - amount;
            require(IVToken(vToken).redeem(burned) == 0, "redeem");
            _sendHeld();
        }
    }

    function valueOf(uint256 id) public view returns (uint256) {
        uint256 held = shares[id];
        if (held == 0) return 0;
        return held * IVToken(vToken).exchangeRateStored() / RATE_SCALE;
    }

    function _sharesFor(uint256 underlyingAmount) internal view returns (uint256) {
        uint256 rate = IVToken(vToken).exchangeRateStored();
        if (rate == 0) return 0;
        return underlyingAmount * RATE_SCALE / rate;
    }

    function _sendHeld() internal {
        uint256 held = IERC20Minimal(asset).balanceOf(address(this));
        if (held > 0) require(IERC20Minimal(asset).transfer(vault, held), "send");
    }

    /// @notice the market's annual rate in basis points
    function getYieldRate() external view returns (uint256) {
        return IVToken(vToken).supplyRatePerBlock() * BLOCKS_PER_YEAR * 10_000 / 1e18;
    }

    function underlying() external view returns (address) {
        return asset;
    }
}
