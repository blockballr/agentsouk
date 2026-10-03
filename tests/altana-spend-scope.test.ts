// Does an Altana spend permission bound a direct token transfer, a contract-mediated swap,
// or neither? This is the question the mandate test could not answer, because both its
// permitted and its over-cap swap reverted with the same error and the revert could not be
// attributed to the cap.
//
// Two calls, same live session, same cap. The only difference is who moves the token:
//
//   transfer(to, amount)          the account moves WBNB itself
//   router.exactInputSingle(...)  the account calls a contract that moves WBNB
//
// Reading the outcomes together is what settles it:
//   transfer under cap succeeds, transfer over cap reverts ExceedsCapacity
//     -> the cap is real, and it does not reach a contract-mediated swap
//   both transfers revert NoSpendPermissions
//     -> the granted permission is not being persisted in the form the account expects
//
// Nothing here touches mainnet. Every address and pool is chain 97.

import { describe, expect, it, beforeAll } from 'vitest'
import { createPublicClient, http, parseEther, parseUnits, encodeFunctionData, toFunctionSelector } from 'viem'
import { bscTestnet } from 'viem/chains'
import { BNB_TESTNET, createClient, signerFromPrivateKey, type Call } from '@altananetwork/sdk'
import { buildRungFill } from '@/lib/grid-fill'
import { privateKeyToAccount } from 'viem/accounts'

const WBNB = '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd' as const
const USDT = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd' as const
const ROUTER = '0x1b81D678ffb9C0263b24A97847620C99d213eB14' as const
// The 500 tier pool, confirmed on chain with 30.9B liquidity against 187M on the 100 tier.
const POOL = '0x2dbB5a4c235164B9f772179A43faca2c71a8abDB' as const
const POOL_FEE_BPS = 5
// The relay wallet, as the transfer destination. It is a real address on chain 97 and is
// not the router, which is the whole point: a different callee.
const SINK = '0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4' as const
const CHAIN_ID = 97
const FEE = 500

// The cap is a ROLLING daily window: it accumulates across every run in the day rather than
// resetting per transaction, so a run spends UNDER twice, once for the transfer and once for
// the swap. A cap of 0.01 exhausted after five runs, which made the under-cap case report
// ExceededSpendLimit for having spent an earlier run's budget. 0.1 leaves room for many runs.
//
// OVER must sit inside the account's balance. I assumed the cap was validated before
// execution so it need not be, and the relay refused it at prepare time with -32602
// "please assign". So the account holds ~0.03 WBNB, which bounds OVER.
//
// The period is an hour, not a day, and that is deliberate. A day window accumulates across
// every run in the day rather than resetting per transaction, so repeated runs exhaust it and
// the under-cap case then reports ExceededSpendLimit for having spent an earlier run's
// budget. An hourly window rolls often enough that the test is repeatable, and it exercises
// exactly the same enforcement.
const CAP_PERIOD = 'hour' as const
const CAP_WBNB = parseEther('0.01')
// Native cap exists to pay relay fees. It is not the trading cap.
const NATIVE_CAP = parseEther('0.05')
const UNDER = parseEther('0.0002')
const OVER = parseEther('0.02')

const walletKey = process.env.ALTANA_SANDBOX_PRIVATE_KEY
const sessionKey = process.env.ALTANA_SANDBOX_SESSION_KEY
const configured = Boolean(walletKey && sessionKey)

const TRANSFER = toFunctionSelector('transfer(address,uint256)')
const APPROVE = toFunctionSelector('approve(address,uint256)')
const word = (v: bigint) => v.toString(16).padStart(64, '0')
const addrWord = (a: string) => a.slice(2).padStart(64, '0')

const transferCall = (to: string, amount: bigint): Call => ({
  to: WBNB,
  data: `${TRANSFER}${addrWord(to)}${word(amount)}`,
})

// The account is a smart account, so the router cannot pull WBNB from it without an
// allowance. Without this the swap reverts with empty data and the cap is never consulted.
const approveRouter = (amount: bigint): Call => ({
  to: WBNB,
  data: `${APPROVE}${addrWord(ROUTER)}${word(amount)}`,
})

/** PancakeSwap V3's swap, encoded by viem from the ABI rather than by hand.
 *
 *  Hand-encoding was the original bug and it cost several rounds. toFunctionSelector on both
 *  the six-field and the eight-field signature yields a selector this router does not have,
 *  so the call dispatched into nothing and reverted with empty data, which looks identical to
 *  a permission failure. encodeFunctionData over the same tuple produces 0x414bf389, the
 *  router accepts it, and a simulation then reports STF for the missing allowance instead of
 *  a bare revert. The tuple is ISwapRouterV3 from contracts/src/HireVault.sol, which was
 *  written against this router. */
const ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

/** The recipient is the account itself, so the proceeds stay where the mandate can see them.
 *  A zero recipient is refused by the router, also with a bare revert. */
const swapCall = (recipient: `0x${string}`, amountIn: bigint, minOut: bigint, deadline: number): Call => ({
  to: ROUTER,
  data: encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: WBNB,
        tokenOut: USDT,
        fee: FEE,
        recipient,
        deadline: BigInt(deadline),
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  }),
})

/** 0x08c379a0 is the standard Error(string) selector, so the revert carries a reason we can
 *  read. Without decoding it a router refusal looked identical to an unexplained failure, which
 *  is how a wrong floor and a right one both read as merely "reverted". */
function decodeErrorString(hex: string): string | null {
  const body = hex.replace(/^0x/, '')
  if (!body.startsWith('08c379a0')) return null
  try {
    const len = parseInt(body.slice(10, 74), 16) * 2
    const bytes = body.slice(74, 74 + len)
    let out = ''
    for (let i = 0; i < bytes.length; i += 2) {
      out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16))
    }
    return out.replace(/\0/g, '').trim()
  } catch {
    return null
  }
}

/** Distinguishes the account errors, because that distinction is the whole finding.
 *  ExceededSpendLimit means a spend permission matched and the limit was blown, which is the
 *  proof we want. ExceedsCapacity is solady's EnumerableSet capacity error and has nothing to
 *  do with spend limits, so it must not be read as an over-cap result. */
function classify(err: unknown): string {
  const text = JSON.stringify(err) + String(err)
  if (/ExceededSpendLimit/.test(text)) return 'ExceededSpendLimit'
  if (/ExceedsCapacity/.test(text)) return 'ExceedsCapacity'
  if (/NoSpendPermissions/.test(text)) return 'NoSpendPermissions'
  if (/UnauthorizedCall/.test(text)) return 'UnauthorizedCall'
  if (/Unauthorized/.test(text)) return 'Unauthorized'
  if (/InvalidNonce/.test(text)) return 'InvalidNonce'
  // The revert hex shows up as `data: '0x...'` in some serialisations and as
  // "details":"0x..." in others, so match either rather than assume one shape.
  const full =
    text.match(/data:\s*'(0x[0-9a-f]+)'/) ?? text.match(/"(?:data|details)":\s*"(0x[0-9a-f]+)"/)
  if (full) {
    const hex = full[1]
    const reason = decodeErrorString(hex)
    if (reason) return `reverted ${reason}`
    return `revert ${hex.slice(0, 10)}`
  }
  const msg = text.match(/shortMessage: '([^']*)'/)
  return msg ? msg[1] : `unclassified: ${text.slice(0, 120)}`
}

