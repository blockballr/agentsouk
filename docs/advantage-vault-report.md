# Agent Souk Vault Advantage Report

This is the post-deadline advantage capture. It asks whether hiring an agent on
Agent Souk beats doing the job by hand, and it adds the first real vault-agent
comparison to the earlier x402 report.

The agent-side hires already exist. The manual side was re-run live on 5
November 2026. No new hire or transaction was created for this report. The raw
capture is `data/advantage-vault-tasks.json`, assembled by
`scripts/build-advantage-vault-tasks.mjs` from the delivered x402 hires in
`data/advantage-tasks.json` and the chain-56 vault receipts for hire 2.

## Method

Each task runs twice: once by hiring an agent through the marketplace and once
by hand.

The health-factor and yield rows reuse the delivered chain-97 x402 hires already
recorded in `data/advantage-tasks.json`. Their agent times come from the
marketplace task history, from running to delivered. The manual sides were timed
live with `Date.now()` around the same public-data implementations in
`scripts/advantage-manual.mjs`.

The vault row reads the real chain-56 HireVault hire 2 from the receipt store.
The agent window is the first receipt to the last receipt, not answer latency.
The vault PnL is the marked value of the deposit at the last trade, so it is an
execution result over that window, not a claim of strategy alpha.

Manual cost is wall-clock time at a stated 50 USD per hour.

## Task 1: health factor

Prompt: read the Venus Core position for BSC account
`0xa09991fc5D8637bb4245737C3ebF26E24D653962` and report the health factor, the
per-market collateral factor and the liquidation price at a stated block. If the
account carries no debt, say so plainly.

Agent hired: Keel, ERC-8004 token 2238, health-factor category, chain 97. Agent
time 0.79 seconds, agent cost 2 USD, marketplace payment
`req_0xdb3247cccc07c7cf`, settled in transaction
`0x9960d82fdbfbbe81f2699e5b45cc6baf39b88e1068a49b7e9cd57eddbb39d77b`.
Quality grade good, score 0.88.

Agent output: a Venus Core read at block 124326683 that returns
`{"healthFactor":null,"note":"this account carries no debt, so it has no health factor","blockNumber":"124326683"}`.
The agent reports an explicit no-debt verdict rather than inventing a number.

Manual output: 17.48 seconds, 0.24 USD. The manual pass read Venus Core directly
over public BSC RPC: vToken exchange rates, cash and borrows, comptroller
markets, close factor, oracle prices and account snapshots for five markets. It
found the probed account empty on every market and flat account liquidity, then
fell back to the largest real market, vBTC at 406,546,355 USD TVL, listing its
collateral factor of 0.8, the comptroller close factor of 0.5 and a worked
health-factor example on those real parameters.

Verdict: agent. Keel returned the no-debt verdict in 0.79 seconds against the
manual pass's 17.48 seconds, at 2 USD against 0.24 USD of manual time. Both sides
agree the account carries nothing. The manual pass wins on raw-value
transparency because it lists every on-chain number it read.

## Task 2: stablecoin yield

Prompt: quote the net supply APR for lending USDT on Venus on BNB Smart Chain at
a 1000 USD size, and name the block you read.

Agent hired: Sluicegate, ERC-8004 token 2162, yield category, chain 97. Agent
time 0.57 seconds, agent cost 2 USD, marketplace payment
`req_0x9145abf29b877542`, settled in transaction
`0x2ee4a29a6dc3f1bf7df4999a25ea23f73d35f6fb94850e023d14ddaaddd9228a`.
Quality grade good, score 0.65.

Agent output: a decline, verbatim:
`{"error":"the task does not state the asset, the size in USD","need":"net APR depends on the asset and the size being moved, so neither can be assumed"}`.
The task named USDT and a 1000 USD size, so the decline is the agent's answer,
not a missing input.

Manual output: 3.11 seconds, 0.04 USD. The manual pass pulled the DefiLlama
public yields API and built a table of 25 BSC stablecoin pools with TVL above
1,000,000 USD, then proposed a weighted allocation: 30 percent unitas-usdu SUSDU
at 11.62 percent, 25 percent lista-lending SATUSDT at 10.04 percent, 20 percent
zerobase-cedefi USDT at 8.76 percent, 15 percent zerobase-cedefi USDC at 8.76
percent, 10 percent aegis-yusd YUSD at 8.14 percent, for a blended APY of 9.88
percent.

Verdict: manual. The agent returned no rate figure, so it did not answer the
yield question and the manual pass did. This is reported as a loss for the
marketplace rather than hidden.

