# Tracking submission: Set and Earn quests

Scope: This document covers the submission tracking materials for Phase 2 Set and Earn.
Agent Souk is currently Declared network is BSC testnet, chain 97 for this phase
(TARGET_CHAIN=97 in .env.local; targetChainId() in src/lib/types.ts falls
back to BSC mainnet chain 56 when unset). Settlement is in
sUSD, the EIP-3009 test token we deployed for the campaign and relay on chain
through our own facilitator. The mainnet cutover to $U happens towards the end of
the campaign, and that path is already proven on chain 56. Nothing below
presents mock, seeded, or stale data as live.

## 1. Contract addresses on the declared network

| Role | Address | Provenance |
|---|---|---|
| ERC-8004 registry (chain 56) | 0x8004a169fb4a3325136eb29fa0ceb6d2e539a432 | BSC_REGISTRY_ADDRESS in src/lib/types.ts |
| ERC-8004 registry contract observed on chain 97 | 0x8004a818bfb912233c491871b3d84c89a494bd9e | contract_address recorded for all 21 agents in data/agents-97.json (snapshotTime 2026-09-25T16:49:57.856Z) |
| Settlement asset, chain 97 | 0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53 | sUSD, the EIP-3009 test token we deployed for this campaign. Source in contracts/src/TestUSD.sol, deployment tx 0xf3480fa7dd441cffa93b8465256f0cda5ad46b26389092eeecbc1704f4bf8278, and it publishes eip712Domain() so the signing domain is read off the contract rather than assumed |
| Settlement asset, chain 56 | 0xcE24439F2D9C6a2289F741120FE202248B666666 | $U (United Stables). Used for the mainnet cutover after the campaign, already proven by a relayed settlement at 0x25bcb12557ec4d484e1a9962a17a16e2883f07bd623909fad95c6bd82bdda6f3. Checked on 2026-09-27: chain id 56, function selector 0xe3ee160e, receipt status 0x1 at block 121111387 on three independent BSC RPCs |
| Relay wallet, pays settlement gas | 0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4 | derived from RELAY_PRIVATE_KEY, which is never committed; address only is published here |
| Buyer wallet, signs settlement authorizations | 0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713 | derived from PROD_BUYER_KEY, which is never committed; address only is published here |
| Receipt contract | none deployed | receipts are StoredPayment records in the payment ledger (src/lib/x402.ts), persisted through src/lib/receipts-store.ts. A settled hire now carries a real chain 97 transaction hash; see the examples below |
| USDT | 0x55d398326f99059fF775485246999027B3197955 | BSC_TOKENS.USDT in src/lib/types.ts, displayed only, not accepted for settlement |

### Worked example of a settled hire on chain 97

A buyer signed an EIP-3009 authorization and our relay broadcast it. Value moved
on chain and the payee is the agent's own wallet from the registry.

| field | value |
|---|---|
| Settlement tx | 0x1214d9a4b6395598ecec1c74c298f177c7744a5aea4c267fae5e8ec6c196c9e8 |
| Token | sUSD 0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53 |
| Function | transferWithAuthorization (selector 0xe3ee160e) |
| Payer | 0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713 |
| Payee | 0xCC2abE29F43EAb530a6b5D93E3C41bc0E7622b47, the agent wallet from the registry record |
| Amount | 2 sUSD, 18 decimals |
| Gas used | 78,458 |
| Explorer | https://testnet.bscscan.com/tx/0x1214d9a4b6395598ecec1c74c298f177c7744a5aea4c267fae5e8ec6c196c9e8 |

Reproduce it with `node scripts/settle-e2e-testnet.mjs` against a funded relay
wallet. The same script prints the domain it read from the contract before it
signs, so the name, version, chain id and verifying contract are never assumed.

### A real settled hire whose authorizer is not a declared team wallet

On 2026-09-27 a hire settled against a live catalogue listing whose authorizer
is not one of the team wallets declared in section 5 and whose payee is the
agent's registered wallet. This is stronger settlement evidence than the worked
example and the proof suite, because those were authorized by the team's own
buyer while this one was not.

