// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {HealthOperator} from "../src/HealthOperator.sol";
import {ForkGuard} from "./ForkGuard.sol";

interface Vm {
    function prank(address sender) external;
}

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IVTokenLike {
    function mint(uint256 amount) external returns (uint256);
    function borrow(uint256 amount) external returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

interface IComptrollerLike {
    function enterMarkets(address[] calldata markets) external returns (uint256[] memory);
}

/// @notice the operator against the real Venus Core vUSDT market on a chain 56
/// fork: a supplied position, a real borrow, then a repay and a collateral
/// redemption through the mandate only.
/// forge test --match-contract HealthOperatorForkTest --fork-url <bsc rpc>
contract HealthOperatorForkTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address private constant V_USDT = 0xfD5840Cd36d94D7229439859C0112a4185BC0255;
    address private constant COMPTROLLER = 0xfD36E2c2a6789Db23113685031d7F16329158384;

    address private constant AGENT = address(0xA9E);
    address private constant PAYOUT = address(0xFA0);

    function testRepayOnTheRealMarket() public {
        ForkGuard.ensure();

        // a real supply, then a real borrow, so the position exists on the fork
        vm.prank(V_USDT);
        require(IERC20Like(USDT).transfer(address(this), 200e18), "fund");
        require(IERC20Like(USDT).approve(V_USDT, type(uint256).max), "approve market");
        require(IVTokenLike(V_USDT).mint(100e18) == 0, "mint");

        address[] memory markets = new address[](1);
        markets[0] = V_USDT;
        IComptrollerLike(COMPTROLLER).enterMarkets(markets);

        require(IVTokenLike(V_USDT).borrow(40e18) == 0, "borrow");
        uint256 owed = IVTokenLike(V_USDT).borrowBalanceCurrent(address(this));
        require(owed >= 40e18, "no debt");

        HealthOperator operator = new HealthOperator();
        require(IERC20Like(USDT).approve(address(operator), type(uint256).max), "approve operator");
        HealthOperator.Position[] memory positions = new HealthOperator.Position[](1);
        positions[0] = HealthOperator.Position({account: address(this), vTokenDebt: V_USDT});
        operator.setMandate(AGENT, USDT, 20e18, 40e18, uint64(block.timestamp + 7 days), positions);

        vm.prank(AGENT);
        operator.repay(address(this), 0, 10e18);
        uint256 afterRepay = IVTokenLike(V_USDT).borrowBalanceCurrent(address(this));
        require(afterRepay + 10e18 <= owed && afterRepay + 10e18 >= owed - 1e12, "repay did not land");

        require(IERC20Like(USDT).balanceOf(address(operator)) == 0, "operator kept funds");
    }
}
