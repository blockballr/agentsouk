# Mainnet cutover runbook: BSC chain 97 to chain 56

This is the operator's runbook for flipping Agent Souk from BSC testnet (chain
97, settling in sUSD) to BSC mainnet (chain 56, settling in $U). It is written
to be run while tired, so every step is literal and every expected result is
stated. It is also written to be honest: where a value is asserted in code but
not proven here, it is marked TO CONFIRM and you read it off chain before you
trust it.

Read first: `src/lib/types.ts` (`targetChainId`, `snapshotFileFor`,
`settlementAsset`, `SETTLEMENT_ASSETS`), `src/lib/facilitator.ts`,
`apps/web/src/lib/contracts.ts`, `apps/web/src/lib/wallet.ts`,
`apps/web/src/lib/mint.ts`, `docs/tracking-submission.md`.

Two projects are involved. Neither auto-deploys from git, so a push publishes
nothing.

| Surface | What it is | Where | Notes |
|---|---|---|---|
| API | Next.js app in the repo root, serves `/api/*` | Vercel project "agora", origin `https://api.agentsouk.xyz` | Reads `TARGET_CHAIN` and the relay key at runtime |
| Web | Vite app in `apps/web`, static | Cloudflare Pages project "agentsouk", origin `https://agentsouk.xyz` | Vite inlines `VITE_*` at build time, so it must be rebuilt to change them |

Project names come from `docs/tracking-submission.md`, not from the repo. The
repo has no deploy workflow that publishes either surface.

## 0. Do not start until

- All queued work is merged and, where relevant, deployed and verified on chain
  97. Once you flip, the testnet site serves nothing new.
- You can read a chain-56 RPC. The defaults live in
  `packages/core/src/rpc.ts`; the API override is `BSC_MAINNET_RPC_URL`
  (`src/lib/rpc.ts`), the web override is `VITE_BSC_MAINNET_RPC_URL`
  (`apps/web/src/lib/wallet.ts`).
- You have the relay key (`RELAY_PRIVATE_KEY`) and the buyer key
  (`PROD_BUYER_KEY`) available as secret values. Never paste them into a file in
  this repo, a chat, or a command you will later share. The addresses below are
  public and safe to print; the keys are not.

## 1. Switch values

`TARGET_CHAIN` is the one variable that selects the network. Everything else
that follows the network is resolved from it at runtime or from a per-chain map,
so there is nothing else to retarget by hand.

### 1a. Environment variables

