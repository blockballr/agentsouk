# Strategy layer scope, for the grid agent

Written 2026-10-14, before the layer is built. This is a scope, not a build: what
the layer decides, what already exists, what it may never claim, and the gate it
has to pass before real money moves through it.

## What already exists

- The planner. `src/lib/reference-grid.ts` and `-live.ts` turn a caller's band,
  rungs and size into ladder geometry and the arithmetic capture of one round
  trip. One live input: the PancakeSwap price read at a single block.
- The custody. `contracts/src/HireVault.sol` holds a buyer's deposit and lets the
  named agent swap it through one router. The floor is measured against a price
  fixed at open (`refPriceX96`, a time weighted read, not a spot read), the
  drawdown budget against the deposit converted at that same price
  (`depositInToken0`), and mainnet is built with a 50% floor, 50 WBNB / 100,000
  USDT caps per deposit and a slippage bound set at open.
- The signing. `src/lib/vault-executor.ts` scopes an actor to the hires that name
  it, encodes `trade(id, tokenIn, amountIn, minOut)` and sends it, or rehearses
  the send without sending it.

## What the layer is

The decision between the plan and the send. Everything in the existing stack is
deterministic; the layer is the only part that chooses, so it is the only part
that can lose money. It answers four questions per open hire:

1. **When to trade.** A rung is crossed: the pool's price moves across one of the
   ladder's prices. Not on a timer, not on a prediction.
2. **How much.** The size the plan places at that rung, bounded by the vault's
   caps and the hire's remaining balance.
3. **When to re-center.** The price leaves the band. A static grid in a trend is
   a slow loss, so the plan is rebuilt around the new price and the position is
   traded back toward the new center. The vault still decides what is allowed:
   the floor, the drawdown budget and the slippage bound are checked on chain,
   not by the layer, so a re-center that would breach them is refused on chain
   rather than prevented in code.
4. **When to stop.** The hire's expiry, the floor, the drawdown budget, or a kill
   switch the operator throws. The buyer can withdraw at any time regardless.

## What it may never claim

The layer does not predict, and no copy anywhere may say it makes money. A grid
earns in a range and bleeds in a trend; the layer picks the band and the sizes,
the market picks the outcome. The site says what it computes. The rehearsal
proves mechanics, never a return.

## Shape

- A worker, not a request handler. Today every route answers a caller; a grid
  needs something that watches a price and acts without one. New failure mode:
  a stuck or hot-looping worker trading on its own. Mitigation: one decision per
  block at most, a lease per hire so two workers cannot act on one hire, an
  idempotent intent per (hire, rung), and the vault's on-chain refusal as the
  last line.
- State, kept on chain. What the layer needs per hire is already in the contract
  (balances, the reference price, the deposit in token0, expiry, open). Anything
  it keeps itself is a cache, and a cache that disagrees with the contract loses
  to the contract.
- Sized to the actor. The executor wallet holds gas only. Its worst case is
  trading an open hire inside the vault's bounds.

## The review gate

Nothing here touches mainnet before all four pass, and the audit sign-off that
the HireVault brief already gates on is the first of them:

1. The outside review of the vault, closed with no open findings that touch the
   trading path.
2. A rehearsal on chain 97 across two markets, not one: a ranging price that
   should capture the spread and a trending price that should not eat the floor.
   Both end with the buyer taking the hire back, and both report what the layer
   did and what the contract refused.
3. A kill switch proven live: throw it mid-hire and the next decision is a no-op.
4. A dry-run mode where the layer decides everything and sends nothing, reporting
   the intents it would have sent. The executor already has this shape.

## Phasing

1. Build the loop dry-run only (decide, log, send nothing) and run it against
   chain 97 with a live price.
2. Turn on the send on 97 and rehearse both markets.
3. Only then mainnet, and only with the audit closed.
