// One transfer, 0.002 tBNB from the relay to the address passed as argv[2],
// earmarked for the agent owner's faucet claim. Keys come from the env files
// and are never printed; the output shows addresses, the tx hash and the
// closing balances only.
import { bscTestnet } from 'viem/chains'
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = 'https://bsc-testnet-rpc.publicnode.com'
const FILE = 'C:/Users/user/Desktop/agora/.env.local'
const AMOUNT = '0.002'
const TO = (process.argv[2] ?? '').trim()

function relayKey() {
  for (const line of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    if (/^\s*RELAY_PRIVATE_KEY\s*=/.test(line)) {
      return line.split('=', 2)[1].trim().replace(/^"(.*)"$/, '$1')
    }
  }
  return null
}

// node:fs is imported here so the module loads before the key is read
import { readFileSync } from 'node:fs'
import { createPublicClient as pub_ } from 'viem'

const pk = relayKey()
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error('no relay key in the env file'); process.exit(1) }
if (!/^0x[0-9a-fA-F]{40}$/.test(TO)) { console.error('pass the destination address as argv[2]'); process.exit(1) }

const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) })
const relay = privateKeyToAccount(pk)
const wallet = createWalletClient({ account: relay, chain: bscTestnet, transport: http(RPC) })

console.log('from relay:', relay.address)
console.log('to        :', TO)
const before = await client.getBalance({ address: relay.address })
console.log('relay before:', formatEther(before))
if (before <= parseEther(AMOUNT) + parseEther('0.0002')) { console.error('the relay holds too little for this transfer plus its claim gas'); process.exit(1) }

const hash = await wallet.sendTransaction({ to: TO, value: parseEther(AMOUNT) })
console.log('tx:', hash)
const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 })
if (receipt.status !== 'success') { console.error('the transfer reverted'); process.exit(1) }
console.log('gas used:', receipt.gasUsed.toString())
console.log('relay after  :', formatEther(await client.getBalance({ address: relay.address })))
console.log('recipient    :', formatEther(await client.getBalance({ address: TO })))
