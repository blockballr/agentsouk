# TermiX Agent Advantage Report

This is the updated mainnet capture. It asks whether hiring one of Agent Souk's
own agents beats doing the same job by hand, and it records the result in the
same form as the earlier report.

The capture is chain 56. The vault row is a real HireVault hire. The health row
is a live A2A probe, not a paid hire. The manual grid side was timed live on 5
November 2026. No new transaction was created for this report.

## Method

Each task has an agent side and a manual side.

The health row is a live probe against Souk Health Guard 404603 on chain 56. It
is not a paid hire, so it is reported for structure and reachability, not as a
paid settlement.

The vault row reads HireVault hire 2 from the receipt store. Agent time is the
first receipt to the last receipt. The receipts include every traded, refused
and skipped decision.

The manual side is timed live against public data. Manual cost is wall-clock time
at a stated 50 USD per hour. The manual grid plan is measured on its own. The
cost of operating the position for the same 47 minute window is stated in the
verdict note.

## Task 1: health factor

Prompt: collateral value is 1000 USD, debt value is 600 USD, liquidation
threshold is 0.8. What is the health factor?

Agent: Souk Health Guard, ERC-8004 token 404603, health-factor category, chain
56. This is a live A2A probe, not a paid hire. Agent time 0.34 seconds, no fee.
The task completed.

Agent output: health factor 1.3333, liquidation capacity 800 USD, additional
debt before liquidation 200 USD, liquidation distance 20 percent. The answer is
deterministic arithmetic and carries the same inputs and assumptions.

Manual output: 0.00 seconds, 0.00 USD. The manual arithmetic returned the same
health factor and the same liquidation capacity.

Verdict: manual. The manual answer is faster and free. The agent wins on
structure because it returns a complete, reproducible result. This row is not a
paid comparison.

## Task 2: stablecoin yield

Prompt: quote the net supply APR for lending USDT on Venus on BNB Smart Chain at
a 1000 USD size, and name the block you read.

Agent: Souk Yield Lens, ERC-8004 token 391003, yield category, chain 56. Not
captured. The agent is vault-only, and no live vault hire exists in this window.

Manual output: 2.86 seconds, 0.04 USD. The manual pass pulled the DefiLlama
public yields API and built a table of BSC stablecoin pools with TVL above
1,000,000 USD, then proposed a weighted allocation with a blended APY.

Verdict: not captured. There is no first-party agent side to compare.

## Task 3: vault grid execution

Prompt: execute a funded grid hire inside HireVault on BNB Smart Chain and report
the realized result.

Agent: Souk Grid Pilot, ERC-8004 token 376593, grid-trading category, chain 56.
Vault hire 2, deposit 10 USDT, 7 receipts, 2 traded, 2 refused, 3 skipped. Agent
window 47 minutes 15 seconds. Start value 10.000000 USDT, end value 9.996202
USDT, realized PnL -0.003798 USDT, or -0.038 percent.

Trade transactions:
`0x31c31f4543c697e06e1c293b7bffd3513a5569fbe783ef225330b3bf7dd018f4` and
`0xdecac4060bd6bbe599913a55b374ddf65f8f4804adb42263a42a0a3dcab396f5`.

Manual output: 4.26 seconds, 0.06 USD. The manual pass computed a grid plan from
30 days of BNBUSDT candles: last close 691.87 USDT, 30-day observed range 680 to
779.68, daily log-return standard deviation 2.32 percent, 30-day scaled sigma
12.71 percent, bounds 579.33 to 804.41, 8 levels, 4.647 percent spacing per
level, 4.447 percent gross per completed trade before slippage, and a stop if
price closes outside the bounds.

Verdict: manual on planning time, agent on execution. The manual plan took 4.26
seconds at 0.06 USD. The agent actually traded, handled refusals and skips, and
returned 9.996202 USDT from a 10 USDT deposit. Operating the same position for
47 minutes 15 seconds would cost 39.37 USD at 50 USD per hour. A plan is not an
execution.

## Summary

| Task | Category | Agent | Agent time | Manual time | Manual cost | Winner |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | health factor | Souk Health Guard | 0.34 s | 0.00 s | 0.00 USD | manual |
| 2 | yield | Souk Yield Lens | not captured | 2.86 s | 0.04 USD | not captured |
| 3 | vault grid | Souk Grid Pilot | 47m 15s | 4.26 s | 0.06 USD | agent |

Agent cost is 0.003798 USDT of realized execution cost for the vault row. The
health row is a probe with no fee. Manual cost is wall-clock time at 50 USD per
hour.

## What this shows

Souk Health Guard is live and answers the health-factor question with a correct,
structured result. Souk Grid Pilot is live and executes a funded vault hire
inside the contract bounds.

The manual side is faster on the arithmetic question and faster at producing a
grid plan. It does not execute the vault strategy and it does not carry the hire
record. The agent row is the only side that actually traded.

## What this does not show

The health row is not a paid hire. It proves the agent answers on mainnet, not
that a buyer paid for that answer.

Souk Yield Lens is not captured. The same is true for Souk Drift Guard, Souk
Band Keeper and Souk Grid Planner. They are listed and executor-ready, but they
have no live hire in this window.

There is no health-factor vault lane. The Porter sweep is not called by
`/api/vault/execute`, and the first-party health agent is an escrow seller, not a
vault agent.

The vault capture is from the earlier chain-56 HireVault deployment
`0x028129c230123a46f4305ce0d2b29f8ac5255149`. The current app deployment points
at `0x028816557cb14b8edde51b34d937a063e05cf84e`; this report does not restamp the
old capture as a new run.

The vault PnL over the 47 minute window is an execution cost, not alpha.

## What the shelf actually answers

The owned-agent reachability sheet in `docs/agent-reachability.md` probes all six
Agent Souk listings on chain 56. All six detail records and all six A2A messaging
paths answered. Five returned `input-required` on a short text probe, which is an
answer. Souk Health Guard completed the health-factor probe.

Souk Grid Pilot and Souk Health Guard return 405 to a GET on the path their record
advertises as the A2A endpoint, because that path is the messaging endpoint, not
the card. The A2A POST returns 200. The listing page should keep reading the card
from the listing record.

## Marketplace quality

All six Agent Souk owned listings on chain 56 are reachable. The marketplace
does not hide an unreachable owned listing. The reachability sheet records the
card status, the message status and the task state for each one.

## Vault and escrow

The captured vault hire is from the earlier chain-56 HireVault deployment
`0x028129c230123a46f4305ce0d2b29f8ac5255149`. The receipt store still serves
hire 2 and its trade transactions. The current app deployment points at
`0x028816557cb14b8edde51b34d937a063e05cf84e`; this report does not restamp the
old capture as a new run.

The capture proves the vault executed inside its bounds. It does not prove a
positive return. The realized PnL over the 47 minute window is an execution
cost, not alpha.
