// The standalone server for hosts that run a container or a plain Node process.
// The route logic lives in routes.js, which the Vercel functions reuse.

import { createServer } from "node:http";
import { corsHeaders, handleHealth, handleLink, handleLinkCode, handleWebhook } from "./routes.js";
import { telegramBotToken } from "./telegram.js";

const PORT = Number(process.env.PORT || 8787);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req.headers.origin));
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    return handleHealth(req, res);
  }
  if (req.method === "POST" && url.pathname === "/telegram/webhook") {
    return handleWebhook(req, res);
  }
  if (req.method === "POST" && url.pathname === "/telegram/link") {
    return handleLink(req, res);
  }
  if (req.method === "POST" && url.pathname === "/telegram/link-code") {
    return handleLinkCode(req, res);
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`telegram service on :${PORT}, configured=${Boolean(telegramBotToken())}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
