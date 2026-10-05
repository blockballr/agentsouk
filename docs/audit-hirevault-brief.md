# HireVault audit brief

Written 2026-10-05 for the outside review that the mainnet flip is gated on.
This is a submission pack, not a report of findings: the facts a reviewer
needs are here so the review starts inside the design rather than rediscovering
it. Status line, stated once and meant: written, tested, never audited, never
deployed. Nothing in this document claims coverage, a clean bill, or a
signature that does not exist.

## Scope

One file carries the asset: contracts/src/HireVault.sol, 434 lines, no
imports outside the file, no contract inheritance, no proxy, no owner, no
upgrade path, no pause. It holds one funding model: a buyer deposits one of
two named tokens, names an agent, and the agent's only power is to swap the
deposit between those two tokens through a fixed PancakeSwap V3 router the
constructor stores.

Supporting material, in the same commit family on the altana-dependency
branch:

- contracts/test/HireVault.t.sol, 463 lines: 19 unit cases against mocks.
- contracts/test/HireVaultFork.t.sol, 173 lines: 2 fork cases against a live
  chain 97 PancakeSwap V3 pool, the fee-500 WBNB/USDT pool the contract exists
  to trade. These self-skip without --fork-url.
- scripts/deploy-hirevault.mjs: the chain 97 deploy script, uncommitted until
  its first real key exists by design.

Out of scope, though the reviewer may want them for contrast:
contracts/src/TestUSD.sol (the chain 97 settlement token) and
contracts/src/LivenessOracle.sol (a separate record contract, its own pack).

## The invariants the design claims

Each of these is stated so the reviewer can attack it, and each has at least
one test behind it. The strongest audit read is an invariant the suite fails
to hold.

1. Custody lives in the contract, never with the agent. The agent has no key
   to anything, and no path moves the deposit out except to the buyer.
2. Only the named agent may trade (msg.sender == h.agent), only an open hire
   (h.open), only before expiry (block.timestamp < h.expiry).
3. The floor is measured against a price the contract fixed at open. Open
   reads the pool's own accumulate over a 1800 second window via observe()
   and stores the result in the hire, along with the fee tier. trade() reads
   the stored value; it never reads slot0. The attack this closes is the
   sandwich: the test is testAnAgentSandwichingTheSpotCannotBeatTheStoredFloor.
4. The fee tier cannot be repointed by the caller. fee is bound at open, so a
   trade cannot aim at a thin pool of the agent's choosing.
5. minOut may only raise the floor, never lower it.
6. Books follow measured balances, not router returns. inBefore/outBefore
   frames the swap and the delta must equal amountIn (BadAmount) and give at
   least the floor (BelowFloor). A fee-on-transfer token therefore refuses at
   open (received != amount) rather than silently shrinking a hire.
7. Reentrancy: every entry point that moves tokens carries nonReentrant, and
   the lock lives in one uint256 slot. The three paths are open, trade and
   withdraw.
8. The revoke is the buyer's withdraw: unconditional, not gated on expiry,
   zeroes the hire before any external call, returns both tokens. Closing
   means trade() refuses forever after (NotOpen).
9. The drawdown budget: a hire's value at the OPEN reference price, expressed
   in token0 units, may never fall below depositInToken0 * minRetainedBps /
   10000, computed post-trade from measured balances. A settle-then-revert
   means the refused swap settles nothing. VALUE_SLACK of one million wei
   exists to absorb rounding, and is a review point precisely because it is
   the one number in the file chosen for convenience.
10. Caps are immutable per deployment (capA, capB integers the constructor
    stores), the pair is immutable (tokenA, tokenB), and the router/factory
    are immutable addresses. A malicious or paused router strands the ability
    to trade but never the ability to withdraw.

## Threats we want ranked, in our own words

- A malicious named agent: the sandwich fork test, the fee-tier binding at
  open, repeated bad trades and the drawdown budget, and trading right up to
  expiry. The agent CAN name itself (open accepts any nonzero address). The
  reviewer should say whether agent == buyer widens anything or nothing.
- A colluding agent plus the buyer's own staff: the hire's caps and budget
  are the only lines; there is no second layer.
- Token edge cases: hooked tokens, empty-returning tokens, malformed ret.
- Arithmetic: _mulDiv is the full 512 bit Remco-style loop, inline; the tick
  power series squares 1.0001 round by round at 1e18 scale, and report exact
  precision loss for realistic tick sizes both directions.
- Gas griefing: _byBuyer and _byAgent are unbounded arrays read whole by
  hiresOf/hiresFor; no loops touch them inside the contract, so reads pay,
  state does not lock. Review whether any path can be pushed into an
  unforseen loop by hire count.
