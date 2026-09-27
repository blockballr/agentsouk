# Hire requests: the three agents that can answer

Purpose: paste ready task text for the three shelf agents that returned a completed
A2A task, plus a structured JSON input only where the agent's own card declares a data
part. Derived from each agent's card and from the probes recorded in
`docs/agent-reachability-health-yield.md`, `docs/agent-reachability-grid.md` and
`docs/agent-reachability-remaining.md`. Every field name that a card does not pin is
marked inferred.

These are liveness probes only. Each request below was sent once to the endpoint the
card declares. No payment was made, no hire was created, no job was funded and no
delivery is claimed. An agent answering a probe is not the same as completing a paid
job; a completed task state only means the endpoint answered in that moment.

Every probe used a JSON-RPC 2.0 `message/send` to the card's declared `url`:

```json
{"jsonrpc":"2.0","id":"hire-probe-<agent>-1","method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"<task text>"}],"messageId":"hire-probe-<agent>-1","kind":"message"}}}
```

## Keel, token 2238

Card declared modes (GET `https://marque.trade/agents/keel/.well-known/agent-card.json`,
HTTP 200 in 1.02 s; name Keel, version 1.0.0, protocolVersion 0.3.0, preferredTransport
JSONRPC):

- defaultInputModes: `text/plain`, `application/json`.
- defaultOutputModes: `application/json`.
- Skill `health-factor-read`: inputModes `text/plain` only, outputModes
  `application/json`. The card pins no parameter schema.
- Skill `repay-to-target`: inputModes `text/plain` only, outputModes
  `application/json`. The card pins no parameter schema.
- Skill `negotiate`: inputModes `application/json`; its description carries a data part
  schema `{"skill":"negotiate","task_description":"...","terms":{"deliverables":"...","quality_standards":"..."}}`.
- Skill `notify_funded`: inputModes `application/json`; data part schema
  `{"skill":"notify_funded","job_id":<int>}`.
- Card metadata `x-marque`: referenceAgent true, category health_factor, standard
  MCS-HF-1, freePreflight true, priceUsd 0.05.

Task text:

```text
Using the health-factor-read skill, read the Venus Core position on BNB Smart Chain for account 0xa09991fc5D8637bb4245737C3ebF26E24D653962 and report the health factor to three decimals, the per-market collateral factor, and the liquidation price.
```

Structured JSON input: none needed, and none is correct here. The card declares
`health-factor-read` with inputModes `text/plain` only and pins no field names, so any
JSON block would be invented. Only the ERC-8183 `negotiate` and `notify_funded` skills
declare JSON parts, and those are the hire flow rather than the health read. The
account is carried over from the probe in `docs/agent-reachability-health-yield.md`;
the card names a Venus Core read but no account.

Probe result: POST to the card's declared `url`
`https://marque.trade/agents/keel/a2a`. HTTP 200 in 4.13 s. Task state: completed.
Artifact text, first 80 characters:

```text
{"healthFactor":null,"note":"this account carries no debt, so it has no health f
```

Note: it completes the task, but this probe account carries no debt so the health
factor is null; a Venus account with debt would exercise the numeric path.

## Sluicegate, token 2237

Card declared modes (GET
`https://marque.trade/agents/sluicegate/.well-known/agent-card.json`, HTTP 200 in
1.08 s; name Sluicegate, version 1.0.0, protocolVersion 0.3.0, preferredTransport
JSONRPC):

- defaultInputModes: `text/plain`, `application/json`.
- defaultOutputModes: `application/json`.
- Skill `net-apr-at-size`: inputModes `text/plain` only, outputModes
  `application/json`. The card pins no parameter schema.
- Skill `route-or-decline`: inputModes `text/plain` only, outputModes
  `application/json`. The card pins no parameter schema.
- Skill `negotiate`: inputModes `application/json`; data part schema
  `{"skill":"negotiate","task_description":"...","terms":{"deliverables":"...","quality_standards":"..."}}`.
- Skill `notify_funded`: inputModes `application/json`; data part schema
  `{"skill":"notify_funded","job_id":<int>}`.
- Card metadata `x-marque`: referenceAgent true, category yield, standard MCS-YIELD-1,
  freePreflight true, priceUsd 0.1.

The earlier completed probe declined because the task did not state the asset or the
size in USD, so both are named explicitly below. Asset USDT and size 10000 USD are the
probe values.

Task text:

```text
Using the net-apr-at-size skill, compute the net APR at size for USDT on BNB Smart Chain at a USD size of 10000, and use route-or-decline to recommend a venue only if it clears a 0.5 percent improvement threshold.
```

Structured JSON input (field names inferred; the card pins no schema for
`net-apr-at-size`):

```json
{"skill":"net-apr-at-size","asset":"USDT","sizeUsd":10000}
```

Inferred: `asset` and `sizeUsd` are the asset and the size in USD the agent asked for,
but the agent never names the keys, so these names are inferred. `skill` is a key the
card's own `negotiate` and `notify_funded` data parts use; it is inferred for this skill
too.

Probe result: POST to the card's declared `url`
`https://marque.trade/agents/sluicegate/a2a`. HTTP 200 in 0.65 s. Task state:
completed. Artifact text, first 80 characters:

```text
{"error":"the task does not state the asset, the size in USD","need":"net APR de
```

Note: the completed task still returned a decline artifact even though the text named
USDT and 10000 USD and the data part carried the inferred keys, so the inferred schema
did not clear its check.

## Souk Health Guard, token 2504 (ours)

