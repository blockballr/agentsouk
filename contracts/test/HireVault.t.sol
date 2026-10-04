// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {HireVault, ISwapRouterV3} from "../src/HireVault.sol";

// only the cheatcodes these tests need, so the suite does not depend on forge-std
interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    // parts per ten thousand kept back on every transfer, to stand in for a token that takes a cut
    uint256 public cutBps;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setCut(uint256 bps) external {
        cutBps = bps;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        balanceOf[to] += amount - (amount * cutBps) / 10_000;
    }
}

// The tick is set directly rather than derived from a price. The vault no longer reads
// slot0, so a sqrt price here would be decoration, and deriving a tick from one is a
// second source of arithmetic to get wrong. A real tick is what observe accumulates.
contract MockPool {
    address public token0;
    int56 public tick;

    constructor(address token0_, int56 tick_) {
        token0 = token0_;
        tick = tick_;
    }

    // what a test moves, to stand in for the agent pushing the price
    function setTick(int56 tick_) external {
        tick = tick_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint32, bool) {
        return (uint160(1 << 96), int24(tick), 0, 0, 0, 0, true);
    }

    // A real pool accumulates ticks for as long as the tick holds, so the cumulative at N
    // seconds ago is the tick times the seconds elapsed since then. The difference over the
    // window divided by the window is therefore the tick itself, which is the property the
    // vault's averaged reference price depends on.
    function observe(uint32[] calldata secondsAgo)
        external
        view
        returns (int56[] memory ticks, uint160[] memory secondsPerLiquidity)
    {
        ticks = new int56[](secondsAgo.length);
        secondsPerLiquidity = new uint160[](secondsAgo.length);
        for (uint256 i = 0; i < secondsAgo.length; i++) {
            ticks[i] = int56(int256(tick) * int256(block.timestamp - uint256(secondsAgo[i])));
        }
    }
}

contract MockFactory {
    address public pool;

    function setPool(address pool_) external {
        pool = pool_;
    }

    // one pool at one fee tier; every other tier has none
    function getPool(address, address, uint24 fee) external view returns (address) {
        return fee == 500 ? pool : address(0);
    }
}

