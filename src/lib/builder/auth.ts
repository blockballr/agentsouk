import "server-only";

import { recoverMessageAddress } from "viem";

const WINDOW_MS = 5 * 60 * 1000;

export interface AuthResult {
  ok: boolean;
  error?: string;
}

export async function verifyWalletAuth(
  req: Request,
  owner: string,
  scope: string,
  subject: string = "",
): Promise<AuthResult> {
  const sig = req.headers.get("x-wallet-signature");
  const ts = req.headers.get("x-wallet-timestamp");
  if (!sig || !ts) {
    return { ok: false, error: "missing wallet signature (x-wallet-signature, x-wallet-timestamp)" };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > WINDOW_MS) {
    return { ok: false, error: "wallet signature expired or invalid timestamp" };
  }
  const message = `soukdio:${scope}:${owner.toLowerCase()}:${subject}:${ts}`;
  try {
    const recovered = await recoverMessageAddress({ message, signature: sig as `0x${string}` });
    if (recovered.toLowerCase() !== owner.toLowerCase()) {
      return { ok: false, error: "wallet signature does not match owner" };
    }
  } catch {
    return { ok: false, error: "wallet signature recovery failed" };
  }
  return { ok: true };
}
