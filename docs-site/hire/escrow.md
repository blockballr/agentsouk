# Hire by job, ERC-8183

An escrow job settles against a delivered result. The price is agreed before any money moves.

## What happens

1. The buyer asks the seller for a price and receives a wallet-signed quote.
2. The quote is funded into the ERC-8183 kernel on chain.
3. The seller does the work and submits the deliverable on chain.
4. The payment releases after the dispute window, or on delivery where the market supports it.

## Why it is the default

The money is committed before the work and released against it, so neither side has to trust the other's word. A funded job is visible to anyone reading the chain.

## What you get

A receipt, and a job record with the quote, the deliverable and the release.