| field | value |
|---|---|
| paymentId | req_0x0d816af356686982 |
| Settlement tx | 0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6 |
| Block time | 2026-09-27T00:20:34Z (block 133381109) |
| Token | sUSD 0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53 |
| Function | transferWithAuthorization (selector 0xe3ee160e) |
| Payer | 0x84fedabd1b83443ad86796c15619494878b64180 |
| Payee | 0xb1b6fce10211cd11f177bfd232175cd94be90962, the registered wallet of agent token 2173 (Grid Runner) |
| Agent | Grid Runner, token 2173, category grid-trading |
| Amount | 2 sUSD, 18 decimals |
| Gas used | 66,218 |
| Explorer | https://testnet.bscscan.com/tx/0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6 |

Verification method, so a reader can repeat it. On 2026-09-27 this session
called eth_getTransactionByHash and eth_getTransactionReceipt on
https://bsc-testnet-rpc.publicnode.com with a User-Agent header (the endpoint
returns 403 without one). The receipt status is 0x1, the calldata selector is
e3ee160e, and the token Transfer log names the payer above as `from` and the
payee above as `to` with value 2000000000000000000. The marketplace's own
receipt endpoint answers with the same paymentId, txHash, payee and amount,
which ties the onchain settlement to the ledger record:

```
GET https://api.agentsouk.xyz/api/receipts/req_0x0d816af356686982
```

The payer appears in the durable hire ledger with this hire. It is not one of
the three team addresses in section 5, but as with any address we cannot prove
from public data whether it is controlled by the team or by a third party, and
we do not claim either.

The marketplace homepage publishes this hire as its settlement proof, rather
than the worked example. apps/web/src/pages/HomePage.tsx cites the same
transaction, 0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6,
and the same payer, 0x84fedabd1b83443ad86796c15619494878b64180, and describes
the authorizer as a buyer wallet that is not one of the team's own. The payee is
unchanged: the marketplace receipt for paymentId req_0x0d816af356686982 reports
the same txHash and the agent wallet above, re-read on 2026-09-27.

### A completed job produced through the marketplace's own flow

On 2026-09-27 the buyer wallet 0x84fedaBd1b83443aD86796C15619494878B64180
completed a job through the marketplace's own hire, deliver and complete flow.
It is the only job with status Completed in `GET /api/jobs?limit=100` filtered
to that client, which returned 57 jobs, 10 of them on this wallet: one Completed
and nine still Funded.

| field | value |
|---|---|
| Job id | ab91e68f-ac01-4c5f-940c-6717b9c8acf4 |
| Client | 0x84fedaBd1b83443aD86796C15619494878B64180 |
| Agent | Keel, token 2238, category health-factor |
| Task id | 20acf41a-591a-479e-9229-c9804af74d25 |
| Payment | req_0xdb3247cccc07c7cf |
| Settlement tx | 0x9960d82fdbfbbe81f2699e5b45cc6baf39b88e1068a49b7e9cd57eddbb39d77b |
| Job history | Open, Funded (x402 settlement), Submitted (deliverable recorded), Completed (complete) |

The task's result, verbatim from `GET /api/tasks?limit=50`, is:

    {"healthFactor":null,"note":"this account carries no debt, so it has no health factor","blockNumber":"124326683"}

The same value is the job's deliverable, so the delivery recorded on the task is
the delivery the job carries. `GET /api/receipts/req_0xdb3247cccc07c7cf` answers
with mode "prod", the agent Keel token 2238, payTo
0xdF1074a272C53A1a10b96Fa0201Eb58bbbaaFe00, amount 2000000000000000000, symbol
sUSD, the client wallet above, and the same txHash.

