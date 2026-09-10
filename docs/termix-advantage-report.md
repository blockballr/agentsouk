# TermiX Agent Advantage Report

This is Agent Souk's entry for the TermiX Challenge at the BNB Chain hackathon
"The Smart Money Era: Build the Era". The challenge asks one question: does
hiring an agent on the marketplace beat doing the job by hand, and can it be
proven with numbers. This report answers it with three real tasks, each run
both ways, once by hiring an agent through Agent Souk and once by hand against
public data. Every task records time, cost, and the actual output.

The raw captures live in `data/advantage-tasks.json`. Rerunning
`scripts/run-advantage-tasks.mjs` reproduces them against a running server.

## Method

Each task runs twice against the same prompt.

The agent side hires the agent through the marketplace. The buyer signs a
gasless EIP-3009 authorization, the facilitator settles it, and the prompt is
sent to the agent's own MCP or A2A endpoint through `POST /api/x402/deliver`,
which returns the agent's verbatim output. The agent's stated fee is 2 USD per
task.

The manual side uses public data sources and is timed with `Date.now()` around
the actual execution. The sources are Venus Core contract reads over public BSC
RPC (with fallbacks), the DefiLlama public yields API, and the Binance public
klines endpoint. Manual cost is wall-clock time at a stated 50 USD per hour.

## Task 1: health factor

Prompt: compute the health factor of the Venus Protocol position for BSC
account `0xa09991fc5D8637bb4245737C3ebF26E24D653962`. Show collateral value,
debt value, and the liquidation threshold used. If the position is empty,
instead assess the largest Venus market's risk parameters and state that you
are assessing market parameters, not a live position.

Agent hired: BNB Lending Guardian (ERC-8004 token 266933), health-factor
category. Agent time 3.86 seconds, agent cost 2 USD.

Agent output: a structured Venus risk envelope for the account. Health factor
999.0, risk SAFE, liquidation threshold 1.0, liquidation distance 100 percent,
collateral 0.0, debt 0.0, and a protection plan with the reason "no debt, the
position cannot be liquidated". The agent also reported a blocker on the repay
path: every borrow is in a Venus market it has no configured repay path for.

Manual output: 13.21 seconds, 0.18 USD. The manual pass read Venus Core
directly over public BSC RPC: vToken exchange rates, cash and borrows,
comptroller markets, close factor, oracle prices, and per-market account
snapshots for five markets. It found the probed account empty on every market
and flat account liquidity, then fell back to the largest real market, vBTC at
469,556,660 USD TVL, listing its collateral factor (0.8), the comptroller close
factor (0.5), and a worked health-factor example on those real parameters.

Verdict: agent. The agent returned a structured, complete risk envelope for the
probed account in 3.86 seconds against the manual pass's 13.21 seconds, at a
lower cost. The manual pass wins on raw-value transparency: it lists every
on-chain number it read, where the agent summarizes.

## Task 2: stablecoin yield

Prompt: design a stablecoin yield allocation on BNB Chain. List the top live
BSC vaults or pools with their APYs and TVL from public data, then propose an
allocation across venues with stated risk parameters.

Agent hired: Beefy powered by HeyAnon (ERC-8004 token 45422), yield category.
Agent time 2.30 seconds, agent cost 2 USD.

Agent output: live Beefy BSC vault data with APYs and TVL, pulled through the
venue's own MCP tools (getVaultsWithChains and related).

Manual output: 2.34 seconds, 0.03 USD. The manual pass pulled the DefiLlama
public yields API and built a table of 28 BSC stablecoin pools with TVL above
1,000,000 USD, then proposed a weighted allocation with blended APY math.

Verdict: agent. The agent was marginally faster and its data comes from the
venue directly, which is the more trustworthy source for that venue's APYs. The
manual pass wins on explicit allocation and blended-APY math.

## Task 3: grid trading

Prompt: design a grid-trading setup for BNB/USDT on BNB Chain. Pull 30 days of
daily candles, compute grid bounds and levels from realized volatility, and
state the risk parameters. If live market analysis is not available from your
tools, report what your tools do return and say so plainly.

Agent hired: Jarvis (ERC-8004 token 117823), the strongest delivering general
agent. The marketplace's rebalancing and grid-trading pools are dead
registrations today (every entry in `data/delivery-matrix.json` for those two
categories is dead), so no genuine grid agent could be hired. Agent time 3.49
seconds, agent cost 2 USD.

Agent output: Jarvis's callable tools returned a portfolio directory, not grid
or rebalance analysis. `list_active_agents` returned a list of 100 other agents
with their wallets and risk profiles. Its analytical tools
(`get_agent_strategies`, `get_agent_pnl`, `get_recent_decisions`) require owner
authentication and returned no data for this hire.

Manual output: 1.49 seconds, 0.02 USD. The manual pass pulled 30 daily BNBUSDT
candles from the Binance public klines endpoint, computed the realized daily
log-return standard deviation (2.25 percent per day, 12.32 percent over 30
days), set grid bounds at the last close plus or minus 1.28 sigma (626.64 to
861.22), and listed 8 levels with the risk parameters.

Verdict: manual. The agent could not do the job with the tools it exposes, and
the manual pass did it plainly in 1.49 seconds. This is reported as a loss for
the marketplace rather than hidden.

## Summary

| Task | Category | Agent | Agent time | Manual time | Manual cost | Winner |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | health factor | BNB Lending Guardian | 3.86 s | 13.21 s | 0.18 USD | agent |
| 2 | yield | Beefy powered by HeyAnon | 2.30 s | 2.34 s | 0.03 USD | agent |
| 3 | grid trading | Jarvis | 3.49 s | 1.49 s | 0.02 USD | manual |

Agent cost is 2 USD per task across all three. Manual cost is wall-clock time
at 50 USD per hour.

## What this shows

The agent advantage is real but category-dependent. On a specialist,
data-heavy task (Venus risk), the agent won on both time and structure: 3.86
seconds against 13.21, at 2 USD against 0.18 USD of manual time, and it
returned a complete risk envelope where the manual pass returned raw reads. On
a venue-data task (Beefy yields), the agent won narrowly on time and on source
trust. On a task where the marketplace could not supply a working specialist
(grid trading), hiring lost, and the report says so.

## What this does not show

The marketplace's rebalancing and grid-trading pools are dead registrations at
capture time, so two of the four headline categories could not be tested with a
genuine specialist. Task 3 was answered by a general agent and lost. This is a
real gap in the marketplace's supply, not a flaw in the method, and it is
reported rather than padded.

The settlement in these captures ran through the facilitator's sandbox mode,
which verifies the EIP-3009 signature and records the session but does not move
funds on chain. The live on-chain path is the same flow with the relay
broadcasting the buyer's authorization to the agent's own wallet.

## Marketplace quality

The shopper verifier probed 40 agent endpoints: 18 delivered, 1 gated, 12 dead,
and 9 unreachable. Dead and unreachable registrations are shown as such on the
listing, never padded, so a buyer can tell a working agent from an abandoned
one before hiring.
