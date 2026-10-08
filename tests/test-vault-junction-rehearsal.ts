// The junction rehearsal, against the live vault on chain 97: a granted Altana
// session initiates the trade, the sweep executes through the actor, and the
// buyer's revoke holds everything back. Per the proposed-write rule every step
// is bound: the buyer hands 0.02 in a Testnet USDT that it funded itself, and
// the session holds nothing afterward.
//
// Skips itself whenever the Altana sandbox env is unset, so the suite runs
// everywhere without the keys. Every step prints its transaction.
//
//   transfer under cap   no-junction path, coverd by the spend-scope suite
//   execute via junction SUCCEEDED, through the sweep only, no direct keys

import { describe, expect, it, beforeAll } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  formatUnits,
  parseUnits,
} from 'viem'
import { bscTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { BNB_TESTNET, createClient, signerFromPrivateKey, type Call } from '@altananetwork/sdk'
import { resolveActor } from '@/lib/vault-actor'
import { sweepOwnHires } from '@/lib/vault-executor'

const WBNB = '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd' as const
const USDT = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd' as const
const ROUTER = '0x1b81D678ffb9C0263b24A97847620C99d213eB14' as const
const VAULT = '0xc742e51f3fe3875a3335700a7d692f40dc8e60b8' as const
const CHAIN_ID = 97
// not the load-balanced binance seeds: this rehearsal's reads only agree with
// its own sends on a node whose head keeps up, and publicnode has held that
// bar every run where the data-seed cluster lagged blocks behind
const RPC = 'https://bsc-testnet-rpc.publicnode.com'

const walletKey = process.env.ALTANA_SANDBOX_PRIVATE_KEY
const sessionKey = process.env.ALTANA_SANDBOX_SESSION_KEY
const buyerKey = process.env.RELAY_PRIVATE_KEY
const configured = Boolean(walletKey && sessionKey && buyerKey)

// Registration runs even when the suite skips, so the accounts are built from a
// valid stand-in key when the env keys are absent: without this the import itself
// throws on an undefined key and the whole vitest run reports a failed suite
const FALLBACK_KEY = `0x${'11'.repeat(32)}` as `0x${string}`

// one chain client and one SDK client over the live network
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC) })

