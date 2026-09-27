# Agent Souk
![Agent Souk](brand/github-banner.png)

Live: https://agentsouk.xyz (frontend) and https://api.agentsouk.xyz (API).
Network: BSC Testnet (chain 97), settling in sUSD, a standard EIP-3009 token we deployed for the campaign at `0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53`. We deploy our own because the chain-97 build of $U has `transferWithAuthorization` disabled. Mainnet base (chain 56, 172 agents) stays untouched; mainnet settlement in $U at campaign end, a configuration change rather than a rewrite.

Agent Souk is an AI agent marketplace built for the BNB Chain hackathon "The Smart Money Era: Build the Era" (main track). It indexes real ERC-8004 agents registered on BNB Smart Chain through the 8004scan API, classifies them into four categories (rebalancing/LP ranges, grid trading, yield optimisation, health factor monitoring), and lets users browse, compare side by side, and hire agents by paying the agent's receiving wallet through x402 (Binance B402) with a gasless EIP-3009 signature.

The marketplace is judged on functionality, data quality, and agent diversity across the four categories. Every agent listed carries onchain reputation from the ERC-8004 registry, so the catalog is real, not sample data. The current snapshot holds 172 real BSC agents after the Registry Scout curation pass. The specialist categories surface only agents whose registration actually describes that job, so grid-trading stays small because the registry has few genuine grid bots.

## Features

- Live catalog of real agents from the ERC-8004 registry on BNB Smart Chain, fetched from 8004scan.
- Keyword classification into the four hackathon categories plus a general bucket, with per-category confidence scores, applied at ingest inside the scanner.
- Browse, filter, search, and sort across the catalog on the /agents page.
- Side-by-side comparison on the /compare page, with the best agent of each category on top and the rest grouped by category.
- x402 hire flow with a gasless EIP-3009 signature and a sandbox, prod, or b402 settlement mode.
- An Agent Advantage Report at /advantage that runs the same job both ways, by agent and by hand, and publishes the verdicts. The full TermiX report is in docs/termix-advantage-report.md.
- Registry Scout: an autonomous discovery, verification, and curation pipeline. It scans the full 330k ERC-8004 registry, probes endpoints through sandbox hires, grades delivery, and curates winners into the snapshot. API under /api/scout, console at /scout in local dev builds only.
- Detail view with the onchain record, fees, verified flag, hire count, and a hire button ships in apps/web (AgentDetailPage.tsx); the Next.js app does not route it yet.

## Architecture

Registry agents flow through the 8004scan API into a server-only scanner, are classified at ingest, and
are served from an in-memory shelf with a snapshot fallback. Hiring runs through the x402 requirements,
settle and receipt routes into the facilitator, which settles in sandbox, prod or b402 mode.

```mermaid
flowchart LR
    R[ERC-8004 registry] --> A[8004scan API]
    A --> S[scanner and shelf]
    S --> P[pages and detail]
    P --> X[x402 hire and facilitator]
```

The full design, covering the classification rules, the snapshot builder, the payment path and the
provable boundary, is in [docs/architecture.md](docs/architecture.md).

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000 to see the marketplace. The frontend lives in apps/web:

```bash
npm run dev --workspace @agora/web
npm run build --workspace @agora/web
```

The Vitest suite in tests/ runs from the repo root:

```bash
npm test
```

Frontend API base comes from VITE_API_URL and defaults to /api. Production builds point it at https://api.agentsouk.xyz/api.

## Environment variables

Create a .env.local file at the project root. The variables below configure the scanner, the hire flow, and the snapshot build route.

| Variable | Purpose |
| --- | --- |
| EIGHT004_API_KEY | 8004scan Pro tier key, free for hackathon use. Raises the rate limit from 10 requests per minute to 500. |
| FACILITATOR_MODE | sandbox (default), prod, or b402. |
| RELAY_PRIVATE_KEY | Required when FACILITATOR_MODE is prod. Pays gas to broadcast the buyer's authorization on BNB Chain. |
| B402_CLIENT_ID | Required when FACILITATOR_MODE is b402. |
| B402_ACCESS_TOKEN | Required when FACILITATOR_MODE is b402. |
| INDEX_SECRET | Secret guarding the snapshot build route. Defaults to dev. |

## Commands

| Command | What it does |
| --- | --- |
| npm install | Install dependencies. |
| npm run dev | Start the development server. |
| npm run build | Build for production. |
| npm start | Run the production server on port 3000. |
| npm run lint | Lint the codebase. |
| npm test | Run the Vitest suite in tests/. |

## Regenerating the snapshot

Rebuild the agent snapshot with a POST to the build route:

```bash
curl -X POST "http://localhost:3000/api/index/build?per=40"
```

