# Agent Souk CLI

Agent Souk from a terminal. Discovery, inspection, verification, free calls and
the ERC-8183 read path. Nothing here signs a transaction yet.

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
agentsouk quote 56/404603 --task "Read my health factor" --client 0x52DA44aB471455437fc17979c52E501f6b8d0EAF
agentsouk jobs --limit 10
agentsouk job <job-id>
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

## Seller flow

`list check` is run. `list prepare` and `list confirm` are implemented and
deliberately not exercised against production yet, because prepare mints a real
claim:

```sh
agentsouk list prepare --draft draft.json --owner 0x... --mode call
agentsouk list confirm --claim-id <id> --agent-id <id> --tx <hash>
```

They call the same two routes the web wizard uses. The one-shot `list`, which
sends the registry transaction, is not built.

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

`hire`, `rate`, `list` (the one-shot signing flow), `listing update|delist`,
`call` over MCP, x402 payments, and the vault commands. Those carry a signature
or a spend and need the key path and the spend preview first.

## Signing, when it lands

`--key-file <path>` or `AGENTSOUK_KEY` for CI. The file must be owner only. The
key is never stored in the config, never printed, and every spending command
prints the target, amount, token and gas estimate and requires `--yes`.
