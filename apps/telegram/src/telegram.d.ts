export interface TelegramUser {
  id: string;
  username?: string;
  firstName?: string;
}

export interface InitDataResult {
  ok: boolean;
  user?: TelegramUser;
  authDate?: number;
  error?: string;
}

export function telegramBotToken(): string | null;
export function webAppUrl(path: string): string;
export function verifyInitData(
  initData: string,
  opts?: { maxAgeSeconds?: number; now?: number },
): InitDataResult;
export function sendTelegramMessage(
  chatId: string | number,
  text: string,
  keyboard?: unknown,
): Promise<boolean>;