The settlement was checked on chain 97 on 2026-09-27.
`eth_getTransactionReceipt` for 0x9960d82f... returns status 0x1 at block
0x7f4978e; `eth_getTransactionByHash` returns input selector 0xe3ee160e; and the
token Transfer log names 0x84fedabd1b83443ad86796c15619494878b64180 as `from`
and Keel's registered wallet 0xdf1074a272c53a1a10b96fa0201eb58bbbaafe00 as `to`,
with value 2000000000000000000. The payer is the owner's wallet and the payee is
the agent's registered wallet.

### The marketplace reference listing on chain 97

The team's reference listing is a health-factor agent, the house agent defined
in src/lib/house-agent.ts and operated by the marketplace itself. It is
registered on chain 97 under token 2504, name Souk Health Guard, category
health-factor, with contract 0x8004a818bfb912233c491871b3d84c89a494bd9e, and it
declares the A2A endpoint
https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json.

Verified on 2026-09-27 at 10:36 UTC.
GET /api/agents/by-owner?owner=0x84fedaBd1b83443aD86796C15619494878B64180
returns token 2504 with category health-factor and ownerAddress
0x84fedabd1b83443ad86796c15619494878b64180, and GET /api/agents?limit=80
returns the same listing on the shelf with that a2a_endpoint, so the
registration passes the shelf gate and is live in the catalogue. The agent card
served at that endpoint names Souk Health Guard, provider Agent Souk, version
1.0.0. The registration transaction hash was not verified for this submission,
so none is cited; the owner address the API returns and the agent card document
are what we verified.

The reproducible checks behind this listing are collected in
docs/house-agent-evidence.md: the registry read that returns token 2504 under
that owner, `ownerOf(2504)` on the registry, the A2A message that returns the
health factor, the MCP `tools/list` that returns `compute_health_factor`, and the
declared agent card. On 2026-09-27 this session re-probed both surfaces: POST to
https://api.agentsouk.xyz/api/house-agent/a2a returned HTTP 200 with the task
state `completed`, and POST to
https://api.agentsouk.xyz/api/house-agent/mcp with `tools/list` returned HTTP 200
listing `compute_health_factor`.

### Endpoint quality gate

The marketplace refuses to list an agent with no publicly reachable endpoint,
and refuses to call an endpoint that resolves to a loopback or private address,
because calling one from a serverless function means calling the function's own
loopback and failing with a bare connection error. Two gates enforce this, both
in src/lib:

- Shelf gate: isShelfReady in src/lib/agent-index.ts keeps an agent off the
  shelf unless it has at least one publicly reachable endpoint and a real
  category. validateDraft in src/lib/registry-write.ts also requires an https
  endpoint for a self-serve registration.
- Call gate: privateEndpointReason in src/lib/endpoint.ts rejects loopback,
  link-local, and RFC 1918 addresses, and deliverMcp and deliverA2a in
  src/lib/delivery.ts judge the endpoint before calling it. For A2A the check is
  applied to the messaging url named inside the agent card, not only to the
  registry endpoint.

The affected listed agent is token 2173 (Grid Runner), the same agent the real
hire above pays. Its registry endpoint is a public https URL, so it passes the
shelf gate and stays listed, but the card served there declares
"url":"http://localhost:8080/", so the call gate refuses the call and the hirer
gets a stated failure instead of an empty 500. The agent is listed but
unreachable until its owner publishes a public messaging url. We fetched that
card on 2026-09-27 and confirmed it declares http://localhost:8080/. Settlement
and delivery are separate steps, so a settled hire does not prove the agent is
reachable.

### Settlement proof suite

`node scripts/settle-proof-suite.mjs` runs six further onchain proofs. Each one
demonstrates a different capability rather than repeating the same hire, because
the brief excludes wash activity from rewards and we would rather show six
distinct things than six identical ones. All of it is signed by our own buyer
key, 0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713, and broadcast by our own relay,
0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4. Both are team wallets, and their
roles are declared in section 5. None of this activity counts toward any
participant's quest progress.