| Name | Read by | Testnet (97), current | Mainnet (56), required |
|---|---|---|---|
| `TARGET_CHAIN` | `src/lib/types.ts` `targetChainId()` | `97` | `56` |
| `FACILITATOR_MODE` | `src/lib/facilitator-mode.ts` | `prod` (real sUSD settlement) | `prod`. Unset means `sandbox`, which records a receipt and moves no funds |
| `RELAY_PRIVATE_KEY` | `src/lib/facilitator.ts`, `src/lib/receipts-store.ts`, `src/app/api/tokens/mint/route.ts` | key for relay `0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4` | same variable. The relay must hold mainnet BNB for gas |
| `PROD_BUYER_KEY` | `scripts/prod-settle-test.mjs`, verifier paths | key for buyer `0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713` | same variable. The buyer must hold $U on chain 56 to sign a transfer |
| `BSC_MAINNET_RPC_URL` | `src/lib/rpc.ts` | not used on 97 | optional comma-separated override for chain 56 |
| `BSC_TESTNET_RPC_URL` | `src/lib/rpc.ts` | optional override for 97 | no longer used once the target is 56 |
| `VITE_BSC_MAINNET_RPC_URL` | `apps/web/src/lib/wallet.ts` | not used on 97 | optional web build-time override for chain 56 |
| `VITE_BSC_TESTNET_RPC_URL` | `apps/web/src/lib/wallet.ts` | optional web build-time override for 97 | no longer used once the target is 56 |
| `RECEIPTS_STORE` | `src/lib/receipts-store.ts` | `postgres` on the deployed API | unchanged |
| `DATABASE_URL` | `src/lib/receipts-store.ts` | durable store | unchanged, and shared across chains, see section 6 |
| `EIGHT004_API_KEY` | `src/lib/scanner.ts` | 8004scan tier key | unchanged |
| `INDEX_SECRET` | `src/app/api/index/build/route.ts` | guards the snapshot build | unchanged |
| `CRON_SECRET`, `VERIFY_LIMIT`, `BASE_URL` | `src/app/api/cron/verify/route.ts` | verifier pass | unchanged |
| `LLM_EVAL_API_KEY`, `LLM_EVAL_BASE_URL`, `LLM_EVAL_MODEL`, `LLM_EVAL_FALLBACK_MODEL` | commentary and quality | model config | unchanged |
| `SMART_WALLET_VERIFY` | `src/lib/facilitator.ts` | off | off |
| `B402_CLIENT_ID`, `B402_ACCESS_TOKEN` | `src/app/api/x402/settle/route.ts` | only for `FACILITATOR_MODE=b402` | not used in `prod` mode |
| `VITE_API_URL` | `apps/web/src/lib/api.ts` | `https://api.agentsouk.xyz/api` | unchanged |
| `VITE_WC_PROJECT_ID` | `apps/web/src/lib/wallet.ts` | WalletConnect project id | unchanged |
| `DEPLOYER_PRIVATE_KEY` | `scripts/deploy-testusd.mjs` | used once, to deploy sUSD on 97 | not used on 56, there is nothing to deploy |
| `BOOST_SECRET`, `NOTIFY_EMAIL`, `NOTIFY_FROM`, `RESEND_API_KEY`, `WEB_ORIGIN`, `PUBLIC_API_URL`, `PROD_TOKEN_ID` | misc scripts and routes | operator config | unchanged |

Note on `TARGET_CHAIN`: `targetChainId()` reads
`Number.parseInt(process.env.TARGET_CHAIN ?? "", 10)` and falls back to `56`
when it is unset. Leaving it blank on the API therefore also lands on mainnet,
but set it explicitly so the value is visible in the dashboard.

### 1b. Config that follows the target chain, no manual retarget

Confirm each map contains chain 56. None of these need editing for the cutover;
they are listed so you can check them rather than hunt for them.

| What | Source of truth | Chain 97 | Chain 56 |
|---|---|---|---|
| Settlement asset used for signing and relay | `SETTLEMENT_ASSETS` in `src/lib/types.ts`, `SETTLEMENT_ASSET_BY_CHAIN` in `apps/web/src/lib/contracts.ts` | sUSD `0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53`, 18 decimals, EIP-712 "Agent Souk Test USD" v1 | $U `0xcE24439F2D9C6a2289F741120FE202248B666666`, 18 decimals, EIP-712 "United Stables" v1 (TO CONFIRM, see section 3 step 2) |
| ERC-8004 registry | `REGISTRY_ADDRESSES` in `src/lib/registry-write.ts`, `REGISTRY_BY_CHAIN` in `apps/web/src/lib/contracts.ts`, `BSC_REGISTRY_ADDRESS` in `src/lib/types.ts` | `0x8004a818bfb912233c491871b3d84c89a494bd9e` | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` |
| Explorer base | `explorerBaseFor` in `src/lib/types.ts`, `explorerTxBase` in `apps/web/src/lib/contracts.ts` | `https://testnet.bscscan.com` | `https://bscscan.com` |
| Default RPC list | `DEFAULT_RPC_URLS` in `packages/core/src/rpc.ts` | three BSC testnet endpoints | three BSC mainnet endpoints |
| Agent catalogue snapshot | `snapshotFileFor` in `src/lib/types.ts` | `data/agents-97.json` | `data/agents.json` |
| Scout data directory | `scoutDirFor` in `src/lib/types.ts` | `data/scout-97` | `data/scout` |
| Wallet target chain | `apps/web/src/lib/wallet.ts` | set from the catalogue and the payment requirements | same |
| WalletConnect chain | `apps/web/src/lib/wallet.ts` | now follows the target chain (was pinned to 56) | follows the target chain |
| Token mint and faucet | `apps/web/src/lib/mint.ts`, `tests/test-mint.ts` | enabled only on 97 | disabled, `isTestnet(56)` is false |

