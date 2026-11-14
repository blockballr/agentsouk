# Altana

Altana is the session layer Agent Souk uses for vault execution. It gives an agent a scoped,
revocable permission on a smart account instead of a private key, and it runs the call through a
relay. This document covers what Altana is, how the integration works, what is live, and what is
still open.

## What Altana is

Altana provides non-custodial smart agentic wallets with on-chain session-key delegation on BNB
Chain. A session is an on-chain permission:

- **Allowed calls.** Only the contracts and functions named in the grant can be called.
- **Spend cap.** A token amount per period (hour, day, and so on). The accounting accumulates.
- **Expiry.** The grant lapses on its own.
- **Revocation.** The owner can revoke it before expiry.

The wallet owner keeps the admin key. The agent gets a session key that can only do what the grant
allows. The SDK also covers wallet creation (passkey or private key), relay execution, x402
payments with Permit2 or EIP-3009 and ERC-1271 signatures, and an atomic ERC-8183 buyer flow
(`hireErc8183Agent`).

## Why Agent Souk uses it

A vault hire has two questions, and the integration answers them on two layers:

| Layer | Question | What enforces it |
|---|---|---|
| Altana session | Who may initiate, and how much per period | The smart account and the relay |
| HireVault | What may move, for this hire only | The vault contract |

The session keeps the executor from holding a raw key over the whole account. The vault keeps one
hire from touching another hire's deposit, caps the drawdown, and records every trade on chain.
Neither layer replaces the other.

## Where it lives in the code

| File | Role |
|---|---|
| `package.json` | `@altananetwork/sdk` 0.9.0 |
| `src/lib/vault-actor.ts` | Resolves a raw-key or Altana actor, and sends a trade through `client.execute` |
| `src/lib/altana-store.ts` | Stores per-agent sessions in Postgres, with a local file fallback |
| `src/lib/session-scope.ts` | Reads the granted scope, checks expiry, and marks a session stale |
| `src/lib/session-renewal.ts` | Re-grants sessions that are near expiry or stale after a vault redeploy |
| `src/app/api/vault/sessions/route.ts` | Operator sync: writes sessions to the DB and reports scope without keys |
| `src/app/api/vault/executor/route.ts` | Public read of the executor kind, addresses, and vault |
| `src/app/api/cron/sessions/route.ts` | Daily renewal run |
| `src/lib/jobs8183.ts` | Reads ERC-8183 kernel addresses and the deliverable URL from the SDK |
| `scripts/setup-altana*.mjs` | Grant a session for one agent, or for each agent in a list |
| `scripts/sync-altana-to-db.mjs` | Push local session records into the production DB |
| `tests/altana-spend-scope.test.ts` | On-chain proof of the spend cap and the price floor on BSC testnet |

The buyer-facing pages read the executor from `/api/vault/executor`: `VaultHirePage` and
`AgentDetailPage` show an Altana mark when `kind` is `altana`.

## The session record

The production store is the `altana_sessions` table in Postgres:

| Column | Meaning |
|---|---|
| `token_id` | The ERC-8004 agent the session belongs to |
| `chain_id` | 56 or 97 |
| `label` | Operator label |
| `wallet_address` | The smart account the session acts for |
| `session_blob` | The serialized granted session |
| `session_key` | The session key, server only |
| `admin_key` | Kept for renewal, server only |
| `expiry` | Unix seconds |
| `created_at` | Timestamp |

`GET /api/vault/sessions` never returns `session_key` or `admin_key`. It returns the token, the
wallet, the expiry, and the scope, plus a `stale` list for the scheduler. The local file
`data/altana-sessions.json` is a development fallback only.

## Scope and cap

The renewal grant in `src/lib/session-renewal.ts` names four vault functions:

```text
trade(uint256,address,uint256,uint256)
supplyToVenue(uint256,address,uint256)
withdrawFromVenue(uint256,address,uint256)
closeIfGoal(uint256,uint256)
```

