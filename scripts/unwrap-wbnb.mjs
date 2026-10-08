// Unwrap rehearsal-deposited WBNB back to native tBNB: the relay's own failed
// funding attempts left wrapped balance sitting in its wallet, and the vault
// pays gas in the native token. Amount in argv[2], whole tBNB.
import { bscTestnet } from "viem/chains";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const RPC = "https://bsc-testnet-rpc.publicnode.com";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const amount = process.argv[2] ?? "0.2";

let pk = null;
for (const line of readFileSync("C:/Users/user/Desktop/agora/.env.local", "utf8").split(/\r?\n/)) {
  if (/^\s*RELAY_PRIVATE_KEY\s*=/.test(line)) {
    pk = line.split("=", 2)[1].trim().replace(/^"(.*)"$/, "$1");
    break;
  }
}

const relay = privateKeyToAccount(pk);
const ercAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
];
const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
const wallet = createWalletClient({ account: relay, chain: bscTestnet, transport: http(RPC) });

const wrapped = await client.readContract({ address: WBNB, abi: ercAbi, functionName: "balanceOf", args: [relay.address] });
console.log("wrapped balance:", Number(wrapped) / 1e18, `| unwrapping ${amount}`);
if (wrapped < parseEther(amount)) {
  console.error("the wrapped balance is below this unwrap");
  process.exit(1);
}
const hash = await wallet.writeContract({ address: WBNB, abi: ercAbi, functionName: "withdraw", args: [parseEther(amount)] });
const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
console.log("withdraw tx:", hash, "status", receipt.status);
console.log("native now:", Number(await client.getBalance({ address: relay.address })) / 1e18);
