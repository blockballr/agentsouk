export interface TelegramLink {
  telegramId: string;
  wallet: string;
  username: string | null;
  linkedAt: string;
}

export function linkTelegram(input: {
  telegramId: string;
  wallet: string;
  username?: string | null;
}): Promise<{ ok: boolean; error?: string }>;

export function walletForTelegram(telegramId: string): Promise<string | null>;
export function telegramForWallet(wallet: string): Promise<string | null>;
export function listTelegramLinks(): Promise<Array<{ telegramId: string; wallet: string }>>;

export function createLinkCode(
  telegramId: string,
): Promise<{ code: string; expiresAt: string } | null>;

export function consumeLinkCode(code: string): Promise<string | null>;