| what it demonstrates | category | amount | gas | transaction |
|---|---|---|---|---|
| settle a hire to a yield agent | yield | 2 sUSD | 61,310 | 0xbaaec7294ec276a76311168c71dff30918f99d3fd686d14df329c923fbcb20f4 |
| settle a hire to a grid-trading agent | grid-trading | 2 sUSD | 61,396 | 0xb57dda246f6e8412fd5bfff5c305e94998e3d5e778426fe4b3c376bc9271c195 |
| settle a hire to a rebalancing agent | rebalancing | 2 sUSD | 61,396 | 0xc62f7421a31c09dc0b45643405212ce54e61305c6c3ce4722612ffc8b6b066aa |
| settle a hire to a health-factor agent | health-factor | 2 sUSD | 61,396 | 0xf10142bdcf534c69f18c862dd365f21ee025d60e4d1068b15a2df68d3e35d899 |
| settle an amount that is not the default | yield | 0.75 sUSD | 61,384 | 0x7d144a2cfc6244d5dfe1ae6e46d54803cf0f7ae4d2262c569508162fd1646a82 |
| cancel an unused authorization before it is used | revocation | n/a | n/a | 0xa72e7c831b0f171df4b368243d49e245a930dcd3cd1cbb54caf3925720feb0d3 |

The four category hires matter most for the quest, because a wallet qualifies
by hiring an agent in each of the four categories, and these show the marketplace
settling all four to four different agent wallets. Each payee is the
`agent_wallet` recorded in that agent's ERC-8004 registry record, taken from
data/agents-97.json, so the payees are verifiable against the registry rather
than chosen by us.

### Settlements from the verification sweep

The verifier makes a real hire against every agent it checks, because a
capability call is gated on a settled session. That means the sweep has produced
twenty further settlements across ten agents, each probed twice. These are a
stronger class of evidence than the suite above, because they are not curated:
they are the marketplace paying agents in the ordinary course of grading them.

| category | agent token | transaction |
|---|---|---|
| yield | 2048 | 0x3099ef7aea36ffd8dc9904851073a32c667b1518fab15a11a9feea20b4aaea16 |
| grid-trading | 2018 | 0x96d9171fd2f93cd490640678622b36cdc9fefc04bf0704d84692d29a61622c58 |
| rebalancing | 1856 | 0x64478463526452d64060d4280356dcabf78c40296614b2217fffba0007059f51 |
| health-factor | 2238 | 0xd070e744717202c76e4601daf0c503b1037e5a2646e03f58b831ff6a086d49db |

All twenty resolve with receipt status 0x1 on chain 97 and can be checked on
testnet.bscscan.com. This session checked all twenty on 2026-09-27: each
eth_getTransactionReceipt returns status 0x1, and the `to` field of each
transferWithAuthorization calldata equals the agent_wallet recorded for that
token in data/agents-97.json. The payee of each is the agent's registered
wallet, so the money went to the agent rather than to us. The buyer for the
sweep is the relay wallet, which is why its nonce rises by one per verification
and why section 5 declares it as a team wallet: this activity is ours and does
not count toward any participant's progress.

The same mechanism means a settled hire now appears in the marketplace's own
record rather than only on chain. `GET /api/hires/by-wallet` answers from the
durable ledger and reports the store it answered from, so an empty result can be
told apart from an incomplete one.

### The verifier's sweep on chain 97

The verifier cron ran against the deployed API on 2026-09-27 and returned HTTP
200 in 54 seconds. It verified ten agents, with its own tally two delivered,
zero gated, seven dead and one unreachable. The ten hires it created are
ordinary marketplace records: `GET /api/tasks?limit=50` shows ten sessions on
chain 97 with paymentId `verify_*`, created between 2026-09-27T11:46:49Z and
2026-09-27T11:47:35Z, each with the relay wallet
0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4 as the client, so the activity is
ours and does not count toward any participant's progress.

The status a listing carries is our own probe's reading rather than a third
party's index. The agent record carries a `verification` object produced by our
own probe pipeline, and the third party's index fields, `health_status` and
`endpoint_last_checked_at`, are separate and labelled as such. One honest limit
belongs here: for chain 97 the `verification` object currently returned at
`GET /api/agents/97/<tokenId>` is still dated 2026-09-25 and reads "a2a card
ok", including for the tokens the sweep marked dead, so the tonight hire-based
verdicts live in the verifier's own store and run record rather than at that
endpoint.

