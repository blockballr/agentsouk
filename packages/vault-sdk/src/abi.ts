// the vault's own surface, as the contract declares it. a builder should never
// hand-copy these into their agent: a wrong output type decodes into a wrong
// number without reverting on chain.

export const HIRE_ABI = [
  {
    name: "hire",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "agent", type: "address" },
      { name: "expiry", type: "uint64" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "open", type: "bool" },
      { name: "balanceA", type: "uint256" },
      { name: "balanceB", type: "uint256" },
      { name: "refPriceX96", type: "uint160" },
      { name: "fee", type: "uint24" },
      { name: "depositInToken0", type: "uint256" },
      { name: "deployedB", type: "uint256" },
      { name: "agentFeeBps", type: "uint16" },
      { name: "highWaterMark", type: "uint256" },
      { name: "maxLossBps", type: "uint16" },
      { name: "venue", type: "address" },
    ],
  },
] as const;

export const VAULT_READ_ABI = [
  { name: "hiresFor", type: "function", stateMutability: "view", inputs: [{ name: "agent", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { name: "hiresOf", type: "function", stateMutability: "view", inputs: [{ name: "buyer", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { name: "tokenA", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "tokenB", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "router", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "factory", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "capA", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "capB", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "minRetainedBps", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { name: "minDepositInToken0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "MAX_OPEN_PER_BUYER", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

export const QUOTE_ABI = [
  {
    name: "quoteAtRef",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "pool", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "refPriceX96", type: "uint160" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const VAULT_WRITE_ABI = [
  {
    name: "open",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "fee", type: "uint24" },
      { name: "agentFeeBps", type: "uint16" },
      { name: "maxLossBps", type: "uint16" },
      { name: "venue", type: "address" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "trade",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minOut", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  {
    name: "closeIfGoal",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "goalValueInToken0", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "supplyToVenue",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "venue", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdrawFromVenue",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "venue", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
