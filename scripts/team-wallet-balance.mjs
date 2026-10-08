// Read-only sweep of the team keys found in the local env files: derive each
// address and print its live tBNB balance on chain 97. Private keys are read
// from the env files and never printed, only the key NAMES appear here.
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, formatEther } from 'viem'
import { bscTestnet } from 'viem/chains'

const FILES = [
  'C:/Users/user/Desktop/agora/.env.local',
  'C:/Users/user/Desktop/agora/.env.sandbox',
  'C:/Users/user/Desktop/agora-main/.env.local',
]
const KEY_NAMES = [
  'RELAY_PRIVATE_KEY',
  'ALTANA_SANDBOX_PRIVATE_KEY',
  'ALTANA_SANDBOX_SESSION_KEY',
]

const client = createPublicClient({
  chain: bscTestnet,
  transport: http('https://data-seed-prebsc-2-s2.binance.org:8545'),
})

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
  let where = null
  for (const file of FILES) {
    const found = readKey(file, name)
    if (found) { key = found; where = file; break }
  }
  if (!key) { console.log(`${name}: no value in any local env file`); continue }
  try {
    const account = privateKeyToAccount(key)
    const balance = await client.getBalance({ address: account.address })
    console.log(`${name} (${where})`)
    console.log(`  address: ${account.address}`)
    console.log(`  tBNB: ${formatEther(balance)}`)
  } catch (e) {
    console.log(`${name}: not a usable private key (${String(e.message).slice(0, 60)})`)
  }
}
