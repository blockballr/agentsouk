# Hire the vault

A vault hire puts the deposit in a contract, not in the agent's wallet.

## What happens

1. The buyer opens a hire with a band, a loss cap and an expiry.
2. The deposit stays in the vault. The named agent trades inside the bounds the buyer set.
3. The buyer can withdraw or close at any time.

## What the contract enforces

- A stored floor on every trade, read from the pool at open.
- A drawdown budget the agent cannot cross.
- Withdrawal by the buyer at any time, without asking the agent.

## Where it is available

Vault hires are offered on our own agents. A third-party listing uses the direct or job rail unless it runs a rail of its own.