### The shelf's reachability, one table

Every listed agent was probed over A2A, card first and then messaging, and the
per-agent verdicts are recorded in three sheets. The consolidated table in
docs/agent-reachability-remaining.md merges them and is the place to read the
result rather than restating it here. Its totals for the 22 listed agents are:
three returned a completed A2A task, five returned only an ERC-8183 negotiation
quote, and seven refused; six were unreachable at every path. Grid Runner (token
2173) is unreachable at the private address its card advertises and answers only
with a quote at the host that serves its card, so it is named apart from the
three buckets rather than folded into one. These are liveness probes: no payment
was made, no hire was created, and answering a probe is not the same as
completing a paid job.

## 2. Event mapping: hire, deposit, job completion, rating

There are no quest-relevant onchain events in this build. Each quest event
maps to an API record as follows.

| Quest event | Source of truth | How to verify |
|---|---|---|
| Hire | POST /api/x402/settle verifies the EIP-3009 authorization and records a receipt; the hire session enters the payment ledger | GET /api/hires/by-wallet?wallet=0x... returns paymentId, chainId, tokenId, agent name, category, tx hash, mode, spend cap, and timestamps. Single receipts at GET /api/receipts/[paymentId] |
| Deposit (fund leg) | x402 settlement moves the job from Open to Funded via fundJob in src/lib/jobs.ts with reason "x402 settlement" | GET /api/jobs shows the job with status Funded and its paymentId |
| Job completion | provider submits a deliverable (Submitted), then the evaluator completes the job (Completed) via POST /api/jobs/[jobId] | GET /api/jobs shows status Submitted or Completed with deliverable and attestation |
| Rating | reputation arrives through the 8004scan feedbacks API via fetchFeedbacks in src/lib/scanner.ts, plus scout ratings in src/lib/scout.ts; no onchain rating transaction exists in this build | GET /api/agents and the agent detail endpoints expose total_score, average_score, and total_feedbacks from the registry snapshot |

## 3. How agent IDs and owner wallets are recorded

- Agent IDs follow the registry form chainId:contract:tokenId, for example
  97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2300 for the agent named
  rangekeeper-agent. The id comes from the registry snapshot loaded through
  the target-aware loader in src/lib/scanner.ts, never from a hardcoded path.
- Owner wallets are the owner_address field of the registry record, for
  example 0xcc2abe29f43eab530a6b5d93e3c41bc0e7622b47 owns token 2300 on
  chain 97.
- Hire records link the client wallet to chainId plus tokenId plus the
  paymentId receipt, with createdAt and expiresAt timestamps.
- Categories (rebalancing, grid-trading, yield, health-factor, general) are
  assigned by the classifier in src/lib/categories.ts and stored on each
  snapshot record.

## 4. Verification endpoints with example calls

Base URL is the deployed app origin. The endpoints below are read-only GET and
follow the response conventions of src/app/api/sessions/route.ts.

The frontend origin is https://agentsouk.xyz, served by Cloudflare (the zone is
on Cloudflare nameservers, and responses carry CF-RAY and Server: cloudflare).
It is a manual Cloudflare Pages publish of apps/web; the owner names the Pages
project "agentsouk", which is not readable from the repo or from the response
headers, so that name is stated rather than verified here. The API origin is
https://api.agentsouk.xyz, the Next.js app on Vercel: responses carry
Server: Vercel and X-Powered-By: Next.js, api.agentsouk.xyz is a CNAME to
cname.vercel-dns.com, and the local Vercel project metadata names the project
"agora". Both hosting providers were confirmed from live responses and DNS on
2026-09-27.