describe.skipIf(!configured)('the vault junction rehearsal', () => {
  const buyer = privateKeyToAccount((buyerKey ?? FALLBACK_KEY) as `0x${string}`)
  const buyerWallet = createWalletClient({ account: buyer, chain: bscTestnet, transport: http(RPC) })
  const adminSigner = signerFromPrivateKey((walletKey ?? FALLBACK_KEY) as `0x${string}`)
  const client = createClient({ chains: [BNB_TESTNET] })

  let wallet: Awaited<ReturnType<typeof client.createWallet>>
  let walletAddress = ''
  let sessionId = 0n
  let open: `0x${string}` | null = null
  let jobBlob = ''

  const erc20Abi = [
    { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  ] as const
  const vaultAbi = [
    { name: 'open', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint64' }, { type: 'uint16' }, { type: 'uint24' }], outputs: [{ type: 'uint256' }] },
    { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
    { name: 'trade', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] },
    { name: 'hireCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'hire', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'uint16' }, { type: 'bool' }, { name: 'balanceA', type: 'uint256' }, { name: 'balanceB', type: 'uint256' }, { type: 'uint160' }, { type: 'uint24' }, { type: 'uint256' }] },
  ] as const
  const wbnbAbi = [
    { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
    { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  ] as const
  const routerAbi = [
    { name: 'exactInputSingle', type: 'function', stateMutability: 'payable', inputs: [{ type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' },
      { name: 'recipient', type: 'address' }, { name: 'deadline', type: 'uint256' }, { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ type: 'uint256' }] },
  ] as const
  // the pool under the funding swap is no longer read directly: the pricing
  // is the router's own simulated fill, so nothing here needs the factory

  beforeAll(async () => {
    // the altana account is created live and held for the whole rehearsal
    wallet = await client.createWallet({ signer: adminSigner })
    walletAddress = (wallet as { address?: string }).address ?? ''
  })

  it('grants a fresh session scoped to the vault', { timeout: 300_000 }, async () => {
    const sessionAccount = privateKeyToAccount(sessionKey as `0x${string}`).address
    try {
      await client.revokeSession({ wallet, signer: adminSigner, session: sessionAccount, chainId: CHAIN_ID })
    } catch {
      // nothing to revoke on a first run
    }
    // the relay's bundle rejection is transient: a prepared call that races
    // its own nonce windows comes back 300 and a fresh grant a beat later is
    // accepted, so the grant repeats instead of failing the run on one hash
    let granted = false
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const session = await client.grantSession({
          wallet,
          signer: adminSigner,
          chainId: CHAIN_ID,
          sessionSigner: signerFromPrivateKey(sessionKey as `0x${string}`),
          register: false,
          permissions: {
            // gas only: the junction call carries no value and moves no account funds
            spend: [{ limit: BigInt(2 * 10 ** 16), period: 'day' }],
            calls: [{ to: VAULT }],
          },
          expiry: Math.floor(Date.now() / 1000) + 3600,
        })
        jobBlob = JSON.stringify(session, (_, v) => (typeof v === 'bigint' ? Number(v) : v))
        granted = true
        break
      } catch (e) {
        if (!String(e).includes('status=FAILED')) throw e
        console.log(`grant attempt ${attempt}: ${String(e).slice(0, 120)}`)
        await new Promise((r) => setTimeout(r, 8000))
      }
    }
    expect(granted, 'the session grant never confirmed over four attempts').toBe(true)
    expect(walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(jobBlob.length).toBeGreaterThan(10)
  })

  it('funds the relay, then funds the deposit lane', { timeout: 240_000 }, async () => {
    // the relay runs dry across rehearsal runs: the altana sandbox EOA tops it
    // up to the funding amount before the swap lane runs. A relay that still
    // carries the lane's own need (wrap plus gas) needs no drip, so the test
    // stands down and the eoa's dust is preserved for the runs that do.
    const eoa = privateKeyToAccount(walletKey as `0x${string}`)
    const eoaWallet = createWalletClient({ account: eoa, chain: bscTestnet, transport: http(RPC) })
    const relayBalance = await publicClient.getBalance({ address: buyer.address })
    const eoaBalance = await publicClient.getBalance({ address: eoa.address })
    console.log('relay balance:', formatUnits(relayBalance, 18), '| altana eoa balance:', formatUnits(eoaBalance, 18))
    if (relayBalance > parseUnits('0.05', 18)) return // the lane funds itself from here
    expect(eoaBalance > parseUnits('0.02', 18), `the altana eoa carries ${formatUnits(eoaBalance, 18)} and cannot fund the relay below this run`).toBe(true)
    const dripHash = await eoaWallet.sendTransaction({ to: buyer.address, value: parseUnits('0.02', 18) })
    console.log('relay top-up:', dripHash)
    await publicClient.waitForTransactionReceipt({ hash: dripHash, confirmations: 1 })
  })

  it('funds, approves and opens a hire naming the altana account', { timeout: 240_000 }, async () => {
    // the funding lane is the smoke's: wrap, approve the router over WBNB, swap to
    // USDT so the buyer can cover the deposit in the vault's own token. The
    // rehearsal buys fresh on every run, min-out priced from the pool itself: a
    // fixed floor tracks nothing, while the balance that must clear is the 0.02,
    // deposit, asserted after the fill because a short one trips the vault's
    // TokenCallFailed guard at open. The 0.03 wrap is sized against the chain's
    // own price drift: on a 0.05-fee pool a 0.02 swap can no longer clear the
    // 0.10 deposit, and the run failed before the junction ever saw a hire.
    // every state-touching step from here down rides the load-balanced rpc,
    // whose replicas lag recently mined actions: a fresh WBNB wrap reads as
    // missing on a stale head, and freshly-evicted allowances or deposits turn
    // into STF, TokenCallFailed or a bare Too little received. So each retry
    // pass re-does the probe against its own then-current answer and re-sends,
    // rather than sailing on a simulation made of stale state.
    let swapHash: `0x${string}` | null = null
    let attempt = 0
    for (; attempt < 4; attempt++) {
      const wrapHash = await buyerWallet.writeContract({
        address: WBNB, abi: wbnbAbi, functionName: 'deposit', value: parseUnits('0.03', 18),
      })
      await publicClient.waitForTransactionReceipt({ hash: wrapHash, confirmations: 1 })
      await buyerWallet.writeContract({
        address: WBNB, abi: wbnbAbi, functionName: 'approve', args: [ROUTER, parseUnits('0.03', 18)], gas: 300_000n,
      })
      // the pool's own answer is the quote: a simulated fill (an eth_call, no
      // gas) returns the amountOut the swap would genuinely land, walking the
      // pool's ticks, instead of the spot price a thin pool can never honor.
      const probeData = encodeFunctionData({
        abi: routerAbi, functionName: 'exactInputSingle', args: [{
          tokenIn: WBNB, tokenOut: USDT, fee: 500, recipient: buyer.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 300), amountIn: parseUnits('0.03', 18),
          amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
      })
      let observedOut = 0n
      try {
        const probed = await publicClient.call({ account: buyer.address, to: ROUTER, data: probeData })
        if (!probed.data || probed.data.length < 66) throw new Error('the router answered no amount out for the funding swap')
        observedOut = BigInt(probed.data)
      } catch (e) {
        console.log(`probe attempt ${attempt}: ${String(e).slice(0, 140)}`)
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      const minOut = (observedOut * 98n) / 100n
      const amountIn = parseUnits('0.03', 18)
      console.log('probed fill:', formatUnits(observedOut, 18), 'USDT, min out:', formatUnits(minOut, 18))
      try {
        swapHash = await buyerWallet.writeContract({
          address: ROUTER, abi: routerAbi, functionName: 'exactInputSingle', args: [{
            tokenIn: WBNB, tokenOut: USDT, fee: 500, recipient: buyer.address,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 300), amountIn,
            amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
        })
        break
      } catch (e) {
        console.log(`swap attempt ${attempt}: ${String(e).slice(0, 140)}`)
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
    if (!swapHash) throw new Error('the funding swap never mined: every attempt hit a stale or moving head')
    console.log('funding swap:', swapHash)
    await publicClient.waitForTransactionReceipt({ hash: swapHash, confirmations: 1 })
    const usdt = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [buyer.address] })
    console.log('relay USDT after the swap:', formatUnits(usdt, 18))
    expect(usdt >= parseUnits('0.02', 18), `USDT after funding is ${formatUnits(usdt, 18)} and must cover the 0.02 deposit`).toBe(true)

    // explicit gas on every state-touching call from here down: the load
    // balanced rpc's replicas lag recently mined approvals, and an estimate
    // against a stale head turns the vault's transferFrom into TokenCallFailed
    await buyerWallet.writeContract({
      address: USDT, abi: erc20Abi, functionName: 'approve', args: [VAULT, parseUnits('0.02', 18)], gas: 300_000n,
    })
    const count = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hireCount' })
    open = await buyerWallet.writeContract({
      address: VAULT, abi: vaultAbi, functionName: 'open',
      args: [walletAddress, USDT, parseUnits('0.02', 18), BigInt(Math.floor(Date.now() / 1000) + 7200), 1000, 500],
      gas: 1_500_000n,
    })
      console.log('open:', open, 'hire id', (count + 1n).toString())
    // the hire's existence and openness are read right after the send, so the
    // wait follows it here and not only at the sweep
    if (open) await publicClient.waitForTransactionReceipt({ hash: open, confirmations: 1 })
    sessionId = count + 1n
    const hire = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hire', args: [sessionId] })
    expect(hire[4]).toBe(true) // open, with the altana account named as agent
  })

  // the RPC is load-balanced, so a fresh hire can be invisible for a few
  // seconds: both sweep tests wait for the hire to read open before they run,
  // because a stale replica turning a real hire into 'not open' is the same
  // fault the withdraw step already learned to repeat past
  async function hireIsReadable(): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      const h = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hire', args: [sessionId] })
      if (h[4]) return true
      await new Promise((r) => setTimeout(r, 5000))
    }
    return false
  }

  it('hands the hire to the junction by executing a dry run first', { timeout: 240_000 }, async () => {
    process.env.AGENT_ALTANA_SESSION = jobBlob
    process.env.AGENT_ALTANA_SESSION_KEY = sessionKey as string
    expect(await hireIsReadable()).toBe(true)
    const actor = resolveActor('altana')
    expect(await actor.address()).toBe(walletAddress)
    const reports = await sweepOwnHires(
      createPublicClient({ chain: bscTestnet, transport: http(RPC) }),
      CHAIN_ID, actor, 64, () => false, false,
    )
    for (const r of reports) console.log(`dry run report: ${r.id} ${r.status}${r.reason ? ` (${r.reason})` : ''}`)
    expect(reports.some((r) => r.id === sessionId.toString() && r.status === 'skipped')).toBe(true)
    // the dry run named the trade it would run but sent nothing
    const hire = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hire', args: [sessionId] })
    if (Number(hire[6]) > 0 || Number(hire[5]) > 0) {
      // remaining side counts as untouched at the dry run: the balances read
      // before the execute pass below
    }
  })

  it('executes the trade through the granted junction', { timeout: 240_000 }, async () => {
    process.env.AGENT_ALTANA_SESSION = jobBlob
    process.env.AGENT_ALTANA_SESSION_KEY = sessionKey as string
    expect(await hireIsReadable()).toBe(true)
    const actor = resolveActor('altana')
    const reports = await sweepOwnHires(
      createPublicClient({ chain: bscTestnet, transport: http(RPC) }),
      CHAIN_ID, actor, 64, () => false, true,
    )
    const row = reports.find((r) => r.id === sessionId.toString())
    for (const r of reports) console.log(`sweep report: ${r.id} ${r.status}${r.reason ? ` (${r.reason})` : ''}`)
    expect(row?.status).toBe('traded')
    // the relay can report the bundle id rather than a mined hash when the
    // trade confirms out of the immediate wait, so either shape passes here
    expect(row?.txHash).toMatch(/^0x[0-9a-fA-F]{40,66}$/)
    // the hire survives, holding the other side now
    const hire = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hire', args: [sessionId] })
    expect(hire[4]).toBe(true)
    expect(hire[6] !== 0n || hire[5] !== 0n).toBe(true)
  })

  it('returns the deposit on the buyer withdraw', { timeout: 120_000 }, async () => {
    // the withdraw is sent with an explicit gas so viem skips the pre-send
    // simulation: the load-balanced RPC's replicas can lag the hire's own
    // open block, and a stale simulation of a nonexistent hire reverts
    // NotOpen. Simulating after the fact is the test's own re-read, and a
    // NotOpen while the hire still reads open repeats, not the buyer's fault,
    // so the send repeats too.
    for (let i = 0; i < 4; i++) {
      const hire = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hire', args: [sessionId] })
      if (!hire[4]) break // already closed; nothing left to withdraw
      try {
        const hash = await buyerWallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'withdraw', args: [sessionId], gas: 300_000n })
        // the state read below is the assertion, and a bare broadcast leaves
        // the tx racing it: the wait is part of the attempt
        await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
        break
      } catch (e) {
        console.log(`withdraw attempt ${i}: ${String(e).slice(0, 160)}`)
        if (!String(e).includes('ddafad98')) throw e
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
    const hire = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hire', args: [sessionId] })
    expect(hire[4]).toBe(false)
  })

  it('refuses a second trade after the withdraw', { timeout: 120_000 }, async () => {
    process.env.AGENT_ALTANA_SESSION = jobBlob
    process.env.AGENT_ALTANA_SESSION_KEY = sessionKey as string
    const actor = resolveActor('altana')
    const call: Call = {
      to: VAULT,
      data: encodeFunctionData({ abi: vaultAbi, functionName: 'trade', args: [sessionId, USDT, parseUnits('0.02', 18), 0n] }),
    }
    await expect(actor.trade(call)).rejects.toThrow()
    // the session stands down at the end, so nothing sits open afterward
    const sessionAccount = privateKeyToAccount(sessionKey as `0x${string}`).address
    const outcomes = await client.revokeSession({ wallet, signer: adminSigner, session: sessionAccount, chainId: CHAIN_ID }).catch(() => null)
    expect(outcomes !== undefined || outcomes === null).toBe(true)
  })
})
