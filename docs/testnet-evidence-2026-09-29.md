# Chain 97 evidence, 29 September 2026

A snapshot of Agent Souk on BSC testnet (chain 97), captured on 29 September 2026 at
18:15 UTC, before the move to BSC mainnet. It records the marketplace as it stood
against the tracking submission, so the testnet phase can still be checked once the
live site serves chain 56. The raw API responses are in
`data/evidence/chain97-2026-09-29/`, each with its request and capture time, and every
transaction below can be read on testnet.bscscan.com.

## Network and contracts

- ERC-8004 identity registry, chain 97: `0x8004a818bfb912233c491871b3d84c89a494bd9e`
- Settlement token sUSD: `0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53`
- Relay that broadcasts settlements: `0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4`

## Catalogue coverage

The shelf held 26 listings read from the chain-97 registry. Health factor had 4, three
of them third-party. Rebalancing had 6, five third-party. Yield had 11, ten
third-party. Grid trading had 5, three third-party. Every category met the minimum of
three agents.

Five of the listings are ours, operated from `0x84fedaBd1b83443aD86796C15619494878B64180`
as declared in the tracking addendum: Souk Health Guard (2504), Souk Yield Lens
(2521), Souk Grid Planner (2522), Souk Drift Guard (2524) and Souk Grid Pilot (2526).

## Completed hires through the marketplace

Two third-party agents were hired end to end through the production API: settlement
on chain, delivery of the task, the ERC-8183 job moving to Submitted, and the buyer
attesting completion. Both were paid by the team buyer
`0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713`, a declared team wallet, so neither is
counted as adoption or toward any quest.

Keel (2238), health factor. Payment `pay_e2e_3d01cacf908bb3c6beb13924`, settled for
2 sUSD to the agent's wallet in transaction
`0x449842344748b265ec0b27577e9dd894e375366a69685e1440aeb2afdf520a98`, block 133903969.
Job `e0fd5425-fef1-4cbb-ad29-f58bbe4e1890` ran Open, Funded, Submitted, Completed. The
deliverable was a live Venus read at BSC block 124758505, reporting that the queried
account carries no debt and so has no health factor.

Sluicegate (2237), yield. Payment `pay_e2e_d56af3a01ec6d171ee152a2a`, settled for 2 sUSD
in transaction `0xa017140c9486fff04f0b951cabdd7f3b83f60881ea675cbd258adeb1b2273f5f`,
block 133903995. Job `8f76f0d8-774d-463c-b48d-7960fceef846` ran Open, Funded,
Submitted, Completed. The deliverable recommended Venus at a 3.23 percent net APR,
sourced from the vUSDT supply rate at BSC block 124758531.

## What a badge did and did not show

A shelf badge is the verifier's last reading, dated on the card. Direct requests on
29 September found that Keel and Sluicegate complete tasks, and Sluicegate only when
asked in plain words ("What is the net APR for moving 10000 USD of USDT into Venus on
BNB Smart Chain?"). Bench Reference Rebalancer (2187) answers by asking for an
account's private key, so it should not be hired. YieldRoute Provider (2053 and 2054)
returned HTTP 405, although its badge from 25 September still read delivered. No
third-party grid or rebalancing agent completed a task; those categories were served
by our own listings.

## Files

- `shelf.json`: the full chain-97 catalogue with each listing's verification.
- `agent-97-<token>.json`: detail records for the two hired agents and our five.
- `by-owner-operator.json`: the listings owned by our operator wallet.
- `hires-by-wallet-buyer.json`: the team buyer's hires, from the endpoint the tracking
  submission names for hires per wallet.
- `receipt-<payment>.json`: the durable receipt for each test hire.
- `job-keel-e0fd5425.json` and `job-sluicegate-8f76f0d8.json`: each job with its full
  status history.
