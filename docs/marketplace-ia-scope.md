# Marketplace information architecture: buyers beside sellers

Written 2026-10-16, before anything is rebuilt. This is a scope, not a build:
what exists, what a buyer/seller split would mean here, what each surface owes
the other, and the order the work lands.

## What already exists

- One catalogue: the marketplace, compare, and the agent pages with their hire
  panels, check panel and reachability rows.
- The seller lane: the list wizard (endpoint prefilled from the served card),
  the profile and stall pages, the seller board, checks reporting per listing.
- The buyer lanes: x402 calls, ERC-8183 jobs (quote, fund, notify, deliverable
  on chain), and the vault deposit lane (a bounded escrow hire naming the
  agent's wallet).
- One wallet identity: the connected address, with ownership already deciding
  delist and edit rights on a listing.

## The decision: one market, two surfaces

A single catalogue on a single wallet identity, with no seller mode: the same
agent page carries the hire offers and, for its owner, the manage strip, and
the role shows up as views over the connected address rather than as a side
the visitor picks first. Tooling beyond the basics layers onto that one
surface instead of splitting it.

Splitting would buy nothing and cost much: an agent's hire panel and its
listing are one page either way, two markets would halve the network between
them, and the wallet would have to declare a side before doing anything. What
is true here and worth designing around: our sellers are builders and our
buyers are not. The seller surface stays as deep as the wizard is today; the
buyer surface owes its visitors outcomes instead of protocol.

## The surfaces

1. Market: browse and the agent page, object-first. The hire offers read as
   outcomes (ask for a price, start a job, fund a managed run) with the
   protocol's numbers behind one details step. Both roles meet here.
2. Ongoing: the buyer's positions. Escrowed hires, jobs in flight, receipts
   and deliverables: the surface a connected buyer lands on.
3. Stall: the seller's dashboard. Their agents, check status, who hired them.
4. List: the builder's lane. The wizard, prefilled from the card; the depth
   belongs here and nowhere else.

No mode toggles. The wallet's context decides what any page offers: you own
the listing, you get its manage strip; you do not, you get hire offers only.

## What the buyer surface must not do

- Never hide the bounds. Escrow, floor, drawdown budget and withdraw-any-time
  are protections; they get plain language, not deletion.
- Never require protocol words to reach a price. Kernel, card, manifest, fee
  tier, slippage and expiry sit behind defaults and one details step.
- Never invent. Every figure on screen comes from the chain, the card, or a
  signed quote.
- Never cross roles. A listing you do not own shows you no seller controls,
  and the wizard never leaks into a hire panel.

## Build order

1. The wallet notice leaves the header: a transient popup where the click
   happened, gone on its own.
2. Buyer-side simplification, densest first: the vault deposit lane and the
   job stages on the agent page. Outcomes and bounds in the body, the
   protocol's numbers as defaults with one details step.
3. Navigation to the four surfaces: Market, Ongoing, Stall, List, with a
   connected wallet landing on Ongoing or Stall by context, never by switch.
4. Wallet-context strips on the agent page: manage for owners, offers for
   everyone else.
5. Later, and only if earned: bulk actions and pro tooling, layered behind
   affordances.

## Review gate

No money moves inside this scope, so the gates that bind it are the ones
already set: the strategy layer's mainnet gate (vault audit closed, the
chain-97 send rehearsal across both markets, kill switch proven live) and the
listing rule of one agent, one registration. The buyer copy may describe only
what the code does today; a surface that promises the job-to-vault bridge
before it exists is refused like any other claim.
