// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISwapRouterV3 {
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

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IV3Pool {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint32, bool);

    function token0() external view returns (address);

    // cumulative ticks at the given secondsAgo, 0 meaning now. A real V3 pool keeps
    // these, which is what makes a time weighted price available without a feed
    function observe(uint32[] calldata secondsAgo)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

// what a buyer hands a trading agent: a deposit the agent may swap between two named tokens on
// one named router, and nothing else
// the agent can never move the deposit out, and the buyer can take all of it back at any time
//
// the floor is measured against a price fixed at open, never against the pool's price at the
// moment of the trade. Reading slot0 inside trade let the agent move the price and then trade
// into the move, so the floor followed the manipulation and stopped constraining anything.
// The price is stored per hire and the fee tier is bound at open, so the agent chooses
// neither. It is a time weighted price rather than a spot read, because a spot read taken at
// open can itself be pushed just before open lands.
// deposits stay capped and mainnet still waits for an audit
contract HireVault {
    struct Hire {
        address buyer;
        address agent;
        uint64 expiry;
        uint16 maxSlippageBps;
        bool open;
        uint256 balanceA;
        uint256 balanceB;
        // token1 per token0 as a Q96 number, fixed at open
        uint160 refPriceX96;
        uint24 fee;
    }

    address public immutable router;
    address public immutable factory;
    address public immutable tokenA;
    address public immutable tokenB;
    // the most one deposit may hold of each token
    uint256 public immutable capA;
    uint256 public immutable capB;

    uint16 public constant MAX_SLIPPAGE_BPS = 1000;
    uint64 public constant MAX_TERM = 90 days;
    uint256 private constant Q96 = 1 << 96;

    // how far back the reference price is averaged, in seconds. A window is what makes a
    // single manipulation move the floor by a fraction of it rather than all of it.
    uint32 public constant TWAP_WINDOW = 1800;

    uint256 public hireCount;
    mapping(uint256 => Hire) private _hires;
    mapping(address => uint256[]) private _byBuyer;
    mapping(address => uint256[]) private _byAgent;
    uint256 private _lock = 1;

    event Opened(
        uint256 indexed id,
        address indexed buyer,
        address indexed agent,
        address token,
        uint256 amount,
        uint64 expiry,
        uint16 maxSlippageBps
    );
    event Traded(
        uint256 indexed id, address indexed agent, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut
    );
    event Closed(uint256 indexed id, address indexed buyer, uint256 amountA, uint256 amountB);

    error NotAContract();
    error UnknownToken();
    error BadAmount();
    error BadExpiry();
    error BadSlippage();
    error NoAgent();
    error NotOpen();
    error NotTheAgent();
    error NotTheBuyer();
    error Expired();
    error NoPool();
    error BelowFloor();
    error TokenCallFailed();
    error Reentered();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentered();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address router_, address factory_, address tokenA_, address tokenB_, uint256 capA_, uint256 capB_) {
        if (
            router_.code.length == 0 || factory_.code.length == 0 || tokenA_.code.length == 0
                || tokenB_.code.length == 0
        ) revert NotAContract();
        if (tokenA_ == tokenB_) revert UnknownToken();
        if (capA_ == 0 || capB_ == 0) revert BadAmount();
        router = router_;
        factory = factory_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        capA = capA_;
        capB = capB_;
    }

    // the buyer approves exactly this amount beforehand, never more
    function open(address agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint24 fee)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (agent == address(0)) revert NoAgent();
        bool isA = token == tokenA;
        if (!isA && token != tokenB) revert UnknownToken();
        if (amount == 0 || amount > (isA ? capA : capB)) revert BadAmount();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_TERM) revert BadExpiry();
        if (maxSlippageBps > MAX_SLIPPAGE_BPS) revert BadSlippage();

        // the price is read here, while the agent has no power over this hire, and it is
        // averaged over a window so that a price pushed just before this lands moves it
        // only a little. The fee tier is bound here for the same reason.
        address other = isA ? tokenB : tokenA;
        address pool = IV3Factory(factory).getPool(token, other, fee);
        if (pool == address(0)) revert NoPool();
        uint160 refPriceX96 = _twapPriceX96(pool);

        uint256 before = _held(token);
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount));
        // a token that keeps a cut on transfer would leave the books ahead of the balance
        if (_held(token) - before != amount) revert BadAmount();

        id = ++hireCount;
        _hires[id] = Hire({
            buyer: msg.sender,
            agent: agent,
            expiry: expiry,
            maxSlippageBps: maxSlippageBps,
            open: true,
            balanceA: isA ? amount : 0,
            balanceB: isA ? 0 : amount,
            refPriceX96: refPriceX96,
            fee: fee
        });
        _byBuyer[msg.sender].push(id);
        _byAgent[agent].push(id);
        emit Opened(id, msg.sender, agent, token, amount, expiry, maxSlippageBps);
    }

    // the one thing an agent can do: swap part of a deposit for the other token, which stays here
    // minOut may raise the floor the buyer's slippage limit sets, never lower it
    //
    // fee is not a parameter and the pool is not looked up: both were bound at open, and a
    // caller supplied fee could have pointed the trade at a thin pool of its choosing. The
    // floor reads h.refPriceX96 rather than the pool, so no price the agent can move
    // changes what it is measured against.
    function trade(uint256 id, address tokenIn, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        Hire storage h = _hires[id];
        if (!h.open) revert NotOpen();
        if (msg.sender != h.agent) revert NotTheAgent();
        if (block.timestamp >= h.expiry) revert Expired();
        bool aIn = tokenIn == tokenA;
        if (!aIn && tokenIn != tokenB) revert UnknownToken();
        if (amountIn == 0 || amountIn > (aIn ? h.balanceA : h.balanceB)) revert BadAmount();
        address tokenOut = aIn ? tokenB : tokenA;
        uint24 fee = h.fee;

        uint256 floor = (quoteAtRef(address(IV3Factory(factory).getPool(tokenIn, tokenOut, fee)), tokenIn, amountIn, h.refPriceX96) * (10_000 - h.maxSlippageBps)) / 10_000;
        if (minOut > floor) floor = minOut;
        if (floor == 0) revert BelowFloor();

        uint256 inBefore = _held(tokenIn);
        uint256 outBefore = _held(tokenOut);
        _call(tokenIn, abi.encodeWithSignature("approve(address,uint256)", router, amountIn));
        ISwapRouterV3(router).exactInputSingle(
            ISwapRouterV3.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: floor,
                sqrtPriceLimitX96: 0
            })
        );
        _call(tokenIn, abi.encodeWithSignature("approve(address,uint256)", router, 0));

        // the books follow what actually moved, not what the router reported
        if (inBefore - _held(tokenIn) != amountIn) revert BadAmount();
        amountOut = _held(tokenOut) - outBefore;
        if (amountOut < floor) revert BelowFloor();

        if (aIn) {
            h.balanceA -= amountIn;
            h.balanceB += amountOut;
        } else {
            h.balanceB -= amountIn;
            h.balanceA += amountOut;
        }
        emit Traded(id, msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // the revoke: everything held for this hire goes back to the buyer, expired or not
    function withdraw(uint256 id) external nonReentrant {
        Hire storage h = _hires[id];
        if (!h.open) revert NotOpen();
        if (msg.sender != h.buyer) revert NotTheBuyer();
        uint256 a = h.balanceA;
        uint256 b = h.balanceB;
        h.open = false;
        h.balanceA = 0;
        h.balanceB = 0;
        if (a > 0) _call(tokenA, abi.encodeWithSignature("transfer(address,uint256)", msg.sender, a));
        if (b > 0) _call(tokenB, abi.encodeWithSignature("transfer(address,uint256)", msg.sender, b));
        emit Closed(id, msg.sender, a, b);
    }

    function hire(uint256 id) external view returns (Hire memory) {
        return _hires[id];
    }

    function hiresOf(address buyer) external view returns (uint256[] memory) {
        return _byBuyer[buyer];
    }

    function hiresFor(address agent) external view returns (uint256[] memory) {
        return _byAgent[agent];
    }

    // what amountIn is worth in the other token at a price the caller supplies, before fees
    function quoteAtRef(address pool, address tokenIn, uint256 amountIn, uint256 refPriceX96)
        public
        view
        returns (uint256)
    {
        if (refPriceX96 == 0) revert NoPool();
        return IV3Pool(pool).token0() == tokenIn
            ? _mulDiv(amountIn, refPriceX96, Q96)
            : _mulDiv(amountIn, Q96, refPriceX96);
    }

    // the time weighted price, as a Q96 token1 per token0 figure
    //
    // A spot read can be pushed in the transaction just before open, so the reference price
    // is averaged over TWAP_WINDOW instead. This is the pool's own accumulated history, not
    // an external feed, so it needs no oracle and no chain outside this one.
    //
    // observe answers with the cumulative tick at each timestamp asked for, so the
    // difference between now and TWAP_WINDOW ago is that many seconds of ticks. Dividing by
    // the window gives the average tick, and 1.0001^tick is the price.
    //
    // The average tick is negative on any pool priced below one, which is most of them: a
    // USDT/WBNB pool has token0 as USDT, so one WBNB is a fraction of a USDT and the tick
    // sits around -22800. Only a cumulative that has not advanced at all means a pool with
    // no liquidity across the window, and that is the one refusal here. A negative tick is
    // a price below one, which _priceX96 inverts rather than wrapping.
    function _twapPriceX96(address pool) internal view returns (uint160) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = TWAP_WINDOW;
        ago[1] = 0;
        (int56[] memory ticks,) = IV3Pool(pool).observe(ago);
        // ticks[0] is the older cumulative, so the difference runs forwards
        int256 delta = int256(ticks[1]) - int256(ticks[0]);
        if (delta == 0) revert NoPool();
        int256 averageTick = delta / int256(uint256(TWAP_WINDOW));
        return uint160(_priceX96(averageTick));
    }

    // 1.0001^tick as a Q96 figure, by squaring. A negative tick inverts rather than
    // wrapping, which is what the subtraction above implies for a falling price.
    function _priceX96(int256 tick) private pure returns (uint256) {
        if (tick == 0) return Q96;
        bool falling = tick < 0;
        uint256 power = uint256(falling ? -tick : tick);
        // 1.0001^power scaled by 1e18, then converted to Q96
        uint256 base = 10001;
        uint256 result = 1e18;
        uint256 squared = base * 1e14;
        uint256 remaining = power;
        while (remaining > 0) {
            if (remaining & 1 == 1) result = (result * squared) / 1e18;
            squared = (squared * squared) / 1e18;
            remaining >>= 1;
        }
        uint256 priceX96 = _mulDiv(result, Q96, 1e18);
        if (!falling) return priceX96;
        // 1 / price, so a falling tick does not underflow to zero
        return priceX96 == 0 ? 0 : Q96 * Q96 / priceX96;
    }

    function _held(address token) private view returns (uint256 amount) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok || ret.length < 32) revert TokenCallFailed();
        amount = abi.decode(ret, (uint256));
    }

    // some tokens return nothing where the standard says a bool
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }

    // a * b / denominator with the full 512-bit product, after Remco Bloemen's mulDiv (MIT)
    function _mulDiv(uint256 a, uint256 b, uint256 denominator) private pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(denominator > 0);
                assembly {
                    result := div(prod0, denominator)
                }
                return result;
            }
            require(denominator > prod1);
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            result = prod0 * inverse;
            return result;
        }
    }
}
