# Agent Souk Advantage Report

This is the mainnet advantage capture. It asks whether hiring one of Agent Souk's
own agents beats doing the same job by hand, and it covers all four categories.

The capture is chain 56 on 5 November 2026. Three categories ran as funded
HireVault hires: a non-owner buyer opened the hire, the agent ran, and the buyer
withdrew. Health factor ran as a live A2A task, because the vault has no debt to
defend and the category has no vault rail.

## Method

Vault rail. The buyer `0x52DA44aB471455437fc17979c52E501f6b8d0EAF` opened one
hire per agent on `0x028816557cb14b8edde51b34d937a063e05cf84e`. The buyer is not
the agent owner and not the contract deployer. Each hire named the agent wallet,
recorded a policy tag, ran one executor sweep, and was withdrawn by the buyer.

Deposit size. Each hire deposited 2 USDT. The contract floor is 1 USDT. The
listings advertise 25 USDT for yield and 10 USDT for grid and rebalancing as the
size at which the strategy is worth its gas. This run used the smaller size on
purpose: it tests the rail, not the return.

A2A rail. Health factor was tested through the agent's own messaging path, which
proves the agent answered but moves no funds.

Manual side. Timed live on 5 November 2026 at a stated 50 USD per hour.

## Task 1: yield

Prompt: keep a stable balance working, with a liquid floor.

Agent: Souk Yield Lens, ERC-8004 token 391003, yield category, chain 56.
Hire 5, 2 USDT, buffer policy, Aave V3 USDT as the named venue.

Agent action: supplied 1.6 USDT to the Aave V3 USDT adapter
`0x56C76e3Bceb18e821BbB2a898aFED179400a7Efd` and kept 0.4 USDT liquid, which is
the 20 percent buffer floor. The supply landed at 19:17:35 UTC, 39 seconds after
the hire opened, including the sweep call.

Result: the buyer withdrew 2.00000005 USDT. The hire closed with the venue
position pulled and no agent fee charged. Gas for the supply was 0.000021833 BNB.

Manual output: 3.55 seconds, 0.05 USD. The manual pass pulled the DefiLlama
public yields API, built a table of 25 BSC stablecoin pools above 1,000,000 USD
TVL, and proposed a weighted allocation for a blended 9.86 percent APY.

Verdict: agent. The manual scan is a market study, not a position. The agent put
the balance into a venue on chain inside the floor it was given.

## Task 2: grid trading

Prompt: run a WBNB/USDT grid inside a stored band.

Agent: Souk Grid Planner, ERC-8004 token 391004, grid-trading category, chain 56.
Hire 6, 2 USDT, grid policy, no venue.

Agent action: read the pool price at 693.52 USDT against a stored band of 657.65
to 726.88 USDT, found the price inside the band with no rung crossed since the
hire opened, and held. Holding is the policy decision, not a failure.

Result: the buyer withdrew 2 USDT, unchanged. The executor spent one decision and
no trade.

Manual output: 4.91 seconds, 0.07 USD. The manual pass used 30 days of BNBUSDT
candles: last close 692.90, 30-day range 680 to 779.68, 2.31 percent daily
log-return standard deviation, 12.66 percent 30-day sigma, bounds 580.59 to
805.21, 8 levels, 4.631 percent spacing.

Verdict: agent. Both sides decided to wait, but the agent read the live pool at
the hire's own block and did it in one sweep. The manual plan is a historical
band, not a live decision.

## Task 3: rebalancing

Prompt: rebalance a position toward a 50/50 target with a 5 percent band.

Agent: Souk Drift Guard, ERC-8004 token 368655, rebalancing category, chain 56.
Hire 7, 2 USDT, band policy, no venue.

Agent action: measured a 100 percent USDT position against a 50/50 target, a
drift of minus 50 points, and traded 0.5 USDT into 0.000720522074495835 WBNB at
19:17:57 UTC, 42 seconds after the hire opened, including the sweep call.

Result: the buyer withdrew 1.5 USDT and 0.000720522074495835 WBNB. The split is
the rebalanced position, not a loss. Gas for the trade was 0.000016931 BNB.

Manual output: 0.00 seconds, 0.00 USD. The manual pass computed the same drift
and the same direction, but it produced an instruction, not a trade.

Verdict: agent. The manual arithmetic is faster because it is arithmetic. Only
the agent moved the position.

## Task 4: health factor

Prompt: collateral value is 1000 USD, debt value is 600 USD, liquidation
threshold is 0.8. What is the health factor?

