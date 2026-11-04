// The exact text a wallet signs to attach a Telegram account to it. Kept in the
// shared package so the bot server and the Mini App cannot drift on wording.

export function telegramLinkMessage(input: { telegramId: string; wallet: string }): string {
  return [
    "Agent Souk link",
    `telegram: ${input.telegramId}`,
    `wallet: ${input.wallet.toLowerCase()}`,
  ].join("\n");
}
