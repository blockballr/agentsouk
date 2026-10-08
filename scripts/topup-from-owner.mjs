// topup from agent owner: agent owner → relay and → sandbox EOA, one shot.
// The agent owner claimed the faucet, and holds the balance the rehearsal
// needs. Keys stay in the env files; amounts are fixed here.
import { bscTestnet } from "viem/chains";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const RPC = "https://bsc-testnet-rpc.publicnode.com";
const FILE = "C:/Users/user/Desktop/agora/.env.sandbox";

function key(name) {
  for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
    if (new RegExp(`^\\s*${name}\\s*=`).test(line)) {
      return line.split("=", 2)[1].trim().replace(/^"(.*)"$/, "$1");
    }
  }
  return null;
}

const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
const owner = privateKeyToAccount(key("ALTANA_SANDBOX_PRIVATE_KEY"));
const wallet = createWalletClient({ account: owner, chain: bscTestnet, transport: http(RPC) });

console.log("from agent owner:", owner.address, formatEther(await client.getBalance({ address: owner.address })));

const HOPS = [
  { name: "relay      ", to: "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4", amount: "0.18" },
  { name: "sandbox eoa", to: "0x1ce1a3A5C20b1fE22905fa55cA10B480F61BDc09", amount: "0.1" },
];

for (const hop of HOPS) {
  const balance = await client.getBalance({ address: owner.address });
  if (balance <= parseEther(hop.amount) + parseEther("0.001")) {
    console.error(`${hop.name}: owner holds ${formatEther(balance)}, too little for ${hop.amount} plus gas; stopping`);
    break;
  }
  const hash = await wallet.sendTransaction({ to: hop.to, value: parseEther(hop.amount) });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  console.log(`${hop.name} <- ${hop.amount} status ${receipt.status} tx ${hash}`);
}

console.log("closing balances:");
for (const [name, addr] of [["agent owner", owner.address], ["relay      ", "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4"], ["sandbox eoa", "0x1ce1a3A5C20b1fE22905fa55cA10B480F61BDc09"]]) {
  console.log(`  ${name}: ${formatEther(await client.getBalance({ address: addr }))}`);
}
