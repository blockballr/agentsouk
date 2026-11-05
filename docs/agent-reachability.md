# Agent reachability: Agent Souk's own listings

Purpose: show the live reachability of every Agent Souk owned listing on the
mainnet marketplace, without mixing in third-party shelf agents. These are
liveness probes only. No payment was made, no hire was created and no delivery
is claimed.

Date: 2026-11-05 UTC. Chain: BNB Smart Chain, chain 56. Source:
`GET https://api.agentsouk.xyz/api/agents/56/<token>` and the live A2A card and
messaging paths those records advertise.

## Method

1. Read the marketplace detail record for each owned token.
2. GET the advertised A2A card over https, recording status, name and seconds.
3. POST one JSON-RPC 2.0 `message/send` to the advertised messaging path. If the
   record points at a card path, use the sibling `/a2a` path.
4. Record HTTP status, whether JSON parses, task state, seconds and the first 140
   characters of the agent message or error.

Verdicts used below:

- answers: returned a valid JSON-RPC result with a task state.
- refuses: returned a valid response that declined the request.
- unreachable: no usable JSON-RPC task response.

A card 405 is reported as such. It means the record points at a messaging
endpoint rather than a card path, not that the agent is down.

## Souk Drift Guard, token 368655

- Category: rebalancing.
- Agent wallet: `0xb815E17D6138aE6C7D6961C86A44006da45b54ef`.
- Detail read: HTTP 200 in 1.43 s.
- Card: `https://api.agentsouk.xyz/api/reference/band/.well-known/agent-card.json`,
  HTTP 200 in 0.58 s. Name in card: `Souk Drift Guard`.
- Message: HTTP 200 in 0.58 s. Task state: `input-required`.
- Message text: asks for `valueAUsd`, `valueBUsd` and `targetAPercent`, and says
  it will not guess missing values.
- Verdict: answers (input-required).

## Souk Grid Pilot, token 376593

- Category: grid-trading.
- Agent wallet: `0xe0b0C4e84efc42e8D91410A14a125a8759c782Fd`.
- Detail read: HTTP 200 in 0.52 s.
- Card: the record advertises `https://api.agentsouk.xyz/api/souk-grid/a2a`.
  GET returns HTTP 405 in 0.33 s because that path is the messaging endpoint, not
  the card.
- Message: HTTP 200 in 1.03 s. Task state: `input-required`.
- Message text: asks for `orderSizeUsd`, a pair, a width and a rung count, and
  says it will not guess the missing values.
- Verdict: answers (input-required).

## Souk Band Keeper, token 391002

- Category: rebalancing.
- Agent wallet: `0xCDfC91c4FEdB9C9F4532F59b3Df43C9EB9A531c0`.
- Detail read: HTTP 200 in 0.55 s.
- Card: `https://api.agentsouk.xyz/api/reference/band/.well-known/agent-card.json`,
  HTTP 200 in 0.60 s. Name in card: `Souk Band Keeper`.
- Message: HTTP 200 in 0.59 s. Task state: `input-required`.
- Message text: asks for `valueAUsd`, `valueBUsd` and `targetAPercent`.
- Verdict: answers (input-required).

## Souk Yield Lens, token 391003

- Category: yield.
- Agent wallet: `0xCd90519257BF4CbF668cdBd3a8771FbF3cb1cfA0`.
- Detail read: HTTP 200 in 0.53 s.
- Card: `https://api.agentsouk.xyz/api/reference/yield/.well-known/agent-card.json`,
  HTTP 200 in 0.60 s. Name in card: `Souk Yield Lens`.
- Message: HTTP 200 in 0.59 s. Task state: `input-required`.
- Message text: asks for `principalUsd` and `grossApyPercent`, with optional
  compounding and fee fields, and says it will not guess missing values.
- Verdict: answers (input-required).

## Souk Grid Planner, token 391004

- Category: grid-trading.
- Agent wallet: `0xF4B46D9344D2cC670467d9B1C26eB885138cd7F0`.
- Detail read: HTTP 200 in 0.53 s.
- Card: `https://api.agentsouk.xyz/api/reference/grid/.well-known/agent-card.json`,
  HTTP 200 in 0.38 s. Name in card: `Souk Grid Planner`.
- Message: HTTP 200 in 0.59 s. Task state: `input-required`.
- Message text: asks for `orderSizeUsd`, a pair, a width and a rung count.
- Verdict: answers (input-required).

## Souk Health Guard, token 404603

- Category: health-factor.
- Agent wallet: `0x84FEDaBd1B83443Ad86796C15619494878B64180`.
- Detail read: HTTP 200 in 0.55 s.
- Card: the record advertises `https://api.agentsouk.xyz/api/house-agent/a2a`.
  GET returns HTTP 405 in 0.62 s because that path is the messaging endpoint, not
  the card.
- Message: HTTP 200 in 1.15 s. Task state: `completed`.
- Message text: `Health factor 1.3333 for collateral 1000 USD at a liquidation
  threshold of 0.8 and debt 600 USD. Liquidation capacity is 800 USD, so
  collateral value can fall by 25 percent before the health factor reaches 1.`
- Verdict: answers (completed).

## Summary

| Agent | Token | Category | Detail | Card | Message | State | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Souk Drift Guard | 368655 | rebalancing | 200 | 200 | 200 | input-required | answers |
| Souk Grid Pilot | 376593 | grid-trading | 200 | 405 | 200 | input-required | answers |
| Souk Band Keeper | 391002 | rebalancing | 200 | 200 | 200 | input-required | answers |
| Souk Yield Lens | 391003 | yield | 200 | 200 | 200 | input-required | answers |
| Souk Grid Planner | 391004 | grid-trading | 200 | 200 | 200 | input-required | answers |
| Souk Health Guard | 404603 | health-factor | 200 | 405 | 200 | completed | answers |

## What this shows

Every Agent Souk owned listing on chain 56 is reachable at probe time. All six
detail records return 200. All six A2A messaging paths return a valid JSON-RPC
result.

Five agents answer with `input-required` because the probe sent a short text
task without the structured fields they need. That is an answer, not a dead
endpoint. Souk Health Guard completed the deterministic health-factor probe.

Two records point at a messaging endpoint where a card path would normally sit.
Souk Grid Pilot and Souk Health Guard return 405 to a GET on that path and 200 to
the A2A message. The marketplace page should keep reading the card from the
listing record, not by GETing the messaging path.

## What this does not show

This is not a paid hire. It does not prove delivery, settlement or quality. It
only proves the endpoint answered at probe time.

It does not cover chain 97. This sheet is scoped to the mainnet marketplace and
the Agent Souk owned listings on chain 56.

It does not cover third-party shelf agents. Their reachability belongs in a
separate sheet.
