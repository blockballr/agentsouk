// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {HireVault} from "../src/HireVault.sol";

interface Vm {
    function prank(address sender) external;
    function deal(address who, uint256 newBalance) external;
    function skip(bool skipTest) external;
    function startPrank(address sender) external;
    function stopPrank() external;
}

interface IWrapped {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IPoolFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
}

/// @notice the vault against the real PancakeSwap v3 contracts on BSC testnet. It runs only on a
/// fork of chain 97 and does nothing anywhere else:
/// forge test --match-contract HireVaultForkTest --fork-url <a chain 97 rpc>
contract HireVaultForkTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14;
    address private constant FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address private constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address private constant USDT = 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd;
    address private constant BUYER = address(0xB0B);
    address private constant AGENT = address(0xA6E7);
    uint24 private constant FEE = 500;

    function testADepositIsTradedBothWaysAndWithdrawn() public {
        vm.skip(block.chainid != 97);
        HireVault vault = new HireVault(ROUTER, FACTORY, WBNB, USDT, 1e18, 100e18);

        vm.deal(BUYER, 1e18);
        vm.prank(BUYER);
        IWrapped(WBNB).deposit{value: 0.05e18}();
        vm.prank(BUYER);
        IWrapped(WBNB).approve(address(vault), 0.05e18);
        vm.prank(BUYER);
        uint256 id = vault.open(AGENT, WBNB, 0.05e18, uint64(block.timestamp + 1 days), 300, FEE);

        // sell a fifth of the deposit for USDT, inside the buyer's three percent
        vm.prank(AGENT);
        uint256 usdtOut = vault.trade(id, WBNB, 0.01e18, 0);
        require(usdtOut > 0, "no USDT came back");
        HireVault.Hire memory h = vault.hire(id);
        require(h.balanceA == 0.04e18 && h.balanceB == usdtOut, "books after the sale");
        require(IWrapped(USDT).balanceOf(AGENT) == 0 && IWrapped(WBNB).balanceOf(AGENT) == 0, "agent holds nothing");

        // and buy WBNB back with all of it
        vm.prank(AGENT);
        uint256 wbnbBack = vault.trade(id, USDT, usdtOut, 0);
        require(wbnbBack > 0, "no WBNB came back");

        vm.prank(BUYER);
        vault.withdraw(id);
        require(IWrapped(WBNB).balanceOf(BUYER) == 0.04e18 + wbnbBack, "buyer has it all back");
        require(IWrapped(WBNB).balanceOf(address(vault)) == 0 && IWrapped(USDT).balanceOf(address(vault)) == 0, "vault empty");
        // a round trip costs two pool fees and a little price movement, never more than the limits allow
        require(wbnbBack >= (0.01e18 * 94) / 100, "round trip lost more than the limits allow");
    }

    /// @notice the agent moves the spot before it trades, and the buyer's slippage limit is measured
    /// against the price the agent made rather than the price that was real when the position opened.
    /// The trade still goes through: the floor at HireVault.sol:168 is read from slot0, so the limit
    /// protects nothing. A fix that stores a reference price at open makes this revert or hold.
    function testAnAgentSandwichingTheSpotCannotBeatTheStoredFloor() public {
        vm.skip(block.chainid != 97);
        HireVault vault = new HireVault(ROUTER, FACTORY, WBNB, USDT, 1e18, 100e18);

        vm.deal(BUYER, 1e18);
        vm.prank(BUYER);
        IWrapped(WBNB).deposit{value: 0.05e18}();
        vm.prank(BUYER);
        IWrapped(WBNB).approve(address(vault), 0.05e18);

        // fifty basis points of slippage the buyer chose
        vm.prank(BUYER);
        uint256 id = vault.open(AGENT, WBNB, 0.05e18, uint64(block.timestamp + 1 days), 50, FEE);

        address pool = IPoolFactory(FACTORY).getPool(WBNB, USDT, FEE);
        uint256 amountIn = 0.005e18;

        // what the sale is honestly worth at the price recorded when the hire was opened
        uint256 refPrice = vault.hire(id).refPriceX96;
        require(refPrice > 0, "a reference price was recorded at open");
        uint256 honestQuote = vault.quoteAtRef(pool, WBNB, amountIn, refPrice);
        uint256 honestFloor = (honestQuote * (10_000 - 50)) / 10_000;
        require(honestQuote > 0, "the pool has no quote to start from");

        // the agent dumps WBNB into the same pool first, so the spot it will sell into is its own
        vm.deal(AGENT, 3e18);
        vm.startPrank(AGENT);
        IWrapped(WBNB).deposit{value: 3e18}();
        IWrapped(WBNB).approve(ROUTER, 3e18);
        IRouter(ROUTER).exactInputSingle(
            IRouter.ExactInputSingleParams({
                tokenIn: WBNB,
                tokenOut: USDT,
                fee: FEE,
                recipient: AGENT,
                deadline: block.timestamp,
                amountIn: 2.5e18,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();

        // and now sells the buyer's deposit into the price it just made. The floor was
        // fixed at open, so the moved price cannot lower what the deposit must fetch.
        vm.prank(AGENT);
        (bool ok, bytes memory ret) = address(vault).call(
            abi.encodeWithSelector(HireVault.trade.selector, id, WBNB, amountIn, uint256(0))
        );
        if (ok) {
            uint256 got = abi.decode(ret, (uint256));
            require(got >= honestFloor, "the stored floor held against the sandwich");
        } else {
            require(
                bytes4(ret) == HireVault.BelowFloor.selector,
                "the sandwich failed, and not for an unrelated reason"
            );
        }
    }
}
