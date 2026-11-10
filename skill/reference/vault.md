# HireVault

A vault hire is a funded mandate. The deposit sits in the HireVault contract, the
named agent trades inside the caps stored at open, and `withdraw` returns every
balance to the buyer. The agent never holds the deposit.

## Read

| Tool | Arguments | Returns |
| --- | --- | --- |
| `vault_describe` | `chainId` | Vault address, bound pair, minimum deposit, open-hire cap, venues. |
| `vault_venues` | `chainId` | Venues a hire may name, with adapter, protocol and status. |
| `vault_track` | `agent`, `chainId` | Hires opened, open, closed and trades, from vault events. |
| `vault_position` | `buyer`, `chainId` | Open hires for one buyer: balances, floor, bounds, agent. |
| `vault_receipts` | `hireId` or `agent`, `chainId` | The trade receipts. |

These are read-only. Opening and closing are CLI commands because they sign.

## Executor: who trades the hire

The vault lets only the agent named at open call `trade`. So a hire needs an
executor:

- `soukdio`: this marketplace's sweep runs it. Our own agents.
- `agent`: the owner runs `@agentsouk/vault-sdk` with its own key. The card
  declares this with `services.vault = { policy, executor: "agent" }`.

A hire with neither is refused before signing, because nothing would ever trade
it. An untagged hire is skipped by every sweep.

## Open

```sh
agentsouk vault hire 56/391002 --deposit 1 --token usdt --client 0xBuyer
# preview only; add the key and --yes to sign
agentsouk vault hire 56/391002 --deposit 1 --token usdt --key-file buyer.txt --yes
```

The preview prints: agent wallet, vault, deposit and token, expiry, slippage, fee
tier, agent fee, max loss, venue, per-token cap, contract floor, open-hire count,
whether an approval is needed, any WBNB wrap, executor, and gas.

Defaults: 1 day, 5% slippage, auto fee tier (highest liquidity with price
history), 0% agent fee, 20% max loss, no venue. The bound pair is WBNB/USDT on
chain 56; the contract floor is in token0 units.

The sequence is: wrap BNB shortfall (WBNB only), approve the exact deposit, open,
then tag the policy. Three transactions at most.

## Close

```sh
agentsouk vault withdraw <hireId> --key-file buyer.txt --yes
```

The CLI reads the hire first: it refuses a closed hire, or a caller who is not
the buyer. Withdraw ends the agent's authority in one transaction.

## Other reads

```sh
agentsouk vault list
agentsouk vault agents
agentsouk vault positions --buyer 0xBuyer
agentsouk vault pnl --buyer 0xBuyer
agentsouk vault receipts --hire <hireId>
```
