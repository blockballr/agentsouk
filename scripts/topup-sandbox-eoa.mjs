// One transfer, relay to the Altana sandbox EOA: the relay's faucet claim
// funds the EOA the junction rehearsal needs above 0.06 tBNB. Keys are read
// from the env files and never printed; the output shows addresses, the tx
// hash and the closing balances only.
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, createPublicClient, http, formatEther, parseEther } from 'viem'
import { bscTestnet } from 'viem/chains'

const RPC = 'https://bsc-testnet-rpc.publicnode.com'
const FILES = ['C:/Users/user/Desktop/agora/.env.local', 'C:/Users/user/Desktop/agora/.env.sandbox']

function readKey(name) {
  for (const file of FILES) {
    const line = readFileSync(file, 'utf8').split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l))
    if (line) {
      const raw = (line.split('=', 2)[1] ?? '').trim()
      return raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    }
  }
  return null
}

const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) })
const relay = privateKeyToAccount(readKey('RELAY_PRIVATE_KEY'))
const eoa = privateKeyToAccount(readKey('ALTANA_SANDBOX_PRIVATE_KEY'))

const [relayBal, eoaBal] = await Promise.all([
  client.getBalance({ address: relay.address }),
  client.getBalance({ address: eoa.address }),
])
console.log('relay before:', formatEther(relayBal), '| eoa before:', formatEther(eoaBal))

const amount = parseEther(process.argv[2] ?? '0.3')
if (relayBal <= amount) { console.error('relay holds too little for this transfer'); process.exit(1) }

const wallet = createWalletClient({ account: relay, chain: bscTestnet, transport: http(RPC) })
const hash = await wallet.sendTransaction({ to: eoa.address, value: amount })
console.log('transfer hash:', hash)
const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 })
if (receipt.status !== 'success') { console.error('transfer reverted'); process.exit(1) }
console.log('gas used:', receipt.gasUsed.toString())

const [relayAfter, eoaAfter] = await Promise.all([
  client.getBalance({ address: relay.address }),
  client.getBalance({ address: eoa.address }),
])
console.log('relay after:', formatEther(relayAfter), '| eoa after:', formatEther(eoaAfter))
console.log('eoa clears the 0.06 rehearsal floor:', eoaAfter > parseEther('0.06'))