## 2. Addresses on chain 56 and where they come from

| Role | Address | Provenance |
|---|---|---|
| ERC-8004 registry | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` | `src/lib/registry-write.ts` line 7, `apps/web/src/lib/contracts.ts` line 4, `src/lib/types.ts` `BSC_REGISTRY_ADDRESS`. Recorded in `docs/tracking-submission.md` |
| $U settlement asset | `0xcE24439F2D9C6a2289F741120FE202248B666666` | `SETTLEMENT_ASSETS[56]` in `src/lib/types.ts` line 54, `SETTLEMENT_ASSET_BY_CHAIN[56]` in `contracts.ts` line 10, pinned by `tests/test-settlement-asset.ts`. Proven on chain 56 by the tracking document |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | `BSC_TOKENS.USDT` in `src/lib/types.ts`, displayed only, never accepted for settlement |
| Relay, broadcasts and pays gas | `0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4` | derived at runtime from `RELAY_PRIVATE_KEY`. Address published in `docs/tracking-submission.md`; key never committed |
| Buyer, signs authorizations | `0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713` | derived at runtime from `PROD_BUYER_KEY`. Address published in `docs/tracking-submission.md`; key never committed |
| Team identity, unused | `0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5` | declared in `docs/tracking-submission.md`, no key, not a payer or payee |

The tracking document records chain-56 balances read on 2026-09-27: the relay
`0xE565...` held `0.0040875 BNB` with nonce 1, the buyer `0xC76E...` held `0` BNB
and `0` $U. Treat those as stale and re-read them in section 3. Funding the
buyer with $U and the relay with BNB is a transfer, not a deployment.

There is no sUSD and no test registry on chain 56. If any step tells you the
settlement asset is `0x9332...` or the registry is `0x8004a818...` while
`TARGET_CHAIN=56`, stop: something is still pinned to 97.

## 3. Read chain-56 ground truth before you touch anything

Read only. Nothing here sends a transaction or changes configuration.

1. Confirm the chain responds and is chain 56.

   ```
   curl -s https://bsc-rpc.publicnode.com -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
   ```

   Expected: `"result":"0x38"` (`56` in hex).

2. Read the $U token's own metadata and EIP-712 domain. This is the authority for
   what the wallet must sign. Use any BSC mainnet RPC.

   ```
   node -e "const{createPublicClient,http}=require('viem');const{bsc}=require('viem/chains');(async()=>{const c=createPublicClient({chain:bsc,transport:http('https://bsc-rpc.publicnode.com')});const a='0xcE24439F2D9C6a2289F741120FE202248B666666';const abi=[{name:'name',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'string'}]},{name:'symbol',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'string'}]},{name:'version',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'string'}]},{name:'decimals',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]},{name:'eip712Domain',type:'function',stateMutability:'view',inputs:[],outputs:[{name:'fields',type:'bytes1'},{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'},{name:'salt',type:'bytes32'},{name:'extensions',type:'uint256[]'}]}];for(const f of ['name','symbol','version','decimals','eip712Domain']){console.log(f,'=',await c.readContract({address:a,abi,functionName:f}))}})().catch(e=>{console.error(e.message);process.exit(1)})"
   ```

   Expected: chainId `56n`, verifyingContract `0xcE24...`, and name/version that
   match `SETTLEMENT_ASSETS[56]` ("United Stables" / "1"). If they differ, the
   signing domain in code is wrong and every settlement will revert at the
   token: fix `SETTLEMENT_ASSETS[56]` in `src/lib/types.ts` before going further.

3. Confirm the registry address is live. This is a read of an arbitrary method
   on the registry; a non-empty result confirms code exists at the address.

   ```
   curl -s https://bsc-rpc.publicnode.com -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x8004a169fb4a3325136eb29fa0ceb6d2e539a432","latest"]}'
   ```

   Expected: a `result` longer than `0x`.

4. Read the relay and buyer balances on 56 and fund what is short.

   ```
   curl -s https://bsc-rpc.publicnode.com -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4","latest"]}'
   ```

   Expected: enough BNB for the settlements you intend to relay. The relay pays
   gas on every settlement; the buyer pays none. Then check the buyer's $U
   balance by calling `balanceOf` on `0xcE24...` for
   `0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713`; it must hold at least the hire
   amount before it can sign.

5. Confirm the $U contract accepts the nine-argument authorization the relay
   sends. The tracking document records a proven mainnet settlement
   `0x25bcb12557ec4d484e1a9962a17a16e2883f07bd623909fad95c6bd82bdda6f3` whose
   calldata selector is `e3ee160e`, which is the selector
   `src/lib/facilitator.ts` encodes. Re-read that receipt if you want to see it
   for yourself.

## 4. Order of operations

Do these in order. The web learns its chain from the API catalogue, so the API
goes first.

1. Rebuild the mainnet catalogue snapshot, then redeploy it.

   `data/agents.json` is the chain-56 catalogue and its `snapshotTime` is
   `2026-09-17T20:42:53.426Z` with 172 agents, only 4 of which carry an endpoint.
   That is the catalogue mainnet will serve, and it is stale. Rebuild it in a
   checkout configured for chain 56, before or during the flip:

   ```
   TARGET_CHAIN=56 npm run dev
   ```

   then in another shell:

   ```
   curl -X POST "http://localhost:3000/api/index/build?chain=56&per=40&secret=<INDEX_SECRET>"
   ```

   This overwrites `data/agents.json`. Review the counts it prints. This is a
   committed file that the serverless deployment reads from disk, so the
   refreshed file must be committed and deployed with the API. Do not touch
   `data/agents-97.json` or `data/scout-97`.

2. Set the API environment for chain 56 and deploy the API.

   In the Vercel project "agora": `TARGET_CHAIN=56`, `FACILITATOR_MODE=prod`,
   `RELAY_PRIVATE_KEY` and `PROD_BUYER_KEY` for keys funded on 56, optionally
   `BSC_MAINNET_RPC_URL`, and leave `RECEIPTS_STORE`/`DATABASE_URL` as they are.
   Redeploy. Deploy the API before the web.

   One data decision belongs here, not later: the postgres `verifications`
   table is keyed by `token_id` alone (section 7 item 13). Before the chain-56
   verifier runs, either empty that table or add a chain column and read by
   chain, so chain-97 verdicts cannot be served for chain-56 agents.

3. Rebuild and republish the web.

   In `apps/web`: `npm run build`, then publish `apps/web/dist` to Cloudflare
   Pages project "agentsouk" (manual, as today). This build must include the
   `WalletConnect` chain fix from this working tree, and it is where
   `VITE_BSC_MAINNET_RPC_URL` would be baked in if you set it.

4. Nothing else is deployed. There is no chain-56 contract to deploy: $U and the
   ERC-8004 registry already exist at the addresses in section 2.

## 5. Verification checklist after the flip

Run all of these against the deployed origins. A single failure means roll back
or fix before announcing the flip.

1. The catalogue serves chain 56.

   ```
   curl -s "https://api.agentsouk.xyz/api/agents?limit=5"
   ```

   Expected: `items[0].chain_id` is `56`, `contract_address` is
   `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432`, and the count is the refreshed
   mainnet snapshot, not 21.

2. A detail read resolves on chain 56.

   ```
   curl -s "https://api.agentsouk.xyz/api/agents/56/<tokenId>"
   ```

   Expected: `success: true` with a real registry record.

3. Payment requirements advertise $U, not sUSD.

   ```
   curl -s -X POST https://api.agentsouk.xyz/api/x402/requirements \
     -H 'content-type: application/json' \
     --data '{"chainId":56,"tokenId":"<tokenId>","amountUsd":2,"client":"<buyer address>"}'
   ```

   Expected: `paymentRequirements.network` is `eip155:56`,
   `paymentRequirements.asset` is `0xcE24439F2D9C6a2289F741120FE202248B666666`,
   `extra.name`/`extra.version` match what section 3 read off the token, and
   `payTo` is the agent's registered wallet.

4. One real settlement on chain 56.

   With a local API running in prod mode (`TARGET_CHAIN=56 FACILITATOR_MODE=prod
   RELAY_PRIVATE_KEY=<secret> npm run dev`) and the buyer funded with $U. The
   script also checks `FACILITATOR_MODE` and `RELAY_PRIVATE_KEY` in its own
   environment, so pass them again here:

   ```
   FACILITATOR_MODE=prod RELAY_PRIVATE_KEY=<secret> PROD_BUYER_KEY=<secret> \
     PROD_TOKEN_ID=<tokenId> node scripts/prod-settle-test.mjs
   ```

   Expected: `settle status: 200`, `PASS`, and a tx hash that is a full 32-byte
   hash and does not start with the sandbox prefix `0x53a66f60`. Open
   `https://bscscan.com/tx/<hash>` and confirm status success and a
   `transferWithAuthorization` call to the $U contract. This is the cutover's
   single most important check: it proves the EIP-712 domain in code matches the
   token on chain 56.