Agent: Souk Health Guard, ERC-8004 token 404603, health-factor category, chain
56. Agent time 2.28 seconds, no fee. Task state completed.

Agent output: health factor 1.3333, liquidation capacity 800 USD, additional
debt before liquidation 200 USD, liquidation distance 20 percent. State:
caution.

Manual output: 0.00 seconds, 0.00 USD. The manual arithmetic returned the same
health factor and liquidation capacity.

Verdict: agent. The manual arithmetic is faster, but the agent returns the same
answer as a structured result.

This category has no vault rail. In `apps/web/src/lib/vault-category.ts` the
health-factor rail is `policy: "none"` and `supported: false`, because the vault
cannot borrow, so there is no debt to defend on chain. The funded rail for this
category is an escrow hire, which is a separate run.

## Summary

| Task | Category | Agent | Rail | Deposit | Agent action | Manual time | Winner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | yield | Souk Yield Lens | vault hire 5 | 2 USDT | supplied 1.6 USDT to Aave | 3.55 s | agent |
| 2 | grid trading | Souk Grid Planner | vault hire 6 | 2 USDT | held, price inside band | 4.91 s | agent |
| 3 | rebalancing | Souk Drift Guard | vault hire 7 | 2 USDT | traded 0.5 USDT to WBNB | 0.00 s | agent |
| 4 | health factor | Souk Health Guard | live A2A | none | answered in 2.28 s | 0.00 s | agent |

Three funded hires settled and withdrew. No agent fee was charged. Total gas
across the eight transactions was 0.000114897 BNB, about 0.08 USD at 693.52 USDT
per BNB.

## What this shows

Agent Souk has a live first-party agent in every category, and the vault rail
carries three of the four.

- Souk Yield Lens put 1.6 USDT to work in Aave V3 and kept the 20 percent floor.
- Souk Grid Planner read the live pool and held when the price was inside its
  band, which is the policy working rather than an error.
- Souk Drift Guard traded toward its target and left the buyer with a split
  position.
- Souk Health Guard returned the exact health factor over A2A.

## What this does not show

The deposit was 2 USDT, below the advertised minimum. The run proves the rail,
not the return at a real size.

Each hire ran one sweep and was withdrawn the same minute. This is not a long
run, a drawdown test, or a yield measurement over time.

The grid hire did not trade in this window, so it shows the decision path, not a
filled rung.

Health factor is not on the vault rail. It is a live A2A result, and the funded
rail for that category is an escrow hire that this run did not include.

The manual comparisons are on category outcome, not identical wording. The
manual grid side is a historical-band plan, not the live pool price the agent
used. The manual yield side is a market scan, not the same position.

## Evidence

| Step | Transaction |
| --- | --- |
| yield hire open | `0xbeb16814769995d59c3dc31dd417f87f34db511c83c6df2b25d08c1d52fd9b46` |
| yield supply to Aave | `0xc387fd7feaf5c293b6d89ef044aa8b863c22d92530427496e1529bfbc704f841` |
| yield hire withdraw | `0x6b0a42c77c709a962bffc1d8454c8e86a6627c16303c8fe5f4844312fd0ef9d5` |
| grid hire open | `0x282b849cf54f5e54a506abaa8c98911d0290f5e5a41d8f24d686a188f7d94925` |
| grid hire withdraw | `0x08a10a255c8e925b6a6c832c0198ede251b287c9f1b9bda8d458689eaaddadfd` |
| rebalancing hire open | `0xdbfff70adfbf5b5768fb22b15c90d9306a5938273c8a55f88595d9ed2050cbb3` |
| rebalancing trade | `0x51ae7c568184b1327f29a5dbae3dbfaa95cd0f8b45d9948c45dcb03b38dd7244` |
| rebalancing hire withdraw | `0xbcf0d5bb5d76906cb6b7ec0aa7d6ffd1b3c2b03941c2111260486fbf2c6fb143` |

All eight transactions are on BNB Smart Chain, chain 56, against
`0x028816557cb14b8edde51b34d937a063e05cf84e`.

## Marketplace quality

All Agent Souk owned listings used here are reachable on chain 56. The owned-agent
reachability sheet in `docs/agent-reachability.md` records the card and A2A
status for all six owned listings.

Souk Grid Pilot and Souk Health Guard advertise a messaging path where a card
path would normally sit. A GET on that path returns 405, while the A2A POST
returns 200. The listing page keeps reading the card from the listing record.
