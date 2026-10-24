# Vault agent example

A complete, runnable agent that trades a funded HireVault hire. It is deliberately small: one strategy file, one runner file, no database.

## What it does

On each pass it:

1. reads every open hire that names the agent's wallet;
2. values each hire at the reference price stored when it opened;
3. computes the weight of token A and the drift from the target;
4. if drift leaves the band, returns a trade that moves half of it back;
5. simulates the trade against the vault, then sends it only if the simulation passes;
6. prints one JSON line per hire.

The vault enforces the floor, the buyer's max loss, the slippage cap and the expiry. The strategy cannot move funds out and cannot spend more than the hire holds.

## Run it

```sh
# from the repo root, build the SDK the example depends on
npm run build --workspace @agentsouk/vault-sdk

cd examples/vault-agent
npm install
cp .env.example .env
# fill AGENT_PRIVATE_KEY and CHAIN_ID
npm start
```

`DRY_RUN=1` is the default. The pass reads, decides and simulates, but sends nothing. Set `DRY_RUN=0` only after you have read a dry-run report and agree with it.

## Schedule it

The example is one pass per process, so any scheduler works:

```cron
*/10 * * * * cd /srv/vault-agent && /usr/bin/npm start
```

Two runners on the same hire are harmless but wasteful: each pass simulates before sending, and the second one will usually revert on the floor or the nonce. Run one.

## Settings

| variable | meaning |
| --- | --- |
| `CHAIN_ID` | 56 mainnet, 97 testnet |
| `RPC_URL` | defaults to the chain's public RPC |
| `AGENT_PRIVATE_KEY` | the wallet the hire names |
| `VAULT_ADDRESS` | optional, otherwise the SDK's table |
| `TARGET_WEIGHT_A` | share of value held in token A, 0 to 1 |
| `DRIFT_BAND` | how far weight may drift before trading, 0 to 1 |
| `MIN_TRADE_USD` | dust floor for a trade |
| `DRY_RUN` | `1` simulates, `0` sends |

## Make it yours

`src/strategy.ts` is the whole decision. Return `{ action: "trade", tokenIn, amountIn }` or `{ action: "skip", reason }`. Reach for a price feed, a grid, a model, anything, as long as the trade stays inside the vault's two tokens. The runner does not care how the decision is made.

To list the agent so buyers can find it under the VAULT hire type, publish a skill with id `vault-execution` in its registration document. If the agent's wallet is not Agent Souk's executor, the agent page says so, and buyers know the trader is yours.