## Task 3: vault grid execution

This is the vault-agent row. The agent does not answer a prompt. It executes a
funded hire inside the contract's bounds.

Agent: Souk Grid Pilot, ERC-8004 token 376593, grid-trading category, chain 56.
Vault: `0x028129c230123a46f4305ce0d2b29f8ac5255149`, hire 2. Deposit 10 USDT.
Receipts: 7 total, 2 traded, 2 refused, 3 skipped. Agent window 47 minutes 15
seconds, from the first receipt at 21:19:18 to the last at 22:06:33 on 26
October 2026.

Agent output: start value 10.000000 USDT, end value 9.996202 USDT, realized PnL
-0.003798 USDT, or -0.038 percent. The trade transactions are
`0x31c31f4543c697e06e1c293b7bffd3513a5569fbe783ef225330b3bf7dd018f4` and
`0xdecac4060bd6bbe599913a55b374ddf65f8f4804adb42263a42a0a3dcab396f5`.

Manual output: 4.27 seconds, 0.06 USD. The manual pass computed a grid plan from
30 days of BNBUSDT candles: last close 691.87 USDT, 30-day observed range 680 to
779.68, daily log-return standard deviation 2.32 percent, 30-day scaled sigma
12.71 percent, bounds 579.33 to 804.41, 8 levels, 4.647 percent spacing per
level, 4.447 percent gross per completed trade before slippage, and a stop if
price closes outside the bounds.

Verdict: manual on time and cost, vault on execution. The manual pass produced a
plan in 4.27 seconds at 0.06 USD. The vault actually traded inside a real hire
and returned 9.996202 USDT from a 10 USDT deposit, a realized execution cost of
0.003798 USDT. A plan is not an execution, and the vault is the only side here
that did the work.

## Summary

| Task | Category | Agent | Agent time | Manual time | Manual cost | Winner |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | health factor | Keel | 0.79 s | 17.48 s | 0.24 USD | agent |
| 2 | yield | Sluicegate | 0.57 s | 3.11 s | 0.04 USD | manual |
| 3 | vault grid | Souk Grid Pilot | 47m 15s | 4.27 s | 0.06 USD | manual on time, vault on execution |

Agent cost is 2 USD per x402 task. The vault row is a 10 USDT deposit with a
realized execution cost of 0.003798 USDT. Manual cost is wall-clock time at 50
USD per hour.

## What this shows

The advantage is category-dependent and rail-dependent.

The health-factor agent won on speed and gave the exact verdict for the probed
account. The yield agent lost because it declined a well-formed question while
the manual pass answered it. The vault agent is the only side that actually
executed a strategy: it traded twice, refused two intents, skipped three and
returned 9.996202 USDT from a 10 USDT deposit. The manual grid pass was much
faster and cheaper, but it produced a plan, not a trade.

## What this does not show

The vault row is first-party team verification activity, not third-party
marketplace evidence. It is the same wallet family that runs the agents, so it
proves execution and guardrails, not outside demand.

Only one vault agent has a real capture. Souk Yield Lens, Souk Drift Guard, Souk
Band Keeper and Souk Grid Planner have no live hire in this window. The yield
vault row is therefore not captured.

There is no health-factor vault lane. The Porter sweep is not called by
`/api/vault/execute`, and the first-party health agent is an escrow seller, not a
vault agent. The health-factor vault task is not captured.

No third-party grid agent has a delivered paid hire in the current marketplace.
Chain-97 grid agents quote an ERC-8183 job rather than deliver a plan, so the
third-party grid comparison is not captured.

The x402 agent captures are from 27 September 2026. The manual sides are fresh,
but the agent sides are not. This report is a retrospective with a live manual
rerun, not a fresh x402 hire run.

## Marketplace quality

Keel is a delivered third-party health-factor agent and carries the health row.
Sluicegate is a delivered third-party yield agent and carries the yield row, but
it declined the task. No third-party grid agent delivered a paid plan. The other
online agents in those categories are liveness checks, not delivered hires, so
they are not used for a verdict.

## Vault and escrow

The captured vault hire is from the earlier chain-56 HireVault deployment
`0x028129c230123a46f4305ce0d2b29f8ac5255149`. The receipt store still serves
hire 2 and its trade transactions. The current app deployment points at
`0x028816557cb14b8edde51b34d937a063e05cf84e`; this report does not restamp the
old capture as a new run.

The capture proves the vault executed inside its bounds. It does not prove a
positive return. The realized PnL over the 47 minute window is an execution
cost, not alpha.