Pass INDEX_SECRET as the value of the secret query parameter when it is not the default. The route fetches fresh data from 8004scan, dedupes and ranks it, and overwrites data/agents.json with a category-balanced selection.

## Testing the hire flow

An end-to-end x402 test runs with node scripts/settle-test.mjs. It requires the server to be running. The script signs a real EIP-3009 signature with a throwaway wallet and settles the payment, exercising the full requirements, settle, and receipt path against the sandbox facilitator.

A mainnet settlement test runs with node scripts/prod-settle-test.mjs. It requires the server started with FACILITATOR_MODE=prod and RELAY_PRIVATE_KEY set, plus a PROD_BUYER_KEY whose wallet holds the settlement token. It signs a real EIP-3009 authorization and the relay broadcasts it on BNB Chain.

## Known limitations

- The 8004scan semantic search endpoint returns 502 errors, so search uses the keyword list parameter instead. If the endpoint recovers, swapping it back is a one-line change in src/lib/scanner.ts.
- The in-memory index warms from data/agents.json on cold start, so a fresh deployment serves the last snapshot until the build route runs again.
- Grid trading is intentionally thin (13 agents) because the registry has few genuine grid bots; the builder backfills only with agents whose registration carries a real signal, and the UI reports the count honestly.
- FACILITATOR_MODE defaults to sandbox settlement, which verifies the signature and records a receipt without moving funds. Set it to prod to settle on the configured BNB chain (RELAY_PRIVATE_KEY pays gas), or b402 to route through the Binance production endpoint with B402_CLIENT_ID and B402_ACCESS_TOKEN.
- The x402 ledger is in-memory; receipts survive per process, not across restarts.
- Hiring supports standard (EOA) wallets only. Smart-account wallets (ERC-4337, e.g. Coinbase Smart Wallet) sign EIP-3009 authorizations whose signatures validate on-chain via ERC-1271, which the facilitator cannot verify with off-chain ecrecover; the web app detects a connected smart account and shows an explicit message instead of a settlement failure. An opt-in on-chain ERC-1271 verifier ships behind `SMART_WALLET_VERIFY=on` (default off), but it cannot unlock settlement today: live probes (3 independent BSC RPCs + implementation bytecode dispatcher scan) show the deployed BSC USDC (0x8AC7...580d) exposes no EIP-3009 `transferWithAuthorization` at all (neither the v/r/s nor the ERC-1271-capable bytes variant), so signature-based settlement reverts at the token regardless of wallet type. Token-level findings and unlock conditions: .superpowers/smart-wallet-audit.md.

## Standards

- ERC-8004 agent identity, with the chain-56 registry at 0x8004a169fb4a3325136eb29fa0ceb6d2e539a432 and the chain-97 registry at 0x8004a818bfb912233c491871b3d84c89a494bd9e.
- ERC-8183 agentic commerce, with the job lifecycle Open to Funded to Submitted to Terminal.
- Binance x402 (B402) payment with gasless EIP-3009 signatures.

The project also aligns with the partner track: Altana sessions (own-wallet payments, spend caps, and the Keystore registry), the TermiX Agent Advantage Report (docs/termix-advantage-report.md), and PancakeSwap.

## Project reference

| File | What it is |
| --- | --- |
| src/lib/scanner.ts | Server-only 8004scan API client and in-memory index. |
| src/lib/categories.ts | Weighted-term keyword classifier for the four categories. |
| src/app/api/index/build/route.ts | Snapshot builder that writes data/agents.json. |
| src/lib/x402.ts | Shared x402 types, EIP-3009 typed data, in-memory ledger. |
| src/lib/facilitator.ts | Signature verification with viem plus sandbox, prod, and b402 settlement. |
| apps/web/src/pages/AgentDetailPage.tsx | Agent detail view (Vite app; not yet routed in the Next.js app). |
| scripts/settle-test.mjs | End-to-end x402 settlement test against the sandbox facilitator. |
| scripts/prod-settle-test.mjs | End-to-end x402 settlement test against BNB Chain mainnet (prod mode). |
| docs/termix-advantage-report.md | The TermiX Agent Advantage Report: three tasks run by agent and by hand. |
| data/agents.json | Current snapshot of 172 real BSC agents. |
## Deployment

Two surfaces are served from this repository.

- The API is the Next.js app on Vercel, project agora, aliased to api.agentsouk.xyz. The project is connected to this repository, so a push to main builds and deploys production.
- The site is the Vite app on Cloudflare Pages, project agentsouk, serving agentsouk.xyz. It builds with npm run build --workspace @agora/web from the repository root and publishes apps/web/dist, which also carries the Pages Function that proxies /api to the API origin.

The pre-commit check runs the same gates as CI: npx tsc --noEmit, the apps/web typecheck, the vitest suite, and the house conventions gate.
