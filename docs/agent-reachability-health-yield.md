# Agent Reachability: Health-Factor and Yield Agents (BSC testnet, chain 97)

Purpose: record which of the seven shelf agents in the health-factor and yield
categories actually answer right now, by fetching each agent card and sending a
real A2A `message/send` JSON-RPC request, so hiring attempts stop going to
agents that cannot respond.

Date: 2026-09-27. Chain: 97 (BSC testnet). Discovery source:
`GET https://api.agentsouk.xyz/api/agents?limit=80`, using each item's
`services.a2a.endpoint` as the declared endpoint.

## Method

1. GET the agent card from the declared endpoint on the shelf.
2. POST a JSON-RPC 2.0 `message/send` to that same declared endpoint.
3. If the declared endpoint failed, POST once more to the single sibling
   messaging path shown in the card's own `url` field.
4. Time every request.

No agent received more than two `message/send` attempts. All requests completed
inside the 30 to 40 second cap, so there are no timeouts to report. Every
request used `Content-Type: application/json` and `Accept: application/json`.

Common request envelope, health-factor payload:

```json
{"jsonrpc":"2.0","id":"probe-health-1","method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Read the Venus position for BSC account 0xa09991fc5D8637bb4245737C3ebF26E24D653962 and report the health factor."}],"messageId":"probe-health-1","kind":"message"}}}
```

Common request envelope, yield payload:

```json
{"jsonrpc":"2.0","id":"probe-yield-1","method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Scan the Venus supply markets and report the current base supply APY for wallet 0x84fedaBd1b83443aD86796C15619494878B64180."}],"messageId":"probe-yield-1","kind":"message"}}}
```

Verdicts used below:

- answers: returned a JSON-RPC result, with the task state recorded.
- refuses: returned a valid response that declined the request.
- unreachable: no usable JSON-RPC response from either attempt.

## Health factor

### Keel, token 2238

- Card: GET `https://marque.trade/agents/keel/.well-known/agent-card.json`
  returned 200 in 1.47 s. Name: Keel. protocolVersion 0.3.0,
  preferredTransport JSONRPC. Skills declared: health-factor-read,
  repay-to-target, negotiate, notify_funded. Capabilities: streaming false,
  pushNotifications false.
- Request sent: the health-factor payload above.
- Attempt 1, declared endpoint (card path)
  `https://marque.trade/agents/keel/.well-known/agent-card.json`: HTTP 404 in
  0.79 s. Body is HTML `Cannot POST /.well-known/agent-card.json`, not JSON-RPC.
- Attempt 2, sibling messaging path (card `url`)
  `https://marque.trade/agents/keel/a2a`: HTTP 200 in 1.35 s. JSON parses.
  Task state: completed. Artifact text, first 80 characters:
  `{"healthFactor":null,"note":"this account carries no debt, so it has no health f`
- Verdict: answers.

### Hevo Sentinel, token 2020

- Card: GET `https://hevo-agents.fly.dev/sentinel/.well-known/agent-card.json`
  returned 200 in 0.84 s. Name: Hevo Sentinel. Capabilities declared: Lending
  health factor monitoring, Liquidation risk alerting, Buffer restoration
  recommendations. Skills declared: negotiate, notify_funded. Card `url`:
  `http://hevo-agents.fly.dev/sentinel`.
- Request sent: the health-factor payload above.
- Attempt 1, declared endpoint (card path)
  `https://hevo-agents.fly.dev/sentinel/.well-known/agent-card.json`: HTTP 405
  in 0.66 s. Body `{"detail":"Method Not Allowed"}`, not JSON-RPC.
- Attempt 2, sibling messaging path (card `url`, requested over https)
  `https://hevo-agents.fly.dev/sentinel`: HTTP 404 in 0.75 s. Body
  `{"detail":"Not Found"}`. No task state, no artifact.
- Verdict: unreachable (the host is up but no A2A JSON-RPC endpoint answered).

### VenusGuard, token 2046

- Card: GET
  `https://spotriq-production.up.railway.app/v1/reference-agents/venusguard/.well-known/agent-card.json`
  returned 200 in 1.88 s. Name: VenusGuard. Skills declared:
  venus-health-monitor. Metadata: safeMode READ_ONLY.
- Request sent: the health-factor payload above.
- Attempt 1, declared endpoint (card path): HTTP 404 in 0.84 s. Body
  `{"error":{"code":"ROUTE_NOT_FOUND",...}}`, not JSON-RPC.
- Attempt 2, sibling messaging path (card `url`)
  `https://spotriq-production.up.railway.app/v1/reference-agents/venusguard/a2a`:
  HTTP 200 in 0.86 s. JSON parses. Task state: none (JSON-RPC error). Error code
  -32000, message `VenusGuard requires input.walletAddress for Venus health
  monitoring.`. No artifact text.
- Verdict: refuses (reachable, but it declines a plain text message and needs a
  structured `input.walletAddress`).

## Yield

### YieldPilot, token 2044

- Card: GET
  `https://spotriq-production.up.railway.app/v1/reference-agents/yieldpilot/.well-known/agent-card.json`
  returned 200 in 1.74 s. Name: YieldPilot. Skills declared:
  venus-yield-opportunities. Metadata: safeMode READ_ONLY.
- Request sent: the yield payload above.
- Attempt 1, declared endpoint (card path): HTTP 404 in 0.86 s. Body
  `{"error":{"code":"ROUTE_NOT_FOUND",...}}`, not JSON-RPC.
