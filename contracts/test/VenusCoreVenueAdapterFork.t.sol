// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {VenusCoreVenueAdapter} from "../src/venues/VenusCoreVenueAdapter.sol";
import {ForkGuard} from "./ForkGuard.sol";

interface Vm {
    function prank(address sender) external;
}

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice the adapter against the real Venus Core vUSDT market on a chain 56
/// fork, so the exchange rate scale is checked against the market and not a mock:
/// forge test --match-contract VenusCoreVenueAdapterForkTest --fork-url <bsc rpc>
contract VenusCoreVenueAdapterForkTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address private constant V_USDT = 0xfD5840Cd36d94D7229439859C0112a4185BC0255;

    function testSupplyWithdrawAndRate() public {
        ForkGuard.ensure();

        VenusCoreVenueAdapter adapter = new VenusCoreVenueAdapter(address(this), USDT, V_USDT);
        vm.prank(V_USDT);
        require(IERC20Like(USDT).transfer(address(this), 200e18), "fund");

        require(IERC20Like(USDT).approve(address(adapter), 100e18), "approve");
        adapter.supply(1, 100e18);

        uint256 held = adapter.valueOf(1);
        require(held + 1e15 >= 100e18 && held <= 100e18 + 1e15, "supply priced wrong");
        require(adapter.getYieldRate() > 0, "no rate");

        adapter.withdraw(1, 40e18);
        uint256 back = IERC20Like(USDT).balanceOf(address(this));
        require(back + 1e15 >= 140e18, "partial withdraw short");
        require(adapter.valueOf(1) + 1e15 >= 60e18, "half left");

        adapter.withdraw(1, type(uint256).max);
        require(adapter.valueOf(1) == 0, "not cleared");
        require(adapter.shares(1) == 0 && adapter.principal(1) == 0, "state left");
    }

    function testScaleMatchesTheMarket() public {
        ForkGuard.ensure();

        VenusCoreVenueAdapter adapter = new VenusCoreVenueAdapter(address(this), USDT, V_USDT);
        require(adapter.RATE_SCALE() == 1e18, "scale for 18 and 8 decimals");
    }
}
