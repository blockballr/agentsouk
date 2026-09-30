// Session terms, defined once so the page and the facilitator cannot disagree.

export const SESSION_SPEND_CAP_USD = 5;
export const SESSION_HOURS = 24;

// the text a buyer signs to revoke their own session; the paymentId is public
// through the hires-per-wallet API, so knowing it must never be enough
export function revokeRequestMessage(paymentId: string, client: string): string {
  return ["Agent Souk session revoke", `paymentId: ${paymentId}`, `client: ${client.toLowerCase()}`].join("\n");
}
