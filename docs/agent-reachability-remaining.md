# Agent reachability: remaining shelf (BSC testnet, chain 97)

Purpose: the deadline brief requires that a stale or unresponsive agent is shown as
such, not hidden. This sheet records a current status for every shelf agent not
already covered by the health-factor/yield sheet or the grid-trading sheet, so the
page can state the truth per agent.

Date: 2026-09-27 UTC. Source:
`GET https://api.agentsouk.xyz/api/agents?limit=80` returned HTTP 200 and 22 items.

Excluded from this sheet because other agents probed them: 2238, 2020, 2046, 2044,
2019, 2237, 2048, 2018, 2173, 1853. That leaves 12 agents here: 5 rebalancing,
6 yield, 1 health-factor.

These are liveness probes only. No payment was made, no hire was created and no
delivery is claimed. An agent answering a card fetch or a `message/send` probe is
not the same as completing a paid task. It only shows the endpoint was alive and
willing to respond at probe time.

## Method

1. GET the agent card from the advertised `a2a_endpoint` over https, recording the
   status code, the name in the card and the seconds.
2. POST one JSON-RPC 2.0 `message/send` with a short text task matching the
   category. One message per agent on its advertised messaging path.
3. If the advertised path did not return a usable JSON-RPC response, send one extra
   `message/send` to an obvious sibling path (the card `url`, an `/a2a` suffix, the
   advertised path itself, or the host origin). Every distinct attempt is listed.
4. Record the HTTP status, whether JSON parses, the task state, the seconds, and the
   first 80 characters of any artifact or error text.

Request texts, one per category:

- rebalancing: "My BNB portfolio has drifted to 70 percent BNB and 30 percent
  stablecoin. Suggest a rebalancing trade to restore a 50/50 target. Reply briefly."
- yield: "Compare two BNB Chain yield venues and recommend the one with the higher
  APR. Reply briefly."
- health-factor: "Collateral value is 1000 USD, debt value is 600 USD, liquidation
  threshold is 0.8. What is the health factor? Reply briefly."

Verdicts used below:

- answers: returned a JSON-RPC result, with the task state or quote recorded.
- refuses: returned a valid response that declined the request.
- unreachable: no usable JSON-RPC task response from any attempt.

## Rebalancing

### LingoAI Portfolio Rebalancer (demo), token 1856

- Category: rebalancing.
- Advertised endpoint:
  `https://holon-staging.lingoai.io/agents/rebalancing/.well-known/agent-card.json`.
- Card: HTTP 200 in 1.45 s. Name in card: `LingoAI Portfolio Rebalancer`. Card
  `url`: `https://holon.lingoai.io/agents/rebalancing/a2a`.
- Request: the rebalancing text above.
- Message attempt on the card `url`
  `https://holon.lingoai.io/agents/rebalancing/a2a`: HTTP 200 in 2.41 s. JSON
  parses. The result is an ERC-8183 negotiation envelope (`result.status` =
  `quoted`), not an A2A task with an artifact. `signed` is false with reason
  `signing key ... is not the provider ...`. First 80 characters of the result:
  `{"status":"quoted","price":"1000000000000000000","currency":"0xce24439f2d9c6a228`.
  No artifact text exists.
- Verdict: answers (returns a quote, not a completed rebalance result).

### Hevo Rebalance, token 1865

- Category: rebalancing.
- Advertised endpoint:
  `https://hevo-agents.fly.dev/rebalance/.well-known/agent-card.json`.
- Card: HTTP 200 in 1.15 s. Name in card: `Hevo Rebalance`. Card `url`:
  `http://hevo-agents.fly.dev/rebalance` (plain HTTP, no `/a2a` suffix).
- Request: the rebalancing text above.
- Attempt 1, advertised card `url` over http `http://hevo-agents.fly.dev/rebalance`:
  HTTP 404 in 0.70 s. Body `{"detail":"Not Found"}`, not JSON-RPC.
- Attempt 2, same path over https `https://hevo-agents.fly.dev/rebalance`: HTTP 404
  in 0.42 s. Body `{"detail":"Not Found"}`.
- Attempt 3, host origin `https://hevo-agents.fly.dev/`: HTTP 405 in 0.57 s. Body
  `{"detail":"Method Not Allowed"}`.
- Attempt 4, sibling `/a2a` `https://hevo-agents.fly.dev/rebalance/a2a`: HTTP 200 in
  1.04 s. JSON parses. The result is an ERC-8183 quote (`result.status` = `quoted`)
  with a non-empty `provider_sig`, not an A2A task with an artifact. First 80
  characters of the result:
  `{"status":"quoted","price":"8000000000000000000","currency":"0xc70B8741B8B07A6d6`.
  No artifact text exists.
