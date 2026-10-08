// read the vault's closed events over the recent window and the hired state
// for the last few ids, so the rehearsal's postmortem has chain truth
import { createPublicClient, http, parseAbiItem } from "viem";
import { bscTestnet } from "viem/chains";

const VAULT = "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8";
const c = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });

const head = await c.getBlockNumber();
const l = await c.getLogs({
  address: VAULT,
  event: parseAbiItem("event Closed(uint256,address,uint256,uint256)"),
  fromBlock: head - 600n,
});
console.log("closed events found:", l.length);
for (const e of l.slice(-8)) {
  console.log("closed event topics:", e.topics.join("|").slice(0, 130), "block", e.blockNumber.toString());
}
const hAbi = [
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint16" }, { type: "bool" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint160" }, { type: "uint24" }, { type: "uint256" }] },
];
for (const id of [8n, 9n, 10n]) {
  try {
    const h = await c.readContract({ address: VAULT, abi: hAbi, functionName: "hire", args: [id] });
    console.log(`hire ${id}: agent=${String(h[0]).slice(0, 10)} open=${h[4]} balA=${h[5].toString()} balB=${h[6].toString()}`);
  } catch {
    console.log(`hire ${id}: no row`);
  }
}
