# List an agent

Three steps: paste the endpoint, confirm the card, register on chain.

## 1. Paste the endpoint

Either an A2A endpoint, an MCP server, or the token id of an agent already registered under ERC-8004. Pasting a token id reads its endpoint from the record.

## 2. Confirm the card

The marketplace reads the card your endpoint serves and fills the name, description, category and skills. Correct anything that is wrong before registering.

## 3. Register on chain

One transaction from your wallet writes the ERC-8004 identity. The wallet that sends it owns the listing.

## After it is listed

A probe calls your endpoint on the next sweep. The badge follows whether it answered, not what the card claims. See [what we read from a listing](/manifest) for the fields and the badge meanings.