// pays out at a rate the test sets, so a trade can be made to land above or below the floor
contract MockRouter {
    error TooLittleReceived();

    uint256 public outPerIn = 1e18;

    function setRate(uint256 outPerInE18) external {
        outPerIn = outPerInE18;
    }

    function exactInputSingle(ISwapRouterV3.ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        MockToken(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        out = (p.amountIn * outPerIn) / 1e18;
        if (out < p.amountOutMinimum) revert TooLittleReceived();
        MockToken(p.tokenOut).transfer(p.recipient, out);
    }
}

/// @notice the hire vault's rules: who may put money in, what the agent may do with it, and that
/// the buyer always gets all of it back
contract HireVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BUYER = address(0xB0B);
    address private constant AGENT = address(0xA6E7);
    address private constant STRANGER = address(0x5712);
    uint256 private constant CAP = 100e18;
    uint24 private constant FEE = 500;

    MockToken private wbnb;
    MockToken private usdt;
    MockPool private pool;
    MockFactory private factory;
    MockRouter private router;
    HireVault private vault;

    function setUp() public {
        vm.warp(1_800_000_000);
        wbnb = new MockToken();
        usdt = new MockToken();
        // token0 is WBNB and one WBNB is worth four USDT. That price is tick 13863,
        // since 1.0001^13863 is 3.99996.
        pool = new MockPool(address(wbnb), 13863);
        factory = new MockFactory();
        factory.setPool(address(pool));
        router = new MockRouter();
        vault = new HireVault(address(router), address(factory), address(wbnb), address(usdt), CAP, CAP);
        // the router pays out of its own stock, as a pool would
        wbnb.mint(address(router), 1000e18);
        usdt.mint(address(router), 1000e18);
        usdt.mint(BUYER, 500e18);
        wbnb.mint(BUYER, 500e18);
    }

    function _open(uint256 amount, uint16 slippageBps) private returns (uint256 id) {
        vm.prank(BUYER);
        usdt.approve(address(vault), amount);
        vm.prank(BUYER);
        id = vault.open(AGENT, address(usdt), amount, uint64(block.timestamp + 7 days), slippageBps, FEE);
    }

    function testOpenTakesExactlyTheDepositAndRecordsIt() public {
        uint256 id = _open(40e18, 300);
        HireVault.Hire memory h = vault.hire(id);
        require(h.buyer == BUYER && h.agent == AGENT && h.open, "who");
        require(h.balanceB == 40e18 && h.balanceA == 0, "balances");
        require(usdt.balanceOf(address(vault)) == 40e18 && usdt.balanceOf(BUYER) == 460e18, "moved");
        require(usdt.allowance(BUYER, address(vault)) == 0, "nothing left approved");
        require(vault.hiresOf(BUYER)[0] == id && vault.hiresFor(AGENT)[0] == id, "indexes");
    }

    function testOpenRefusesWhatItShould() public {
        uint64 soon = uint64(block.timestamp + 1 days);
        vm.prank(BUYER);
        usdt.approve(address(vault), 500e18);

        vm.expectRevert(HireVault.NoAgent.selector);
        vm.prank(BUYER);
        vault.open(address(0), address(usdt), 10e18, soon, 300, FEE);

        vm.expectRevert(HireVault.UnknownToken.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(0xDEAD), 10e18, soon, 300, FEE);

        vm.expectRevert(HireVault.BadAmount.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(usdt), CAP + 1, soon, 300, FEE);

        vm.expectRevert(HireVault.BadAmount.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(usdt), 0, soon, 300, FEE);

        vm.expectRevert(HireVault.BadExpiry.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(usdt), 10e18, uint64(block.timestamp), 300, FEE);

        vm.expectRevert(HireVault.BadExpiry.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(usdt), 10e18, uint64(block.timestamp + 91 days), 300, FEE);

        vm.expectRevert(HireVault.BadSlippage.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(usdt), 10e18, soon, 1001, FEE);
    }

    function testOpenRefusesATokenThatKeepsACut() public {
        usdt.setCut(100);
        vm.prank(BUYER);
        usdt.approve(address(vault), 10e18);
        vm.expectRevert(HireVault.BadAmount.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(usdt), 10e18, uint64(block.timestamp + 1 days), 300, FEE);
    }

    function _openHire() private returns (uint256 id) {
        usdt.mint(BUYER, 20e18);
        vm.prank(BUYER);
        usdt.approve(address(vault), type(uint256).max);
        vm.prank(BUYER);
        id = vault.open(AGENT, address(usdt), 10e18, uint64(block.timestamp + 7 days), 300, FEE);
    }

    function testRefQuoteReadsTheStoredPriceBothWays() public view {
        // the reference price as token1 per token0, Q96. Four USDT to one WBNB.
        uint256 ref = 4 * (uint256(1) << 96);
        require(vault.quoteAtRef(address(pool), address(wbnb), 1e18, ref) == 4e18, "one WBNB is four USDT");
        require(vault.quoteAtRef(address(pool), address(usdt), 4e18, ref) == 1e18, "four USDT is one WBNB");
    }

    // The flaw this replaces: trade used to read slot0, so the agent could move the price
    // in the same transaction and the floor followed it. The floor is now fixed at open.
    function testMovingThePoolDoesNotMoveTheFloor() public {
        uint256 id = _openHire();
        uint160 refBefore = vault.hire(id).refPriceX96;
        router.setRate(0.25e18);
        // the agent pushes the price to a quarter of what it was
        pool.setTick(0);
        vm.prank(AGENT);
        uint256 out = vault.trade(id, address(usdt), 8e18, 0);
        // the swap landed at the router's rate, and the stored price is untouched by the move
        require(out == 2e18, "the router rate is what cleared");
        require(vault.hire(id).refPriceX96 == refBefore, "the stored price did not move");
    }

    function testTheFloorIsUnchangedByAMovedPrice() public {
        uint256 id = _openHire();
        uint160 refBefore = vault.hire(id).refPriceX96;
        // the tick is halved, which is a large fall, well past any slippage allowance
        pool.setTick(0);
        require(vault.hire(id).refPriceX96 == refBefore, "the stored price does not follow spot");
        // the floor here is about 1.94 for 8 in, so a router paying under 0.2425 a unit
        // cannot clear it. 0.25 would clear it, which is why the rate is not a quarter.
        // The router refuses first with its own error, because amountOutMinimum is what
        // it is given. Either way the fill does not happen, which is the property.
        router.setRate(0.24e18);
        vm.expectRevert(MockRouter.TooLittleReceived.selector);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 8e18, 0);
    }

    function testTheAgentTradesAndTheProceedsStayInTheVault() public {
        uint256 id = _open(40e18, 300);
        // four USDT buy one WBNB at spot, so the router pays a quarter per unit in
        router.setRate(0.25e18);
        vm.prank(AGENT);
        uint256 out = vault.trade(id, address(usdt), 8e18, 0);
        require(out == 2e18, "bought two WBNB");
        HireVault.Hire memory h = vault.hire(id);
        require(h.balanceB == 32e18 && h.balanceA == 2e18, "books follow the trade");
        require(wbnb.balanceOf(address(vault)) == 2e18 && wbnb.balanceOf(AGENT) == 0, "agent holds nothing");
        require(usdt.allowance(address(vault), address(router)) == 0, "no approval left on the router");

        // and back the other way
        router.setRate(4e18);
        vm.prank(AGENT);
        vault.trade(id, address(wbnb), 1e18, 0);
        h = vault.hire(id);
        require(h.balanceA == 1e18 && h.balanceB == 36e18, "sold one WBNB");
    }

    function testATradeBelowTheBuyersFloorIsRefused() public {
        uint256 id = _open(40e18, 300);
        // spot gives two WBNB for eight USDT; three percent under that is 1.94, and this pays 1.92
        router.setRate(0.24e18);
        vm.expectRevert(MockRouter.TooLittleReceived.selector);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 8e18, 0);
    }

    function testTheAgentMayRaiseTheFloorButNotLowerIt() public {
        uint256 id = _open(40e18, 300);
        router.setRate(0.249e18);
        // 1.992 WBNB clears the buyer's floor but not the two the agent itself asked for
        vm.expectRevert(MockRouter.TooLittleReceived.selector);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 8e18, 2e18);
        // a minimum under the buyer's floor changes nothing: the same trade goes through
        vm.prank(AGENT);
        require(vault.trade(id, address(usdt), 8e18, 1) == 1.992e18, "floor held at the buyer's limit");
    }

    function testOnlyTheNamedAgentTradesAndOnlyWithinTheDeposit() public {
        uint256 id = _open(40e18, 300);
        router.setRate(0.25e18);

        vm.expectRevert(HireVault.NotTheAgent.selector);
        vm.prank(STRANGER);
        vault.trade(id, address(usdt), 1e18, 0);

        vm.expectRevert(HireVault.NotTheAgent.selector);
        vm.prank(BUYER);
        vault.trade(id, address(usdt), 1e18, 0);

        vm.expectRevert(HireVault.BadAmount.selector);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 41e18, 0);

        vm.expectRevert(HireVault.UnknownToken.selector);
        vm.prank(AGENT);
        vault.trade(id, address(0xDEAD), 1e18, 0);
    }

    // The old suite ended with a trade that named a fee tier the factory had no pool for,
    // and expected NoPool. The fee is bound at open now, so an agent can no longer point a
    // trade at a thin pool of its choosing and that path no longer exists. What replaces it
    // is that open refuses a fee tier with no pool, so a hire can never start one.
    function testOpenRefusesAFeeTierWithNoPool() public {
        vm.prank(BUYER);
        usdt.approve(address(vault), 10e18);
        vm.expectRevert(HireVault.NoPool.selector);
        vm.prank(BUYER);
        vault.open(AGENT, address(usdt), 10e18, uint64(block.timestamp + 7 days), 300, 3000);
    }

    function testOneHiresMoneyIsNeverSpentForAnother() public {
        uint256 first = _open(10e18, 300);
        uint256 second = _open(40e18, 300);
        router.setRate(0.25e18);
        // the vault holds fifty, but the first hire may only spend its own ten
        vm.expectRevert(HireVault.BadAmount.selector);
        vm.prank(AGENT);
        vault.trade(first, address(usdt), 11e18, 0);
        vm.prank(AGENT);
        vault.trade(first, address(usdt), 10e18, 0);
        require(vault.hire(second).balanceB == 40e18 && vault.hire(second).balanceA == 0, "second untouched");
    }

    function testNothingTradesAfterTheExpiry() public {
        uint256 id = _open(40e18, 300);
        router.setRate(0.25e18);
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(HireVault.Expired.selector);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 1e18, 0);
    }

    function testTheBuyerTakesEverythingBackAtAnyTime() public {
        uint256 id = _open(40e18, 300);
        router.setRate(0.25e18);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 8e18, 0);

        vm.expectRevert(HireVault.NotTheBuyer.selector);
        vm.prank(AGENT);
        vault.withdraw(id);

        vm.prank(BUYER);
        vault.withdraw(id);
        require(usdt.balanceOf(BUYER) == 492e18 && wbnb.balanceOf(BUYER) == 502e18, "both tokens returned");
        require(usdt.balanceOf(address(vault)) == 0 && wbnb.balanceOf(address(vault)) == 0, "vault empty");
        require(!vault.hire(id).open, "closed");

        // once closed there is nothing left to trade or to take twice
        vm.expectRevert(HireVault.NotOpen.selector);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 1e18, 0);
        vm.expectRevert(HireVault.NotOpen.selector);
        vm.prank(BUYER);
        vault.withdraw(id);
    }

    function testTheBuyerCanStillWithdrawAfterTheExpiry() public {
        uint256 id = _open(40e18, 300);
        vm.warp(block.timestamp + 30 days);
        vm.prank(BUYER);
        vault.withdraw(id);
        require(usdt.balanceOf(BUYER) == 500e18, "all of it back");
    }

    function testItWillNotBeBuiltOnAnythingThatIsNotAContract() public {
        vm.expectRevert(HireVault.NotAContract.selector);
        new HireVault(address(0x1234), address(factory), address(wbnb), address(usdt), CAP, CAP);
        vm.expectRevert(HireVault.UnknownToken.selector);
        new HireVault(address(router), address(factory), address(wbnb), address(wbnb), CAP, CAP);
    }
}
