// Read-only exposure check for the two keys the leak touched: derive the
// addresses from the env files (keys are never printed) and report the native
// balances on BSC mainnet (56) and Ethereum mainnet (1), plus whether the
// address holds code (sol contract deployed from it).
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, formatEther } from 'viem'

const FILES = [
  'C:/Users/user/Desktop/agora/.env.local',
  'C:/Users/user/Desktop/agora-main/.env.local',
]
const KEY_NAMES = ['RELAY_PRIVATE_KEY', 'PROD_BUYER_KEY']
const CHAINS = [
  { id: 56, name: 'BSC mainnet', rpc: 'https://bsc-rpc.publicnode.com' },
  { id: 1, name: 'Ethereum mainnet', rpc: 'https://ethereum-rpc.publicnode.com' },
]

function readKey(file, name) {
  try {
    const line = readFileSync(file, 'utf8').split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l))
    if (!line) return null
    const raw = (line.split('=', 2)[1] ?? '').trim()
    return raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  } catch {
    return null
  }
}

for (const name of KEY_NAMES) {
  let key = null
  for (const file of FILES) {
    const found = readKey(file, name)
    if (found) { key = found; break }
  }
  if (!key) { console.log(`\n${name}: no value locally`); continue }
  const account = privateKeyToAccount(key)
  console.log(`\n${name}: ${account.address}`)
  for (const chain of CHAINS) {
    const client = createPublicClient({
      chain: chain.id === 56 ? (await import('viem/chains')).bsc : (await import('viem/chains')).mainnet,
      transport: http(chain.rpc),
    })
    try {
      const [balance, code] = await Promise.all([
        client.getBalance({ address: account.address }),
        client.getBytecode({ address: account.address }),
      ])
      console.log(`  ${chain.name}: ${formatEther(balance)} native${code && code !== '0x' ? ', HOLDS CONTRACT CODE' : ''}`)
    } catch (e) {
      console.log(`  ${chain.name}: read failed (${String(e.message).slice(0, 60)})`)
    }
  }
}
