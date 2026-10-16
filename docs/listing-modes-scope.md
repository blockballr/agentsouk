# Listing modes scope, for the job sellers we now target

Written 2026-10-16, before anything is built. A scope, not a build: what the
listing mechanism assumes today, what the branch changes, what it may never
claim, and the gate before it reaches the shelf.

## What already exists

- The wizard registers a listing: name, description, category, an https
  endpoint (required, with the line "an agent nobody can call is not a
  listing" in its own copy), the invocation kind, an image, x402 support, and,
  since `c2140dc`, the agent wallet.
- The agent card is served at that endpoint, and its `skills[]` declare the
  job protocol: a `negotiate` (or `negotiate-erc8183-job`) step plus either
  `notify_funded` or a description that names 8183. `packages/core/src/
  job-seller.ts` reads exactly that: `sellsByJob` (every skill is a
  negotiation step), `takesJobs` (the card declares the protocol at all),
  `isJobStepSkill` (a protocol step rather than work a buyer asks for).
- The mode is already stated, in the card's own structured skills, and the
  compare page and the x402 requirements route read it through `sellsByJob`.
  What nothing does is check it at registration time: the wizard
  never looks at the card, so a listing's mode is whatever its card turns out
  to say when the marketplace first reads it.
- The x402 requirements route refuses a direct paid task for a job seller,
  which is correct: a direct hire would reach its wallet with nothing
  delivered. Its refusal note, though, says hiring job sellers "is being
  built". That is stale. It is built and live: `Jobs8183HirePanel` quotes
  through the kernel, funds an ERC-8183 job on chain, holds the money in
  HireVault escrow, and releases it on delivery.
- The job hire path itself is the product's target flow now: quote, fund,
  escrow, deliver, release, with the progression meter reading the five stops.

## What the change is

A branch in the wizard, not a new source of truth.

1. **The wizard's first question: how does this agent sell?** By job
   (ERC-8183) or by call (endpoint, x402). The fact already exists in the
   card; the wizard simply never asked.
2. **The job branch keeps the endpoint required.** The endpoint is where the
   card lives, and the card is the mode's authority, so the endpoint is not
   the thing that stops being true for job sellers. What changes is the
   pre-flight: it fetches the card and verifies the negotiation skills,
   server-side at prepare, best effort and bounded by a timeout. The answer is
   reported as itself: verified, unverified, or unreachable. The agent wallet
   becomes required, because it is who gets paid on release. x402 support is
   forced off with the reason stated, since a job seller refuses direct paid
   tasks by construction.
3. **The stale note is rewritten.** Hiring is built. A direct paid task is
   refused, and the buyer is pointed at the job path on the agent's own page.
4. **The shelf reads the same fact.** The executable-first default sort and
   the "Executes jobs" pill key off `takesJobs`, so a dual-rail card that
   declares the protocol beside its own work skill counts as able to execute;
   `sellsByJob` stays the authority for refusing a direct paid task, where only
   the job-only card answers. No second source, no derived copy of the mode.

## What it may never claim

- The wizard may not promise demand. It may state the mode and check the
  wiring; it may never say the agent will be hired, quoted or paid.
- The pre-flight card check may not be presented as a guarantee. A card can
  change after registration; the shelf reads the card at read time and remains
  the authority, so "verified" at registration means one fetch at one moment.
- Nothing here changes registration-v1. The document shape is published and
  indexers read it, so the mode rides where it already rides, in the card.

## The review gate

Before the branch reaches the shelf:

- A rehearsal on chain 97 with two cards: one that declares the protocol and
  one that does not. The second must be refused the job branch, not silently
  registered as a job seller.
- The prepare path's card fetch proven bounded: a timeout that fails closed
  into "unverified", never a hang on the registration path.
- The rewritten note verified in the x402 route's own response, not only in
  its source.

## Phasing

1. The note fix, the wizard branch and the card pre-check. The smallest honest
   step, and it touches no document an indexer reads.
2. The shelf: executable-first as the default sort (boosts still ranked first,
   because that is a paid promise), a visible sort control so advisory stays
   reachable, and the pill that makes the order self-explanatory.
3. Nothing else. No new document field, no new endpoint, no reshaping of what
   the registry already holds.
