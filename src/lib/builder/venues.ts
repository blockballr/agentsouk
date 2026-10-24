// Verified on-chain addresses and ABIs for the compose generator.
// Injected into the SYSTEM prompt so the LLM uses real addresses instead of
// hallucinating them. Unlisted venues cause the LLM to return {"cannot": "..."}.

export const VENUES_REGISTRY = `KNOWN VENUES (verified addresses - use these exactly, never invent):

PancakeSwap V3 (BSC mainnet 56 / testnet 97):
  SwapRouter: 0x13f4EA83D0bd40E75C8222255bc855a974568Dd4 (both chains)
  PositionManager (NFPM): 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364 (testnet 97), 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364 (mainnet 56)
  Factory: 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865 (both chains)
  QuoterV2: 0xB048Bbc1Ee6b733FFfCF101C56A5e5e3C758BbB3 (testnet), 0xB048Bbc1Ee6b733FFfCF101C56A5e5e3C758BbB3 (mainnet)
  V3 Swap ABI: exactInputSingle, exactOutputSingle (NOT swapExactTokensForTokens - that is V2)
  V3 exactInputSingle params: { tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96 }
  Fee tiers: 100 (0.01%), 500 (0.05%), 2500 (0.25%), 10000 (1%)

Tokens:
  WBNB: 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c (mainnet 56), 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd (testnet 97)
  USDT: 0x55d398326f99059fF775485246999027B3197955 (mainnet 56), 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd (testnet 97)
  USDC: 0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d (mainnet 56)
  BUSD: 0xe9e7cea3dedca5984780bafc599bd69add087d56 (mainnet 56)
  CAKE: 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 (mainnet 56)

ERC-20 ABI (standard):
  approve(spender, amount), balanceOf(owner), transfer(to, amount), allowance(owner, spender)

viem wallet client: use privateKeyToAccount(key) for the account, never pass a raw string.
  const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY)
  const walletClient = createWalletClient({ account, chain, transport: viemHttp(rpcUrl) })
  address = account.address (NOT walletClient.getAddress())

Chain detection: rpcUrl.includes("testnet") ? bscTestnet : bsc
Always pass rpcUrl to viemHttp(rpcUrl). Never call viemHttp() without a URL.

Venus Protocol (BSC mainnet 56, health-factor / lending):
  Comptroller (core pool): 0xfD36E2c2a6789Db23113685031d7F16329158384
  Venus Lens: 0xe797804c5d4410777c70EF8769c4eB9C39BEF662
  vUSDT: 0xfD5840Cd36d94D7229439859C0112a4185BC0255
  vBNB: 0xA07c5b74C9B40447a954e1466938b865b6BBea36
  vBUSD: 0x95c78222B3D6e262426483D42CfA53685A67Ab9D
  vUSDC: 0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8
  Comptroller ABI: getAccountLiquidity(account) returns (error, liquidity, shortfall), marketsEntered(account) returns vToken[]
  VToken ABI: balanceOfUnderlying(account), borrowBalanceCurrent(account), exchangeRateCurrent(), underlying()
  Health factor = (collateral * liquidation threshold) / borrow value. Use getAccountLiquidity for liquidity/shortfall.

ERC-8004 Identity Registry (agent registration):
  mainnet (56): 0x8004a169fb4a3325136eb29fa0ceb6d2e539a432
  testnet (97): 0x8004a818bfb912233c491871b3d84c89a494bd9e

AgenticCommerce (job escrow):
  mainnet (56): 0xea4daa3100a767e86fded867729ae7446476eba6
  testnet (97): 0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de

BNB Chain MCP (bnbchain-mcp) provides verified on-chain tools for blocks, transactions,
contracts, tokens, NFTs, wallet, ERC-8004 agents, and Greenfield. Reference:
https://github.com/bnb-chain/bnbchain-mcp

Aave V3 (BSC mainnet 56, yield sleeve):
  Pool: 0x6807dc923806fE8Fd134338EABCA509979a7e0cB
  USDT: 0x55d398326f99059fF775485246999027B3197955
  aUSDT: 0xa9251ca9DE909CB71783723713B21E4233fbf1B1
  Rate: getReserveData(USDT).currentLiquidityRate is a ray, annual; about 3.07 percent APY on 2026-10-25
  Adapter: contracts/src/venues/AaveV3VenueAdapter.sol, fork-tested, not deployed

Venus Liquidity Hub USDT (ERC-4626):
  Hub: 0x18AfDACF30F8671021dec4b78297E39d2FE87226
  HubRegistry: 0x6D93Fd479f2d37445CFBe132412e316a0364acc2
  Share: vhUSDT. No APY view; aggregate the source spotAPYBps off chain.

Lista DAO and other unlisted venues are NOT in this registry.
If the user asks for a venue not listed here, return {"cannot": "venue X is not in the verified venue registry"}.
Do not invent addresses or ABIs for unlisted venues.
`;
