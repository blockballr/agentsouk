// The route logic, shared by the standalone server and the Vercel functions.
// Node request and response objects only, so the same code runs behind both.

import { getAddress, verifyMessage } from "viem";
import { telegramBotToken, verifyInitData, sendTelegramMessage, webAppUrl } from "./telegram.js";
import { linkTelegram, walletForTelegram, createLinkCode, consumeLinkCode } from "./link-store.js";
import { telegramLinkMessage } from "./link-message.js";

const MAX_BODY = 64 * 1024;
const ALLOWED_ORIGINS = (process.env.TELEGRAM_ALLOWED_ORIGINS || "https://app.agentsouk.xyz,http://localhost:4173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : null;
  return {
    ...(allowed ? { "access-control-allow-origin": allowed, vary: "Origin" } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
  };
}

function json(res, status, body, origin) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseJson(req) {
  try {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function keyboard(rows) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b) => ({ text: b.text, web_app: { url: webAppUrl(b.path) } })),
    ),
  };
}

const HIRE = keyboard([
  [{ text: "Hire an agent", path: "/agents" }],
  [
    { text: "Vault hire", path: "/vault" },
    { text: "Set and Earn", path: "/quest" },
  ],
  [
    { text: "List an agent", path: "/list" },
  ],
]);

const ONE = (path, text) => keyboard([[{ text, path }]]);

async function questProgress(wallet) {
  const base = process.env.PUBLIC_API_URL?.trim() || "https://api.agentsouk.xyz";
  try {
    const res = await fetch(`${base}/api/quest/progress?wallet=${encodeURIComponent(wallet)}`);
    const body = await res.json().catch(() => null);
    return body?.success ? body : null;
  } catch {
    return null;
  }
}

function questLines(p) {
  const categories = Object.entries(p.categories ?? {})
    .map(([key, done]) => `${done ? "done" : "open"} ${key}`)
    .join(" · ");
  return [
    "<b>Set and Earn</b>",
    `${p.agentsHired ?? 0}/${p.requiredHires ?? 2} hires · ${p.listedOne ? "listed" : "not listed"}`,
    categories,
    p.completed ? "Finished." : "Not finished yet.",
  ].join("\n");
}

export async function handleHealth(req, res) {
  return json(res, 200, { ok: true, configured: Boolean(telegramBotToken()) }, req.headers.origin);
}

export async function handleWebhook(req, res) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!telegramBotToken() || !secret) {
    return json(res, 503, { ok: false, error: "telegram is not configured" });
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  const update = await parseJson(req);
  const chatId = update?.message?.chat?.id;
  if (!chatId) return json(res, 200, { ok: true });

  const text = String(update?.message?.text ?? "").trim();
  const command = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
  const telegramId = String(chatId);
  const linked = await walletForTelegram(telegramId).catch(() => null);
  const linkedLine = linked
    ? `Linked wallet: <code>${linked}</code>`
    : "No wallet linked yet. Send /link to attach one.";

  if (command === "/start") {
    await sendTelegramMessage(
      chatId,
      [
        "<b>Agent Souk</b>",
        "",
        "Hire an agent, list your own, or finish the Set and Earn quest.",
        "Send /link to attach a wallet, or open the app with the buttons below.",
        "",
        linkedLine,
      ].join("\n"),
      HIRE,
    );
  } else if (command === "/link") {
    const created = await createLinkCode(telegramId).catch(() => null);
    const link = created ? webAppUrl(`/telegram/link?code=${created.code}`) : null;
    await sendTelegramMessage(
      chatId,
      [
        "<b>Link a wallet</b>",
        "",
        link
          ? "Open this link in Safari, connect the wallet you hire with, and sign:"
          : "Could not create a link. Try again in a moment.",
        ...(link ? ["", link, "", "The code expires in 15 minutes."] : []),
        "",
        linkedLine,
      ].join("\n"),
    );
  } else if (command === "/agents") {
    await sendTelegramMessage(chatId, "Open the shelf and pick an agent.", ONE("/agents", "Open the shelf"));
  } else if (command === "/vault") {
    await sendTelegramMessage(chatId, "Open a vault hire: the deposit stays in the vault.", ONE("/vault", "Open the vault"));
  } else if (command === "/quest") {
    if (!linked) {
      await sendTelegramMessage(chatId, "Link a wallet first. Send /link and open the link it gives you.");
    } else {
      const progress = await questProgress(linked);
      await sendTelegramMessage(
        chatId,
        progress ? questLines(progress) : "Could not read your quest progress right now.",
      );
    }
  } else if (command === "/hire") {
    const parts = text.split(/\s+/).slice(1);
    const chain = parts.find((p) => p === "56" || p === "97") ?? "56";
    const token = parts.find((p) => /^\d+$/.test(p) && p !== chain);
    if (!token) {
      await sendTelegramMessage(chatId, "Send /hire <tokenId>, for example /hire 376593.");
    } else {
      await sendTelegramMessage(
        chatId,
        [
          `<b>Hire ${token}</b>`,
          "",
          "Open this in Safari or Chrome to connect a wallet and sign:",
          `https://app.agentsouk.xyz/agents/${chain}/${token}`,
        ].join("\n"),
      );
    }
  } else if (command === "/wallet") {
    await sendTelegramMessage(
      chatId,
      linked ? `Linked wallet: <code>${linked}</code>` : "No wallet linked yet. Send /link.",
    );
  } else if (command === "/list") {
    await sendTelegramMessage(
      chatId,
      [
        "<b>List an agent</b>",
        "",
        "Open this in Safari or Chrome to connect a wallet and sign:",
        "https://app.agentsouk.xyz/list",
      ].join("\n"),
    );
  } else {
    await sendTelegramMessage(
      chatId,
      [
        "<b>Agent Souk</b>",
        "",
        "/agents  the shelf",
        "/vault  a vault hire",
        "/quest  Set and Earn",
        "/list  list your own agent",
        "/link  attach a wallet",
        "",
        linkedLine,
      ].join("\n"),
      HIRE,
    );
  }

  return json(res, 200, { ok: true });
}