describe.skipIf(!configured)('what an Altana spend permission actually bounds', () => {
  const client = createClient({ chains: [BNB_TESTNET] })
  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http('https://bsc-testnet.publicnode.com'),
  })
  // Built inside beforeAll, not here. A describe body runs at collection time even when the
  // suite is skipped, so deriving a signer from an absent key throws while the file is still
  // loading. That is how this test broke a clean run before it ever reached its own skip.
  let adminSigner: ReturnType<typeof signerFromPrivateKey>
  let wallet: Awaited<ReturnType<typeof client.createWallet>>
  let session: Awaited<ReturnType<typeof client.grantSession>>
  const outcomes: string[] = []

  async function balanceOf(token: `0x${string}`, who: string) {
    return publicClient.readContract({
      address: token,
      abi: [
        {
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ type: 'address' }],
          outputs: [{ type: 'uint256' }],
        },
      ],
      functionName: 'balanceOf',
      args: [who as `0x${string}`],
    })
  }

  beforeAll(async () => {
    adminSigner = signerFromPrivateKey(walletKey as `0x${string}`)
    wallet = await client.createWallet({ signer: adminSigner })

    // REVOKE FIRST, THEN GRANT. Without this the test is not repeatable.
    //
    // The spend window is keyed per (account, sessionKeyHash, token, period) and it
    // accumulates across every run rather than resetting per transaction, so a long lived
    // session key burns its budget once and stays spent for the rest of the calendar period.
    // Measured on chain earlier today: the WBNB day row read 140% of its 0.01 limit while the
    // freshly added hour row read 0%.
    //
    // Neither a larger cap nor a shorter period clears it. setSpendLimit overwrites limit and
    // preserves spent, and it only ever ADDS a period without removing the old one, while
    // _incrementSpent reverts if ANY registered period is over. Revoke does clear it: removing a
    // key bumps the storage seed, so the same keyHash lands on a virgin slot with zeroed
    // counters. The contract's own header says so: "when a spend permission is removed and
    // re-added, its spent amount will be reset".
    //
    // The stored publicKey for a secp256k1 key is the 20 byte address derived from it, so the
    // public key to revoke is derived rather than carried across runs.
    const sessionAddress = privateKeyToAccount(sessionKey as `0x${string}`).address
    try {
      await client.revokeSession({
        wallet,
        signer: adminSigner,
        session: sessionAddress,
        chainId: CHAIN_ID,
      })
      outcomes.push('revoked the previous session, so the window starts empty')
    } catch {
      // Nothing to revoke on a first run. Not an error worth failing over.
      outcomes.push('no previous session to revoke')
    }

    session = await client.grantSession({
      wallet,
      signer: adminSigner,
      chainId: CHAIN_ID,
      sessionSigner: signerFromPrivateKey(sessionKey as `0x${string}`),
      register: false,
      permissions: {
        // The native cap is not optional. The relay takes each transaction's fee out of the
        // session's native spend cap, so a session without one has every bundle rejected
        // before inclusion, and the token cap below is never even consulted. Altana's docs
        // are explicit that a near-zero native cap "creates a session that can never execute
        // a single transaction". The token omitted means native.
        spend: [
          { limit: NATIVE_CAP, period: CAP_PERIOD },
          // WBNB is 18 decimals on BNB, so limit is in the smallest unit.
          { token: WBNB, limit: CAP_WBNB, period: CAP_PERIOD },
        ],
        // both callees, so the call scope cannot be what fails either experiment
        calls: [{ to: ROUTER }, { to: WBNB }, { to: SINK }],
      },
      expiry: Math.floor(Date.now() / 1000) + 60 * 60,
    })

    // Record the starting position so a transfer can be shown to have moved the balance
    // rather than merely not throwing.
    const start = await balanceOf(WBNB, SINK)
    let sinkStart = start
    try {
      await client.execute({ session, calls: [transferCall(SINK, UNDER)], chainId: CHAIN_ID })
      outcomes.push('transfer under cap: SUCCEEDED')
    } catch (e) {
      outcomes.push(`transfer under cap: ${classify(e)}`)
    }
    sinkStart = await balanceOf(WBNB, SINK)
    if (sinkStart > start) outcomes.push(`  sink balance rose by ${UNDER} wei units`)

    try {
      await client.execute({ session, calls: [transferCall(SINK, OVER)], chainId: CHAIN_ID })
      outcomes.push('transfer over cap: SUCCEEDED')
    } catch (e) {
      outcomes.push(`transfer over cap: ${classify(e)}`)
    }

    const deadline = Math.floor(Date.now() / 1000) + 300

    try {
      await client.execute({
        session,
        calls: [approveRouter(UNDER), swapCall(wallet.address, UNDER, 1n, deadline)],
        chainId: CHAIN_ID,
      })
      outcomes.push('swap under cap: SUCCEEDED')
    } catch (e) {
      outcomes.push(`swap under cap: ${classify(e)}`)
    }

    try {
      await client.execute({
        session,
        calls: [approveRouter(OVER), swapCall(wallet.address, OVER, 1n, deadline)],
        chainId: CHAIN_ID,
      })
      outcomes.push('swap over cap: SUCCEEDED')
    } catch (e) {
      outcomes.push(`swap over cap: ${classify(e)}`)
    }
  }, 900_000)

  it('admits a fill inside the cap and refuses one outside it, for transfers and swaps alike', () => {
    // These are the assertions this file existed to earn. It ran as a measurement first and
    // the four outcomes were SUCCEEDED, ExceededSpendLimit, SUCCEEDED, ExceededSpendLimit,
    // so they are recorded here rather than assumed.
    //
    // ExceededSpendLimit and NoSpendPermissions are different failures and the difference is
    // the whole finding: ExceededSpendLimit means a spend permission matched and the limit
    // was blown, NoSpendPermissions means none matched at all. Asserting the former is what
    // stops this test passing for the wrong reason.
    const under = outcomes.filter((o) => o.startsWith('transfer under cap'))
    const overTransfer = outcomes.filter((o) => o.startsWith('transfer over cap'))
    const underSwap = outcomes.filter((o) => o.startsWith('swap under cap'))
    const overSwap = outcomes.filter((o) => o.startsWith('swap over cap'))

    expect(under).toEqual(['transfer under cap: SUCCEEDED'])
    expect(overTransfer).toEqual(['transfer over cap: ExceededSpendLimit'])
    expect(underSwap).toEqual(['swap under cap: SUCCEEDED'])
    expect(overSwap).toEqual(['swap over cap: ExceededSpendLimit'])
  })

  it('moved the balance on the permitted transfer, rather than merely not throwing', () => {
    // Without this, a swap that reverts for an unrelated reason and a transfer that no-ops
    // would both read as SUCCEEDED.
    expect(outcomes).toContain('  sink balance rose by 200000000000000 wei units')
  })

  it('granted exactly the permissions asked for', () => {
    expect(session.permissions.spend?.[0]?.token).toBeUndefined() // native, for relay fees
    expect(session.permissions.spend?.[0]?.limit).toBe(NATIVE_CAP)
    expect(session.permissions.spend?.[1]?.token?.toLowerCase()).toBe(WBNB.toLowerCase())
    expect(session.permissions.spend?.[1]?.limit).toBe(CAP_WBNB)
    // the call scope is what stops the cap being the only control, so it is asserted too
    expect(session.permissions.calls?.map((c) => ('to' in c ? c.to : undefined)?.toLowerCase()).sort()).toEqual(
      [ROUTER, WBNB, SINK].map((a) => a.toLowerCase()).sort(),
    )
  })

  it('completes a swap whose floor comes from the rung, and reverts one whose floor is unreachable', async () => {
    // The cap proves the agent cannot spend past its limit. It says nothing about what it
    // pays for what it spends, which is the floor's job. This is the floor's proof: a floor
    // derived from a rung the plan published must pass at the market price, and a floor the
    // market cannot reach must revert in the router rather than fill.
    //
    // The rung is read from the live pool rather than pinned, so the passing case cannot fail
    // merely because the market drifted away from a constant recorded hours ago.
    const slot0 = await publicClient.readContract({
      address: POOL,
      abi: [
        {
          name: 'slot0',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [
            { type: 'uint160' },
            { type: 'int24' },
            { type: 'uint16' },
            { type: 'uint16' },
            { type: 'uint16' },
            { type: 'uint32' },
            { type: 'bool' },
          ],
        },
      ],
      functionName: 'slot0',
    })
    // slot0 is token1 per token0. token0 is USDT and token1 is WBNB, so the raw price is WBNB
    // per USDT. rungUsd is USD per unit of BASE, which is the reciprocal. Passing the raw
    // price put the rung ~100x too low, which made the floor trivially reachable and the
    // "unreachable floor" case pass without reverting.
    const wbnbPerUsdt = (Number(slot0[0]) / 2 ** 96) ** 2
    const spotUsd = 1 / wbnbPerUsdt

    const fill = buildRungFill({
      side: 'sell',
      rungUsd: spotUsd,
      orderSizeUsd: Number(UNDER) / 10 ** 18 * spotUsd,
      feeBps: POOL_FEE_BPS,
      maxSlippageBps: 500,
      baseToken: WBNB,
      quoteToken: USDT,
    })
    const rungFloor = parseUnits(fill.amountOutMinimum.toFixed(6), 18)
    const unreachable = rungFloor * 100n

    const deadline = Math.floor(Date.now() / 1000) + 300

    await client.execute({
      session,
      calls: [approveRouter(UNDER), swapCall(wallet.address, UNDER, rungFloor, deadline)],
      chainId: CHAIN_ID,
    })
    outcomes.push(`floor from the rung (${fill.amountOutMinimum.toFixed(6)} USDT): SUCCEEDED`)

    let refused = 'DID NOT REVERT'
    try {
      await client.execute({
        session,
        calls: [approveRouter(UNDER), swapCall(wallet.address, UNDER, unreachable, deadline)],
        chainId: CHAIN_ID,
      })
    } catch (e) {
      refused = classify(e)
    }
    outcomes.push(`floor the market cannot reach (x100): ${refused}`)

    // Asserted here rather than left to the printed report. Without this the floor proof was
    // an observation: the test would still have passed if the router had stopped enforcing it.
    expect(refused).not.toBe('DID NOT REVERT')
    // the router refuses on its own terms, not on the account's cap, so this must NOT be an
    // account spend error. If it ever reads ExceededSpendLimit the floor was never reached.
    expect(refused).not.toMatch(/ExceededSpendLimit|NoSpendPermissions/)
    // and it should say why
    expect(refused).toMatch(/reverted|Too little|TooLittle/i)
  }, 600_000)

  it('prints the outcomes, so a failure on chain says what actually happened', () => {
    console.log('\n--- the Altana mandate on chain 97 ---')
    for (const line of outcomes) console.log(`  ${line}`)
    console.log(`  cap ${CAP_WBNB} WBNB per day, native cap ${NATIVE_CAP} for relay fees`)
    console.log('--- end ---\n')
    expect(outcomes.length).toBeGreaterThanOrEqual(5)
  })
})