- Verdict: answers, but only at the undisclosed `/a2a` sibling. The advertised
  messaging path 404s and the host root 405s. It returns a quote, not a completed
  rebalance result.

### RangeKeeper, token 2017

- Category: rebalancing.
- Advertised endpoint:
  `https://spotriq-production.up.railway.app/v1/reference-agents/rangekeeper/.well-known/agent-card.json`.
- Card: HTTP 200 in 1.13 s. Name in card: `RangeKeeper`. Card `url`:
  `https://spotriq-production.up.railway.app/v1/reference-agents/rangekeeper/a2a`.
- Request: the rebalancing text above.
- Message attempt on the card `url`
  `https://spotriq-production.up.railway.app/v1/reference-agents/rangekeeper/a2a`:
  HTTP 200 in 0.72 s. JSON parses. Task state: none (JSON-RPC error). Error code
  -32000, message `RangeKeeper requires input.tokenId for a PancakeSwap V3 position
  read.`. First 80 characters:
  `{"code":-32000,"message":"RangeKeeper requires input.tokenId for a PancakeSwap V`.
  No artifact text.
- Verdict: refuses (reachable, but it declines a plain text message and needs a
  structured `input.tokenId`).

### Bench Reference Rebalancer (operated by Bench), token 2187

- Category: rebalancing.
- Advertised endpoint: `https://bench-bnb.vercel.app/.well-known/agent-card.json`.
- Card: HTTP 200 in 1.10 s. Name in card:
  `Bench Reference Rebalancer (operated by Bench)`. Card `url`:
  `https://bench-bnb.vercel.app/a2a`.
- Request: the rebalancing text above.
- Message attempt on the card `url` `https://bench-bnb.vercel.app/a2a`: HTTP 200 in
  0.92 s. JSON parses. Task state: none. The result is an A2A agent message whose
  data part is an error. First 80 characters of the error:
  `{"error":"MISSING_AUDITION_CONTEXT","message":"need the fork RPC endpoint, the a`.
  It asks for `rpc_url`, `account` and `account_private_key`.
- Verdict: refuses (reachable, but it declines the task without position context).

### rangekeeper-agent, token 2300

- Category: rebalancing.
- Advertised endpoint:
  `https://rangekeeper-agent.moisescisnerosdl.workers.dev/.well-known/agent-card.json`.
- Card: HTTP 200 in 0.91 s. Name in card: `rangekeeper-agent`. Card `url`:
  `https://rangekeeper-agent.moisescisnerosdl.workers.dev/` (the host origin).
- Request: the rebalancing text above.
- Attempt 1, advertised card `url` (host origin)
  `https://rangekeeper-agent.moisescisnerosdl.workers.dev/`: HTTP 200 in 0.34 s.
  JSON parses, but the body is a health document, not a JSON-RPC response. First 80
  characters: `{"status":"HEALTHY","agent":"rangekeeper-agent","version":"0.1.0","network":"bsc`.
  It ignored `message/send`.
- Attempt 2, sibling `/a2a`: HTTP 404 in 0.62 s. Body
  `{ "error": "Not Found", "path": "/a2a" }`.
- Attempt 3, sibling `/mcp`: HTTP 200 in 0.67 s. JSON parses, JSON-RPC envelope with
  an empty `result` (`{}`), not a task response.
- Verdict: unreachable (the advertised origin ignores `message/send` and returns a
  health document; `/a2a` 404s; `/mcp` returns an empty result).

## Yield

### Yield Router, token 2175

- Category: yield.
- Advertised endpoint:
  `https://yieldrouter-production.up.railway.app/.well-known/agent-card.json`.
- Card: HTTP 200 in 1.00 s. Name in card: `yieldrouter-agent`. Card `url`:
  `http://localhost:8080/` (a private, unroutable address).
- Request: the yield text above.
- Attempt 1, advertised card `url` `http://localhost:8080/`: fetch failed in 0.01 s
  (no response, private address).
- Attempt 2, host origin `https://yieldrouter-production.up.railway.app/`: HTTP 200
  in 0.32 s. JSON parses. Task state: none. The result is an A2A agent message whose
  data part is an error. First 80 characters:
  `{"error":"unknown skill: undefined","skills":["negotiate","notify_funded"]}`. It
  hints to send the skill envelope as an A2A data part.
- Verdict: refuses (reachable, but rejects a plain text message and asks for a skill
  data part).

### Sluicegate, token 2162

- Category: yield.
- Advertised endpoint:
  `https://marque.trade/agents/sluicegate/.well-known/agent-card.json`.
- Card: HTTP 200 in 0.99 s. Name in card: `Sluicegate`. Card `url`:
  `https://marque.trade/agents/sluicegate/a2a`.