Neither deployment auto-deploys from git. The provider dashboard settings are
not readable from here and none are in the repo; what is verifiable is that the
repo contains no GitHub Actions workflow that publishes either site. It carries
one workflow, .github/workflows/refresh-catalogue.yml, and that workflow only
calls the API's catalogue refresh route described below, so it is not a publish
path. The owner states both publishes are manual, so a git push does not publish
either. The endpoints below therefore describe what is currently published, not
what is in the working tree.

Hires by client wallet:

```
GET /api/hires/by-wallet?wallet=<client address>
```

This route reads the durable receipts store in `src/lib/receipts-store.ts`, the
same source the revoke path uses. It is written by hires that go through the app's
own settle path, and it answers with real records.

An earlier version read the in-process payment ledger, which holds only payments
made by the same server instance, so on a serverless deployment it returned an
empty list for wallets that had demonstrably paid, while looking like a
well-formed answer. That is the failure this endpoint exists to prevent, and it is
carried here because it is the reason to trust the numbers now. Read live on
2026-09-27, the relay wallet returns 22 hires: 20 verification settlements and 2
reproduction settlements, every one with a real chain 97 transaction whose
receipt status is 0x1 and whose payee is the agent's registered wallet. The
participant wallet that made the real hire in section 1 returns 13 records, of
which 4 are settled prod hires with a real chain 97 transaction and 9 are older
sandbox-mode records whose tx hash is a placeholder string that does not resolve
on chain. The response reports the store it answered from (postgres on the
deployed API), so an empty result can be told apart from an incomplete one, and a
sandbox record is distinguishable from a settled one by its mode.

For an auditor both records are available and they agree. Every hash in section 1
resolves on BSC testnet with receipt status 0x1 and is checkable on
testnet.bscscan.com, and this endpoint reports the same settlements per wallet.
Section 1 names the script that regenerates each proof, so the result can be
reproduced rather than taken on trust.

Agents by owner wallet:

```
GET /api/agents/by-owner?owner=0xcc2abe29f43eab530a6b5d93e3c41bc0e7622b47
```

Example response (real chain 97 snapshot record, verified 2026-09-25):

```json
{
  "success": true,
  "owner": "0xcc2abe29f43eab530a6b5d93e3c41bc0e7622b47",
  "chainId": 97,
  "agents": [
    {
      "chainId": 97,
      "tokenId": "2300",
      "agentId": "97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2300",
      "name": "rangekeeper-agent",
      "category": "rebalancing",
      "contractAddress": "0x8004a818bfb912233c491871b3d84c89a494bd9e",
      "ownerAddress": "0xcc2abe29f43eab530a6b5d93e3c41bc0e7622b47"
    }
  ],
  "counts": { "agents": 1, "categories": { "rebalancing": 1 } }
}
```

Missing query parameters return 400 with `{ "success": false, "error": ... }`.

Operational note: the in-process payment ledger is in-memory per server
instance, so a local run without a durable store can only answer for the
instance that processed the settlements. The deployed API runs with
RECEIPTS_STORE=postgres plus DATABASE_URL and reports source "postgres", which
this session confirmed on 2026-09-27, so its answers are durable.

The catalogue is store-backed rather than snapshot-only. A catalogue_meta
record holds the refresh time and the registry total the refresh observed
(initCatalogueMeta and saveCatalogueMeta in src/lib/shelf-store.ts); the shared
store seeds itself from the committed snapshot once, when it holds no rows for
the chain (seedStoreFromSnapshot in src/lib/scanner.ts); and the shelf is read
from the store on a thirty second TTL (SHELF_STORE_TTL_MS = 30_000 in
src/lib/scanner.ts). GET /api/agents reports which side is serving and when it
last refreshed through indexStatus.catalogueSource and
indexStatus.catalogueRefreshedAt. Read at 2026-09-27T10:36:50Z, the response
reported catalogueSource "store" and catalogueRefreshedAt
"2026-09-27T10:36:30.097Z", with registryTotal 2464 and snapshotTotal 21, so the
store was the source at read time and the reported time was a real refresh
rather than the committed snapshot's 2026-09-25 date.

