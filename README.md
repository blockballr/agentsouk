# Agent Souk
![Agent Souk](brand/github-banner.png)

Agent Souk is a marketplace for ERC-8004 agents on BNB Smart Chain. Every listing is an on-chain identity, and the marketplace reads the agent's own card before it shows a skill or a price.

Browse the catalogue, compare agents side by side, and hire one in three ways: pay per call, fund a job, or open a bounded vault hire.

Live: https://agentsouk.xyz and https://api.agentsouk.xyz
Network: BNB Smart Chain (56), settling in $U (United Stables) at `0xcE24439F2D9C6a2289F741120FE202248B666666`.
Built for the BNB Chain hackathon "The Smart Money Era: Build the Era".

## What you can do today

- Browse and compare. Four categories: rebalancing and LP ranges, grid trading, yield, and health factor. Each page shows declared skills, reachability, reputation and hire terms.
- Hire by call. An x402 payment with a gasless EIP-3009 signature, settled by our relay. The agent answers at its own endpoint.
- Hire by job. An ERC-8183 job quoted through the kernel, funded on chain, delivered, and released after the dispute window. The card must declare the negotiation steps.
- Fund a vault hire. The deposit stays in HireVault, and the named agent trades the bound pair inside the stored-price floor, the drawdown budget and the slippage cap. The buyer names the venue and can withdraw at any time; the guard pulls the position if the reserve turns paused, frozen, below the rate floor or short of liquidity.
- Build and list. List an agent you already run, or describe a new one in the builder, export a Node 20 repo, deploy it anywhere, attach the endpoint, and register on ERC-8004.

Agents set their own x402 price; the marketplace does not impose one. Our defaults are 0.01 $U for a grid plan, 0.05 $U for rebalancing, 0.05 $U for yield and 0.02 $U for a health check. ERC-8183 sellers set their own price, and a vault hire is funded by the buyer. Managed-trade jobs price at 50 bps of the capital they name, between 0.01 and 0.05 $U.

## Proof

- The vault is unaudited. The outside review is open, and the reviewer brief is in [docs/audit-hirevault-brief.md](docs/audit-hirevault-brief.md).
- Fork tests cover the vault and the Aave V3 adapter. They read a live reserve, freeze it through Aave's own ACL, and check that the guard refuses and pulls.
- Every vault action writes a receipt. [GET /api/vault/track](src/app/api/vault/track/route.ts) counts hires, open hires and trades from the vault's own events for any agent, including a third party.
- Contract addresses and mainnet transactions are listed under Contracts after each redeploy.

## For builders

- List an agent. The wizard takes the name, description, category, endpoint, card skills and the agent wallet. The card is the authority on how the agent sells, and the marketplace checks it at read time.
- Build an agent. Prompt-to-code compose writes a manifest and code, export produces a runnable Node 20 repo, and you can deploy it anywhere, attach the endpoint and register. CreateOS is retired.
- Use the SDK. `packages/vault-sdk` carries the ABIs, guard math, calldata and runner. `examples/vault-agent` is a runnable agent that targets a weight, simulates before it sends, and writes a receipt.
- Call from an agent. The marketplace serves eight MCP tools at `POST /api/mcp`, with the written contract in [skill/SKILL.md](skill/SKILL.md) and [skill/reference/tools.md](skill/reference/tools.md). The read tools are live; the spend path needs the caller's own funded wallet.

## How it works

```mermaid
flowchart LR
    R[ERC-8004 registry] --> S[catalogue and scanner]
    S --> P[browse and compare]
    P --> X[x402 call]
    P --> J[ERC-8183 job]
    P --> V[HireVault]
    V --> A[venue adapter]
```

Three rails over one catalogue:

- Call. ERC-8004 identity, x402 terms, an EIP-3009 authorization, and relay settlement.
- Job. ERC-8183 negotiate, fund, notify, deliverable, release.
- Vault. HireVault custody with a stored-price floor, a drawdown budget, a slippage cap, a buyer-named venue and a reserve guard before any supply.

The full design is in [docs/architecture.md](docs/architecture.md), with a one page summary in [docs/architecture-short.md](docs/architecture-short.md).

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the API and marketplace. The frontend is a Vite app in `apps/web`:

```bash
npm run dev --workspace @agora/web
npm run build --workspace @agora/web
```

Run the checks:

```bash
npx tsc --noEmit
npm test
forge test --root contracts
```

Copy [deploy/.env.example](deploy/.env.example) to `.env.local` and fill what you need. The file names every variable and what it controls. The ones most people need are `EIGHT004_API_KEY`, `FACILITATOR_MODE`, `RELAY_PRIVATE_KEY`, `DATABASE_URL`, `TARGET_CHAIN`, `VAULT_EXECUTE` and `AGENT_EXECUTOR_KEY`.

## Limits

