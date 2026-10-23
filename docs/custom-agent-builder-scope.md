# Custom agent builder scope

Status: accepted for handoff. This is a scope, not a build. Another agent starts
the first proof from this document.

## Priority

The primary focus is **hirer-funded execution**. The agent acts on the hirer's
capital through Vault or Altana, inside declared bounds, with receipts and
refusals.

The agent-funded lane is the proof and onboarding path. It validates the
builder, deployment, wallet, endpoint, and listing. It is not the marketplace
product.

The order follows from that: prove agent-funded once, then put the main effort
into the hirer-funded path.

## The problem

The current builder composes read-only advice agents from approved blocks. It
cannot produce an agent that opens a long-range LP position, rebalances a
position on another venue, or takes any other action the runner does not
already know.

That is a product gap, not a prompt gap. Adding more blocks will not close it.
The builder needs a second lane that can deploy real execution code.

## The decision

Split the builder into two lanes.

### Lane 1: Strategy builder

The existing safe path, rebuilt around policy declarations instead of advisory
blueprints.

- Policy: Band, Buffer, or Sentinel.
- Inputs: capital bounds, drawdown, cost cap, trigger, venue, revoke window.
- Execution: the shared runner, inside Vault or Altana bounds.
- Output: a policy-backed listing with receipts and refusals.

This lane stays constrained. It is the default for users who want a working
agent without writing code.

### Lane 2: Custom agent builder

The new path for arbitrary on-chain actions.

- The user describes the agent, brings code, or starts from a generated
  scaffold.
- The builder packages the project and deploys it to the user's own CreateOS
  principal.
- The agent runs with its own endpoint and, where needed, its own wallet or
  session.
- The marketplace lists, hires, and verifies the agent. It does not run the
  user's code as trusted code.

This is the lane that can open a long-range LP position in another venue,
because the agent's own code calls that venue.

## What the marketplace is for

An agent with its own capital does not need the marketplace to execute. It can
run on its own wallet and its own venue without listing anywhere.

The marketplace earns its place by connecting agents that can act for other
people with hirers who have capital. That is the core product.

So the two lanes have different jobs:

- The agent-funded lane proves the builder, deployment, endpoint, wallet, and
  listing pipeline. It is an onboarding and proof path.
- The hirer-funded lane is the marketplace product. The agent acts for the
  hirer, and Vault or Altana supplies the authority and the bounds.

An agent-funded agent can still list and be hired, but it is selling a service,
a track record, or capacity. It is not asking the marketplace for capital. If
the marketplace gives it none of those things, it has no reason to list.

## The boundary that matters

There are two funding models, and they are not interchangeable.

### Agent-funded actions

The agent acts with its own wallet or a session granted to it. It may call any
contract the host allows. The user accepts the risk of the code and the key.

The agent can still be listed and hired. The hire pays for the service. It does
not hand the agent the hirer's capital, so no capital escrow is needed. The
service fee can still be escrowed. Capital escrow and payment escrow are
different things.

The marketplace does not custody these funds. It lists the agent and records
what the agent proves it did.

But an agent with its own capital does not need the marketplace to execute. It
should list only if the marketplace gives it distribution, demand, a verifiable
record, or access to more capital. If it gives none of those, the agent has no
reason to appear.

### Hirer-funded actions

This is the marketplace's core case. The agent acts on the hirer's capital
through Vault or Altana.

- Vault: the deposit is bounded by the contract, and only declared actions are
  allowed.
- Altana: the session is bounded by spend caps and delegation rules.
- Arbitrary calldata is not allowed by default. A new action needs an allowlist
  entry, a venue adapter, or a contract change.

The long-range LP example belongs here only after the vault or session can name
and bound that action. Until then, the custom agent can do it with its own
funds, not the hirer's. That proves the pipeline. It does not yet prove the
marketplace product.

## Payment and delivery

A hire has two separate questions:

- Who owns the capital the agent acts on?
- When does the agent get paid for the service?

The answer to the first does not settle the second.

### x402 direct payment

The hirer pays at the call. There is no delivery guarantee on chain.

Use it only for low-stakes work where the caller can check the result
immediately, or where the agent's reputation is the real protection.

Do not use it for work that needs a guaranteed deliverable.

### ERC-8183 job escrow

The hirer quotes, funds the job, and the agent delivers. The escrow releases
on delivery or returns on expiry or rejection.

This is the path for a deliverable that matters.

The agent-funded model only changes the trading capital. It does not remove
the need for job escrow when the hirer is paying for a result.

### The custom agent manifest should declare this

Every custom agent declares:

- `payment`: `x402` or `job`
- `deliverable`: what the hirer receives
- `release`: what the hirer accepts before funds release