- DoS by pool state: a pool with no accumulation across the window reverts
  NoPool at open. The reviewer should decide whether trade() should also
  refuse an empty pool on the floor lookup rather than relying on the
  stored price.

## Known limitations, stated by the design on purpose

- The reference price goes stale across a real drift. A legitimate market
  move can refuse a compliant fill (agent stranded, buyer withdraws), and a
  small adversarial drift inside the band still trades. The budget is the
  second line, not the first.
- One pair per deployment, one cap per token. Scaling means deploying more
  vaults, not upgrading one.
- There is no per-trade cap below the hire's balance and no partial send.
- No top-up, no renewal, no partial withdraw: a hire is one deposit and one
  revoke, all of it.
- No delegation or Permit2 path; the agent must be a signer of its own.

## How to reproduce everything claimed

    cd contracts && forge test                                 # 47 pass across 4 suites
    forge test --match-contract HireVaultForkTest --fork-url <chain 97 rpc>
    # the fork rpc used here: https://bsc-testnet-rpc.publicnode.com

Forge 0.8.24, no via-ir, no settings beyond the default. The tree is the
gate's tree: the same locked set of checks (lint, typecheck, vitest, forge,
conventions) ran before every commit on the altana branch.

## Static analysis record, 2026-10-05

Slither 0.11.6 ran the full detector set on HireVault.sol and returned 20
results across 9 categories, all informational-class against a contract that
needs no privileged role:

- incorrect-exp and divide-before-multiply fire on _mulDiv and _priceX96.
  The XOR the exp detector wants to be an exponent is the Newton iteration
  step from the standard mulDiv algorithm, and divide-before-multiply is that
  same step's truncation pattern. Both are the algorithm working as written,
  and both deserve a human glance rather than a detector's read.
- reentrancy-benign is the only reentrancy family hit, and the flows it
  annotates are the ones the reentrancy guard and the checks-effects order
  cover: balances zeroed before the transfers out.
- timestamp, assembly, low-level-calls, unused-return and cyclomatic
  complexity are the expected register for a file that does raw token calls
  and inline arithmetic. The timestamps flagged are the expiry comparisons,
  and the vault's horizons are 90 days, not block-relative payouts, so a
  validator's second-scale nudge does not move what they decide. Token calls
  behind _call are the toll of refusing both non-standard returns and
  fake-positive booleans.

Two more engines ran the same file inside a WSL Ubuntu environment after the
Windows passes, which is why the record below is four engines and not two.

Aderyn 0.6.8 returned two highs and five lows. Its H-1 is the same mulDiv XOR
that slither's incorrect-exp flagged, the second engine to want that caret to
be an exponent, and the second to be answered by the algorithm's own docs. Its
H-2 marks four state-after-external-call sites: the hire written after
transferFrom in open, and the books updated after the router swap in trade.
All four sit behind the nonReentrant lock, and trade's ordering is not a
convenience: the books must follow what actually moved, so writing them first
would be the real defect. The guard is the single line of defense on those
paths, and attacking it is a review question, not a settled matter. The lows
name TestUSD's ecrecover (out of this scope, nonce-guarded), literals in the
bps arithmetic and the 1e18 scale factors, and the bare requires inside the
mulDiv assembly, where there is nothing to say the assembly does not.

Mythril 0.24.8, symbolic execution over the same file with the compiler pinned
to 0.8.24 and a 240 second budget per path, completed with no issues detected.
That silence means its detector families, ether theft, unchecked delegatecall,
state-reachable integer underflow, delegatecall to caller input, found no
reachable path in the budget; it is one more engine agreeing, not a proof of
absence.

The first record of this section, written before the Linux run, said these two
engines "did not run". That was true on the Windows side only, and the
correction is part of the record rather than a quiet edit.

A second engine did run: the static analysis built into this toolchain's own
build (the portable parser behind forge) over the same file returned two
findings, both the block timestamp warnings on the expiry comparisons named
above, and nothing else. One engine that sees what slither's class of
detectors does not, and it saw only the expiry arithmetic.

The reproduction line above this section stays the source of truth for the
test suite.

## Deployment state

Not deployed anywhere. scripts/deploy-hirevault.mjs targets chain 97 with
caps of 1 WBNB and 20 USDT by env default, retained share of 5000 bps, and
the shared chain 97 PancakeSwap addresses already in the file. The oracle
addresses (ERC-8004 identity registry on chain 97 is
0x8004a818bfb912233c491871b3d84c89a494bd9e, which this repo reads for
identity already) go in the same package when the review clears.
