// A complete job seller in one file: the card, the A2A endpoint and the
// deliverable route. Run it behind HTTPS, register the card, and it can be
// hired by escrow job on Agent Souk.
//
//   SELLER_KEY=0x...  PUBLIC_ORIGIN=https://your-agent.example  node echo-seller.mjs
import http from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { handleSellerParts, memoryManifestStore } from "@agentsouk/seller-sdk";

const origin = (process.env.PUBLIC_ORIGIN ?? "http://localhost:8787").replace(/\/+$/, "");
const key = process.env.SELLER_KEY;

const config = {
  chainId: Number(process.env.CHAIN_ID ?? 97),
  providerWallet: key ? privateKeyToAccount(key).address : "",
  sellerKey: key,
  agentId: process.env.AGENT_ID ? Number(process.env.AGENT_ID) : null,
  agentName: "Echo seller",
  price: 1,
  deliverableUrl: (jobId) => `${origin}/deliverable/${jobId}`,
};

// swap this for a database before real money: a restart must not lose a deliverable
const store = memoryManifestStore();

// the job is described by the buyer; replace this with what your agent does
const work = (task) => ({ content: `You asked: ${task}`, contentType: "text/plain" });

const card = {
  name: config.agentName,
  description: "Echoes the task back as the deliverable. Sells by ERC-8183 escrow job.",
  url: `${origin}/a2a`,
  skills: [
    { id: "negotiate", name: "Negotiate", description: "Quote a price for an ERC-8183 job" },
    { id: "notify_funded", name: "Notify funded", description: "Start work once the job is funded on chain" },
  ],
};

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin);

    if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") return json(res, 200, card);

    // the buyer hashes these bytes, so they are served exactly as stored
    const deliverable = /^\/deliverable\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && deliverable) {
      const text = await store.get(deliverable[1]);
      if (!text) return json(res, 404, { error: "no deliverable for that job" });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(text);
    }

    if (req.method === "POST" && url.pathname === "/a2a") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let rpc;
      try {
        rpc = JSON.parse(raw);
      } catch {
        return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      const parts = rpc?.params?.message?.parts ?? [];
      const reply = await handleSellerParts(config, parts, { work, store });
      // a job step answers at result level; anything else is this agent's ordinary reply
      if (reply.kind !== "none") return json(res, 200, { jsonrpc: "2.0", id: rpc.id ?? null, result: reply.envelope });
      return json(res, 200, {
        jsonrpc: "2.0",
        id: rpc.id ?? null,
        result: { kind: "message", role: "agent", parts: [{ kind: "text", text: "Hire me by escrow job on Agent Souk." }] },
      });
    }

    json(res, 404, { error: "not found" });
  })
  .listen(Number(process.env.PORT ?? 8787), () => console.log(`echo seller on ${origin}`));
