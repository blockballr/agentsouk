// outbound email for listing review and boost receipts
// provider: Resend HTTP API when RESEND_API_KEY is set; otherwise log only

export interface NotifyResult {
  ok: boolean;
  provider: "resend" | "log";
  id?: string;
  error?: string;
}

const RESEND_URL = "https://api.resend.com/emails";

function fromAddress(): string {
  return process.env.NOTIFY_FROM ?? "Agent Souk <onboarding@resend.dev>";
}

function teamAddress(): string | null {
  return process.env.NOTIFY_EMAIL ?? null;
}

function isEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
}

async function sendViaResend(
  to: string[],
  subject: string,
  text: string,
): Promise<NotifyResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, provider: "resend", error: "RESEND_API_KEY missing" };
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to,
        subject,
        text,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, provider: "resend", error: body.message ?? `resend ${res.status}` };
    }
    return { ok: true, provider: "resend", id: body.id };
  } catch (e) {
    return { ok: false, provider: "resend", error: (e as Error).message };
  }
}

export async function notifyListingRequest(input: {
  tokenId: string;
  contact: string;
  note: string;
  createdAt: string;
}): Promise<NotifyResult[]> {
  const results: NotifyResult[] = [];
  const team = teamAddress();
  const subject = `Listing review request: token ${input.tokenId}`;
  const text = [
    `New listing review request on Agent Souk.`,
    ``,
    `Token id: ${input.tokenId}`,
    `Contact: ${input.contact}`,
    `Created: ${input.createdAt}`,
    ``,
    `Note:`,
    input.note || "(none)",
  ].join("\n");

  if (team) {
    const r = await sendViaResend([team], subject, text);
    results.push(r);
    if (!r.ok && r.error?.includes("RESEND_API_KEY")) {
      results.push({ ok: true, provider: "log", id: "team-log" });
      console.log("[notify] listing request (no RESEND_API_KEY)", { tokenId: input.tokenId, contact: input.contact });
    }
  } else {
    console.log("[notify] listing request (no NOTIFY_EMAIL)", {
      tokenId: input.tokenId,
      contact: input.contact,
    });
    results.push({ ok: true, provider: "log", id: "team-log" });
  }

  if (isEmail(input.contact)) {
    const ack = await sendViaResend(
      [input.contact.trim()],
      "We received your Agent Souk listing review request",
      [
        `Thanks. We have your request for token ${input.tokenId}.`,
        `A human reads every request and will reply to this address if the listing needs more detail.`,
        ``,
        `Agent Souk does not auto-list from this form; verification and review decide the shelf.`,
      ].join("\n"),
    );
    results.push(ack);
    if (!ack.ok && ack.error?.includes("RESEND_API_KEY")) {
      console.log("[notify] skip lister ack (no RESEND_API_KEY)", input.contact);
    }
  }

  return results;
}

export async function notifyBoostReceipt(input: {
  tokenId: string;
  agentName: string;
  days: number;
  expiresAt: string;
  contact?: string;
}): Promise<NotifyResult[]> {
  const results: NotifyResult[] = [];
  const team = teamAddress();
  const subject = `Boost active: ${input.agentName} (${input.days}d)`;
  const text = [
    `Agent boost recorded.`,
    `Agent: ${input.agentName}`,
    `Token: ${input.tokenId}`,
    `Days: ${input.days}`,
    `Expires: ${input.expiresAt}`,
    input.contact ? `Contact: ${input.contact}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (team) {
    results.push(await sendViaResend([team], subject, text));
  } else {
    console.log("[notify] boost (no NOTIFY_EMAIL)", input);
    results.push({ ok: true, provider: "log" });
  }

  if (input.contact && isEmail(input.contact)) {
    results.push(
      await sendViaResend(
        [input.contact],
        "Your Agent Souk boost is live",
        [
          `${input.agentName} is boosted until ${input.expiresAt}.`,
          `Boosted agents sort higher on the marketplace for the paid window.`,
        ].join("\n"),
      ),
    );
  }

  return results;
}
