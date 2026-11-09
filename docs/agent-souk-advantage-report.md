# Agent Souk Advantage Report

This is the mainnet advantage capture. It asks whether hiring one of Agent Souk's
own agents beats doing the same job by hand, and it covers all four categories.

The capture is chain 56. Three categories ran as funded HireVault hires: yield
and rebalancing on 5 November 2026, and grid on 9 November when its rung filled.
A non-owner buyer opened each hire, the agent ran, and the buyer withdrew.
Health factor has no vault rail, so it ran as a funded buyer mandate on 7 and 8
November: the buyer wrote the authority, the watcher repaid Venus debt, and the
prepaid watch drew its first daily fee.

## Method

Vault rail. The buyer `0x52DA44aB471455437fc17979c52E501f6b8d0EAF` opened one
hire per agent on `0x028816557cb14b8edde51b34d937a063e05cf84e`. The buyer is not
the agent owner and not the contract deployer. Each hire named the agent wallet,
recorded a policy tag, ran one executor sweep, and was withdrawn by the buyer.

Deposit size. Each hire deposited 2 USDT. The contract floor is 1 USDT. The
listings advertise 25 USDT for yield and 10 USDT for grid and rebalancing as the
size at which the strategy is worth its gas. This run used the smaller size on
purpose: it tests the rail, not the return.

Health rail. The vault cannot borrow, so health factor uses the mandate operator
at `0xb63cd6dbe6a48761190f4d3a819b0485c43221d6`. The buyer keeps the position
in their own wallet, writes the agent, trigger, target and caps, and prepays
`0.01 USDT` per day to `0x14ca53f7b4edfc9b0f49d6fe25532339c7ec5877`. The agent
can only repay, within the caps, and the buyer can revoke at any time. The A2A
read remains the liveness check: it proves the agent answers, not that it moves
funds.

Manual side. Vault tasks were timed live on 5 November 2026 at a stated 50 USD
per hour.

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

Prompt: run a WBNB/USDT grid inside a stored band, and trade when a rung is
crossed.

Agent: Souk Grid Planner, ERC-8004 token 391004, grid-trading category, chain 56.
Hire 13, 2 USDT, grid policy, no venue, eleven rungs.

Agent action: the executor read the pool every ten minutes. When price crossed a
rung it sold 0.0000219 WBNB for USDT, leaving 1.8496 USDT and 0.0002193 WBNB in
the hire. The buyer withdrew both.

Result: trade
`0x8f3ac296003c920724306ff4343f51b0af26d700acbdb15ec21b1abf85d3f861`, one filled
rung. Open `0x5fd472c7f21487a555a0a8e943afc129cfaf25c689cdb66afc0d763eac5c0fb2`,
close `0x3b739c1b5ce79b30360ed52b11da7d0bc682677211bf18c3f16b1a261a98f792`.

Manual output: 4.91 seconds, 0.07 USD. The manual pass used 30 days of BNBUSDT
candles: last close 692.90, 30-day range 680 to 779.68, 2.31 percent daily
log-return standard deviation, 12.66 percent 30-day sigma, bounds 580.59 to
805.21, 8 levels, 4.631 percent spacing.

Verdict: agent. The agent waited 49 minutes for the market to reach the rung,
then traded inside the hire's bounds; the wait is market time, not compute. The
manual plan is a historical band, not a live fill.

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

Prompt: defend a Venus position under a buyer-written mandate, repaying when
coverage falls under 4.0 and recovering to 5.0, within 1 USDT per call and per
day.

Agent: Souk Health Guard, ERC-8004 token 404603, health-factor category, chain
56. Funded by the buyer's mandate, not a vault hire. Agent time is bounded by
one watch interval.

Agent action: coverage fell to 3.200. The watcher ranked the position, sized the
repay inside the per-call cap, simulated it, and repaid 0.1798 USDT on Venus.
Coverage recovered to 4.997 and the borrow fell from 0.5 to 0.3202 USDT. Repay
`0x4b6402947044a8f8c492303b6775cc93ac708d145fcdc6e19cb61156157109c3`.

The prepaid watch drew its first daily fee on 8 November: 0.011867 USDT for the
elapsed term,
`0x2a4b3234b6adb78ebef446981779ec1472603647704268e9f49e15f714db4646`, leaving a
0.03813 USDT balance. The buyer can withdraw the remainder at any time.

Manual output: no timed action. A person has to watch the health factor and send
the repay by hand; nobody did.

Verdict: agent. The manual reading is faster; only the mandate moved the
position, and it did so without being asked.

