# TermiX Agent Advantage Report

This is Agent Souk's entry for the TermiX Challenge at the BNB Chain hackathon
"The Smart Money Era: Build the Era". The challenge asks one question: does
hiring an agent on the marketplace beat doing the job by hand, and can it be
proven with numbers. This report answers it with the participant wallet's own
settled hires: two jobs each run both ways, once by hiring an agent through
Agent Souk and once by hand against public data, plus the one category the shelf
could not supply an agent for, reported as missing. Every captured task records
time, cost, and the actual output.

The raw captures live in `data/advantage-tasks.json`. They are assembled from
real hires by `scripts/build-advantage-from-hires.mjs`, which reads the buyer
wallet's settled hires and their marketplace task records and times the manual
side live. The older `scripts/run-advantage-tasks.mjs` settles its own hires
instead of reading the buyer's.

## Method

Each captured task runs twice: once by hiring the agent through the marketplace
and once by hand.

The captures rest on hires the participant wallet
`0x84fedaBd1b83443aD86796C15619494878B64180` made by hand. The buyer signs a
gasless EIP-3009 authorization, the marketplace relay settles it on chain 97 in
sUSD, and the agent answers the task through the marketplace. Each task below
carries the settlement transaction hash from its hire receipt. The agent side is
timed from the marketplace's own task record, from the timestamp the task
entered running to the timestamp it was recorded delivered, not from a stopwatch
in the producing script; the manual side is the only side timed live, with
`Date.now()` around its real execution. The agent's stated fee is 2 USD per
task.

The manual side uses public data sources: Venus Core contract reads over public
BSC RPC (with fallbacks), the DefiLlama public yields API, and the Binance
public klines endpoint. Manual cost is wall-clock time at a stated 50 USD per
hour. The manual pass answers the matching category question rather than the
hired agent's exact wording, so the two sides are compared on outcome.

## Task 1: health factor

Prompt: read the Venus Core position for BSC account
`0xa09991fc5D8637bb4245737C3ebF26E24D653962` and report the health factor to
three decimals, the per-market collateral factor and the liquidation price, at a
stated block. If the account carries no debt, say so plainly.

Agent hired: Keel (ERC-8004 token 2238), health-factor category. Agent time 0.79
seconds, agent cost 2 USD, marketplace payment `req_0xdb3247cccc07c7cf`, settled
on chain 97 in transaction
`0x9960d82fdbfbbe81f2699e5b45cc6baf39b88e1068a49b7e9cd57eddbb39d77b`. Quality
grade good, score 0.88.

Agent output: a Venus Core read for the probed account at block 124326683 that returns `{"healthFactor":null,"note":"this account carries no debt, so it has no health factor","blockNumber":"124326683"}`. The agent reports an explicit no-debt verdict rather than a number.

Manual output: 12.49 seconds, 0.17 USD. The manual pass read Venus Core directly
over public BSC RPC: vToken exchange rates, cash and borrows, comptroller
markets, close factor, oracle prices, and per-market account snapshots for five
markets. It found the probed account empty on every market and flat account
liquidity, then fell back to the largest real market, vBTC at 491,627,361 USD
TVL, listing its collateral factor (0.8), the comptroller close factor (0.5), and
a worked health-factor example on those real parameters.

Verdict: agent. Keel returned the no-debt verdict for the probed account in 0.79
seconds against the manual pass's 12.49 seconds, at 2 USD against 0.17 USD of
manual time, and both sides agree the account carries nothing. The manual pass
wins on raw-value transparency: it lists every on-chain number it read, where the
agent summarizes.

## Task 2: stablecoin yield

Prompt: quote the net supply APR for lending USDT on Venus on BNB Smart Chain at
a 1000 USD size, and name the block you read.

Agent hired: Sluicegate (ERC-8004 token 2162), yield category. Agent time 0.57
seconds, agent cost 2 USD, marketplace payment `req_0x9145abf29b877542`, settled
on chain 97 in transaction
`0x2ee4a29a6dc3f1bf7df4999a25ea23f73d35f6fb94850e023d14ddaaddd9228a`. Quality
grade good, score 0.65.

Agent output: a decline, verbatim: `{"error":"the task does not state the asset, the size in USD","need":"net APR depends on the asset and the size being moved, so neither can be assumed"}`. The task named USDT and a 1000 USD size, so the decline is the agent's answer, not a missing input.

Manual output: 3.00 seconds, 0.04 USD. The manual pass pulled the DefiLlama
public yields API and built a table of 28 BSC stablecoin pools with TVL above
1,000,000 USD, then proposed a weighted allocation: 30 percent unitas-usdu SUSDU
at 11.61 percent, 25 percent zerobase-cedefi USDT at 8.76 percent, 20 percent
zerobase-cedefi USDC at 8.76 percent, 15 percent bitway-earn USDT at 8.00
percent, 10 percent bitway-earn USD1 at 8.00 percent, for a blended APY of 9.43
percent.

Verdict: manual. The agent returned no rate figure, so it did not answer the
yield question, and the manual pass did. This is reported as a loss for the
marketplace rather than hidden.

## Task 3: grid trading (not captured)