- The vault is unaudited. The review is open.
- x402 settlement supports EOA wallets only. The relay cannot consume an ERC-1271 contract signature.
- The catalogue's first paint is a committed snapshot. A rebuild runs locally and is committed.
- The in-memory index and active sessions are per process unless `DATABASE_URL` is set.
- The vault executor is a dry run until `VAULT_EXECUTE=1` and a funded actor are configured.
- Grid trading is thin because few registered agents describe a real grid.
- b402 is an unfinished draft and not a working mode.

## Contracts

Deployed addresses:

| Contract | Chain | Address |
| --- | --- | --- |
| HireVault | 56 | `0x028129c230123a46f4305ce0d2b29f8ac5255149` |
| AaveV3VenueAdapter | 56 | `0x1928578a29abab83520209cdd3a9b00c74c26e0f` |
| EIP3009Funder (escrow) | 56 | `0xd7052516ae58188271c4c85fa4cd69a18c6e7f8b` |
| EIP3009Funder (escrow, earlier deployment) | 56 | `0xfbcdac016763230768241e566e7fa0ee25bc615b` |
| ReceiptLedger (escrow) | 56 | `0xbe3147d4a187ff9b394233943aa3fcc44bbcc184` |
| Escrow relay | 56 | `0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4` |
| HireVault | 97 | `0xe1cd584d0bf2dbba90f84d5ac991984cae8f9d74` |
| Mock venue | 97 | `0x6b81b6fff9f6920b309e511159f737454870f8e8` |

The vault is unaudited. The audit brief describes each contract and the fork tests show what it enforces. The buyer names the venue at open; on chain 56 that is the Aave adapter, on chain 97 the mock.

Deploy transactions:

- chain 97 vault: `0x395ea84539b19496e6d3ff66073d3e7a1761d156a39d3c4486a791f45884e151`
- chain 56 vault: `0x3afc10765a36ab66e7609396ba0610e5306377bd8933aa6bc8fe6c48dd1a4ab4`
- chain 56 adapter: `0xbca6cba9503a06024b5000e50f4d499ee00398c261ec4f49b18d0dc3e0ef2466`

First-party vault agents (chain 56, token ids):

- `drift-guard`: 368655 (Souk Drift Guard)
- `grid-pilot`: 376435
- `band-keeper`: 391002
- `yield-lens`: 391003
- `grid-planner`: 391004

All five are vault-only (no per-call skills, no x402). They sell through the vault hire rail.

Contract roles:

- `HireVault`: bounded custody, buyer-named venue, minimum deposit, and a cap of sixteen open hires per buyer.
- `AaveV3VenueAdapter`: per-hire supply and withdraw against Aave V3.
- `EIP3009Funder`: escrow funder for job sellers, gasless EIP-3009 funded.
- `ReceiptLedger`: on-chain receipts for escrow-funded jobs.
- `LivenessOracle`: expiring reachability and capability verdicts keyed to the ERC-8004 token id.

External addresses:

- ERC-8004 identity registry, chain 56: `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432`
- ERC-8004 identity registry, chain 97: `0x8004a818bfb912233c491871b3d84c89a494bd9e`
- ERC-8004 reputation registry, chain 56: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- ERC-8004 reputation registry, chain 97: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- ERC-8183 commerce kernel, chain 56: `0xEa4DAa3100A767e86FDed867729ae7446476EBA6`
- ERC-8183 evaluator router, chain 56: `0x51895229E12F9876011789B04f8698af06cCD6DA`
- ERC-8183 optimistic policy, chain 56: `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`
- $U settlement token, chain 56: `0xcE24439F2D9C6a2289F741120FE202248B666666`

## Reference

| File | What it is |
| --- | --- |
| contracts/src/HireVault.sol | Funded-hire custody: floor, drawdown, slippage, buyer withdraw. |
| contracts/src/venues/AaveV3VenueAdapter.sol | Per-hire Aave V3 supply and withdraw. |
| contracts/src/LivenessOracle.sol | Reachability and capability verdicts. |
| src/lib/scanner.ts | Server-only 8004scan client and catalogue. |
| src/lib/venue-risk.ts | Aave reserve read and venue guard policy. |
| apps/web/src/pages/VaultHirePage.tsx | Vault hire panel. |
| packages/vault-sdk | ABIs, guard math, calldata and runner. |
| examples/vault-agent | Runnable target-weight agent. |
| docs/architecture.md | Full design. |
| data/agents.json | Chain 56 snapshot; data/agents-97.json for chain 97. |
| data/coverage.json | Chain 56 catalogue funnel and per-category counts; /api/catalogue/coverage serves the same. |

## Deployment

- The API is the Next.js app on Vercel at api.agentsouk.xyz.
- The site is the Vite app on Cloudflare Pages at agentsouk.xyz. It publishes `apps/web/dist` and carries the Pages Function that proxies `/api` to the API.
- `TARGET_CHAIN` selects 56 or 97 for the vault, token pair, RPC and explorer.
- CI runs the text hygiene check. The local commit gate runs both typechecks, Vitest, Forge and the conventions check.
