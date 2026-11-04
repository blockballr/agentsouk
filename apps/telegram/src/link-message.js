// The exact text a wallet signs to attach a Telegram account to it. Kept in the
// shared package for the web app, and duplicated here for the service; a test in
// tests/test-telegram-initdata.ts asserts both produce the same bytes.

export function telegramLinkMessage(input) {
  return [
    "Agent Souk link",
    "domain: app.agentsouk.xyz",
    `telegram: ${input.telegramId}`,
    `wallet: ${input.wallet.toLowerCase()}`,
    `issued: ${input.issued}`,
  ].join("\n");
}
