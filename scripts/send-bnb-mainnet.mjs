// One MAINNET transfer, 0.002 real BNB from the relay key to the address
// passed as argv[2], deposited so the faucet claim goes through with it.
// Real money: the amount is fixed in the file, the destination comes from the
// command line, and nothing is force-overridden without an explicit ask.
import { bsc } from "viem/chains";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const RPC = "https://bsc-dataseed.bnbchain.org";
const FILE = "C:/Users/user/Desktop/agora/.env.local";
const AMOUNT = "0.002";
const TO = (process.argv[2] ?? "").trim();

let pk = null;
for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
  if (/^\s*RELAY_PRIVATE_KEY\s*=/.test(line)) {
    pk = line.split("=", 2)[1].trim().replace(/^"(.*)"$/, "$1");
    break;
  }
}

const client = createPublicClient({ chain: bsc, transport: http(RPC) });
const relay = privateKeyToAccount(pk);
const wallet = createWalletClient({ account: relay, chain: bsc, transport: http(RPC) });

console.log("from relay (mainnet):", relay.address);
console.log("to        :", TO);
const before = await client.getBalance({ address: relay.address });
console.log("relay before:", formatEther(before), "BNB");
const need = parseEther(AMOUNT) + parseEther("0.001"); // transfer + gas buffer
if (before < need) {
  console.error(`the relay's mainnet balance is below the transfer plus gas buffer (${AMOUNT} + 0.001), refusing`);
  process.exit(1);
}

const hash = await wallet.sendTransaction({ to: TO, value: parseEther(AMOUNT) });
console.log("tx:", hash);
const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
if (receipt.status !== "success") { console.error("the transfer reverted"); process.exit(1); }
console.log("status: success, gas used:", receipt.gasUsed.toString());
console.log("relay after  :", formatEther(await client.getBalance({ address: relay.address })));
console.log("recipient now:", formatEther(await client.getBalance({ address: TO })), "BNB");