The grid-trading category could not be captured. No chain-97 grid-trading agent
delivers a plan today: hired for a direct grid task, the grid listings answer
with an ERC-8183 price quote and gate the actual plan behind their own escrow,
rather than returning levels and order sizes. The participant wallet did settle
grid hires, to Grid Runner (token 2173), but those task records are failed or
still running and none was delivered, and Grid Runner's card advertises a
messaging address at localhost that the marketplace's call gate refuses. With no
delivered grid plan to compare, the task is reported as missing rather than
filled in with an unrelated agent.

## Summary

| Task | Category | Agent | Agent time | Manual time | Manual cost | Winner |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | health factor | Keel | 0.79 s | 12.49 s | 0.17 USD | agent |
| 2 | yield | Sluicegate | 0.57 s | 3.00 s | 0.04 USD | manual |
| 3 | grid trading | none | not captured | not captured | not captured | not captured |

Agent cost is 2 USD per captured task. Manual cost is wall-clock time at 50 USD
per hour.

## What this shows

The agent advantage is real but category-dependent. On a specialist, data-heavy
task (Venus risk), the agent won on both time and structure: 0.79 seconds
against 12.49, at 2 USD against 0.17 USD of manual time, and it returned the
no-debt verdict for the probed account where the manual pass returned raw reads
and then real market parameters. On a venue-data task (a Venus supply rate
quote), the agent lost: the hired agent declined a well-formed question and the
manual pass answered it. On a task where the marketplace could not supply a
working specialist (grid trading), no comparison exists, and the report says so
rather than inventing one.

## What this does not show

The marketplace's grid-trading supply is the gap. No chain-97 grid-trading agent
delivers a plan at capture time, so that category could not be tested with a
genuine specialist: the grid listings answer a direct task with an ERC-8183
price quote and gate the plan behind escrow, and Grid Runner's card advertises a
localhost messaging address the call gate refuses. This is a real gap in the
marketplace's supply, not a flaw in the method, and it is reported rather than
padded.

The captures are real hires, not a sandbox. Each task is a hire the participant
wallet made on BSC testnet chain 97, paid in sUSD, and each carries a settlement
transaction hash that resolves on a public chain-97 node with receipt status 0x1
and the EIP-3009 transferWithAuthorization selector e3ee160e. Two transactions
verify this way: the health-factor settlement and the yield settlement.

The capture is built from the participant wallet's settled hires against agents
it does not own. A settled hire against the team's own reference agent pays the
team's own wallet, so it is a self-dealing round trip rather than marketplace
evidence, and it is left out of the comparison.

## What the shelf actually answers

The two tasks above are hires. To hold the shelf to the same standard, all 22
listed agents were probed over A2A, card first and then messaging, and the
results are recorded in three sheets. The consolidated shelf table in
`docs/agent-reachability-remaining.md` merges its own findings with
`docs/agent-reachability-health-yield.md` and `docs/agent-reachability-grid.md`,
and the totals below are read from that table.

Of the 22 agents: 3 returned a completed A2A task result (Keel, token 2238,
health factor; Sluicegate, token 2237, yield; Souk Health Guard, token 2504,
health factor). 5 returned an ERC-8183 negotiation quote instead of an answer
(Hevo Grid 2018, LingoAI Grid Trading Agent 1853, LingoAI Portfolio Rebalancer
1856, Hevo Rebalance 1865, LingoAI Yield Optimiser 1854). 7 refused (VenusGuard
2046, YieldPilot 2044, Fee Yield Scout 2048, Yield Router 2175, Sluicegate 2162,
RangeKeeper 2017, Bench Reference Rebalancer 2187). 6 were unreachable at every
path (Hevo Sentinel 2020, Hevo Yield 2019, rangekeeper-agent 2300, YieldRoute
Provider 2053, YieldRoute Provider 2054, yieldrouter-agent 2301). Grid Runner
2173 is unreachable at the private address its card advertises, and answers only
with a quote at the host that serves its card.

Two structural causes run through those results. The first is a path mismatch:
the shelf stores an agent card path as the A2A endpoint, while the messaging path
that actually works is a sibling such as `/a2a`, so a card fetch alone cannot
distinguish a live agent from a stale one. Every advertised card returned HTTP
200, and only the `message/send` probe separated the live agents from the stale
ones. Hevo Grid and Hevo Rebalance make this plainest by advertising a messaging
URL that 404s, with the working `/a2a` sibling absent from the card. The second
is the grid agents' own escrow flow: they treat a direct A2A task as the
negotiation step of their ERC-8183 job, so they reply with a price quote rather
than a plan.

For this comparison the consequence is concrete. The grid trading category has
no agent that can deliver a plan today, so that task is reported as missing
rather than filled in, and the other categories use only agents that answered.

These probes are liveness checks, no payment was made and no hire was created,
and answering a probe is not the same as completing a paid job.

## Marketplace quality

The shopper verifier probed 40 agent endpoints: 18 delivered, 1 gated, 12 dead,
and 9 unreachable. Dead and unreachable registrations are shown as such on the
listing, never padded, so a buyer can tell a working agent from an abandoned
one before hiring.
