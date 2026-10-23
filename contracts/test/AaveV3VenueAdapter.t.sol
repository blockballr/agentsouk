// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AaveV3VenueAdapter} from "../src/venues/AaveV3VenueAdapter.sol";

interface Vm {
    function prank(address sender) external;
    function deal(address who, uint256 newBalance) external;
    function warp(uint256 timestamp) external;
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice the adapter against the real Aave V3 BNB pool on a chain 56 fork:
/// forge test --match-contract AaveV3VenueAdapterForkTest --fork-url <bsc rpc>
contract AaveV3VenueAdapterForkTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address private constant POOL = 0x6807dc923806fE8Fd134338EABCA509979a7e0cB;
    address private constant A_USDT = 0xa9251ca9DE909CB71783723713B21E4233fbf1B1;

    function testSupplyWithdrawAndRate() public {
        AaveV3VenueAdapter adapter = new AaveV3VenueAdapter(address(this), USDT, POOL, A_USDT);
        vm.prank(POOL);
        require(IERC20Balance(USDT).transfer(address(this), 200e18), "fund");

        require(IERC20Balance(USDT).approve(address(adapter), 100e18), "approve");
        adapter.supply(1, 100e18);

        uint256 held = adapter.valueOf(1);
        require(held + 1 >= 100e18, "supply did not land");

        uint256 rate = adapter.getYieldRate();
        require(rate > 0, "no rate");

        adapter.withdraw(1, 50e18);
        uint256 back = IERC20Balance(USDT).balanceOf(address(this));
        require(back + 1 >= 150e18, "withdraw did not return");
        require(adapter.valueOf(1) + 1 >= 50e18, "half left");
    }

    // two hires, one adapter. closing the first must pay its own share and
    // leave the second's position whole, including its interest.
    function testTwoHiresKeepTheirOwnInterest() public {
        AaveV3VenueAdapter adapter = new AaveV3VenueAdapter(address(this), USDT, POOL, A_USDT);
        vm.prank(POOL);
        require(IERC20Balance(USDT).transfer(address(this), 300e18), "fund");
        require(IERC20Balance(USDT).approve(address(adapter), 200e18), "approve");

        adapter.supply(1, 100e18);
        uint256 before = IERC20Balance(USDT).balanceOf(address(this));
        vm.warp(block.timestamp + 180 days);
        adapter.supply(2, 100e18);
        require(IERC20Balance(USDT).balanceOf(address(this)) == before - 100e18, "second supply");

        require(adapter.valueOf(1) > 100e18, "no accrual on the older hire");

        // close the older hire first, and confirm it is paid its own interest
        uint256 paidBefore = IERC20Balance(USDT).balanceOf(address(this));
        adapter.withdraw(1, type(uint256).max);
        uint256 paid = IERC20Balance(USDT).balanceOf(address(this)) - paidBefore;
        require(paid > 100e18, "older hire got no interest");
        require(adapter.valueOf(1) == 0, "older hire not cleared");
        require(adapter.valueOf(2) + 1 >= 100e18, "younger hire was touched");
    }

    function testOnlyVault() public {
        AaveV3VenueAdapter adapter = new AaveV3VenueAdapter(address(this), USDT, POOL, A_USDT);

        vm.prank(address(0xB0B));
        (bool ok,) = address(adapter).call(abi.encodeWithSignature("supply(uint256,uint256)", 1, 1e18));
        require(!ok, "supply was open");
    }
}
