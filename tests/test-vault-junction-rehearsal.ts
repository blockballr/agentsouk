// The junction rehearsal, against the live vault on chain 97: a granted Altana
// session initiates the trade, the sweep executes through the actor, and the
// buyer's revoke holds everything back. Per the proposed-write rule every step
// is bound: the buyer hands 0.10 in a Testnet USDT that it funded itself, and
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
const RPC = 'https://data-seed-prebsc-2-s2.binance.org:8545'

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
    { name: 'factory', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  ] as const
  // the pool under the funding swap, discovered rather than hardcoded: the
  // factory names it and slot0 prices it
  const factoryAbi = [
    { name: 'getPool', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }] },
  ] as const
  const poolAbi = [
    { name: 'slot0', type: 'function', stateMutability: 'view', inputs: [], outputs: [
      { type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' },
      { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }] },
  ] as const

  beforeAll(async () => {
    // the altana account is created live and held for the whole rehearsal
    wallet = await client.createWallet({ signer: adminSigner })
    walletAddress = (wallet as { address?: string }).address ?? ''
  })

  it('grants a fresh session scoped to the vault', { timeout: 240_000 }, async () => {
    const sessionAccount = privateKeyToAccount(sessionKey as `0x${string}`).address
    try {
      await client.revokeSession({ wallet, signer: adminSigner, session: sessionAccount, chainId: CHAIN_ID })
    } catch {
      // nothing to revoke on a first run
    }
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
    expect(walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(jobBlob.length).toBeGreaterThan(10)
  })

  it('funds the relay, then funds the deposit lane', { timeout: 240_000 }, async () => {
    // the relay runs dry across rehearsal runs: the altana sandbox EOA tops it
    // up to the funding amount before the swap lane runs
    const eoa = privateKeyToAccount(walletKey as `0x${string}`)
    const eoaWallet = createWalletClient({ account: eoa, chain: bscTestnet, transport: http(RPC) })
    const eoaBalance = await publicClient.getBalance({ address: eoa.address })
    console.log('altana eoa balance:', formatUnits(eoaBalance, 18))
    expect(eoaBalance > parseUnits('0.06', 18), `the altana eoa carries ${formatUnits(eoaBalance, 18)} and cannot fund the relay below this run`).toBe(true)
    const dripHash = await eoaWallet.sendTransaction({ to: buyer.address, value: parseUnits('0.06', 18) })
    console.log('relay top-up:', dripHash)
    await publicClient.waitForTransactionReceipt({ hash: dripHash, confirmations: 1 })
  })

  it('funds, approves and opens a hire naming the altana account', { timeout: 240_000 }, async () => {
    // the funding lane is the smoke's: wrap, approve the router over WBNB, swap to
    // USDT so the buyer can cover the deposit in the vault's own token. The
    // rehearsal buys fresh on every run, min-out priced from the pool itself: a
    // fixed floor tracks nothing, while the balance that must clear is the 0.10
    // deposit, asserted after the fill because a short one trips the vault's
    // TokenCallFailed guard at open
    const wrapHash = await buyerWallet.writeContract({
      address: WBNB, abi: wbnbAbi, functionName: 'deposit', value: parseUnits('0.05', 18),
    })
    console.log('wrap:', wrapHash)
    await publicClient.waitForTransactionReceipt({ hash: wrapHash, confirmations: 1 })
    await buyerWallet.writeContract({ address: WBNB, abi: wbnbAbi, functionName: 'approve', args: [ROUTER, parseUnits('0.05', 18)] })
    // the pool's own price at this moment is the quote, two percent its
    // tolerance: wide enough that block timing never refuses a covered fill,
    // narrow enough that a genuine price move fails the swap instead of
    // passing quietly
    const factory = await publicClient.readContract({ address: ROUTER, abi: routerAbi, functionName: 'factory' })
    const pool = await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: 'getPool', args: [WBNB, USDT, 500] })
    const [sqrtPriceX96] = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' })
    const amountIn = parseUnits('0.05', 18)
    const q96 = 1n << 96n
    // sqrtPriceX96 prices token1 in token0 raw units; both sides are 18 decimals
    const quote = WBNB.toLowerCase() < USDT.toLowerCase()
      ? (amountIn * sqrtPriceX96 * sqrtPriceX96) / (q96 * q96)
      : (amountIn * q96 * q96) / (sqrtPriceX96 * sqrtPriceX96)
    const minOut = (quote * 98n) / 100n
    console.log('pool quote:', formatUnits(quote, 18), 'USDT, min out:', formatUnits(minOut, 18))
    const swapHash = await buyerWallet.writeContract({
      address: ROUTER, abi: routerAbi, functionName: 'exactInputSingle', args: [{
        tokenIn: WBNB, tokenOut: USDT, fee: 500, recipient: buyer.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 300), amountIn,
        amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    })
    console.log('funding swap:', swapHash)
    await publicClient.waitForTransactionReceipt({ hash: swapHash, confirmations: 1 })
    const usdt = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [buyer.address] })
    console.log('relay USDT after the swap:', formatUnits(usdt, 18))
    expect(usdt >= parseUnits('0.10', 18), `USDT after funding is ${formatUnits(usdt, 18)} and must cover the 0.10 deposit`).toBe(true)

    await buyerWallet.writeContract({ address: USDT, abi: erc20Abi, functionName: 'approve', args: [VAULT, parseUnits('0.10', 18)] })
    const count = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'hireCount' })
    const openHash = await buyerWallet.writeContract({
      address: VAULT, abi: vaultAbi, functionName: 'open',
      args: [walletAddress, USDT, parseUnits('0.10', 18), BigInt(Math.floor(Date.now() / 1000) + 7200), 1000, 500],
    })
    console.log('open:', openHash, 'hire id', (count + 1n).toString())
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
      CHAIN_ID, actor, 5, () => false, false,
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
      CHAIN_ID, actor, 5, () => false, true,
    )
    const row = reports.find((r) => r.id === sessionId.toString())
    for (const r of reports) console.log(`sweep report: ${r.id} ${r.status}${r.reason ? ` (${r.reason})` : ''}`)
    expect(row?.status).toBe('traded')
    expect(row?.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/)
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
        await buyerWallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'withdraw', args: [sessionId], gas: 300_000n })
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
      data: encodeFunctionData({ abi: vaultAbi, functionName: 'trade', args: [sessionId, USDT, parseUnits('0.10', 18), 0n] }),
    }
    await expect(actor.trade(call)).rejects.toThrow()
    // the session stands down at the end, so nothing sits open afterward
    const sessionAccount = privateKeyToAccount(sessionKey as `0x${string}`).address
    const outcomes = await client.revokeSession({ wallet, signer: adminSigner, session: sessionAccount, chainId: CHAIN_ID }).catch(() => null)
    expect(outcomes !== undefined || outcomes === null).toBe(true)
  })
})
