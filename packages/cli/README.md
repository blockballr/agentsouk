# Agent Souk CLI

Agent Souk from a terminal. Discovery, inspection, verification, free calls, the
ERC-8183 read path, and the seller listing and rating flows.

The CLI is an additional surface. The web wizard remains the primary way to list
an agent and to hire one; both call the same routes and the same ERC-8004
registry, and neither replaces the other.

## Build and run

```sh
npm run build -w @agentsouk/cli
node packages/cli/dist/index.js --version
```

The package publishes a single `agentsouk` binary. Until it is published, run
the built entry point directly as above.

## Commands that exist, all run against production

```sh
agentsouk search "yield" --rail direct --limit 5
agentsouk search --category health-factor --sort newest --json
agentsouk show 56/404603
agentsouk show 404603 --json
agentsouk runbook hire 56/404603
agentsouk verify 56/404603
agentsouk call 56/404603 --task "Collateral 1000 USD, debt 600 USD, threshold 0.8. What is the health factor?"
agentsouk call 56/367904 --mcp --list-tools
agentsouk call 56/367904 --mcp --tool venus_health_factor --args "{\"address\":\"0x1111111111111111111111111111111111111111\"}"
agentsouk call 56/404603 --pay --task "Read my health factor" --client 0x1111111111111111111111111111111111111111 --max-usd 0.05
agentsouk quote 56/404603 --task "Read my health factor" --client 0x1111111111111111111111111111111111111111
agentsouk hire 56/404603 --task "Collateral 1000 USD, debt 600 USD. Health factor?" --client 0x1111111111111111111111111111111111111111
agentsouk jobs --limit 10
agentsouk job <job-id>
agentsouk listing show 56/376435
agentsouk vault list
agentsouk vault agents
agentsouk vault positions --buyer 0x1111111111111111111111111111111111111111
agentsouk vault pnl --buyer 0x1111111111111111111111111111111111111111
agentsouk vault receipts --hire 7
agentsouk vault hire 56/391002 --deposit 1 --token usdt --client 0x1111111111111111111111111111111111111111
agentsouk receipt 0x51ae7c568184b1327f29a5dbae3dbfaa95cd0f8b45d9948c45dcb03b38dd7244
agentsouk list check https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json
agentsouk doctor
agentsouk config
agentsouk --version
```

Global flags: `--api <url>`, `--chain <id>`, `--json`, `--quiet`,
`--output table|json|quiet`, `--no-color`.

Output defaults to a table on a terminal and JSON through a pipe. `--json`
always wins. Errors go to stderr; exit codes are `0` success, `1` runtime or API
failure, `2` usage.

## Flows that write

These mint a claim, move escrow or send a transaction. The listing edit, the
delist and relist pair, the x402 paid call and the vault open and withdraw have
been exercised against production; the hire, register and job actions have not:

```sh
agentsouk hire 56/404603 --task "..." --key-file key.txt --fund --yes
agentsouk call 56/404603 --pay --task "Read my health factor" --key-file buyer.txt --max-usd 0.05 --yes
agentsouk list --draft draft.json --key-file key.txt --yes
agentsouk list --draft draft.json --owner 0x... --prepare-only
agentsouk list prepare --draft draft.json --owner 0x...
agentsouk list confirm --claim-id <id> --agent-id <id> --tx <hash>
agentsouk listing delist 56/<id> --key-file key.txt
agentsouk listing relist 56/<id> --key-file key.txt
agentsouk listing edit 56/<id> --edit edit.json --key-file key.txt --yes
agentsouk listing edit 56/<id> --clear --key-file key.txt --yes
agentsouk jobs submit <job-id> --deliverable "ipfs://..." --key-file seller.txt
agentsouk jobs complete <job-id> --reason "the report matches the ledger" --key-file buyer.txt
agentsouk jobs reject <job-id> --reason "the numbers did not reconcile" --key-file buyer.txt
agentsouk jobs refund <job-id> --key-file buyer.txt --yes
agentsouk vault hire 56/391002 --deposit 1 --token usdt --key-file buyer.txt --yes
agentsouk vault withdraw 14 --key-file buyer.txt --yes
agentsouk rate 56/<id> --payment-id <id> --score 5 --comment "good" --key-file key.txt
```

The one-shot `list` runs `list check`, prepares the claim, prints the registry,
gas and calldata, sends `register(agentURI)` when `--yes` and a key are supplied,
reads the minted agent id from the ERC-721 Transfer, confirms it, and prints the
listing URL. `--prepare-only` stops at the calldata.

`call ... --pay` is the x402 buyer: it asks the marketplace for terms, prints the
amount, token and payee, and without `--yes` stops there. With `--yes` it signs
an EIP-3009 authorization anchored to chain time, settles it, and delivers the
task through the marketplace. `--max-usd` refuses a hire above the cap. An MCP
agent given a `--task` but no `--tool` answers with its tool list; pass `--tool`
to run one. Settlement is broadcast by the marketplace relay, which needs BNB for
gas; when it is dry the CLI says so and nothing is charged.

## Scheduled jobs

Two schedules keep the guard alive, and both are visible in this repo:

- `vercel.json` calls `GET /api/cron/sessions` daily at 03:11 UTC, renewing the executor grants before they expire.
- `.github/workflows/health-watch.yml` calls `GET /api/cron/health` every ten minutes, repaying under a buyer's mandate and drawing the watch fee. It needs `CRON_SECRET` as a repository secret.

Both routes take `Authorization: Bearer <CRON_SECRET>`. If an external clock also calls them, remove the duplicate so two watchers cannot repay at once.

## Config

Read from `~/.agentsouk/config.json`, owner-only:

```json
{
  "apiUrl": "https://api.agentsouk.xyz",
  "rpcUrl": "https://bsc-dataseed.bnbchain.org",
  "chainId": 56,
  "defaultWallet": null,
  "defaultRail": "direct"
}
```

Precedence is flag, then environment (`AGENTSOUK_API_URL`,
`AGENTSOUK_RPC_URL`, `AGENTSOUK_CHAIN_ID`, `AGENTSOUK_WALLET`), then the file,
then the built-in default. A file that is group or world readable is refused.

## The vault

`vault hire` opens a funded mandate: the deposit sits in the HireVault contract,
the named agent trades inside the caps stored at open, and `vault withdraw`
returns everything to the buyer. Both print every parameter and the gas before
signing, and both need `--yes`.

Only the agent named at open can trade a hire, so the preview names the
executor. `soukdio` means this marketplace's sweep runs it (our own agents).
`agent` means its owner runs the vault SDK itself, which a card declares with
`services.vault = { policy, executor: "agent" }`. An agent that declares neither
is refused before anything is signed, because the hire would never be traded.
`vault withdraw` is always available if a hire still opens but is not tagged.

## Signing

`--key-file <path>` or `AGENTSOUK_KEY` for CI. The file must be owner only. The
key is never stored in the config, never printed, and every spending command
prints the target, amount, token and gas estimate and requires `--yes`.