This category still has no vault rail. In `apps/web/src/lib/vault-category.ts`
the health-factor rail is `policy: "none"` and `supported: false`, because the
vault cannot borrow. The mandate operator is the funded rail for this category.

## Summary

| Task | Category | Agent | Rail | Deposit | Agent action | Manual time | Winner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | yield | Souk Yield Lens | vault hire 5 | 2 USDT | supplied 1.6 USDT to Aave | 3.55 s | agent |
| 2 | grid trading | Souk Grid Planner | vault hire 13 | 2 USDT | sold 0.0000219 WBNB at a rung | 4.91 s | agent |
| 3 | rebalancing | Souk Drift Guard | vault hire 7 | 2 USDT | traded 0.5 USDT to WBNB | 0.00 s | agent |
| 4 | health factor | Souk Health Guard | buyer mandate | none | repaid 0.1798 USDT on Venus | 0.00 s | agent |

Three vault hires settled and withdrew. No vault fee was charged. The health
mandate settled separately: one repay and one fee draw, both on chain.

## What this shows

Agent Souk has a live first-party agent in every category, and the vault rail
carries three of the four. Health factor is funded on its own rail.

- Souk Yield Lens put 1.6 USDT to work in Aave V3 and kept the 20 percent floor.
- Souk Grid Planner read the live pool, waited for a rung, and sold WBNB when
  price crossed it.
- Souk Drift Guard traded toward its target and left the buyer with a split
  position.
- Souk Health Guard repaid Venus debt under a buyer mandate and drew its first
  prepaid watch fee.

## What this does not show

The deposit was 2 USDT, below the advertised minimum. The run proves the rail,
not the return at a real size.

Each hire ran one sweep and was withdrawn the same minute. This is not a long
run, a drawdown test, or a yield measurement over time.

The grid trade was one rung on a 2 USDT hire, so it shows the fill path, not a
ladder returning a profit over time.

Health factor is not on the vault rail. The mandate is a separate contract; it
repays only, never borrows, and the buyer can revoke it. The 600 second bound is
the watch interval, not compute time.

The manual comparisons are on category outcome, not identical wording. The
manual grid side is a historical-band plan, not the live pool price the agent
used. The manual yield side is a market scan, not the same position.

## Evidence

| Step | Transaction |
| --- | --- |
| yield hire open | `0xbeb16814769995d59c3dc31dd417f87f34db511c83c6df2b25d08c1d52fd9b46` |
| yield supply to Aave | `0xc387fd7feaf5c293b6d89ef044aa8b863c22d92530427496e1529bfbc704f841` |
| yield hire withdraw | `0x6b0a42c77c709a962bffc1d8454c8e86a6627c16303c8fe5f4844312fd0ef9d5` |
| grid hire open | `0x5fd472c7f21487a555a0a8e943afc129cfaf25c689cdb66afc0d763eac5c0fb2` |
| grid rung fill | `0x8f3ac296003c920724306ff4343f51b0af26d700acbdb15ec21b1abf85d3f861` |
| grid hire withdraw | `0x3b739c1b5ce79b30360ed52b11da7d0bc682677211bf18c3f16b1a261a98f792` |
| rebalancing hire open | `0xdbfff70adfbf5b5768fb22b15c90d9306a5938273c8a55f88595d9ed2050cbb3` |
| rebalancing trade | `0x51ae7c568184b1327f29a5dbae3dbfaa95cd0f8b45d9948c45dcb03b38dd7244` |
| rebalancing hire withdraw | `0xbcf0d5bb5d76906cb6b7ec0aa7d6ffd1b3c2b03941c2111260486fbf2c6fb143` |
| health repay | `0x4b6402947044a8f8c492303b6775cc93ac708d145fcdc6e19cb61156157109c3` |
| health fee draw | `0x2a4b3234b6adb78ebef446981779ec1472603647704268e9f49e15f714db4646` |

The nine vault transactions are on BNB Smart Chain, chain 56, against
`0x028816557cb14b8edde51b34d937a063e05cf84e`. The health repay is against
`0xb63cd6dbe6a48761190f4d3a819b0485c43221d6`; the fee draw is against
`0x14ca53f7b4edfc9b0f49d6fe25532339c7ec5877`.

## Marketplace quality

All Agent Souk owned listings used here are reachable on chain 56. The owned-agent
reachability sheet in `docs/agent-reachability.md` records the card and A2A
status for all six owned listings.

Souk Grid Pilot and Souk Health Guard advertise a messaging path where a card
path would normally sit. A GET on that path returns 405, while the A2A POST
returns 200. The listing page keeps reading the card from the listing record.
