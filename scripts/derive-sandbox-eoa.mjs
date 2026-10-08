// Print only the public address of the Altana sandbox EOA, plus its live tBNB
// balance so a top-up can be verified. The private key is read from the old
// clone's env file and never printed.
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, formatEther } from 'viem'
import { bscTestnet } from 'viem/chains'

const line = readFileSync('C:/Users/user/Desktop/agora/.env.sandbox', 'utf8')
  .split(/\r?\n/)
  .find((l) => /^\s*ALTANA_SANDBOX_PRIVATE_KEY\s*=/.test(l))
if (!line) {
  console.error('ALTANA_SANDBOX_PRIVATE_KEY not found in the sandbox env file')
  process.exit(1)
}
const key = (line.split('=', 2)[1] ?? '').trim().replace(/^["']|["']$/g, '')
const account = privateKeyToAccount(key)

const client = createPublicClient({
  chain: bscTestnet,
  transport: http('https://data-seed-prebsc-2-s2.binance.org:8545'),
})
const balance = await client.getBalance({ address: account.address })

console.log('sandbox EOA address:', account.address)
console.log('tBNB balance now:', formatEther(balance))
console.log('needs to clear 0.06 tBNB before the rehearsal can fund the relay')