5. One delivery attempt, against the payment from step 4.

   ```
   curl -s -X POST https://api.agentsouk.xyz/api/x402/deliver \
     -H 'content-type: application/json' --data '{"paymentId":"<paymentId>"}'
   ```

   then, for an A2A agent:

   ```
   curl -s -X POST https://api.agentsouk.xyz/api/x402/deliver \
     -H 'content-type: application/json' \
     --data '{"paymentId":"<paymentId>","task":"report your status in one sentence"}'
   ```

   Expected: `{"success":true,"data":{"ok":true,...}}` with a real answer, or a
   stated `gated`/`dead` reason. A settled hire does not prove the agent is
   reachable; an empty 500 would be a bug, a stated failure is not.

6. The receipt is retrievable and honest about the chain.

   ```
   curl -s "https://api.agentsouk.xyz/api/receipts/<paymentId>"
   ```

   Expected: `mode: "prod"`, the chain-56 tx hash, the agent token and the
   payTo you saw in step 3.

7. The site, by hand, in a browser on chain 56.

   - The footer reads "BNB Smart Chain, chain 56", not "BSC Testnet, chain 97".
   - The test-token entry point is gone. `POST /api/tokens/mint` returns 404
     "test tokens are only available on the testnet deployment".
   - Transaction links point at `https://bscscan.com`, not
     `https://testnet.bscscan.com`.
   - Connect a wallet on chain 56 and run one hire end to end; the wallet is
     asked to switch to chain 56 and signs a $U authorization.

