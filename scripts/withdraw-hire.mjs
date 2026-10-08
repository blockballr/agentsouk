// Recover the rehearsal's own escrow: the relay is the buyer of the hire that
// a run opened, and withdraw returns its full deposit in one transaction.
// Pass the hire id as argv[2]; nothing else is assumed.
import { bscTestnet } from "viem/chains";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const RPC = "https://bsc-testnet-rpc.publicnode.com";
const VAULT = "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8";
const id = (process.argv[2] ?? "").trim();

let pk = null;
for (const line of readFileSync("C:/Users/user/Desktop/agora/.env.local", "utf8").split(/\r?\n/)) {
  if (/^\s*RELAY_PRIVATE_KEY\s*=/.test(line)) {
    pk = line.split("=", 2)[1].trim().replace(/^"(.*)"$/, "$1");
    break;
  }
}
if (!/^\d+$/.test(id)) { console.error("pass the hire id as argv[2]"); process.exit(1); }

const buyer = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
const wallet = createWalletClient({ account: buyer, chain: bscTestnet, transport: http(RPC) });

const hireAbi = [
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint16" }, { type: "bool" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint160" }, { type: "uint24" }, { type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "hireCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

const hire = await publicClient.readContract({ address: VAULT, abi: hireAbi, functionName: "hire", args: [BigInt(id)] });
const [hBuyer, hToken, hExpiry, hDrawdown, openFlag, balanceA, balanceB] = hire;
console.log(`hire ${id}: buyer=${hBuyer} token=${hToken} open=${openFlag} balanceB=${balanceB}`);
if (!openFlag) { console.log("already closed; nothing to withdraw"); process.exit(0); }
if (String(hBuyer).toLowerCase() !== buyer.address.toLowerCase()) {
  console.error(`hire ${id}'s buyer is ${hBuyer}, not the relay ${buyer.address}`);
  process.exit(1);
}

const hash = await wallet.writeContract({ address: VAULT, abi: hireAbi, functionName: "withdraw", args: [BigInt(id)], gas: 300_000n });
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
console.log(`withdraw tx ${hash} status ${receipt.status}`);
const after = await publicClient.readContract({ address: VAULT, abi: hireAbi, functionName: "hire", args: [BigInt(id)] });
console.log(`hire ${id} after: open=${after[4]}`);