- Request: the yield text above.
- Message attempt on the card `url`
  `https://marque.trade/agents/sluicegate/a2a`: HTTP 200 in 0.16 s. JSON parses.
  Task state: completed. Artifact text, first 80 characters:
  `{"error":"the task does not state the asset, the size in USD","need":"net APR de`.
- Verdict: refuses (it completes a task, but the artifact declines to compute net
  APR without the asset and the size).

### LingoAI Yield Optimiser (demo), token 1854

- Category: yield.
- Advertised endpoint:
  `https://holon-staging.lingoai.io/agents/yield/.well-known/agent-card.json`.
- Card: HTTP 200 in 0.44 s. Name in card: `LingoAI Yield Optimiser`. Card `url`:
  `https://holon.lingoai.io/agents/yield/a2a`.
- Request: the yield text above.
- Message attempt on the card `url` `https://holon.lingoai.io/agents/yield/a2a`:
  HTTP 200 in 2.25 s. JSON parses. The result is an ERC-8183 quote
  (`result.status` = `quoted`), `signed` false with reason `signing key ... is not
  the provider ...`. First 80 characters:
  `{"status":"quoted","price":"1000000000000000000","currency":"0xce24439f2d9c6a228`.
  No artifact text.
- Verdict: answers (returns a quote, not a completed yield result).

### YieldRoute Provider, token 2053

- Category: yield.
- Advertised endpoint:
  `https://mandate-provider-yield.onrender.com/mandate/capability`.
- Card: HTTP 200 in 0.82 s, but the body is not an A2A agent card. It is a
  capability document with `schema` = `mandate.provider-service.v1`, and it has no
  name, no `url`, and no skills. Shelf name: `YieldRoute Provider`.
- Request: the yield text above.
- Attempt 1, host origin `https://mandate-provider-yield.onrender.com/`: HTTP 404 in
  0.35 s. Body `{"detail":"Not Found"}`.
- Attempt 2, advertised path `https://mandate-provider-yield.onrender.com/mandate/capability`:
  HTTP 405 in 0.65 s. Body `{"detail":"Method Not Allowed"}` (GET only).
- Verdict: unreachable (no A2A message endpoint; the advertised path is GET only and
  the origin 404s).

### YieldRoute Provider, token 2054

- Category: yield.
- Advertised endpoint:
  `https://mandate-provider-yield.onrender.com/mandate/capability`.
- Card: HTTP 200 in 0.79 s, same non-A2A capability document as token 2053, no name
  and no `url`.
- Request: the yield text above.
- Attempt 1, host origin: HTTP 404 in 0.33 s. Body `{"detail":"Not Found"}`.
- Attempt 2, advertised path: HTTP 405 in 0.32 s. Body
  `{"detail":"Method Not Allowed"}`.
- Verdict: unreachable (duplicate of token 2053; same host, same result).

### yieldrouter-agent, token 2301

- Category: yield.
- Advertised endpoint:
  `https://yieldrouter-agent.moisescisnerosdl.workers.dev/.well-known/agent-card.json`.
- Card: HTTP 200 in 0.74 s. Name in card: `yieldrouter-agent`. Card `url`: host
  origin.
- Request: the yield text above.
- Attempt 1, advertised card `url` (host origin): HTTP 200 in 0.34 s. JSON parses,
  but the body is a health document, not a JSON-RPC response. First 80 characters:
  `{"status":"HEALTHY","agent":"yieldrouter-agent","version":"0.1.0","network":"bsc`.
- Attempt 2, sibling `/a2a`: HTTP 404 in 0.47 s. Body
  `{ "error": "Not Found", "path": "/a2a" }`.
- Attempt 3, sibling `/mcp`: HTTP 200 in 0.48 s. JSON parses, JSON-RPC envelope with
  an empty `result` (`{}`).
- Verdict: unreachable (same failure shape as token 2300).

## Health factor

### Souk Health Guard, token 2504

- Category: health-factor.
- Advertised endpoint:
  `https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json`.
- Card: HTTP 200 in 1.06 s. Name in card: `Souk Health Guard`. Card `url`:
  `https://api.agentsouk.xyz/api/house-agent/a2a`.
- Request: the health-factor text above.
- Message attempt on the card `url` `https://api.agentsouk.xyz/api/house-agent/a2a`:
  HTTP 200 in 0.32 s. JSON parses. Task state: completed
  (`result.task.status.state` = `completed`). The artifact data reports
  `healthFactor` 1.3333, `state` caution, `liquidationDistance` 0.25. Message text,
  first 80 characters:
  `Health factor 1.3333 for collateral 1000 USD at a liquidation threshold of 0.8 a`.
- Verdict: answers (completed task with a deterministic health factor).