8. The owner-scoped read is chain 56.

   ```
   curl -s "https://api.agentsouk.xyz/api/agents/by-owner?owner=<mainnet owner>"
   ```

   Expected: `chainId: 56` and the owner's mainnet agents.

## 6. Rollback to testnet

If mainnet misbehaves, you can put the site back on chain 97. This undoes the
configuration, not the chain.

1. In the Vercel project "agora", set `TARGET_CHAIN=97` (and
   `FACILITATOR_MODE=prod` with the testnet-funded relay key). Redeploy. The API
   reads this at runtime, so no rebuild is needed for the API itself.
2. No web change is required to return, provided `VITE_*` values were not
   changed for the flip. If you set `VITE_BSC_MAINNET_RPC_URL`, it is simply
   unused on 97.
3. `data/agents-97.json` and `data/scout-97` were left untouched, so the testnet
   catalogue is exactly as before.
4. Refund or re-fund the relay with testnet tBNB if you drained it.

State left behind, stated plainly:

- Any $U transfer already relayed on chain 56 is final. Rollback does not and
  cannot reverse it.
- The durable store (`RECEIPTS_STORE=postgres`, `DATABASE_URL`) is shared across
  chains. Mainnet receipts, jobs, and hire sessions written during the flip stay
  in it. Jobs are filtered to the target chain
  (`onTargetChain` in `src/lib/jobs.ts`), so chain-56 jobs disappear from the
  chain-97 UI, but per-wallet receipt reads are cross-chain and will still show
  the mainnet hires with `chainId: 56`.
