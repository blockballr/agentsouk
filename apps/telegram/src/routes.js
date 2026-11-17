// The route logic, shared by the standalone server and the Vercel functions.
// Node request and response objects only, so the same code runs behind both.

import { timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage } from "viem";
import { telegramBotToken, verifyInitData, sendTelegramMessage, sendTyping, askAssistant, webAppUrl } from "./telegram.js";
import {
  linkTelegram,
  walletForTelegram,
  createLinkCode,
  consumeLinkCode,
  listTelegramLinks,
  telegramForWallet,
  setMuted,
  isMuted,
  createWalletCode,
  consumeWalletCode,
  linkForWallet,
  unlinkWallet,
} from "./link-store.js";
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

async function agentDetail(chain, token) {
  const base = process.env.PUBLIC_API_URL?.trim() || "https://api.agentsouk.xyz";
  try {
    const res = await fetch(`${base}/api/agents/${chain}/${token}`);
    const body = await res.json().catch(() => null);
    return body?.data ?? null;
  } catch {
    return null;
  }
}

// tapping one sends it as a message, which goes to the assistant like anything typed
const STARTERS = {
  keyboard: [
    [{ text: "Which agent can protect my Venus loan?" }],
    [{ text: "Which stock pools are earning on Flux LP?" }],
    [{ text: "How do I list my agent?" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function secretMatches(given) {
  const expected = process.env.ASSISTANT_SECRET?.trim();
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

function pageLink(path) {
  return `https://app.agentsouk.xyz${path}`;
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

  // anything that is not a command is a question for the assistant
  if (text && !text.startsWith("/")) {
    await sendTyping(chatId);
    const handed = await askAssistant(chatId, text, linked);
    if (!handed) {
      await sendTelegramMessage(chatId, "The assistant is not reachable right now. The commands still work: send /help to see them.");
    }
    return json(res, 200, { ok: true });
  }

  // a link opened from the website carries a one-time code bound to a wallet: /start <code>
  const startCode = command === "/start" ? (text.split(/\s+/)[1] ?? "") : "";
  const codeWallet = startCode ? await consumeWalletCode(startCode).catch(() => null) : null;
  if (startCode && codeWallet) {
    const username = update?.message?.from?.username ?? null;
    const saved = await linkTelegram({ telegramId, wallet: codeWallet, username });
    await sendTelegramMessage(
      chatId,
      saved.ok
        ? `Linked to <code>${codeWallet}</code>. Alerts for this wallet now arrive here too. Send /mute to pause them, or ask me anything.`
        : "The link could not be saved just now. Try Connect Telegram again from the website.",
      saved.ok ? STARTERS : undefined,
    );
    return json(res, 200, { ok: true });
  }
  if (startCode && !codeWallet) {
    await sendTelegramMessage(chatId, "That link has expired or was already used. Open Connect Telegram on the website again for a fresh one.");
    return json(res, 200, { ok: true });
  }

  if (command === "/start") {
    await sendTelegramMessage(
      chatId,
      [
        "<b>Agent Souk</b>",
        "",
        "Ask me anything in plain words: which agent can protect my Venus loan, which stock pools are earning, how is my vault hire doing. I find the agents, compare them and prepare the hire; you confirm in your own wallet.",
        "",
        "Hire an agent, list your own, or finish the Set and Earn quest.",
        "Send /link to attach a wallet, or open the app with the buttons below.",
        "Send /quest to see your progress. Send /hire <tokenId> or /list to get the right page.",
        "",
        linkedLine,
      ].join("\n"),
      HIRE,
    );
    await sendTelegramMessage(chatId, "Try one of these, or type your own question:", STARTERS);
  } else if (command === "/mute") {
    await setMuted(telegramId, true);
    await sendTelegramMessage(chatId, "Notifications are off for this chat. You can still ask anything. Send /unmute to turn them back on.");
  } else if (command === "/unmute") {
    await setMuted(telegramId, false);
    await sendTelegramMessage(chatId, "Notifications are on. You will hear here when something happens to your linked wallet's hires and agents.");
  } else if (command === "/link") {
    const created = await createLinkCode(telegramId).catch(() => null);
    const link = created ? webAppUrl(`/telegram/link?code=${created.code}`) : null;
    await sendTelegramMessage(
      chatId,
      [
        "<b>Link a wallet</b>",
        "",
        link
          ? "Use the wallet you registered on BNB Chain's campaign form. Hires signed by any other wallet do not count for the quest."
          : "Could not create a link. Try again in a moment.",
        ...(link
          ? [
              "",
              "Open this link in Safari, or in MetaMask's browser, connect the wallet you hire with, and sign:",
              link,
              "",
              `Code: <code>${created.code}</code>`,
              "",
              "The code expires in 15 minutes.",
            ]
          : []),
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
      const detail = await agentDetail(chain, token);
      const skills = detail?.skills ?? [];
      const vault = skills.some((s) => /vault/i.test(`${s.id ?? ""} ${s.name ?? ""}`));
      const path = vault ? `/vault/${chain}/${token}?amount=5&days=7` : `/agents/${chain}/${token}`;
      await sendTelegramMessage(
        chatId,
        [
          `<b>Hire ${detail?.name ?? token}</b>`,
          "",
          vault
            ? "Vault hire prefilled at 5 USDT for 7 days. Change them on the page, then approve and open."
            : "Open the agent page and pick the rail.",
          "Open the link and tap Connect wallet. On Android, MetaMask opens and you approve.",
          pageLink(path),
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
        "Open the link and tap Connect wallet. On Android, MetaMask opens and you approve.",
        pageLink("/list"),
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
        "/quest  your Set and Earn progress",
        "/list  list your own agent",
        "/link  attach a wallet",
        "/wallet  the attached wallet",
        "/mute  stop notifications here, /unmute to resume",
        "",
        "Or just ask a question in plain words.",
        linkedLine,
      ].join("\n"),
      HIRE,
    );
  }

  return json(res, 200, { ok: true });
}

// the main API calls this for every notification it records; the message goes to the chat linked
// to that wallet, unless the chat muted them. nothing is sent for a wallet with no linked chat
// the website's delivery settings, through the main API with the shared secret: start a link,
// read whether the wallet is linked and to whom, or remove the link
export async function handleWalletLink(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
  if (!secretMatches(req.headers["x-assistant-secret"])) return json(res, 401, { ok: false, error: "unauthorized" });
  const body = await parseJson(req);
  const wallet = typeof body?.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet : null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!wallet) return json(res, 400, { ok: false, error: "wallet is required" });
  if (action === "start") {
    const created = await createWalletCode(wallet).catch(() => null);
    if (!created) return json(res, 503, { ok: false, error: "could not create a code" });
    const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "agentsouk_bot").replace(/^@/, "");
    return json(res, 200, { ok: true, url: `https://t.me/${bot}?start=${created.code}`, expiresAt: created.expiresAt });
  }
  if (action === "status") {
    const link = await linkForWallet(wallet).catch(() => null);
    const muted = link ? await isMuted(link.telegramId).catch(() => false) : false;
    return json(res, 200, { ok: true, linked: Boolean(link), username: link?.username ?? null, muted });
  }
  if (action === "unlink") {
    const removed = await unlinkWallet(wallet).catch(() => 0);
    return json(res, 200, { ok: true, removed });
  }
  return json(res, 400, { ok: false, error: "action must be start, status or unlink" });
}

export async function handleNotify(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
  if (!telegramBotToken()) return json(res, 503, { ok: false, error: "telegram is not configured" });
  if (!secretMatches(req.headers["x-assistant-secret"])) return json(res, 401, { ok: false, error: "unauthorized" });
  const body = await parseJson(req);
  const wallet = typeof body?.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet : null;
  const title = typeof body?.title === "string" ? body.title.slice(0, 200) : "";
  if (!wallet || !title) return json(res, 400, { ok: false, error: "wallet and title are required" });
  const chatId = await telegramForWallet(wallet).catch(() => null);
  if (!chatId) return json(res, 200, { ok: true, sent: false, reason: "not linked" });
  if (await isMuted(chatId).catch(() => false)) return json(res, 200, { ok: true, sent: false, reason: "muted" });
  const text = typeof body?.body === "string" ? body.body.slice(0, 600) : "";
  const href = typeof body?.href === "string" && /^\/[^\s]*$/.test(body.href) ? pageLink(body.href) : null;
  const lines = [`<b>${escapeHtml(title)}</b>`, text ? escapeHtml(text) : null, href ? `<a href="${href}">Open it</a>` : null];
  const sent = await sendTelegramMessage(chatId, lines.filter(Boolean).join("\n"));
  return json(res, 200, { ok: true, sent });
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

// A daily touch for every linked wallet: one message with the live quest rows
// for the attached wallet, so no one has to wonder whether they are behind.
export async function handleRemind(req, res) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!telegramBotToken() || !secret) {
    return json(res, 503, { ok: false, error: "telegram is not configured" });
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }
  const links = await listTelegramLinks().catch(() => []);
  let notified = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of links) {
    try {
      const progress = await questProgress(row.wallet);
      if (!progress || progress.team || progress.completed) {
        skipped += 1;
        continue;
      }
      await sendTelegramMessage(row.telegramId, questLines(progress));
      notified += 1;
    } catch {
      failed += 1;
    }
  }
  return json(res, 200, { ok: true, total: links.length, notified, skipped, failed });
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
  const issued = typeof body?.issued === "string" ? body.issued : "";

  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json(res, 400, { success: false, error: "wallet must be an address" }, origin);
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return json(res, 400, { success: false, error: "signature must be 65 bytes" }, origin);
  }
  if (!issued || Math.abs(Date.now() - Date.parse(issued)) > 10 * 60 * 1000) {
    return json(res, 401, { success: false, error: "the signature has expired" }, origin);
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

  const message = telegramLinkMessage({ telegramId: subject, wallet: address, issued });
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
