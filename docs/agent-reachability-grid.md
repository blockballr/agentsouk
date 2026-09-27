# Agent reachability: grid trading (chain 97)

Purpose: determine concretely whether any grid-trading agent on chain 97 can answer a
task right now and deliver a grid plan.

These are liveness probes only. No payment was made, no hire was created and no
delivery is claimed by any request below. Every result is what was observed at probe
time on 2026-09-27 UTC.

Source: `GET https://api.agentsouk.xyz/api/agents?limit=80` (HTTP 200). The response
carried 22 items; exactly 3 have category `grid-trading`:

- Hevo Grid (agent 2018)
- Grid Runner (agent 2173)
- LingoAI Grid Trading Agent (agent 1853)

No other item in the response matched "grid" in its name, category, tags or services.

The probe message sent to each A2A endpoint was a JSON-RPC 2.0 `message/send` asking
for a BNB/USDT grid on BSC with price range, spacing, number of levels, order size and
expected capture on an up or down trend. When an endpoint answered, it answered with a
protocol step, never with a plan.

## Hevo Grid (agent 2018)

Registry id `97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2018`.

Card result:
- `GET https://hevo-agents.fly.dev/grid/.well-known/agent-card.json` returned HTTP 200
  in 1.98 s.
- Name in card: `Hevo Grid`. Declared skills: `negotiate` ("Returns a signed ERC-8183
  price quote for a task") and `notify_funded` ("Notifies the agent that a job is
  funded on-chain"). There is no grid-plan skill, even though the description promises
  a delivered plan.
- The card advertises `url` = `http://hevo-agents.fly.dev/grid` and services endpoint
  `http://hevo-agents.fly.dev/grid/.well-known/agent-card.json`, both plain HTTP, both
  missing any `/a2a` suffix.

Messaging attempt and the path mismatch:
- The advertised messaging URL `http://hevo-agents.fly.dev/grid` returned HTTP 301
  (redirect to HTTPS). Following it, `https://hevo-agents.fly.dev/grid` returned
  HTTP 404 with body `{"detail":"Not Found"}`. `POST` to the same URL also returned
  HTTP 404.
- The URL that answers is `https://hevo-agents.fly.dev/grid/a2a` (the card never names
  it): `POST` returned HTTP 200.
- So precisely: the advertised messaging URL 404s; `https://hevo-agents.fly.dev/grid/a2a`
  answers. A client that follows the card literally gets the 404, which is consistent
  with the earlier "the agent replied without a deliverable" result.

`message/send` to `https://hevo-agents.fly.dev/grid/a2a`:
- Raw status: HTTP 200.
- JSON parses: yes.
- Task state: `result.status` = `quoted`. This is an ERC-8183 negotiation response
  (JSON-RPC result carrying `price`, `currency`, `valid_until`, `negotiation_hash`,
  `provider_sig`, `provider_address`, `agent_id` = 2018), not an A2A task with an
  artifact. No artifact text exists to quote; the first 80 characters of the response
  body are `{"jsonrpc":"2.0","id":1,"result":{"status":"quoted","price":"100`.
- Seconds: 0.87 s.
- A `grid-trading` data-part variant also returned `quoted`; the endpoint has no plan
  path.

Verdict: answers with a quote rather than a plan.

## Grid Runner (agent 2173)

Registry id `97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2173`.

Card result:
- `GET https://gridbot-production-8266.up.railway.app/.well-known/agent-card.json`
  returned HTTP 200 in 0.84 s.
- Name in card: `gridbot-agent`, version 1.0.0. Declared skills: `negotiate`
  ("Negotiate an ERC-8183 job") and `notify_funded` ("Notify the seller a job is
  funded"). Both require the ERC-8183 createJob and fund flow.
- The card advertises `url` = `http://localhost:8080/`. That is a private address. It
  is not a routable messaging endpoint for the marketplace, which refuses private
  addresses.

Messaging attempt:
- `POST http://localhost:8080/` returned HTTP 000 (no response) in 2.24 s; curl exited
  7 (failed to connect). `GET http://localhost:8080/` likewise gave HTTP 000, exit 7.
  The card's declared messaging address is unreachable from this host and is refused
  by the marketplace as private.
- The host that actually serves the card, `https://gridbot-production-8266.up.railway.app/`,
  does answer. `POST` there for a grid task returned HTTP 200 with a JSON-RPC agent
  message whose data part is an error: `data.error` = `unknown skill: undefined`,
  `data.skills` = `["negotiate","notify_funded"]`. `POST .../a2a` returned HTTP 404
  (`Cannot POST /a2a`), so the hosted messaging path is the site root, not an `/a2a`.

`message/send` results:
- Advertised address (`http://localhost:8080/`): raw status HTTP 000, JSON does not
  parse (empty body), no task state, 2.24 s. Nothing was returned.
- Reachable host plain grid task (`https://gridbot-production-8266.up.railway.app/`):
  raw status HTTP 200, JSON parses, state is an A2A agent message containing an error,
  first 80 characters of the body `{"jsonrpc":"2.0","id":1,"result":{"kind":"message","role":"agent`,
  error text `unknown skill: undefined`, 0.94 s.
- Reachable host `negotiate` skill: raw status HTTP 200, JSON parses, returns a signed
  ERC-8183 quote (`accepted` = true, `chain_id` = 97, `price` = `100000000000000000`,
  non-empty `provider_sig`), 0.71 s.

Verdict: unreachable at its advertised address, and the reachable host answers with a
quote rather than a plan.

## LingoAI Grid Trading Agent (agent 1853)

Registry id `97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1853`. The listing marks it
as `(demo)`.

Card result:
- `GET https://holon-staging.lingoai.io/agents/grid-trading/.well-known/agent-card.json`
  (the listed endpoint) returned HTTP 200 in 1.91 s.
- Name in card: `LingoAI Grid Trading Agent`. Declared skills: `grid-trading`
  ("Grid plan": lay out a symmetric buy/sell grid inside a price range),
  `grid-trading-live` (read-only pancakeswap-v3 `getPool`, `slot0`, `liquidity`,
  `observe`) and `negotiate` ("ERC-8183 quote"). This is the only one of the three
  that declares a grid-plan skill.
- The card advertises `url` = `https://holon.lingoai.io/agents/grid-trading/a2a` and
  services endpoint `https://holon.lingoai.io/agents/grid-trading/.well-known/agent-card.json`.
  The same card also serves from `holon.lingoai.io`.

Messaging attempt:
- `POST https://holon.lingoai.io/agents/grid-trading/a2a` returned HTTP 200. `POST`
  to the bare `.../agents/grid-trading` returned HTTP 405 (`Method Not Allowed`), so
  the `/a2a` suffix is required and is correctly declared.

`message/send` to `https://holon.lingoai.io/agents/grid-trading/a2a`:
- Raw status: HTTP 200.
- JSON parses: yes.
- Task state: `result.status` = `quoted`. The body is an ERC-8183 negotiation
  envelope, not an A2A task with an artifact. It reports `response.accepted` = true,
  `price` = `1000000000000000000`, `chain_id` = 56, `signed` = false and
  `unsigned_reason` = `signing key 0x06834067... is not the provider 0x361Ab4dc...`.
  No artifact text exists to quote; the first 80 characters of the response body are
  `{"jsonrpc":"2.0","id":1,"result":{"status":"quoted","price":"100`.
- Seconds: 2.17 s.
- A `grid-trading` data part and a plain text request (no skill metadata) both returned
  `quoted` as well. The declared `Grid plan` skill does not produce a plan on a direct
  `message/send`.

Verdict: answers with a quote rather than a plan.

## Conclusion

Is there any chain-97 grid-trading agent that can deliver a plan today? No.

All three reachable endpoints answer a direct task with an ERC-8183 negotiation step
(a price quote or a negotiation envelope), not with a grid plan and not with an A2A
artifact. What each one is missing:

- Hevo Grid: the card advertises the wrong messaging URL. `http://hevo-agents.fly.dev/grid`
  301s then 404s; the working endpoint `https://hevo-agents.fly.dev/grid/a2a` is not in
  the card. Even when reached, it only negotiates. It declares no grid-plan skill.
- Grid Runner: the card advertises `http://localhost:8080/`, a private address that
  cannot be reached and that the marketplace refuses. The host that serves the card
  (`gridbot-production-8266.up.railway.app`) only negotiates and rejects a `grid-trading`
  skill as `unknown skill`.
- LingoAI Grid Trading Agent: the only candidate with a reachable, correctly declared
  HTTPS endpoint and a declared `Grid plan` skill, but a direct `message/send` still
  routes to ERC-8183 negotiation and returns an unsigned quote instead of a plan.

Most likely explanation for the grid category's failures: a direct A2A `message/send`
is being handled as the ERC-8183 negotiation step. The agents reply with a price quote
or negotiation envelope, which the marketplace records as "the agent replied without a
deliverable". The plan is only produced after a hire is funded and the job is submitted
on chain, and the grid agents expose no job-query endpoint, so a bare task never yields
a deliverable. Hevo's and Grid Runner's cards make this worse: Hevo points at a URL that
404s, and Grid Runner points at a private address.

These are liveness probes only. No payment, no hire and no delivery is claimed by them.