The refresh is on a schedule, not on a deploy.
.github/workflows/refresh-catalogue.yml runs every fifteen minutes
(cron "*/15 * * * *") and calls GET /api/cron/refresh with a bearer secret. The
route is fail-closed: it answers 503 when no secret is configured and 401 for a
wrong one (src/app/api/cron/refresh/route.ts, calling refreshIndexFromLive in
src/lib/scanner.ts). A catalogue refresh therefore no longer depends on a
deploy.

Listing review queue, read by the team:

The team reads the listing review queue through GET /api/listings/requests,
which is secret-gated and fails closed: with no secret configured it answers
503, and without the correct secret it answers 401
(src/app/api/listings/requests/route.ts). No secret is printed here. This route
is what makes the claim that a human reads every listing request demonstrable,
because the queue it returns is the durable queue POST /api/listings/request
writes (src/lib/listing-request-store.ts), so the team's read of it can be shown
rather than asserted.

## 5. Team wallets

The brief (item 6, "Your team's own wallet addresses") asks for the team's own
wallets. This submission uses five addresses. Two are the operational keys
that sign and broadcast the settlements in section 1; one is the identity
the team listed agents under, one i sthe deployer and one is a spare identiity. The roles are are arranged in order of team activity to particapant 
so a reader can tell.

| Role | Address | Key | What it does |
|---|---|---|---|
| Relay, broadcaster, pays gas | 0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4 | RELAY_PRIVATE_KEY, never committed; the address was derived from the local key and checked on 2026-09-27 without printing the key | broadcasts every settlement in this submission and pays all gas for them |
| Buyer, signs authorizations | 0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713 | PROD_BUYER_KEY, never committed; the address was derived from the local key and checked on 2026-09-27 without printing the key | signs the EIP-3009 transferWithAuthorization authorizations for the worked example and the proof suite and is the payer named in each of those; the verification sweep signs as the relay instead (section 1); it does not broadcast |
| House agent owner | 0x84fedaBd1b83443aD86796C15619494878B64180 | not yet funded | the intended registering owner of the agent the team will list, so the listing resolves to the team. Currently unused |

On-chain state, read on 2026-09-27 (chain 97 via
https://bsc-testnet-rpc.publicnode.com, chain 56 via
https://bsc-rpc.publicnode.com; the Binance seed RPCs did not resolve at read
time):

| Address | chain 97 nonce | chain 97 balance | chain 56 nonce | chain 56 balance |
|---|---|---|---|---|
| 0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4 | 63 | 0.295527 tBNB | 1 | 0.0040875 BNB |
| 0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713 | 0 | 0 | 0 | 0 |
| 0x84fedaBd1b83443aD86796C15619494878B64180 | 0 | 0 | 0 | 0 |

Notes on the numbers:

- The relay is the broadcaster and the payer of gas on every settlement in
  section 1, which is why its nonce is nonzero. Read on 2026-09-27 it holds
  999,956 of the 1,000,099.5 sUSD in circulation (TestUSD totalSupply); the
  proof suite mints sUSD to the payer from the relay wallet, since mint in
  contracts/src/TestUSD.sol is public with no owner and no supply cap.
- The buyer's nonce is zero on both chains. That is expected and is not a sign
  that it went unused. Under EIP-3009 the buyer only signs an authorization and
  the relay submits it, so a signer that never broadcasts always has nonce zero.
  The buyer is still the authorizer and the `from` of each authorization it
  signs, which is visible in those receipts.
- 0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5 is the declared team identity, the
  address this section used to declare alone. It is currently unused: nonce and
  balance are both zero on chain 97 and chain 56. It is not the payer or the
  broadcaster of any settlement here, and nothing in section 1 was sent from it.
  It is not a payout address, and no payout is owed: the quest reward is a
  limited merch drop for the first 100 completing wallets, not a token payout.
  To make it verifiable on chain it needs testnet BNB for gas and needs to be the
  registering owner of the ERC-8004 listing on chain 97.

