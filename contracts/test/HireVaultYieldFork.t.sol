// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {HireVault} from "../src/HireVault.sol";
import {AaveV3VenueAdapter} from "../src/venues/AaveV3VenueAdapter.sol";

interface Vm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IFactory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

/// @notice the patched vault plus the Aave adapter on a chain 56 fork:
/// forge test --match-contract HireVaultYieldForkTest --fork-url <bsc rpc>
contract HireVaultYieldForkTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14;
    address private constant FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address private constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address private constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address private constant POOL = 0x6807dc923806fE8Fd134338EABCA509979a7e0cB;
    address private constant A_USDT = 0xa9251ca9DE909CB71783723713B21E4233fbf1B1;

    function _openFunded() private returns (HireVault vault, AaveV3VenueAdapter adapter, uint256 id) {
        address lp = IFactory(FACTORY).getPool(WBNB, USDT, 500);
        vm.prank(lp);
        require(IERC20(USDT).transfer(address(this), 1_000e18), "fund");

        vault = new HireVault(ROUTER, FACTORY, WBNB, USDT, 50e18, 100_000e18, 5_000, 1e18);
        adapter = new AaveV3VenueAdapter(address(vault), USDT, POOL, A_USDT);

        require(IERC20(USDT).approve(address(vault), 100e18), "approve");
        id = vault.open(address(this), USDT, 100e18, uint64(block.timestamp + 60 days), 500, 500, 0, 2_000, address(adapter));
        vault.supplyToVenue(id, address(adapter), 100e18);
        vm.warp(block.timestamp + 30 days);
    }

    function testSupplyAccruesAndWithdrawCredits() public {
        (HireVault vault, AaveV3VenueAdapter adapter, uint256 id) = _openFunded();
        require(adapter.valueOf(id) > 100e18, "no accrual");

        vault.withdrawFromVenue(id, address(adapter), 100e18);
        HireVault.Hire memory hired = vault.hire(id);
        require(hired.balanceB > 100e18, "interest was not credited");
        require(hired.deployedB == 0, "principal still deployed");

        vault.withdraw(id);
        require(IERC20(USDT).balanceOf(address(this)) > 1_000e18, "buyer did not receive interest");
    }

    function testBuyerClosePullsVenue() public {
        (HireVault vault,, uint256 id) = _openFunded();
        vault.withdraw(id);
        require(IERC20(USDT).balanceOf(address(this)) > 1_000e18, "buyer close did not pull interest");
    }

    function testCloseIfGoalPullsVenue() public {
        (HireVault vault,, uint256 id) = _openFunded();
        vault.closeIfGoal(id, 100e18);
        require(IERC20(USDT).balanceOf(address(this)) > 1_000e18, "goal close did not pull interest");
    }

    // two hires on one adapter, opened a fortnight apart. closing the older one
    // first must pay its own interest and leave the younger position untouched.
    function testTwoHiresAccrueSeparately() public {
        address lp = IFactory(FACTORY).getPool(WBNB, USDT, 500);
        vm.prank(lp);
        require(IERC20(USDT).transfer(address(this), 1_000e18), "fund");

        HireVault vault = new HireVault(ROUTER, FACTORY, WBNB, USDT, 50e18, 100_000e18, 5_000, 1e18);
        AaveV3VenueAdapter adapter = new AaveV3VenueAdapter(address(vault), USDT, POOL, A_USDT);
        require(IERC20(USDT).approve(address(vault), 200e18), "approve");

        uint256 a = vault.open(address(this), USDT, 100e18, uint64(block.timestamp + 60 days), 500, 500, 0, 2_000, address(adapter));
        vault.supplyToVenue(a, address(adapter), 100e18);
        vm.warp(block.timestamp + 15 days);
        uint256 b = vault.open(address(this), USDT, 100e18, uint64(block.timestamp + 60 days), 500, 500, 0, 2_000, address(adapter));
        vault.supplyToVenue(b, address(adapter), 100e18);
        vm.warp(block.timestamp + 15 days);

        uint256 valueA = adapter.valueOf(a);
        uint256 valueB = adapter.valueOf(b);
        require(valueA > 100e18 && valueB > 100e18, "no accrual");
        require(valueA > valueB, "the older hire should hold more interest");

        uint256 before = IERC20(USDT).balanceOf(address(this));
        vault.withdraw(a);
        uint256 got = IERC20(USDT).balanceOf(address(this)) - before;
        require(got > 100e18, "the older hire got no interest");
        require(vault.hire(a).open == false, "the older hire stayed open");
        require(adapter.valueOf(b) + 1 >= valueB, "closing a moved b");

        before = IERC20(USDT).balanceOf(address(this));
        vault.withdraw(b);
        got = IERC20(USDT).balanceOf(address(this)) - before;
        require(got > 100e18, "the younger hire got no interest");
    }
}