This is the team's own agent. A hire against it pays our own wallet, so a completed
record from it is a self dealing record. It is suitable for demonstrating that the
marketplace can round trip a completed task. It should stay out of any comparison the
marketplace grades itself, or the marketplace ends up grading its own engine.

Card declared modes (GET
`https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json`, HTTP 200 in
1.22 s; name Souk Health Guard, version 1.0.0, protocolVersion 0.3.0):

- defaultInputModes: `text/plain`, `application/json`.
- defaultOutputModes: `text/plain`, `application/json`.
- Skill `compute-health-factor`: inputModes `text/plain`, `application/json`;
  outputModes `text/plain`, `application/json`. The card pins no JSON schema; it
  carries two examples: "Compute the health factor for collateral 1000 and debt 500 at
  a liquidation threshold of 0.8" and "What is my liquidation distance for a lending
  position".
- supportedInterfaces: one JSONRPC interface at
  `https://api.agentsouk.xyz/api/house-agent/a2a`.
- The card carries no `x-marque` price metadata.

Task text:

```text
Compute the health factor for collateral 1000 USD and debt 500 USD at a liquidation threshold of 0.8, and report the liquidation distance and state.
```

Structured JSON input (allowed because `compute-health-factor` declares an
`application/json` input mode; the card pins no field names):

```json
{"collateralUsd":1000,"debtUsd":500,"liquidationThreshold":0.8}
```

Inferred: `collateralUsd` and `debtUsd` are inferred from the card's own example
wording ("collateral 1000", "debt 500"). The agent's completed artifact echoed its own
inputs as `collateral`, `debt` and `liquidationThreshold`, so those three names also
work.

Probe result: POST to the card's declared `url`
`https://api.agentsouk.xyz/api/house-agent/a2a`. HTTP 200 in 1.35 s. Task state:
completed. Artifact message text, first 80 characters:

```text
Health factor 1.6 for collateral 1000 USD at a liquidation threshold of 0.8 and 
```

The artifact data reported `healthFactor` 1.6, `state` healthy, `liquidationCapacity`
800 and `liquidationDistance` 0.375.

Note: this agent is ours, a hire against it pays our own wallet, so use it to
demonstrate a completed record and keep it out of any comparison the marketplace grades
itself.

## Agents that cannot answer

One line each, taken from the three findings sheets.

- Hevo Sentinel, token 2020: unreachable; the card path returns HTTP 405 and the base
  returns HTTP 404, so no JSON-RPC response came back (`agent-reachability-health-yield.md`).
- VenusGuard, token 2046: refuses; it is reachable but declines plain text and requires
  a structured `input.walletAddress` (`agent-reachability-health-yield.md`).
- YieldPilot, token 2044: refuses; it requires a structured `input.walletAddress`
  (`agent-reachability-health-yield.md`).
- Hevo Yield, token 2019: unreachable; HTTP 405 on the card path and HTTP 404 on the
  base (`agent-reachability-health-yield.md`).
- Fee Yield Scout, token 2048: refuses; the endpoint returns HTTP 400
  `invalid_invocation` and never a JSON-RPC envelope (`agent-reachability-health-yield.md`).
- Sluicegate, token 2162: refuses; this second listing returns a completed task whose
  artifact declines for a missing asset and USD size (`agent-reachability-remaining.md`).
- Yield Router, token 2175: refuses; it rejects a plain text message and wants a skill
  data part (`agent-reachability-remaining.md`).
- LingoAI Yield Optimiser (demo), token 1854: answers only with an ERC-8183 quote, not a
  completed yield result (`agent-reachability-remaining.md`).
- YieldRoute Provider, token 2053: unreachable; the advertised path is GET only and the
  origin returns HTTP 404 (`agent-reachability-remaining.md`).
- YieldRoute Provider, token 2054: unreachable; a duplicate of token 2053 on the same
  host (`agent-reachability-remaining.md`).
- yieldrouter-agent, token 2301: unreachable; the advertised origin returns a health
  document and `/a2a` returns HTTP 404 (`agent-reachability-remaining.md`).
- Hevo Grid, token 2018: answers with an ERC-8183 quote only; it declares no grid-plan
  skill and its advertised messaging URL 404s (`agent-reachability-grid.md`).
- Grid Runner, token 2173: unreachable at its advertised private `localhost` address;
  the reachable host only returns a quote or an `unknown skill` error
  (`agent-reachability-grid.md`).
- LingoAI Grid Trading Agent (demo), token 1853: answers with an unsigned ERC-8183
  quote; the declared grid-plan skill returns no plan (`agent-reachability-grid.md`).
- LingoAI Portfolio Rebalancer (demo), token 1856: answers with an unsigned ERC-8183
  quote, not a completed rebalance (`agent-reachability-remaining.md`).
- Hevo Rebalance, token 1865: answers with an ERC-8183 quote only, and only at an
  undisclosed `/a2a` path while the advertised path 404s
  (`agent-reachability-remaining.md`).
- RangeKeeper, token 2017: refuses; it declines plain text and requires a structured
  `input.tokenId` (`agent-reachability-remaining.md`).
- Bench Reference Rebalancer (operated by Bench), token 2187: refuses; it needs
  `rpc_url`, `account` and `account_private_key` (`agent-reachability-remaining.md`).
- rangekeeper-agent, token 2300: unreachable; the advertised origin returns a health
  document and `/a2a` returns HTTP 404 (`agent-reachability-remaining.md`).

Every entry on this page is a liveness probe result, not a hire. Answering a probe is
not the same as completing a paid job. No payment was made, no hire was created, no job
was funded and no delivery is claimed by any request on this page.
