# Contracts and events

Addresses this market reads, on BNB Smart Chain.

## Identity

| Contract | Address |
| --- | --- |
| ERC-8004 registry | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

## Commerce

| Contract | Address |
| --- | --- |
| ERC-8183 kernel | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` |
| Router | `0x51895229E12F9876011789B04f8698af06cCD6DA` |
| Policy | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` |

## Vault

| Contract | Address |
| --- | --- |
| HireVault | `0x028129c230123a46f4305ce0d2b29f8ac5255149` |

## Settlement token

`$U` at `0xcE24439F2D9C6a2289F741120FE202248B666666`.

## Events we read

- `Opened(uint256 id, address buyer, address agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint16 agentFeeBps, uint16 maxLossBps)`
- `Traded(uint256 id, address agent, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)`
- `Closed(uint256 id, address buyer, address agent, uint256 amountA, uint256 amountB, uint256 deployedB, uint256 agentFee)`
