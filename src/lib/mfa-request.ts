import "server-only";
import { verifyMessage } from "viem";

// Proof that the caller controls the wallet: a signed message that names the
// wallet and a timestamp no older than five minutes, so a captured signature
// cannot be replayed later.
export async function verifyWalletProof(wallet: string, message: string, signature: string): Promise<boolean> {
  if (!message || !signature) return false;
  if (!message.toLowerCase().includes(wallet.toLowerCase())) return false;
  const stamp = Number(/at\s+(\d{10,})/.exec(message)?.[1] ?? 0);
  if (!stamp || Math.abs(Date.now() - stamp) > 5 * 60 * 1000) return false;
  try {
    return await verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
