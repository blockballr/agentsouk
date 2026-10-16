# Wallet session scope, for the identity the provider cannot give

Written 2026-10-16, before anything is built. A scope, not a build: what the
connection mechanism assumes today, what the session changes, what it may never
claim, and the gate before it reaches the page.

## What already exists

- `apps/web/src/lib/wallet.ts` is an EIP-1193 client with EIP-6963 discovery
  and WalletConnect. "Connected" today means: a stored wallet choice
  (`storeRdns`), whatever `eth_accounts` answers, and listeners attached to the
  provider.
- Since `b8a6681`, an `accountsChanged` the wallet reports moves every surface
  that shows the address: `watchActiveAccount` feeds `useActiveAccount`, which
  10 files render from. An empty account list, or leaving BSC, drops the
  connection. `activeAccountMatches` re-reads the provider at sign time as a
  belt-and-braces check.
- The reported failure: switching account inside the wallet does not move the
  page until the wallet's own connect is pressed for the new account; until
  then the page keeps showing the first wallet. The wallet decides what it
  reports, and the page mirrors it as identity, which is the wrong layer: the
  address a wallet happens to have selected is not a decision by the user to
  act as that address.
- `apps/web/src/lib/station.ts` already signs in the team station the right
  shape: fixed message, server-issued nonce, signature, bearer session. That
  surface is separate and unchanged by this scope; its message discipline is
  what the marketplace session mirrors.

## What the change is

A session between the wallet and the page, proved by a signature.

1. **Connect ends in a sign-in.** After `eth_requestAccounts`, the wallet
   signs one fixed message naming the site, the address and the issue time.
   The client verifies it locally with `recoverMessageAddress` and stores the
   record for that address in this browser. Decline the signature and nothing
   is stored: the page stays disconnected, with the refusal stated. The
   signature costs nothing, creates no transaction, and is verified byte for
   byte against the exact text that was shown.
2. **The session is the identity the page shows.** `useActiveAccount` reads
   the signed-in address instead of `eth_accounts[0]`; surfaces do not change,
   the source under them does. The wallet's raw events are still watched, but
   only the session layer subscribes to them.
3. **A switch adopts or disconnects, never impersonates.** On
   `accountsChanged`: an address with a valid stored record is adopted as the
   session, since this browser was authorized for it before; any other address
   ends the session and the page shows disconnected; an empty list ends the
   session as it does today. A chain change away from BSC ends the session as
   it does today, and returning re-adopts only if the record still verifies.
   Disconnect clears the active session and keeps the records; sign-out
   clears one address's record.
4. **Sign time still compares against the wallet.** `activeAccountMatches`
   takes the signed-in address, so a wallet that reports a different active
   account refuses before any signature is asked for.

## What it may never claim

- The record is this browser's authorization, not a server login. No server
  route gains a gate from it: owner actions keep their own per-message
  signatures, escrow stays key-gated, the station keeps its own session.
- A record is not proof of present intent. It lives until sign-out or the
  browser forgets it; it never expires and the page must not imply it did.
- The page cannot see a switch the wallet does not report. When the wallet is
  silent, the session stands and the divergence surfaces at the next
  signature, where the wallet itself demands the right account.
- Adoption is keyed by address, not by wallet brand: the same address proven
  again is the same identity, whichever wallet carries it.

## The review gate

Before the session reaches the page, each of these is rehearsed in a browser
with a stubbed provider, then on chain 97 with two wallets:

- Switch to an address that never signed in: the page shows disconnected, not
  the old address and not the new one.
- Switch back to an address that signed in before: the page adopts it with no
  prompt.
- Decline the signature at connect: nothing is stored, the page stays
  disconnected, and the copy says the sign-in was declined.
- Leave BSC and return: disconnected on the other chain, signed in again on
  return when the record verifies.
- Ask for a signature while the wallet's active account differs from the
  session: refused before the wallet opens.

## Phasing

1. The session store, the sign-in step in the connect flow, the
   adopt-or-disconnect rules, and `useActiveAccount` repointed at the session,
   with tests for the rules and the proof above. One change, one gate.
2. Nothing else. No server session, no nonce endpoints, no station change, no
   change to registration or to what an owner signature already gates.