It also sets a spend limit (1 U by default, configurable through the setup scripts) and a 30 day
expiry. The grant names functions rather than a vault address, so a vault redeploy does not
invalidate it, and the vault still bounds every call it receives.

Operational detail worth knowing, proved in `tests/altana-spend-scope.test.ts`:

- The spend window is keyed per account, session key, token, and period, and accumulates across
  runs. A long lived key burns its budget once and stays spent for the period.
- Raising the cap with `setSpendLimit` overwrites the limit but preserves `spent`.
- Shortening the period only adds a period, so an exhausted row remains fatal.
- Revoking the session clears the budget. That is the clean reset.
- `ExceededSpendLimit` means a permission matched and the limit was hit. `NoSpendPermissions`
  means nothing matched. They are different failures.
- The price floor is separate from the cap. A cap stops a drain; the floor stops a bad fill.

## ERC-8183

The marketplace does not hardcode the kernel. `src/lib/jobs8183.ts` reads `commerce`, `router`,
`policy`, and `paymentToken` from `erc8183Addresses(chainId)`, and builds the deliverable URL with
`getErc8183DeliverableUrl`. That keeps the job rail on the same kernel Altana deploys, including
when the addresses change.

The SDK's own `hireErc8183Agent` is not used today: Agent Souk runs the negotiate, fund, deliver,
and release steps itself so the flow can enforce its own seller checks and receipts.

## What is live

As of 14 November 2026:

- Production runs `AGENT_EXECUTOR_ACTOR=altana`. `GET /api/vault/executor` returns
  `kind: "altana"` and three executor addresses.
- Per-agent sessions are stored in Postgres and read by the vault sweep.
- `POST /api/vault/sessions` and `scripts/sync-altana-to-db.mjs` write records.
- The daily `/api/cron/sessions` run renews sessions near expiry or stale after a vault redeploy.
- The spend cap and price floor are proven on BSC testnet, not only described.

## What is not live

- Custom agents composed in the builder do not receive an Altana session yet. `venue-adapter.ts`
  still supports only the vault swap, not LP or Altana execution.
- There is no owner-facing UI to grant or revoke a session. The operator scripts and the
  `/api/vault/sessions` endpoint are the current surface.
- The SDK's x402 `fetchWithX402` helper is not used. The direct call rail uses its own EIP-3009
  authorization and the escrow funder.
- The SDK's ERC-8183 buyer helper is not used, as above.

## Security notes

- Session and admin keys are server only. They never reach the browser and are never returned by
  the session read.
- The session is a second line of defence, not a replacement for the vault bounds. A compromised
  session can still only call the four vault functions, under the cap, until revocation.
- Revoke and re-grant after key rotation or a suspected leak. Revocation is also the clean way to
  reset a spent budget.
- A relay reply is not a transaction hash. `callsId` is a bundle handle. The executor refuses a
  trade with no `transactionHash`, and reports `FAILED` with the relay's status code.
- One runner holds a hire through a lease, so two sweeps cannot trade the same hire at once.

## Operating it

Grant or refresh sessions with the scripts:

```bash
node scripts/setup-altana-session.mjs
node scripts/setup-altana-per-agent.mjs
node scripts/sync-altana-to-db.mjs
```

Read the current scope without keys:

```bash
curl -H "authorization: Bearer $CRON_SECRET" \
  "https://api.agentsouk.xyz/api/vault/sessions?chainId=56"
```

The same secret pair (`VAULT_SECRET` or `CRON_SECRET`) protects the sync endpoint and the vault
executor.

## Questions for Altana

- Relay uptime, retry behaviour, and the failure modes beyond `FAILED` and `statusCode`.
- Their recommended revocation and renewal flow when one operator runs many agents.
- The ERC-8183 kernel roadmap and compatibility with a marketplace that funds the shared kernel
  itself.
- x402 and Permit2 support for buyer agents, beyond the seller-side call rail.
- A partner or credits path for a marketplace that already runs their session layer in production.
