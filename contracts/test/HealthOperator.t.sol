// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {HealthOperator} from "../src/HealthOperator.sol";

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

contract MockDebtToken {
    MockToken public immutable underlying;
    mapping(address => uint256) public repaid;

    constructor(MockToken underlying_) {
        underlying = underlying_;
    }

    // Compound and Venus return 0 on success
    function repayBorrowBehalf(address borrower, uint256 amount) external returns (uint256) {
        underlying.transferFrom(msg.sender, address(this), amount);
        repaid[borrower] += amount;
        return 0;
    }
}

contract HealthOperatorTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BUYER = address(0xB0B);
    address private constant AGENT = address(0xA9E);
    address private constant STRANGER = address(0xBAD);
    address private constant ACCOUNT_A = address(0xA1);
    address private constant ACCOUNT_B = address(0xB2);

    MockToken private usdt;
    MockDebtToken private vA;
    MockDebtToken private vB;
    HealthOperator private operator;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdt = new MockToken();
        vA = new MockDebtToken(usdt);
        vB = new MockDebtToken(usdt);
        operator = new HealthOperator();
        usdt.mint(BUYER, 1_000e18);
    }

    function _positions() internal view returns (HealthOperator.Position[] memory list) {
        list = new HealthOperator.Position[](2);
        list[0] = HealthOperator.Position({account: ACCOUNT_A, vTokenDebt: address(vA)});
        list[1] = HealthOperator.Position({account: ACCOUNT_B, vTokenDebt: address(vB)});
    }

    function _mandate(uint128 repayCap, uint128 dailyCap, uint64 expiry) internal {
        vm.prank(BUYER);
        operator.setMandate(AGENT, address(usdt), 12_000, 15_000, repayCap, dailyCap, expiry, _positions());
    }

    function _approve() internal {
        vm.prank(BUYER);
        usdt.approve(address(operator), type(uint256).max);
    }

    function testRepayPullsFromTheBuyerAndDefendsTheNamedPosition() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(AGENT);
        operator.repay(BUYER, 0, 100e18);

        assert(usdt.balanceOf(BUYER) == 900e18);
        assert(vA.repaid(ACCOUNT_A) == 100e18);
        assert(vB.repaid(ACCOUNT_B) == 0);
        assert(operator.spentToday(BUYER) == 100e18);
    }

    function testTheAgentCanDefendTheSecondPosition() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(AGENT);
        operator.repay(BUYER, 1, 10e18);

        assert(vB.repaid(ACCOUNT_B) == 10e18);
        assert(vA.repaid(ACCOUNT_A) == 0);
    }

    function testOneBudgetCoversTheWholePortfolio() public {
        _mandate(100e18, 150e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(AGENT);
        operator.repay(BUYER, 0, 100e18);

        vm.prank(AGENT);
        vm.expectRevert(HealthOperator.OverCap.selector);
        operator.repay(BUYER, 1, 100e18);
    }

    function testOnlyTheNamedAgentMayRepay() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(STRANGER);
        vm.expectRevert(HealthOperator.NotTheAgent.selector);
        operator.repay(BUYER, 0, 10e18);
    }

    function testExpiredMandateStops() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 1 days));
        _approve();
        vm.warp(block.timestamp + 2 days);

        vm.prank(AGENT);
        vm.expectRevert(HealthOperator.MandateExpired.selector);
        operator.repay(BUYER, 0, 10e18);
    }

    function testPerCallCap() public {
        _mandate(50e18, 300e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(AGENT);
        vm.expectRevert(HealthOperator.BadAmount.selector);
        operator.repay(BUYER, 0, 51e18);
    }

    function testDailyCapResetsTheNextDay() public {
        _mandate(100e18, 150e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(AGENT);
        operator.repay(BUYER, 0, 100e18);

        vm.warp(block.timestamp + 1 days);
        vm.prank(AGENT);
        operator.repay(BUYER, 1, 100e18);

        assert(vB.repaid(ACCOUNT_B) == 100e18);
    }

    function testRevokeEndsAuthorityAtOnce() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(BUYER);
        operator.revoke();

        vm.prank(AGENT);
        vm.expectRevert(HealthOperator.NoMandate.selector);
        operator.repay(BUYER, 0, 10e18);
    }

    function testIndexOutsideThePortfolioIsRefused() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(AGENT);
        vm.expectRevert(HealthOperator.BadPosition.selector);
        operator.repay(BUYER, 2, 10e18);
    }

    function testMandateCannotOutliveTheTerm() public {
        vm.prank(BUYER);
        vm.expectRevert(HealthOperator.BadExpiry.selector);
        operator.setMandate(AGENT, address(usdt), 12_000, 15_000, 100e18, 300e18, uint64(block.timestamp + 91 days), _positions());
    }

    function testZeroAgentIsRefused() public {
        vm.prank(BUYER);
        vm.expectRevert(HealthOperator.BadMandate.selector);
        operator.setMandate(address(0), address(usdt), 12_000, 15_000, 1e18, 1e18, uint64(block.timestamp + 1 days), _positions());
    }

    function testAnEmptyPortfolioIsRefused() public {
        HealthOperator.Position[] memory none = new HealthOperator.Position[](0);
        vm.prank(BUYER);
        vm.expectRevert(HealthOperator.BadPosition.selector);
        operator.setMandate(AGENT, address(usdt), 12_000, 15_000, 1e18, 1e18, uint64(block.timestamp + 1 days), none);
    }

    function testTheDailyCapMustNotBeBelowTheCallCap() public {
        vm.prank(BUYER);
        vm.expectRevert(HealthOperator.BadAmount.selector);
        operator.setMandate(AGENT, address(usdt), 12_000, 15_000, 100e18, 50e18, uint64(block.timestamp + 1 days), _positions());
    }

    function testTheBuyerJoinsTheWatchListOnce() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        assert(operator.buyerCount() == 1);
        assert(operator.buyerAt(0) == BUYER);

        // writing the mandate again must not duplicate the buyer
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        assert(operator.buyerCount() == 1);
    }

    function testRevokeLeavesTheWatchList() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        vm.prank(BUYER);
        operator.revoke();
        assert(operator.buyerCount() == 0);
    }

    function testTheTriggerMustSitUnderTheTarget() public {
        vm.prank(BUYER);
        vm.expectRevert(HealthOperator.BadTrigger.selector);
        operator.setMandate(AGENT, address(usdt), 15_000, 12_000, 1e18, 1e18, uint64(block.timestamp + 1 days), _positions());

        vm.prank(BUYER);
        vm.expectRevert(HealthOperator.BadTrigger.selector);
        operator.setMandate(AGENT, address(usdt), 0, 15_000, 1e18, 1e18, uint64(block.timestamp + 1 days), _positions());
    }

    function testTheBuyerKeepsCustody() public {
        _mandate(100e18, 300e18, uint64(block.timestamp + 7 days));
        _approve();

        vm.prank(AGENT);
        operator.repay(BUYER, 0, 40e18);

        assert(usdt.balanceOf(address(operator)) == 0);
    }
}