export async function handleLinkCode(req, res) {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }
  const body = await parseJson(req);
  const initData = typeof body?.initData === "string" ? body.initData : "";
  const verified = verifyInitData(initData, { maxAgeSeconds: 86_400 });
  if (!verified.ok || !verified.user) {
    return json(res, 401, { success: false, error: verified.error ?? "initData is not valid" }, origin);
  }
  const created = await createLinkCode(verified.user.id);
  if (!created) {
    return json(res, 503, { success: false, error: "could not create a code" }, origin);
  }
  return json(
    res,
    200,
    {
      success: true,
      code: created.code,
      expiresAt: created.expiresAt,
      url: webAppUrl(`/telegram/link?code=${created.code}`),
    },
    origin,
  );
}

export async function handleLink(req, res) {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }
  const body = await parseJson(req);
  const initData = typeof body?.initData === "string" ? body.initData : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";

  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json(res, 400, { success: false, error: "wallet must be an address" }, origin);
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return json(res, 400, { success: false, error: "signature must be 65 bytes" }, origin);
  }

  let subject = "";
  let username = null;
  if (code) {
    subject = `code:${code}`;
  } else {
    const verified = verifyInitData(initData, { maxAgeSeconds: 86_400 });
    if (!verified.ok || !verified.user) {
      return json(res, 401, { success: false, error: verified.error ?? "initData is not valid" }, origin);
    }
    subject = verified.user.id;
    username = verified.user.username ?? null;
  }

  let address;
  try {
    address = getAddress(wallet);
  } catch {
    return json(res, 400, { success: false, error: "wallet is not a valid address" }, origin);
  }

  const message = telegramLinkMessage({ telegramId: subject, wallet: address });
  let proves = false;
  try {
    proves = await verifyMessage({ address, message, signature });
  } catch {
    proves = false;
  }
  if (!proves) {
    return json(res, 401, { success: false, error: "the signature does not prove this wallet" }, origin);
  }

  let telegramId = subject;
  if (code) {
    telegramId = await consumeLinkCode(code);
    if (!telegramId) {
      return json(res, 410, { success: false, error: "this link code has expired" }, origin);
    }
  }

  const saved = await linkTelegram({
    telegramId,
    wallet: address,
    username,
  });
  if (!saved.ok) {
    return json(res, 503, { success: false, error: saved.error ?? "could not save the link" }, origin);
  }

  return json(
    res,
    200,
    {
      success: true,
      telegramId,
      wallet: address.toLowerCase(),
      username,
    },
    origin,
  );
}