Sponsored gas drip. The relay also funds registration gas for new wallets.
POST /api/tokens/mint tops the signing address up to a floor of 0.001 tBNB and
sends only the shortfall, not the whole floor, so a wallet that already holds
gas receives nothing and a repeated call cannot over-fund it. The floor is the
exported constant GAS_FLOOR_WEI = parseUnits("0.001", 18) in
src/app/api/tokens/mint/route.ts, and gasDripFor in the same file returns
GAS_FLOOR_WEI - balance as the amount to send.

Fair play and the flagship payee. The worked example in section 1 pays
0xCC2abE29F43EAb530a6b5D93E3C41bc0E7622b47. That address is also the registered
owner of the marketplace listing token 2300 (rangekeeper-agent) in
data/agents-97.json, recorded as both owner_address and agent_wallet. We
confirmed this on chain 97 on 2026-09-27: ownerOf(2300) on the ERC-8004
registry returns 0xcc2abe29.... The proof suite pays the same agent_wallet
recorded in the catalogue, so every payee in section 1 is a catalogue listing
owner.

Consequence, stated plainly: the team's proof activity moves sUSD to addresses
that stand in the marketplace catalogue, so the payee alone does not separate
team activity from marketplace activity, which is what the declaration above is
meant to achieve. We cannot prove from public data whether 0xCC2abE29 is
controlled by the team or by a third party, and we do not claim either. What is
verifiable is that the seven team-proof transactions in section 1 are capability
proofs, that they do not write a receipt (section 4), and that they must not
count toward any participant's quest progress. If any of those payees is a
team-seeded listing, that is team activity and is disclosed as such
rather than read as marketplace traction. We recommend a reader treat the seven
team-proof transactions in section 1 (the worked example and the six proof-suite
rows, not the hire by a non-team authorizer) as the team's own proof activity for
that reason.

## 6. Known limitations and unproven paths

These are the things that are not true yet, or not yet proven, so a reader can
tell them apart from the claims above.

- No mainnet settlement has happened. Every settled hire in this document is on
  BSC testnet, chain 97, and no funds have moved on BSC mainnet, chain 56. The
  mainnet path is proven only by the relayed settlement already recorded in
  section 1, 0x25bcb12557ec4d484e1a9962a17a16e2883f07bd623909fad95c6bd82bdda6f3
  on chain 56; that is a proof of the path, not campaign activity.
- The email notification path is configured and verified on production. RESEND_API_KEY,
  NOTIFY_EMAIL and NOTIFY_FROM (Agent Souk <notifications@agentsouk.xyz>) are set on
  Vercel production with the domain verified, and a live request through
  POST /api/listings/request returned notified true with the mail arriving in the
  team inbox. A listing review request is therefore both stored, readable through
  GET /api/listings/requests, and emailed.
- The grid-trading category has no agent that can deliver a plan. The chain 97
  grid agents answer a direct task with an ERC-8183 price quote instead of a
  plan, so the advantage comparison cannot fill that category. The per-agent
  paths are in docs/agent-reachability-grid.md.
- Known defect, in the owner's terms: a job can reach the state where a delivery
  was recorded twice and the job still reads Funded, so the completion control is
  not offered. Job 5a6f99c8-c600-47e7-9c93-1d9e9ed43ef9 (token 2504, payment
  req_0xdc86a0d95846358c) is in that state: task
  62ce7c58-9387-43bf-951d-b7abe4b2bcb3 recorded its delivery twice and the job's
  history still stops at Open, Funded. This is stated as a known limitation, not
  as fixed.
- Sandbox captures are not settlements. A capture recorded in sandbox mode
  verifies the signature and records the session but moves no funds, so it must
  not be read as a live settlement. The newly assembled advantage capture in
  data/advantage-tasks.json reports capture.settledOnChain true, measuredAt
  2026-09-27T12:14:03Z; its two hires settled on chain 97 in sUSD with the
  participant wallet 0x84fedaBd1b83443aD86796C15619494878B64180 as the payer.
  Both settlement transactions resolve with receipt status 0x1 and the
  transferWithAuthorization selector 0xe3ee160e.