- If you rebuilt `data/agents.json` for mainnet, that refreshed file stays in
  the tree and in the deployed API unless you revert it in git and redeploy.
- Any mainnet agent registration is final.

## 7. What is not simply a switch

The owner's model is that chain 56 is a change of network, payment asset, and
agent endpoints. That is mostly true for the settle path, but the following are
real differences and are not covered by setting `TARGET_CHAIN=56`.

1. The catalogue is a different set of agents. Chain 97 serves 21 campaign
   agents (all with endpoints); chain 56 serves the frozen mainnet snapshot of
   172 agents from 2026-09-17, only 4 of which carry an endpoint. Every listing,
   endpoint, payee wallet, and delivery outcome changes. This is a switch of
   catalogue, not just a network id.
2. The snapshot is a file, not a live table. `loadSnapshot` reads
   `data/<snapshotFileFor(chain)>` from disk. On serverless the filesystem is
   read-only, so a stale `data/agents.json` ships as stale until you rebuild and
   redeploy it (section 4, step 1).
3. `next.config.ts` traces `./data/agents.json` and the chain-agnostic data
   files into the deployment, but it does not list `./data/agents-97.json`. On a
   chain-97 deployment the snapshot may not be packaged at all, in which case
   the index falls back to live warming from the 8004scan API. This is worth
   fixing, but it is outside this runbook's owned files: see section 9.
4. The mint, the faucet, and the sponsored gas drip are testnet-only. On chain
   56 there is no permissionless mint of $U, `/api/tokens/mint` returns 404, and
   the web hides the test-token button because `isTestnet(56)` is false. Mainnet
   users need real BNB for any registration and real $U to hire.
5. Wallet funding is a real prerequisite. The relay needs mainnet BNB to pay gas
   and the buyer needs $U to sign. The tracking document's 2026-09-27 read shows
   the buyer at `0` $U and the relay at `0.0040875` BNB, so plan funding before
   the flip, not during it.
6. Durable state is shared, not partitioned by chain. Old chain-97 receipts and
   hires remain readable and will surface with `chainId: 97` on a chain-56 site.
7. Verification semantics differ. On chain 97, "delivered" verdicts are
   reachability probes (see `isProbeCheck` and the `BSC_TESTNET_CHAIN_ID = 97`
   constants in `MarketplacePage.tsx` and `AgentDetailPage.tsx`); on chain 56
   the UI assumes a paid-hire verifier produced the verdict. The verifier
   (`src/app/api/cron/verify/route.ts`) settles a real hire per candidate, so on
   mainnet it spends real $U from the relay.
8. The $U EIP-712 domain is asserted in code, not read from the contract.
   `SETTLEMENT_ASSETS[56].eip712Name = "United Stables"` and
   `eip712Version = "1"`. Section 3 step 2 reads the truth off chain. Do not skip
   it: a domain mismatch fails only at settlement time, after gas is spent.
9. WalletConnect was pinned to chain 56 in `apps/web/src/lib/wallet.ts`
   (`chains: [56]`). This is fixed in the working tree to follow the target
   chain, but the fix only reaches users when the web is rebuilt. Until then,
   the published testnet web initializes WalletConnect against mainnet.
10. The cron verifier captures `const CHAIN_ID = targetChainId()` at module
    load. A running server does not pick up a changed `TARGET_CHAIN` without a
    redeploy.
11. The web learns its chain from the first item in the catalogue
    (`apps/web/src/lib/api.ts` `setTargetChain(items[0].chain_id)`), defaulting
    to 56 before the catalogue loads. On mainnet the default agrees; on an empty
    mainnet catalogue the UI still says chain 56, which is correct but means the
    displayed network is data-dependent.
12. The 5 unit settlement cap (`PROD_CAP_RAW` in `src/lib/facilitator.ts`) is
   five 18-decimal units, which is correct for $U and was correct for sUSD. It is
   not a per-dollar cap and does not need changing, but it is worth knowing it
   did not change.
