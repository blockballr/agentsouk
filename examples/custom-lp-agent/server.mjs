import http from "node:http";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http as httpTransport, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const manifest = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";

function clients() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error("AGENT_PRIVATE_KEY is not set");
  const rpc = process.env.RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: bscTestnet, transport: httpTransport(rpc) });
  const walletClient = createWalletClient({ account, chain: bscTestnet, transport: httpTransport(rpc) });
  return { account, publicClient, walletClient, rpc };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === (manifest.healthcheck || "/health")) {
    let wallet = null;
    try { wallet = clients().account.address; } catch {}
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, agent: manifest.name, wallet }));
    return;
  }
  if (req.method === "POST" && url.pathname === (manifest.endpoint || "/a2a")) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch {}
    try {
      const { account, walletClient, publicClient } = clients();
      // Real contract call: WBNB.deposit() wraps BNB into WBNB (payable).
      const hash = await walletClient.writeContract({
        address: WBNB,
        abi: [{ type: "function", name: "deposit", inputs: [], outputs: [], stateMutability: "payable" }],
        functionName: "deposit",
        value: parseEther("0.001"),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed?.id ?? null,
        result: {
          status: receipt.status === "success" ? "completed" : "failed",
          agentWallet: account.address,
          action: "wrap-bnb",
          venue: "wbnb-testnet",
          contract: WBNB,
          function: "deposit",
          txHash: hash,
          block: Number(receipt.blockNumber),
          amount: "0.001 tBNB",
        },
      }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed?.id ?? null, error: { code: -32603, message: String(e) } }));
    }
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`custom agent listening on :${port}`));