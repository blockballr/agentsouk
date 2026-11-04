// The exact text a wallet signs to attach a Telegram account to it. Kept in the
// shared package so the bot server and the Mini App cannot drift on wording.

export function telegramLinkMessage(input: {
  telegramId: string;
  wallet: string;
  issued: string;
}): string {
  return [
    "Agent Souk link",
    "domain: app.agentsouk.xyz",
    `telegram: ${input.telegramId}`,
    `wallet: ${input.wallet.toLowerCase()}`,
    `issued: ${input.issued}`,
  ].join("\n");
}
