// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {HireVault} from "../src/HireVault.sol";
import {Vm, MockPool, MockFactory, MockRouter} from "./HireVault.t.sol";

// a plain token that can be told to refuse one receiver, to stand in for a
// stablecoin that has frozen the marketplace's wallet
contract FreezableToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public frozen;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function freeze(address who) external {
        frozen = who;
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
        require(to != frozen, "frozen");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

// a yield venue that pays back what it took plus a fixed amount of interest
contract InterestVenue {
    FreezableToken private immutable token;
    uint256 private immutable interest;
    mapping(address => mapping(uint256 => uint256)) public held;

    constructor(FreezableToken token_, uint256 interest_) {
        token = token_;
        interest = interest_;
    }

    function supply(uint256 id, uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        held[msg.sender][id] += amount;
    }

    function withdraw(uint256 id, uint256) external {
        uint256 balance = held[msg.sender][id];
        held[msg.sender][id] = 0;
        if (balance > 0) token.transfer(msg.sender, balance + interest);
    }
}

/// @notice the marketplace's share: it comes out of the agent's fee, the buyer
/// never pays for it, and it can never stand between a buyer and a withdrawal
contract HireVaultMarketShareTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant BUYER = address(0xB0B);
    address private constant AGENT = address(0xA6E7);
    address private constant MARKET = address(0x50C);
    uint256 private constant CAP = 100e18;
    uint256 private constant MIN_DEPOSIT = 1e17;

    struct Payout {
        // what the buyer ends with beyond what they started with
        uint256 buyerUsdt;
        uint256 agentUsdt;
        uint256 marketUsdt;
    }

    FreezableToken private wbnb;
    FreezableToken private usdt;
    MockFactory private factory;
    MockRouter private router;

    function setUp() public {
        vm.warp(1_800_000_000);
        wbnb = new FreezableToken();
        usdt = new FreezableToken();
        // token0 is WBNB and one WBNB is worth four USDT, as in the main suite
        MockPool pool = new MockPool(address(wbnb), 13863);
        factory = new MockFactory();
        factory.setPool(address(pool));
        router = new MockRouter();
        wbnb.mint(address(router), 1000e18);
        usdt.mint(address(router), 1000e18);
    }

    function _vault(address recipient, uint16 shareBps) private returns (HireVault) {
        return new HireVault(
            address(router), address(factory), address(wbnb), address(usdt), CAP, CAP, 5000, MIN_DEPOSIT, recipient, shareBps
        );
    }

    // one profitable hire, start to finish: the agent parks half the deposit
    // in a venue that pays four USDT of interest, so the hire closes above its
    // high-water mark and a ten percent performance fee falls due
    function _profitableHire(HireVault vault) private returns (Payout memory p) {
        InterestVenue venue = new InterestVenue(usdt, 4e18);
        usdt.mint(address(venue), 4e18);
        usdt.mint(BUYER, 40e18);
        uint256 buyerBefore = usdt.balanceOf(BUYER);
        uint256 agentBefore = usdt.balanceOf(AGENT);
        uint256 marketBefore = usdt.balanceOf(MARKET);

        vm.prank(BUYER);
        usdt.approve(address(vault), 40e18);
        vm.prank(BUYER);
        uint256 id =
            vault.open(AGENT, address(usdt), 40e18, uint64(block.timestamp + 7 days), 300, 500, 1000, 2000, address(venue));

        vm.prank(AGENT);
        vault.supplyToVenue(id, address(venue), 20e18);

        vm.prank(BUYER);
        vault.withdraw(id);

        p.buyerUsdt = usdt.balanceOf(BUYER) - buyerBefore;
        p.agentUsdt = usdt.balanceOf(AGENT) - agentBefore;
        p.marketUsdt = usdt.balanceOf(MARKET) - marketBefore;
    }

    function testAZeroShareBehavesLikeTheVaultWithoutOne() public {
        Payout memory p = _profitableHire(_vault(address(0), 0));
        require(p.agentUsdt > 0, "the hire was in profit, so a fee fell due");
        require(p.marketUsdt == 0, "nothing goes to a market with no share");
        require(p.buyerUsdt + p.agentUsdt == 4e18, "the interest is split between buyer and agent only");
        // ten percent of four USDT, less the rounding of valuing it through the reference price
        require(p.agentUsdt > 0.399e18 && p.agentUsdt <= 0.4e18, "the fee is ten percent of the profit");
    }

    function testTheShareComesOutOfTheAgentFeeAndTheBuyerPaysTheSame() public {
        Payout memory plain = _profitableHire(_vault(address(0), 0));
        Payout memory shared = _profitableHire(_vault(MARKET, 2000));

        require(shared.buyerUsdt == plain.buyerUsdt, "the buyer ends with the same with or without a share");
        require(shared.agentUsdt + shared.marketUsdt == plain.agentUsdt, "agent and market split exactly the old fee");
        require(shared.marketUsdt == (plain.agentUsdt * 2000) / 10_000, "the market takes its stated share of the fee");
        require(shared.marketUsdt > 0, "and that share is not nothing");
    }

    function testAFrozenMarketWalletCannotHoldUpAWithdrawal() public {
        Payout memory plain = _profitableHire(_vault(address(0), 0));
        Payout memory shared = _profitableHire(_vault(MARKET, 2000));
        usdt.freeze(MARKET);
        Payout memory p = _profitableHire(_vault(MARKET, 2000));

        require(p.marketUsdt == 0, "the frozen wallet received nothing");
        require(p.agentUsdt == shared.agentUsdt, "the agent still gets its own part");
        require(p.buyerUsdt == plain.buyerUsdt + shared.marketUsdt, "and the undelivered cut went back to the buyer");
    }

    function testAFrozenAgentWalletCannotHoldUpAWithdrawal() public {
        Payout memory plain = _profitableHire(_vault(address(0), 0));
        Payout memory shared = _profitableHire(_vault(MARKET, 2000));
        usdt.freeze(AGENT);
        Payout memory p = _profitableHire(_vault(MARKET, 2000));

        require(p.agentUsdt == 0, "the frozen agent wallet received nothing");
        require(p.marketUsdt == shared.marketUsdt, "the market still gets its cut");
        require(p.buyerUsdt == plain.buyerUsdt + shared.agentUsdt, "and the agent's undelivered part went back to the buyer");
    }

    function testWithNoShareAFrozenAgentLeavesTheWholeFeeWithTheBuyer() public {
        Payout memory plain = _profitableHire(_vault(address(0), 0));
        usdt.freeze(AGENT);
        Payout memory p = _profitableHire(_vault(address(0), 0));
        require(p.agentUsdt == 0, "nothing reached the agent");
        require(p.buyerUsdt == plain.buyerUsdt + plain.agentUsdt, "the buyer keeps the fee that could not be paid");
    }

    function testTheShareIsCappedAndNeedsSomewhereToGo() public {
        vm.expectRevert(HireVault.BadShare.selector);
        _vault(MARKET, 3001);
        vm.expectRevert(HireVault.BadShare.selector);
        _vault(address(0), 1);
        HireVault atCap = _vault(MARKET, 3000);
        require(atCap.marketShareBps() == 3000 && atCap.feeRecipient() == MARKET, "the cap itself is allowed");
    }

    // the vault as it stands today: a gain made by trading raises the high-water
    // mark inside the trade itself, so no fee is due on it when the hire closes.
    // the gain here exists only at the stored reference price: the agent bought
    // WBNB below it, and at the price it actually paid the hire is worth what
    // was put in. charging a fee on that would bill the buyer for nothing
    function testAGainMadeByTradingPaysNoFee() public {
        HireVault vault = _vault(MARKET, 2000);
        usdt.mint(BUYER, 40e18);
        vm.prank(BUYER);
        usdt.approve(address(vault), 40e18);
        vm.prank(BUYER);
        uint256 id = vault.open(AGENT, address(usdt), 40e18, uint64(block.timestamp + 7 days), 300, 500, 1000, 2000, address(0));

        // WBNB costs four USDT at the reference; the agent gets it at three and a third
        router.setRate(0.3e18);
        vm.prank(AGENT);
        vault.trade(id, address(usdt), 20e18, 0);
        require(vault.valueInToken0(id) > vault.hire(id).depositInToken0, "at the reference price the hire shows a gain");

        vm.prank(BUYER);
        vault.withdraw(id);
        require(usdt.balanceOf(AGENT) == 0 && usdt.balanceOf(MARKET) == 0, "and still no fee was paid to anyone");
    }
}
