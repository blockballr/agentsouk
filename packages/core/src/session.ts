// Session terms, defined once so the page and the facilitator cannot disagree.

// env-configurable per-session spend cap (USD). reads from process.env on the
// server and VITE_SESSION_CAP in the browser bundle; falls back to 5.
function readSessionCap(): number {
  let raw: string | undefined;
  try {
    raw = typeof process !== "undefined" ? process.env?.AGENT_SESSION_CAP_USD : undefined;
  } catch {
    raw = undefined;
  }
  if (!raw) {
    try {
      raw = (import.meta as { env?: { VITE_SESSION_CAP?: string } })?.env?.VITE_SESSION_CAP;
    } catch {
      raw = undefined;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export const SESSION_SPEND_CAP_USD = readSessionCap();
export const SESSION_HOURS = 24;

// the text a buyer signs to revoke their own session; the paymentId is public
// through the hires-per-wallet API, so knowing it must never be enough
export function revokeRequestMessage(paymentId: string, client: string): string {
  return ["Agent Souk session revoke", `paymentId: ${paymentId}`, `client: ${client.toLowerCase()}`].join("\n");
}
