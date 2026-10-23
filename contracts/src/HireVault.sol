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

    function observe(uint32[] calldata secondsAgo)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

interface IYieldVenue {
    function supply(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

contract HireVault {
    struct Hire {
        address buyer;
        address agent;
        uint64 expiry;
        uint16 maxSlippageBps;
        bool open;
        uint256 balanceA;
        uint256 balanceB;
        uint160 refPriceX96;
        uint24 fee;
        uint256 depositInToken0;
        // deployed to a yield venue (buffer): amount of tokenB in the venue
        uint256 deployedB;
        // agent performance fee in basis points (e.g. 1000 = 10% of profits)
        uint16 agentFeeBps;
        // highest value reached, in token0 units (high-water mark for fee)
        uint256 highWaterMark;
        // max loss in basis points (e.g. 2000 = 20% loss allowed before auto-close)
        uint16 maxLossBps;
        // the single yield venue this hire has used; zero means none
        address venue;
    }

    address public immutable router;
    address public immutable factory;
    address public immutable tokenA;
    address public immutable tokenB;
    uint256 public immutable capA;
    uint256 public immutable capB;

    uint16 public constant MAX_SLIPPAGE_BPS = 1000;
    uint64 public constant MAX_TERM = 90 days;
    uint256 private constant Q96 = 1 << 96;

    uint16 public immutable minRetainedBps;
    // the smallest deposit the vault will take, valued in token0 at the open
    // price. a dust hire cannot pay for its own round trip and rounds the
    // deposit used by the floor toward zero, so it is refused at the door.
    uint256 public immutable minDepositInToken0;
    uint256 private constant VALUE_SLACK = 1_000_000;
    uint32 public constant TWAP_WINDOW = 1800;

    uint16 public constant MAX_AGENT_FEE_BPS = 3000; // 30% max
    uint16 public constant MAX_LOSS_BPS = 5000; // 50% max loss
    // a live-hire queue is what a buyer can actually run, and what the agent's
    // sweep and the hire page read. a wallet holding more than this is a queue
    // nobody executes, so the contract refuses it rather than indexing it
    uint256 public constant MAX_OPEN_PER_BUYER = 16;

    uint256 public hireCount;
    mapping(uint256 => Hire) private _hires;
    mapping(address => uint256[]) private _byBuyer;
    mapping(address => uint256[]) private _byAgent;
    // live hires per buyer, so one wallet cannot hold an unbounded queue and
    // leave every sweep and every page paying for it
    mapping(address => uint256) private _openByBuyer;
    uint256 private _lock = 1;

    event Opened(uint256 indexed id, address indexed buyer, address indexed agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint16 agentFeeBps, uint16 maxLossBps);
    event Traded(uint256 indexed id, address indexed agent, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event Supplied(uint256 indexed id, address indexed venue, uint256 amount);
    event WithdrawnFromVenue(uint256 indexed id, address indexed venue, uint256 amount);
    event Closed(uint256 indexed id, address indexed buyer, address indexed agent, uint256 amountA, uint256 amountB, uint256 deployedB, uint256 agentFee);
    event MaxLossBreached(uint256 indexed id, uint256 value, uint256 floor);

    error NotAContract();
    error UnknownToken();
    error BadAmount();
    error BadExpiry();
    error BadSlippage();
    error BadRetained();
    error BadFee();
    error BadLoss();
    error NoAgent();
    error NotOpen();
    error NotTheAgent();
    error NotTheBuyer();
    error Expired();
    error NoPool();
    error BelowFloor();
    error BelowMinimum();
    error TokenCallFailed();
    error Reentered();
    error DrawdownBreached();
    error GoalNotMet();
    error BadVenue();
    error MaxLossBreachedErr();
    error TooManyOpenHires();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentered();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address router_, address factory_, address tokenA_, address tokenB_, uint256 capA_, uint256 capB_, uint16 minRetainedBps_, uint256 minDepositInToken0_) {
        if (router_.code.length == 0 || factory_.code.length == 0 || tokenA_.code.length == 0 || tokenB_.code.length == 0) revert NotAContract();
        if (tokenA_ == tokenB_) revert UnknownToken();
        if (capA_ == 0 || capB_ == 0) revert BadAmount();
        if (minRetainedBps_ == 0 || minRetainedBps_ > MAX_SLIPPAGE_BPS * 10) revert BadRetained();
        if (minDepositInToken0_ == 0) revert BadAmount();
        router = router_;
        factory = factory_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        capA = capA_;
        capB = capB_;
        minRetainedBps = minRetainedBps_;
        minDepositInToken0 = minDepositInToken0_;
    }

    function open(address agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint24 fee, uint16 agentFeeBps_, uint16 maxLossBps_, address venue_)
        external nonReentrant returns (uint256 id)
    {
        if (agent == address(0)) revert NoAgent();
        bool isA = token == tokenA;
        if (!isA && token != tokenB) revert UnknownToken();
        if (amount == 0 || amount > (isA ? capA : capB)) revert BadAmount();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_TERM) revert BadExpiry();
        if (maxSlippageBps > MAX_SLIPPAGE_BPS) revert BadSlippage();
        if (agentFeeBps_ > MAX_AGENT_FEE_BPS) revert BadFee();
        if (maxLossBps_ > MAX_LOSS_BPS) revert BadLoss();
        if (venue_ != address(0) && venue_.code.length == 0) revert BadVenue();
        if (_openByBuyer[msg.sender] >= MAX_OPEN_PER_BUYER) revert TooManyOpenHires();

        address other = isA ? tokenB : tokenA;
        address pool = IV3Factory(factory).getPool(token, other, fee);
        if (pool == address(0)) revert NoPool();
        uint160 refPriceX96 = _twapPriceX96(pool);

        // value the deposit before taking it, so a dust hire is refused without
        // moving the buyer's tokens and the guards always have a real floor
        uint256 depositInToken0 = _depositInToken0(IV3Pool(pool).token0() == token, amount, refPriceX96);
        if (depositInToken0 < minDepositInToken0) revert BelowMinimum();

        uint256 before = _held(token);
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount));
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
            fee: fee,
            depositInToken0: depositInToken0,
            deployedB: 0,
            agentFeeBps: agentFeeBps_,
            highWaterMark: depositInToken0,
            maxLossBps: maxLossBps_,
            venue: venue_
        });
        _byBuyer[msg.sender].push(id);
        _byAgent[agent].push(id);
        _openByBuyer[msg.sender] += 1;
        emit Opened(id, msg.sender, agent, token, amount, expiry, maxSlippageBps, agentFeeBps_, maxLossBps_);
    }

    function trade(uint256 id, address tokenIn, uint256 amountIn, uint256 minOut)
        external nonReentrant returns (uint256 amountOut)
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

        address pool = IV3Factory(factory).getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert NoPool();
        uint256 floor = (quoteAtRef(address(pool), tokenIn, amountIn, h.refPriceX96) * (10_000 - h.maxSlippageBps)) / 10_000;
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

        // check max loss after trade
        uint256 value0 = _valueInToken0(h, pool);
        uint256 maxLossFloor = _mulDiv(h.depositInToken0, 10_000 - h.maxLossBps, 10_000);
        if (value0 + VALUE_SLACK < maxLossFloor) {
            emit MaxLossBreached(id, value0, maxLossFloor);
            revert MaxLossBreachedErr();
        }
        // update high-water mark
        if (value0 > h.highWaterMark) {
            h.highWaterMark = value0;
        }

        _enforceBudget(h, pool);
        emit Traded(id, msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // supply tokenB to an external yield venue (Buffer). Moves funds from the
    // hire's liquid balanceB to the venue. The venue must implement supply(amount).
    function supplyToVenue(uint256 id, address venue, uint256 amount) external nonReentrant {
        if (venue == address(0)) revert BadVenue();
        Hire storage h = _hires[id];
        if (!h.open) revert NotOpen();
        if (msg.sender != h.agent) revert NotTheAgent();
        if (block.timestamp >= h.expiry) revert Expired();
        if (amount == 0 || amount > h.balanceB) revert BadAmount();
        // the buyer named the venue at open; the agent cannot point the hire
        // anywhere else, so a bad venue is the buyer's choice, not the agent's
        if (h.venue == address(0) || h.venue != venue) revert BadVenue();

        _call(tokenB, abi.encodeWithSignature("approve(address,uint256)", venue, amount));
        (bool ok,) = venue.call(abi.encodeWithSignature("supply(uint256,uint256)", id, amount));
        if (!ok) revert TokenCallFailed();
        _call(tokenB, abi.encodeWithSignature("approve(address,uint256)", venue, 0));

        h.balanceB -= amount;
        h.deployedB += amount;

        // check max loss after supply
        address pool = IV3Factory(factory).getPool(tokenA, tokenB, h.fee);
        if (pool != address(0)) {
            uint256 value0 = _valueInToken0(h, pool);
            uint256 maxLossFloor = _mulDiv(h.depositInToken0, 10_000 - h.maxLossBps, 10_000);
            if (value0 + VALUE_SLACK < maxLossFloor) {
                emit MaxLossBreached(id, value0, maxLossFloor);
                revert MaxLossBreachedErr();
            }
            if (value0 > h.highWaterMark) {
                h.highWaterMark = value0;
            }
        }

        emit Supplied(id, venue, amount);
    }

    // withdraw tokenB from an external yield venue back into the hire's balance
    function withdrawFromVenue(uint256 id, address venue, uint256 amount) external nonReentrant {
        if (venue == address(0)) revert BadVenue();
        Hire storage h = _hires[id];
        if (!h.open) revert NotOpen();
        if (msg.sender != h.agent) revert NotTheAgent();
        if (block.timestamp >= h.expiry) revert Expired();
        if (amount == 0 || amount > h.deployedB) revert BadAmount();
        if (h.venue != venue) revert BadVenue();

        uint256 heldBefore = _held(tokenB);
        (bool ok,) = venue.call(abi.encodeWithSignature("withdraw(uint256,uint256)", id, amount));
        if (!ok) revert TokenCallFailed();
        uint256 received = _held(tokenB) - heldBefore;
        if (received < amount) revert BadAmount();

        h.balanceB += received;
        h.deployedB -= amount;

        // check max loss after withdraw
        address pool = IV3Factory(factory).getPool(tokenA, tokenB, h.fee);
        if (pool != address(0)) {
            uint256 value0 = _valueInToken0(h, pool);
            uint256 maxLossFloor = _mulDiv(h.depositInToken0, 10_000 - h.maxLossBps, 10_000);
            if (value0 + VALUE_SLACK < maxLossFloor) {
                emit MaxLossBreached(id, value0, maxLossFloor);
                revert MaxLossBreachedErr();
            }
            if (value0 > h.highWaterMark) {
                h.highWaterMark = value0;
            }
        }

        emit WithdrawnFromVenue(id, venue, amount);
    }

    function _enforceBudget(Hire storage h, address pool) private view {
        uint256 value0 = _valueInToken0(h, pool);
        uint256 retained = _mulDiv(h.depositInToken0, minRetainedBps, 10_000);
        if (value0 + VALUE_SLACK < retained) revert DrawdownBreached();
    }

    function _valueInToken0(Hire storage h, address pool) private view returns (uint256) {
        bool aIsToken0 = IV3Pool(pool).token0() == tokenA;
        uint256 liquid0 = aIsToken0 ? _mulDiv(h.balanceB, Q96, uint256(h.refPriceX96)) : h.balanceB;
        uint256 deployed0 = aIsToken0 ? _mulDiv(h.deployedB, Q96, uint256(h.refPriceX96)) : h.deployedB;
        uint256 heldA = aIsToken0 ? h.balanceA : _mulDiv(h.balanceA, Q96, uint256(h.refPriceX96));
        return heldA + liquid0 + deployed0;
    }

    function _depositInToken0(bool isToken0, uint256 amount, uint160 ref) private pure returns (uint256) {
        return isToken0 ? amount : _mulDiv(amount, Q96, uint256(ref));
    }

    function _payAgentFee(Hire storage h, address pool) private returns (uint256 agentFeeTokenB) {
        if (h.agentFeeBps == 0) return 0;
        uint256 currentValue = _valueInToken0(h, pool);
        if (currentValue <= h.highWaterMark) return 0; // no new profit
        uint256 profit = currentValue - h.highWaterMark;
        uint256 feeToken0 = _mulDiv(profit, h.agentFeeBps, 10_000);
        // convert fee to tokenB
        bool aIsToken0 = IV3Pool(pool).token0() == tokenA;
        if (aIsToken0) {
            // token0 is A (WBNB), convert fee from token0 to tokenB (USDT)
            agentFeeTokenB = _mulDiv(feeToken0, uint256(h.refPriceX96), Q96);
        } else {
            // token0 is B (USDT), fee is already in tokenB
            agentFeeTokenB = feeToken0;
        }
        // cap at available balanceB
        if (agentFeeTokenB > h.balanceB) {
            agentFeeTokenB = h.balanceB;
        }
        if (agentFeeTokenB > 0) {
            h.balanceB -= agentFeeTokenB;
            _call(tokenB, abi.encodeWithSignature("transfer(address,uint256)", h.agent, agentFeeTokenB));
        }
        // update high-water mark
        h.highWaterMark = currentValue;
        return agentFeeTokenB;
    }

    // pull the whole venue position back before the hire closes, so accrued
    // interest is part of the payout instead of stranded in the adapter
    function _pullVenue(uint256 id, Hire storage h) private {
        if (h.deployedB == 0 || h.venue == address(0)) return;
        uint256 before = _held(tokenB);
        // max asks the venue for the whole position, so the interest this hire
        // earned comes back with the principal instead of staying behind
        (bool ok,) = h.venue.call(abi.encodeWithSignature("withdraw(uint256,uint256)", id, type(uint256).max));
        if (!ok) revert TokenCallFailed();
        uint256 received = _held(tokenB) - before;
        if (received < h.deployedB) revert BadAmount();
        h.balanceB += received;
        h.deployedB = 0;
    }

    function withdraw(uint256 id) external nonReentrant {
        Hire storage h = _hires[id];
        if (!h.open) revert NotOpen();
        if (msg.sender != h.buyer) revert NotTheBuyer();
        address pool = IV3Factory(factory).getPool(tokenA, tokenB, h.fee);
        if (pool == address(0)) revert NoPool();
        uint256 d = h.deployedB;
        _pullVenue(id, h);
        uint256 agentFee = _payAgentFee(h, pool);
        uint256 a = h.balanceA;
        uint256 b = h.balanceB;
        h.open = false;
        _openByBuyer[h.buyer] -= 1;
        h.balanceA = 0;
        h.balanceB = 0;
        if (a > 0) _call(tokenA, abi.encodeWithSignature("transfer(address,uint256)", msg.sender, a));
        if (b > 0) _call(tokenB, abi.encodeWithSignature("transfer(address,uint256)", msg.sender, b));
        emit Closed(id, msg.sender, h.agent, a, b, d, agentFee);
    }

    function valueInToken0(uint256 id) external view returns (uint256) {
        Hire storage h = _hires[id];
        if (!h.open) revert NotOpen();
        address pool = IV3Factory(factory).getPool(tokenA, tokenB, h.fee);
        if (pool == address(0)) revert NoPool();
        return _valueInToken0(h, pool);
    }

    function closeIfGoal(uint256 id, uint256 goalValueInToken0) external nonReentrant {
        Hire storage h = _hires[id];
        if (!h.open) revert NotOpen();
        if (msg.sender != h.buyer) revert NotTheBuyer();
        address pool = IV3Factory(factory).getPool(tokenA, tokenB, h.fee);
        if (pool == address(0)) revert NoPool();
        if (goalValueInToken0 == 0) revert GoalNotMet();
        uint256 d = h.deployedB;
        _pullVenue(id, h);
        uint256 value = _valueInToken0(h, pool);
        if (value < goalValueInToken0) revert GoalNotMet();
        uint256 agentFee = _payAgentFee(h, pool);
        uint256 a = h.balanceA;
        uint256 b = h.balanceB;
        h.open = false;
        _openByBuyer[h.buyer] -= 1;
        h.balanceA = 0;
        h.balanceB = 0;
        h.deployedB = 0;
        if (a > 0) _call(tokenA, abi.encodeWithSignature("transfer(address,uint256)", h.buyer, a));
        if (b > 0) _call(tokenB, abi.encodeWithSignature("transfer(address,uint256)", h.buyer, b));
        emit Closed(id, h.buyer, h.agent, a, b, d, agentFee);
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

    function quoteAtRef(address pool, address tokenIn, uint256 amountIn, uint160 refPriceX96)
        public view returns (uint256)
    {
        if (refPriceX96 == 0) revert NoPool();
        return IV3Pool(pool).token0() == tokenIn
            ? _mulDiv(amountIn, refPriceX96, Q96)
            : _mulDiv(amountIn, Q96, refPriceX96);
    }

    function _twapPriceX96(address pool) internal view returns (uint160) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = TWAP_WINDOW;
        ago[1] = 0;
        (int56[] memory ticks,) = IV3Pool(pool).observe(ago);
        int256 delta = int256(ticks[1]) - int256(ticks[0]);
        if (delta == 0) revert NoPool();
        int256 averageTick = delta / int256(uint256(TWAP_WINDOW));
        return uint160(_priceX96(averageTick));
    }

    function _priceX96(int256 tick) private pure returns (uint256) {
        if (tick == 0) return Q96;
        bool falling = tick < 0;
        uint256 power = uint256(falling ? -tick : tick);
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
        return priceX96 == 0 ? 0 : Q96 * Q96 / priceX96;
    }

    function _held(address token) private view returns (uint256 amount) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok || ret.length < 32) revert TokenCallFailed();
        amount = abi.decode(ret, (uint256));
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }

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
                assembly { result := div(prod0, denominator) }
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