An agent that only trades its own capital and sells no deliverable is not a
job seller. It can still be listed as a service, but the listing must say what
the hirer is actually buying.

Reputation and repeat demand are incentives. They are not enforcement. If the
result matters, use job escrow.

## What the custom builder collects

A custom agent project needs a manifest before it can be deployed or listed.

```json
{
  "name": "Range LP opener",
  "category": "rebalancing",
  "description": "Opens and manages a long-range LP position on a named venue.",
  "runtime": "node20",
  "entrypoint": "dist/server.js",
  "endpoint": "/a2a",
  "wallet": "agent",
  "payment": "job",
  "deliverable": "An open LP position with the range, amount, and tx hash",
  "release": "The position exists on chain and the tx hash matches the range",
  "actions": [
    {
      "name": "open-range",
      "venue": "venue-name",
      "contracts": ["0x..."],
      "functions": ["openPosition"],
      "maxValueUsd": 500
    }
  ],
  "env": ["RPC_URL"],
  "healthcheck": "/health"
}
```

The manifest is the contract between the builder, the host, and the listing.

It answers:

- what the agent claims to do
- where it runs
- how it is called
- what it may call
- whose funds it uses
- how it gets paid and what counts as delivery
- what it needs in the environment
- how the marketplace checks that it is alive

## Deployment path

1. User connects a wallet.
2. User chooses a template or brings a repository.
3. Builder validates the manifest and runs the build.
4. Builder creates or reuses the user's CreateOS principal.
5. Builder uploads the build and sets environment variables.
6. Builder triggers the deployment.
7. Builder waits for a health check and a test call.
8. Builder registers the endpoint and prepares the ERC-8004 listing.
9. The user sends the registration transaction from their own wallet.
10. The marketplace checks the registration, the endpoint, and the activity
    proof before the listing is shown.

The marketplace may prepare the registration. It never sends it for the user.

## Where the code runs

The marketplace has two supported options, in order of preference.

### Option A: User-hosted on CreateOS

This is the default.

- One CreateOS principal per marketplace wallet.
- The user's code runs in the user's project.
- The marketplace holds a CreateOS API key only to deploy and read logs.
- The agent's wallet key lives in the user's project environment, never in the
  marketplace database.
- The marketplace can revoke its deployment access without touching the agent.

This avoids running untrusted code inside the marketplace.

### Option B: Marketplace-hosted sandbox

This is optional and later.

Only build it if users cannot bring their own host.

- Firecracker microVMs or gVisor containers.
- No marketplace secrets inside the sandbox.
- Agent-scoped key only, never the hirer's key.
- Allowlisted RPC and outbound network.
- CPU, memory, time, and disk limits.
- Ephemeral filesystem.
- Seccomp and AppArmor profiles.
- Per-run receipts and logs.
- A kill switch that stops the deployment and revokes its key.

An SDK is not a sandbox. Bundling user code into the SDK does not isolate it.

## Listing and proof

A custom agent is listable only when it can answer the same standard as any
other listing.

- A real ERC-8004 registration owned by the builder's wallet.
- A public endpoint that answers.
- A declared example that returns a real result.
- Five contract actions on three distinct days, excluding transfers,
  approvals, ERC-8004 registry writes, and ERC-8183 deliveries.
- If activity cannot be read, the listing says why. It never shows a false
  zero.

For an execution agent, the activity must come from the agent's own wallet or
from a hire the agent was named on. A response with no action is not proof of
execution.

## Builder UI

The builder should ask for outcomes, not protocol words.

1. What should this agent do?
2. Whose funds does it use?
3. Which venue or contracts does it touch?
4. What is the maximum it may spend per action and per hire?
5. How is it stopped?
6. Where should it be hosted?
7. What example proves it works?

The review step shows:

- the generated manifest
- the contracts and functions it may call
- the wallet model
- the deployment target
- the listing proof it still needs

## API surface

- `POST /api/builder/custom/validate` validates the manifest and project.
- `POST /api/builder/custom/build` builds the project.
- `POST /api/builder/custom/deploy` deploys to the user's CreateOS project.
- `GET /api/builder/custom/status` returns build and deployment status.
- `POST /api/builder/custom/register` prepares the ERC-8004 registration.
- `GET /api/builder/custom/agent/:id` returns the deployed endpoint and
  listing state.

Every route is wallet-authenticated and scoped to the caller's principal.

## Security rules

- The marketplace never holds a hirer's private key.
- The marketplace never runs user code without isolation.
- The marketplace never sends a registration transaction for the builder.
- A deployment key is scoped to one principal and can be revoked.
- A custom agent cannot spend hirer funds unless the vault or session names the
  action and the cap.
- A custom agent cannot be listed on a claim alone. It needs an endpoint and
  activity proof.
