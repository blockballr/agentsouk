// the session between the wallet and the page: connect ends in a signature, the
// record lives per address in this browser, and a provider switch adopts a
// recorded address or ends the session instead of becoming whoever the wallet
// now shows. this is this browser's authorization, not a server login: owner
// actions and escrow keep their own per-message signatures.

import { recoverMessageAddress } from 'viem'
import {
  changeWallet as changeProvider,
  clearWalletChoice,
  connectProvider,
  getActiveAccount,
  getProvider,
  watchActiveAccount,
} from './wallet'

const KEY = 'agora.wallet.signins'

interface SignIn {
  message: string
  signature: string
  issued: string
}

// a fixed four-line message naming this site, the address and the time: the
// signature is verified against exactly these bytes later, so the text that
// was shown in the wallet is the text that decides the record
export function signInMessage(address: string, site: string, issued: string): string {
  return [
    'Agent Souk sign-in',
    `site: ${site}`,
    `address: ${address.toLowerCase()}`,
    `issued: ${issued}`,
  ].join('\n')
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function records(): Record<string, SignIn> {
  try {
    const raw = store()?.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Record<string, SignIn>
  } catch {
    return {}
  }
}

function save(address: string, record: SignIn): void {
  try {
    store()?.setItem(KEY, JSON.stringify({ ...records(), [address.toLowerCase()]: record }))
  } catch {
    // private mode: the session just does not survive a reload
  }
}

function drop(address: string): void {
  try {
    const kept = records()
    delete kept[address.toLowerCase()]
    store()?.setItem(KEY, JSON.stringify(kept))
  } catch {
    // nothing to forget
  }
}

// a record is believed only while its signature still recovers the address from
// the exact message that was signed: a tampered or foreign record reads as none
async function verified(address: string): Promise<SignIn | null> {
  const record = records()[address.toLowerCase()]
  if (!record?.message || !record?.signature) return null
  try {
    const recovered = await recoverMessageAddress({
      message: record.message,
      signature: record.signature as `0x${string}`,
    })
    return recovered.toLowerCase() === address.toLowerCase() ? record : null
  } catch {
    return null
  }
}

let active: string | null = null
let watching = false
let pending: Promise<void> | null = null
const watchers = new Set<(account: string | null) => void>()

function emit(): void {
  for (const watcher of watchers) watcher(active)
}

function setSession(account: string): void {
  if (active?.toLowerCase() === account.toLowerCase()) return
  active = account
  emit()
}

function endSession(): void {
  if (active === null) return
  active = null
  emit()
}

// what the wallet reports decides transitions: a recorded address is adopted as
// the session, anything else ends it, and null (disconnected, empty account
// list, another chain) ends it too; the promise resolves once decided, so a
// restore read cannot answer before the record has been checked
function adopt(account: string | null): Promise<void> {
  if (!account) {
    endSession()
    pending = Promise.resolve()
    return pending
  }
  pending = verified(account).then((record) => {
    if (record) setSession(account)
    else endSession()
  })
  return pending
}

function attach(): void {
  if (watching) return
  watching = true
  // the session starts from the wallet's own account, adopted only when this
  // browser holds a record that still verifies for it
  pending = getActiveAccount().then(adopt)
  watchActiveAccount(adopt)
}

// the signed-in address for this browser: read once on mount and then watched,
// so a switch inside the wallet adopts a recorded address or disconnects
// instead of changing who the page thinks you are
export function watchSession(listener: (account: string | null) => void): () => void {
  attach()
  watchers.add(listener)
  listener(active)
  return () => {
    watchers.delete(listener)
  }
}

// imperative read for surfaces that act for the account rather than render it;
// resolves once the most recent report has been decided
export function sessionAccount(): Promise<string | null> {
  attach()
  return (pending ?? Promise.resolve()).then(() => active)
}

// the sign-in itself: the wallet signs the fixed message, and the record is
// stored only once the signature recovers that address; declining stores
// nothing and leaves the page as it was, with the refusal stated
async function signIn(address: string): Promise<void> {
  const site = typeof window !== 'undefined' ? window.location.origin : 'agentsouk'
  const issued = new Date().toISOString()
  const message = signInMessage(address, site, issued)
  const provider = await getProvider()
  let signature: string
  try {
    signature = (await provider.request({ method: 'personal_sign', params: [message, address] })) as string
  } catch (e) {
    if ((e as { code?: number } | null)?.code === 4001) {
      throw new Error('Sign-in was declined, connect again to sign in.')
    }
    throw e
  }
  const recovered = await recoverMessageAddress({
    message,
    signature: signature as `0x${string}`,
  })
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('That signature was not from the address being signed in.')
  }
  save(address, { message, signature, issued })
}

// connect the wallet, then sign in as the account it returns: an address this
// browser already holds a record for adopts without a prompt, anything else
// must sign, and a refusal stores nothing
export async function connectWallet(): Promise<string> {
  const account = await connectProvider()
  if (!(await verified(account))) await signIn(account)
  setSession(account)
  return account
}

// switch wallet: the session ends first, the picked wallet signs in as its own
// account, and a dismissed picker leaves the page disconnected
export async function changeWallet(): Promise<string | null> {
  endSession()
  const account = await changeProvider()
  if (!account) return null
  if (!(await verified(account))) await signIn(account)
  setSession(account)
  return account
}

// the page forgets the session and the wallet choice; the records stay, so the
// same address signing in again adopts without a new signature
export function disconnectWallet(): void {
  endSession()
  clearWalletChoice()
}

// forget this browser entirely for the active address: its record is cleared,
// so nothing re-adopts it on a later switch or reload until it signs in again
export function signOut(): void {
  if (active) drop(active)
  endSession()
}