- Attempt 2, sibling messaging path (card `url`)
  `https://spotriq-production.up.railway.app/v1/reference-agents/yieldpilot/a2a`:
  HTTP 200 in 0.80 s. JSON parses. Task state: none (JSON-RPC error). Error code
  -32000, message `YieldPilot requires input.walletAddress for Venus opportunity
  discovery.`. No artifact text.
- Verdict: refuses (reachable, but it declines a plain text message and needs a
  structured `input.walletAddress`).

### Hevo Yield, token 2019

- Card: GET `https://hevo-agents.fly.dev/yield/.well-known/agent-card.json`
  returned 200 in 0.80 s. Name: Hevo Yield. Capabilities declared:
  Cross-protocol APY comparison, Venus & Aave V3 market analysis, Lista liquid
  staking yield routing. Skills declared: negotiate, notify_funded. Card `url`:
  `http://hevo-agents.fly.dev/yield`.
- Request sent: the yield payload above.
- Attempt 1, declared endpoint (card path)
  `https://hevo-agents.fly.dev/yield/.well-known/agent-card.json`: HTTP 405 in
  0.82 s. Body `{"detail":"Method Not Allowed"}`, not JSON-RPC.
- Attempt 2, sibling messaging path (card `url`, requested over https)
  `https://hevo-agents.fly.dev/yield`: HTTP 404 in 0.87 s. Body
  `{"detail":"Not Found"}`. No task state, no artifact.
- Verdict: unreachable (the host is up but no A2A JSON-RPC endpoint answered).

### Sluicegate, token 2237

- Card: GET `https://marque.trade/agents/sluicegate/.well-known/agent-card.json`
  returned 200 in 1.55 s. Name: Sluicegate. Skills declared: net-apr-at-size,
  route-or-decline, negotiate, notify_funded.
- Request sent: the yield payload above.
- Attempt 1, declared endpoint (card path)
  `https://marque.trade/agents/sluicegate/.well-known/agent-card.json`: HTTP 404
  in 0.69 s. Body is HTML `Cannot POST /.well-known/agent-card.json`, not
  JSON-RPC.
- Attempt 2, sibling messaging path (card `url`)
  `https://marque.trade/agents/sluicegate/a2a`: HTTP 200 in 0.86 s. JSON parses.
  Task state: completed. Artifact text, first 80 characters:
  `{"error":"the task does not state the asset, the size in USD","need":"net APR de`
- Verdict: answers (it completes a task, but declines to compute net APR without
  the asset and the size).

### Fee Yield Scout, token 2048

- Card: GET
  `https://bearing-fawn.vercel.app/api/agents/vault-weather/invoke/.well-known/agent-card.json`
  returned 200 in 1.77 s. Name: Fee Yield Scout. version 0.1.0. Skills declared:
  yield-condition-read. defaultInputModes:
  application/json, application/x-www-form-urlencoded. Card `url`:
  `https://bearing-fawn.vercel.app/api/agents/vault-weather/invoke`.
- Request sent: the yield payload above.
- Attempt 1, declared endpoint (card path)
  `https://bearing-fawn.vercel.app/api/agents/vault-weather/invoke/.well-known/agent-card.json`:
  HTTP 405 in 0.88 s, empty body.
- Attempt 2, sibling messaging path (card `url`)
  `https://bearing-fawn.vercel.app/api/agents/vault-weather/invoke`: HTTP 400 in
  1.61 s. JSON parses but is not a JSON-RPC envelope:
  `{"ok":false,"error":"invalid_invocation"}`. No task state, no artifact.
- Verdict: refuses (the endpoint rejects the A2A invocation and never returns a
  JSON-RPC envelope).

## Ranking

Ranked by whether they answered, best first. "answers" means a JSON-RPC result
came back, "refuses" means a valid decline came back, "unreachable" means
nothing usable came back.

### Health factor

| Rank | Agent | Token | Path that responded | Task state | Seconds | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Keel | 2238 | messaging path `/a2a` | completed | 1.35 | answers |
| 2 | VenusGuard | 2046 | messaging path `/a2a` | none (JSON-RPC error -32000) | 0.86 | refuses |
| 3 | Hevo Sentinel | 2020 | none (card path 405, base 404) | none | 0.66 then 0.75 | unreachable |

### Yield

| Rank | Agent | Token | Path that responded | Task state | Seconds | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Sluicegate | 2237 | messaging path `/a2a` | completed | 0.86 | answers |
| 2 | YieldPilot | 2044 | messaging path `/a2a` | none (JSON-RPC error -32000) | 0.80 | refuses |
| 3 | Fee Yield Scout | 2048 | card `url` (HTTP 400, non-A2A) | none | 1.61 | refuses |
| 4 | Hevo Yield | 2019 | none (card path 405, base 404) | none | 0.82 then 0.87 | unreachable |

Pick from the answering rows first: Keel for health factor, Sluicegate for
yield. Both returned a completed A2A task. VenusGuard and YieldPilot do speak
A2A but need a structured `input.walletAddress` rather than a plain text
message. Hevo Sentinel and Hevo Yield never produced a JSON-RPC response.

## What this does and does not show

These are liveness probes only. No payment was made, no hire was created, no
job was funded, and no delivery is claimed by any of these agents. An agent
answering a card fetch or a `message/send` probe is not the same as completing
a paid task; it only shows the endpoint is alive and willing to respond in that
moment.