- Logs are redacted before they leave the host.

## Milestones

| # | Milestone | Scope | Exit criteria | Status |
| --- | --- | --- | --- | --- |
| C1 | Custom manifest | Schema, validation, example project | A manifest validates and a sample project builds | Not started |
| C2 | CreateOS deploy | Principal lookup, upload, env, trigger, logs | A sample agent deploys and answers its health check | Not started |
| C3 | Builder UI | Custom lane, manifest review, deployment status | A user can go from description to deployed endpoint | Not started |
| C4 | Agent wallet | Agent-scoped key in the user's project, rotation, revoke | A deployed agent sends one transaction from its own wallet | Not started |
| C5 | Listing and proof | Registration preparation, endpoint check, activity gate | A custom agent is listed with five actions on three days | Not started |
| C6 | Hirer-funded actions | Vault or Altana action allowlist for a named venue | A custom agent performs one bounded action with hirer funds | Not started |
| C7 | Sandbox, optional | Firecracker or gVisor host | A sample agent runs with no marketplace secrets and a hard limit | Deferred |

## Implementation sequence

The order is deliberate. The builder UI is not the first step. The proof is.

1. **First proof: one custom agent, one on-chain action.**
   C1 and C2. Build the manifest, build one sample project, deploy it to a
   test CreateOS principal, and send one transaction from the agent's own
   wallet on testnet.
2. **Builder UI.**
   C3. Only after the proof returns. The UI configures the path that already
   works instead of inventing one.
3. **Agent wallet and listing.**
   C4 and C5. The agent owns its key. The listing needs a real endpoint and
   real activity.
4. **Hirer-funded action.**
   C6. Add the first venue action through Vault or Altana, with caps and
   allowlists. This is the primary product focus, not an optional phase. It
   gets its own security review.
5. **Sandbox, optional.**
   C7. Only if the marketplace must host code. User-hosted CreateOS remains
   the default.

Do not start with the policy library or the sandbox. Both are larger than the
first proof and neither is needed to prove that a builder-created agent can act
on chain.

The first proof is a pipeline proof, not the product. It proves that a
builder-created agent can deploy and act on chain with its own funds. It does
not prove that hirers will use the marketplace, because the agent does not need
hirer capital for that run.

## First proof handoff

The next agent starts here. The goal is evidence, not a full builder. This is
an agent-funded proof. It does not prove demand or the hirer-funded product.

### What to build

- One manifest for one custom agent.
- One sample project that opens a long-range LP position on one named venue.
- One CreateOS deployment on testnet or a test principal.
- One transaction from the agent's own wallet.
- One receipt that names the venue, the action, the amount, the tx hash, and
  the block.

### What to prove

- The project builds from the manifest.
- It deploys to CreateOS through the existing client.
- The endpoint answers a health check.
- The agent sends the transaction from its own wallet, not the marketplace's.
- The action is visible on chain.
- The listing can read the action as proof.
- Revoking the deployment stops the agent.

### What not to do

- Do not wire the builder UI yet.
- Do not use hirer funds.
- Do not add a vault contract or a new action type.
- Do not run user code inside the marketplace.
- Do not list the agent on a claim alone.
- Do not present the agent-funded proof as the marketplace product.

### Deliverable

A short proof report with:

- the manifest
- the project path
- the deployment URL and principal
- the transaction hash and block
- the endpoint response
- the activity read
- anything that blocked the run

If the proof fails, the report says why. A failed proof is more useful than a
builder UI built on an unproven assumption.

## Out of scope

- Running arbitrary user code inside the marketplace API.
- A new vault contract in this scope.
- Custody of hirer funds by the marketplace.
- A per-agent bot fork in the shared runner.
- Listing an agent on a description alone.
- Counting transfers, approvals, registry writes, or deliveries as execution
  proof.
- A second marketplace surface for custom agents.

## Open questions

- Does the custom lane use the user's CreateOS account, a marketplace-owned
  principal, or both?
- Which wallet model is the default for custom agents: agent-owned key, Altana
  session, or vault-named agent?
- Which venue is the first long-range LP adapter, and does it need a vault
  action type or can it run on agent funds first?
- What is the maximum project size and build time for a free principal?
- Who pays for hosting after the trial, and how is that shown before deploy?

## Verification

- A sample custom agent builds and deploys to CreateOS.
- Its endpoint answers a health check and a real task.
- It sends one transaction from its own wallet.
- The listing shows five contract actions on three distinct days, or a named
  reason it cannot.
- A hirer-funded action is bounded by the vault or session and writes a
  receipt.
- Revoking the deployment stops the agent.
- `npx tsc --noEmit`, `npm run build`, and `node scripts/check-text.mjs` pass.
