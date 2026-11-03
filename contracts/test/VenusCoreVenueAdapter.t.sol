// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {VenusCoreVenueAdapter} from "../src/venues/VenusCoreVenueAdapter.sol";

/// @notice the adapter against a mock market: no fork, so the scale and the
/// per-hire accounting are checked on every run.
contract VenusCoreVenueAdapterTest {
    MockToken private asset;
    MockVToken private vToken;
    VenusCoreVenueAdapter private adapter;

    function setUp() public {
        asset = new MockToken(18);
        vToken = new MockVToken(address(asset), 8, 2e17);
        adapter = new VenusCoreVenueAdapter(address(this), address(asset), address(vToken));
    }

    function testSupplyLandsAndRateReads() public {
        asset.mint(address(this), 200e18);
        asset.approve(address(adapter), 100e18);
        adapter.supply(1, 100e18);

        require(approximately(adapter.valueOf(1), 100e18), "supply did not land");
        require(adapter.getYieldRate() > 0, "no rate");
        require(adapter.getYieldRate() == vToken.annualRateBps(), "adapter and market disagree");
    }

    function testInterestAccruesToTheHire() public {
        asset.mint(address(this), 100e18);
        asset.approve(address(adapter), 100e18);
        adapter.supply(1, 100e18);

        vToken.setRate(2.2e17);
        require(approximately(adapter.valueOf(1), 110e18), "interest not counted");
    }

    function testTwoHiresKeepTheirOwnShares() public {
        asset.mint(address(this), 300e18);
        asset.approve(address(adapter), 300e18);
        adapter.supply(1, 100e18);
        vToken.setRate(2.2e17);
        adapter.supply(2, 100e18);

        require(approximately(adapter.valueOf(2), 100e18), "younger hire mispriced");
        require(adapter.valueOf(1) > adapter.valueOf(2), "older hire lost its extra");

        adapter.withdraw(1, type(uint256).max);
        require(adapter.valueOf(1) == 0, "older hire not cleared");
        require(approximately(adapter.valueOf(2), 100e18), "younger hire was touched");
    }

    function testPartialWithdrawReturnsItsShare() public {
        asset.mint(address(this), 100e18);
        asset.approve(address(adapter), 100e18);
        adapter.supply(1, 100e18);

        uint256 before = asset.balanceOf(address(this));
        adapter.withdraw(1, 40e18);
        uint256 paid = asset.balanceOf(address(this)) - before;
        require(approximately(paid, 40e18), "partial paid the wrong amount");
        require(approximately(adapter.valueOf(1), 60e18), "the rest did not stay");
    }

    function testFullWithdrawClearsThePosition() public {
        asset.mint(address(this), 100e18);
        asset.approve(address(adapter), 100e18);
        adapter.supply(1, 100e18);

        uint256 before = asset.balanceOf(address(this));
        adapter.withdraw(1, type(uint256).max);
        require(approximately(asset.balanceOf(address(this)) - before, 100e18), "full pay out");
        require(adapter.shares(1) == 0, "shares left");
        require(adapter.principal(1) == 0, "principal left");
    }

    function testOnlyVault() public {
        (bool ok,) = address(adapter).call(
            abi.encodeWithSignature("supply(uint256,uint256)", 1, 1e18)
        );
        require(!ok, "supply was open");
    }

    function testWithdrawWithoutPosition() public {
        (bool ok,) = address(adapter).call(
            abi.encodeWithSignature("withdraw(uint256,uint256)", 9, 1e18)
        );
        require(!ok, "withdraw without position was allowed");
    }

    function approximately(uint256 a, uint256 b) private pure returns (bool) {
        if (a > b) return a - b <= 1e12;
        return b - a <= 1e12;
    }
}

contract MockToken {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockVToken {
    MockToken private immutable underlying;
    uint8 public immutable decimals;
    uint256 private rate;
    uint256 private constant BLOCKS_PER_YEAR = 10_512_000;
    uint256 private constant RATE_PER_BLOCK = 4_870_611_980;
    mapping(address => uint256) public balanceOf;
    uint256 private scale;

    constructor(address underlying_, uint8 decimals_, uint256 rate_) {
        underlying = MockToken(underlying_);
        decimals = decimals_;
        rate = rate_;
        scale = 1e18;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function exchangeRateStored() external view returns (uint256) {
        return rate;
    }

    function annualRateBps() external pure returns (uint256) {
        return RATE_PER_BLOCK * BLOCKS_PER_YEAR * 10_000 / 1e18;
    }

    function supplyRatePerBlock() external pure returns (uint256) {
        return RATE_PER_BLOCK;
    }

    function mint(uint256 amount) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount * scale / rate;
        return 0;
    }

    function redeem(uint256 shares) external returns (uint256) {
        require(balanceOf[msg.sender] >= shares, "shares");
        balanceOf[msg.sender] -= shares;
        underlying.transfer(msg.sender, shares * rate / scale);
        return 0;
    }
}
