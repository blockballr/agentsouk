// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {HealthSubscription} from "../src/HealthSubscription.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract HealthSubscriptionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BUYER = address(0xB0B);
    address private constant AGENT = address(0xA9E);
    address private constant STRANGER = address(0xBAD);

    MockToken private usdt;
    HealthSubscription private subs;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdt = new MockToken();
        subs = new HealthSubscription(address(usdt));
        usdt.mint(BUYER, 1_000e18);
        vm.prank(BUYER);
        usdt.approve(address(subs), type(uint256).max);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(BUYER);
        subs.deposit(amount);
    }

    function _plan(uint128 rate, uint64 expiry) internal {
        vm.prank(BUYER);
        subs.setPlan(AGENT, rate, expiry);
    }

    function testDepositAndWithdraw() public {
        _deposit(100e18);
        assert(subs.balanceOf(BUYER) == 100e18);
        assert(usdt.balanceOf(address(subs)) == 100e18);

        vm.prank(BUYER);
        subs.withdraw(40e18);
        assert(subs.balanceOf(BUYER) == 60e18);
        assert(usdt.balanceOf(BUYER) == 940e18);
    }

    function testCannotWithdrawMoreThanTheBalance() public {
        _deposit(10e18);
        vm.prank(BUYER);
        vm.expectRevert(HealthSubscription.BadAmount.selector);
        subs.withdraw(11e18);
    }

    function testTheAgentDrawsTheElapsedRate() public {
        _deposit(100e18);
        _plan(1e18, uint64(block.timestamp + 30 days));

        vm.warp(block.timestamp + 2 days);
        vm.prank(AGENT);
        subs.charge(BUYER);

        assert(usdt.balanceOf(AGENT) == 2e18);
        assert(subs.balanceOf(BUYER) == 98e18);
    }

    function testTheDrawStartsAgainFromTheCharge() public {
        _deposit(100e18);
        _plan(1e18, uint64(block.timestamp + 30 days));

        vm.warp(block.timestamp + 1 days);
        vm.prank(AGENT);
        subs.charge(BUYER);
        assert(usdt.balanceOf(AGENT) == 1e18);

        vm.warp(block.timestamp + 1 days);
        vm.prank(AGENT);
        subs.charge(BUYER);
        assert(usdt.balanceOf(AGENT) == 2e18);
    }

    function testTheDrawIsCappedByTheBalance() public {
        _deposit(1e18);
        _plan(1e18, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 5 days);

        vm.prank(AGENT);
        subs.charge(BUYER);

        assert(usdt.balanceOf(AGENT) == 1e18);
        assert(subs.balanceOf(BUYER) == 0);
    }

    function testOnlyTheNamedAgentDraws() public {
        _deposit(100e18);
        _plan(1e18, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 1 days);

        vm.prank(STRANGER);
        vm.expectRevert(HealthSubscription.NotTheAgent.selector);
        subs.charge(BUYER);
    }

    function testNothingIsDueInTheSameBlock() public {
        _deposit(100e18);
        _plan(1e18, uint64(block.timestamp + 30 days));

        vm.prank(AGENT);
        vm.expectRevert(HealthSubscription.NoBalance.selector);
        subs.charge(BUYER);
    }

    function testAnHourOfWatchIsWorthAnHourOfTheRate() public {
        _deposit(100e18);
        _plan(24e18, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 1 hours);
        assert(subs.accrued(BUYER) == 1e18);
    }

    function testAnExpiredPlanCannotBeCharged() public {
        _deposit(100e18);
        _plan(1e18, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 2 days);

        vm.prank(AGENT);
        vm.expectRevert(HealthSubscription.PlanExpired.selector);
        subs.charge(BUYER);
    }

    function testCancelStopsTheDrawAndLeavesTheBalanceWithdrawable() public {
        _deposit(100e18);
        _plan(1e18, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 2 days);

        vm.prank(BUYER);
        subs.cancel();

        vm.prank(AGENT);
        vm.expectRevert(HealthSubscription.NoPlan.selector);
        subs.charge(BUYER);

        vm.prank(BUYER);
        subs.withdraw(100e18);
        assert(usdt.balanceOf(BUYER) == 1_000e18);
    }

    function testTheBuyerCanWithdrawAfterThePlanExpires() public {
        _deposit(50e18);
        _plan(1e18, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 10 days);

        vm.prank(BUYER);
        subs.withdraw(50e18);
        assert(subs.balanceOf(BUYER) == 0);
    }

    function testAccruedNeverExceedsTheBalance() public {
        _deposit(3e18);
        _plan(1e18, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 10 days);
        assert(subs.accrued(BUYER) == 3e18);
    }
}