## Consolidated shelf table

Both sibling sheets existed when this was written and were read:
`docs/agent-reachability-health-yield.md` and `docs/agent-reachability-grid.md`. The
table below merges them with this sheet, so one page covers all 22 shelf agents.
Card status is the GET result for the advertised card. Message status is the result
of the attempt that produced the recorded response (or the failure of every attempt).

| Category | Token | Agent | Card status | Message status | Verdict |
| --- | --- | --- | --- | --- | --- |
| health-factor | 2238 | Keel | 200 | 200 `/a2a` (completed) | answers |
| health-factor | 2020 | Hevo Sentinel | 200 | 405 card path, 404 base (no JSON-RPC) | unreachable |
| health-factor | 2046 | VenusGuard | 200 | 200 `/a2a` (JSON-RPC error) | refuses |
| health-factor | 2504 | Souk Health Guard | 200 | 200 `/a2a` (completed) | answers |
| yield | 2044 | YieldPilot | 200 | 200 `/a2a` (JSON-RPC error) | refuses |
| yield | 2019 | Hevo Yield | 200 | 405 card path, 404 base (no JSON-RPC) | unreachable |
| yield | 2237 | Sluicegate | 200 | 200 `/a2a` (completed) | answers |
| yield | 2048 | Fee Yield Scout | 200 | 405 card path, 400 card `url` | refuses |
| yield | 2175 | Yield Router | 200 | 200 origin (agent message error) | refuses |
| yield | 2162 | Sluicegate | 200 | 200 `/a2a` (completed, decline artifact) | refuses |
| yield | 1854 | LingoAI Yield Optimiser (demo) | 200 | 200 `/a2a` (quote) | answers (quote) |
| yield | 2053 | YieldRoute Provider | 200 | 404 origin, 405 advertised path | unreachable |
| yield | 2054 | YieldRoute Provider | 200 | 404 origin, 405 advertised path | unreachable |
| yield | 2301 | yieldrouter-agent | 200 | 200 origin health doc, 404 `/a2a` | unreachable |
| grid-trading | 2018 | Hevo Grid | 200 | 404 advertised, 200 `/a2a` (quote) | answers (quote) |
| grid-trading | 2173 | Grid Runner | 200 | 000 localhost, 200 host (quote/error) | unreachable at advertised address; answers (quote) at host |
| grid-trading | 1853 | LingoAI Grid Trading Agent (demo) | 200 | 200 `/a2a` (quote) | answers (quote) |
| rebalancing | 1856 | LingoAI Portfolio Rebalancer (demo) | 200 | 200 `/a2a` (quote) | answers (quote) |
| rebalancing | 1865 | Hevo Rebalance | 200 | 404 advertised, 200 `/a2a` (quote) | answers (quote) |
| rebalancing | 2017 | RangeKeeper | 200 | 200 `/a2a` (JSON-RPC error) | refuses |
| rebalancing | 2187 | Bench Reference Rebalancer (operated by Bench) | 200 | 200 `/a2a` (agent message) | refuses |
| rebalancing | 2300 | rangekeeper-agent | 200 | 200 origin health doc, 404 `/a2a` | unreachable |

Shelf totals: 3 agents returned a completed A2A task result (Keel 2238, Sluicegate
2237, Souk Health Guard 2504). 5 returned only an ERC-8183 negotiation quote (Hevo
Grid 2018, LingoAI Grid 1853, LingoAI Portfolio Rebalancer 1856, Hevo Rebalance
1865, LingoAI Yield Optimiser 1854). 7 refused (VenusGuard 2046, YieldPilot 2044,
Fee Yield Scout 2048, Yield Router 2175, Sluicegate 2162, RangeKeeper 2017, Bench
Reference Rebalancer 2187). 6 were unreachable at every path (Hevo Sentinel 2020,
Hevo Yield 2019, rangekeeper-agent 2300, YieldRoute Provider 2053, YieldRoute
Provider 2054, yieldrouter-agent 2301). Grid Runner 2173 is unreachable at its
advertised private address but returns a quote at its reachable host. One point is
common to the whole shelf: every advertised card returns HTTP 200, so a card fetch
alone cannot tell a live agent from a stale one. Only the `message/send` probe
separates them.

For this sheet alone (12 agents): 4 answered (3 with quotes, 1 with a completed
task), 4 refused, 4 were unreachable.

## What this does and does not show

These are liveness probes only. No payment was made, no hire was created, no job was
funded and no delivery is claimed by any of these agents. Answering a card fetch or
a `message/send` probe is not the same as completing a paid task. A verdict of
answers only means a JSON-RPC response came back in that moment; a verdict of
unreachable means no usable response came back at probe time and should be shown as
such on the page.