13. Verification rows are keyed by token id alone, not by chain.
   `verifications-store.ts` defines the postgres table with
   `token_id text primary key`, and `upsertVerification` writes it from the cron
   verifier on any chain. Reads are chain-split (`verifications.ts` `loadOnce`
   returns the chain-97 scout file for 97 and the postgres table for 56), but the
   write path is not. Rows written while the deployment ran on 97 therefore stay
   in the table and can be served as a chain-56 agent's verdict whenever the two
   registries share a token id. Before you trust a mainnet badge, clear or
   partition the table (add a chain column, or start mainnet from an empty table)
   and let the chain-56 verifier repopulate it. This is the one place a chain-97
   artifact can leak into the chain-56 surface without anyone editing a file.

## 8. State that is seeded or snapshot based

| Artifact | Chain | Role | Fate on cutover |
|---|---|---|---|
| `data/agents.json` | 56 | Mainnet catalogue | Served after flip; rebuild it (section 4 step 1) |
| `data/agents-97.json` | 97 | Testnet catalogue | Left in the tree and not served once `TARGET_CHAIN=56` |
| `data/scout/` | 56 | Mainnet scout candidates and verifications | Used by the mainnet scout paths |
| `data/scout-97/` | 97 | Testnet scout data | Left alone |
| postgres table `verifications` | keyed by token id only, no chain column | Cron verifier output for the chain-56 read path | Can hold chain-97 rows; clear or partition before trusting mainnet badges, see section 7 item 13 |
| `data/verifications.json` | chain-agnostic file fallback, keyed by token | Cron verifier output | Shared; chain-56 tokens will be appended |
| `data/delivery-matrix.json` | 56 (`capturedAt 2026-09-08`) | Delivery matrix | Stale; regenerate if you want fresh mainnet badges |
| `data/advantage-tasks.json`, `data/performance.json` | mixed | Advantage report and probes | Not network-critical, review before quoting |

The failure mode this section exists to prevent: the site flipping to chain 56
while still serving the 21-agent chain-97 snapshot, or the reverse. Both are
possible if the snapshot file is not the one `snapshotFileFor(targetChainId())`
resolves to, so a cutover is not complete until section 5 step 1 shows chain-56
data.

## 9. Hardcodes found during the audit

Fixed, inside the owned files (`docs/mainnet-cutover.md`,
`apps/web/src/lib/wallet.ts`, `apps/web/src/lib/contracts.ts`,
`apps/web/src/lib/mint.ts`, `src/lib/types.ts`):

| File and line | Before | After | Why |
|---|---|---|---|
| `apps/web/src/lib/wallet.ts` `initWalletConnect` | `chains: [56]` | `chains: [targetChainId]` | WalletConnect was pinned to mainnet regardless of the deployment |
| `apps/web/src/lib/wallet.ts` `chainParams` | `chainIdToHex(97)` / `chainIdToHex(56)` and literal explorer URLs | `chainIdToHex(chainId)` and `explorerTxBase(chainId)` | The parameter now drives the id and the explorer base from one place |
| `apps/web/src/lib/mint.ts` `SUSD_ADDRESS`, `SUSD_SYMBOL` | literal sUSD address and symbol | read from `SETTLEMENT_ASSET_BY_CHAIN[97]` | Removes a duplicated token address; the value is unchanged |

No chain-97 literal was found in `apps/web/src/lib/contracts.ts` or
`src/lib/types.ts`. Both are already per-chain tables and helper functions, and
are left unchanged.

Reported, outside the owned files, not fixed here:

