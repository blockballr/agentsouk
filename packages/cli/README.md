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
agentsouk verify 56/404603
agentsouk call 56/404603 --task "Collateral 1000 USD, debt 600 USD, threshold 0.8. What is the health factor?"
agentsouk quote 56/404603 --task "Read my health factor" --client 0x1111111111111111111111111111111111111111
agentsouk jobs --limit 10
agentsouk job <job-id>
agentsouk listing show 56/376435
agentsouk vault list
agentsouk vault agents
agentsouk vault positions --buyer 0x1111111111111111111111111111111111111111
agentsouk vault pnl --buyer 0x1111111111111111111111111111111111111111
agentsouk vault receipts --hire 7
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

## Seller flow, implemented and not yet exercised end to end

These mint a real claim or send a transaction, so they have not been run against
production:

```sh
agentsouk list --draft draft.json --key-file key.txt --yes
agentsouk list --draft draft.json --owner 0x... --prepare-only
agentsouk list prepare --draft draft.json --owner 0x...
agentsouk list confirm --claim-id <id> --agent-id <id> --tx <hash>
agentsouk listing delist 56/<id> --key-file key.txt
agentsouk listing relist 56/<id> --key-file key.txt
agentsouk rate 56/<id> --payment-id <id> --score 5 --comment "good" --key-file key.txt
```

The one-shot `list` runs `list check`, prepares the claim, prints the registry,
gas and calldata, sends `register(agentURI)` when `--yes` and a key are supplied,
reads the minted agent id from the ERC-721 Transfer, confirms it, and prints the
listing URL. `--prepare-only` stops at the calldata.

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

## Not built yet

`hire` (creating and funding an ERC-8183 job on chain), `listing update`, `call`
over MCP, x402 payments, and the vault commands. Those carry a spend or a larger
contract surface and need the spend preview and tests before they ship.

## Signing

`--key-file <path>` or `AGENTSOUK_KEY` for CI. The file must be owner only. The
key is never stored in the config, never printed, and every spending command
prints the target, amount, token and gas estimate and requires `--yes`.
