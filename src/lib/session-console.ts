// the message a team wallet signs for each session console action. the browser
// builds the same text in apps/web/src/lib/session-console.ts, and a test keeps
// the two equal

export type ConsoleAction = "list" | "renew" | "revoke" | "regrant";

export const CONSOLE_ACTIONS: readonly ConsoleAction[] = ["list", "renew", "revoke", "regrant"];

export function consoleMessage(action: ConsoleAction, chainId: number, tokenId: string | null, wallet: string, at: number): string {
  return [
    "Agent Souk session console",
    `action: ${action}`,
    `chain: ${chainId}`,
    `agent: ${tokenId ?? "all"}`,
    `by: ${wallet.toLowerCase()}`,
    `at ${at}`,
  ].join("\n");
}

// the relay refuses a bundle the wallet cannot pay for before it is sent, with a
// message that names "asset deficits"; say what to do instead
export function plainRelayError(message: string): string {
  if (/asset deficit|fee token deficit|relay code 300/i.test(message)) {
    return "the executor wallet does not hold enough BNB for the relay fee. Send it some BNB and try again";
  }
  return message.slice(0, 200);
}