| File and line | Finding |
|---|---|
| `src/app/api/tokens/mint/route.ts:20`, `41`, `114`, `139`, `140`, `159` | Duplicate sUSD literal; `targetChainId() !== 97` gate; hardcoded `bscTestnet` and `BSC_TESTNET_CHAIN_ID`; hardcoded `https://testnet.bscscan.com` explorer instead of `explorerBaseFor`. Testnet-only by design, but the address duplicates `mint.ts` and the explorer string ignores the helper |
| `src/components/hire-flow.tsx:20` | Local `chainLabel` re-implements `chainLabel` from `apps/web/src/lib/contracts.ts` with a `97` literal |
| `apps/web/src/pages/HomePage.tsx:251`, `268`, `282` | Hardcoded chain-97 explorer and a hardcoded testnet settlement tx, plus "2 sUSD" copy in the evidence strip |
| `apps/web/src/pages/MarketplacePage.tsx:319` | `const BSC_TESTNET_CHAIN_ID = 97` used to interpret delivered verdicts as probes |
| `apps/web/src/pages/AgentDetailPage.tsx:42`, `56` | `BSC_TESTNET_CHAIN_ID = 97` and a hardcoded testnet explorer |
| `apps/web/src/pages/ListAgentPage.tsx:905` | `BSC_TESTNET_CHAIN_ID = 97`; also `371`, `372`, `549` fall back to `REGISTRY_BY_CHAIN[56]` and `SETTLEMENT_ASSET_BY_CHAIN[56]`, and `567` branches on `getTargetChain() === 97` for copy |
| `src/lib/scanner.ts:81`, `104` | `fetchAgentsPage` and `searchAgents` default their `chainId` argument to `BSC_CHAIN_ID` (56), a mainnet-biased fallback. Callers pass `targetChainId()`, so this is not hit in the normal path |
| `apps/web/src/core/types.ts:1-19` | Still declares mainnet `BSC_TOKENS` (USDC/USDT) and `BSC_REGISTRY_ADDRESS`; stale and superseded by `lib/contracts.ts`, unused on the settlement path |
| `src/app/api/x402/settle/route.ts:62-67` | Fallback agent is `chainId: 56`, `symbol: "USDC"` when the caller omits `agent`; a fallback only, but it names the wrong asset |
| `next.config.ts:6-8` | `outputFileTracingIncludes` lists `data/agents.json` and the chain-agnostic files but not `data/agents-97.json` |
| `src/lib/verifications-store.ts:31-42`, `90-124` | Postgres `verifications` table is keyed by `token_id` alone, so chain-97 verdicts written by the cron verifier can be read as chain-56 verdicts after the flip. The chain-56 read path is the table; the chain-97 read path is the scout file |
| `src/lib/verifications.ts:105-130` | `loadOnce` reads the chain-97 scout file for 97 and the postgres/file path for 56, which is why the write-side collision above is not caught by the read split |
| `scripts/settle-e2e-testnet.mjs` | Chain-97 proof script (sUSD, testnet RPC). Keep for reproducing testnet evidence, not for mainnet |
| `scripts/prod-settle-test.mjs` | Chain-56 proof script (`chainId: 56`, `symbol: "U"`, default `PROD_TOKEN_ID=45381`). Reuse it for section 5 step 4 |

Pre-existing, unrelated to this task: `npx tsc --noEmit` fails in
`src/app/api/x402/deliver/route.ts` lines 58 to 60 with `'body' is possibly
'null'`. That file is owned by another agent and was not touched.

## 10. Things that could not be established from the repository

- The exact EIP-712 name and version $U publishes on chain 56. The code asserts
  "United Stables" and "1" and the tracking document reports a proven chain-56
  settlement, but the value is not read from the contract anywhere in the repo.
  Section 3 step 2 settles it.
- Whether the operator intends to reuse the same `RELAY_PRIVATE_KEY` and
  `PROD_BUYER_KEY` on mainnet. The code only needs the addresses to be funded;
  the repo does not state the intent.
- The currently deployed `TARGET_CHAIN` and `FACILITATOR_MODE`. The repository
  cannot read the Vercel or Cloudflare settings; the tracking document states
  them, and the operator should confirm in the dashboards.
- Whether Vercel currently ships `data/agents-97.json` to the deployed API. It is
  absent from `outputFileTracingIncludes`, so it may not; if it does not, the
  chain-97 index is served from live warming rather than the snapshot.
- The Vercel and Cloudflare project names and build settings. The names used
  above come from the tracking document; the repo has no deploy workflow.
- A chain-56 token id that is safe and reachable for the section 5 real
  settlement. `scripts/prod-settle-test.mjs` defaults to `45381`; confirm one
  exists in the refreshed mainnet snapshot before running it.
