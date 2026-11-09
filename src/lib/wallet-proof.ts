// A read of a wallet's own rows has to prove the caller holds that wallet. The
// app's sign-in already produces a signed statement naming the site, the address
// and the time; the bell replays it as headers, and this checks it. The site
// line is an allowlist, so a signature collected by another origin is refused.

import { isAddress, recoverMessageAddress } from "viem";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SKEW_MS = 5 * 60 * 1000;

export function allowedSites(): string[] {
  const configured = (process.env.AGENTSOUK_ORIGINS ?? "")
    .split(",")
    .map((site) => site.trim())
    .filter(Boolean);
  const defaults = ["https://agentsouk.xyz", "https://www.agentsouk.xyz", "https://app.agentsouk.xyz"];
  if (process.env.NODE_ENV !== "production") {
    defaults.push("http://localhost:5173", "http://localhost:4173", "http://localhost:4179");
  }
  return [...new Set([...configured, ...defaults])];
}

export async function verifyWalletProof(input: {
  wallet: string;
  message?: string | null;
  signature?: string | null;
  now?: number;
  sites?: readonly string[];
}): Promise<boolean> {
  const { wallet, message, signature } = input;
  if (!isAddress(wallet) || !message || !signature) return false;

  // the exact four lines signInMessage writes; anything else is not our record
  const lines = message.split("\n");
  if (lines.length !== 4 || lines[0] !== "Agent Souk sign-in") return false;
  if (!lines[1].startsWith("site: ") || !lines[2].startsWith("address: ") || !lines[3].startsWith("issued: ")) {
    return false;
  }
  const site = lines[1].slice("site: ".length);
  const address = lines[2].slice("address: ".length);
  const issued = lines[3].slice("issued: ".length);
  if (address.toLowerCase() !== wallet.toLowerCase()) return false;

  const sites = input.sites ?? allowedSites();
  if (!sites.includes(site)) return false;

  const at = Date.parse(issued);
  if (!Number.isFinite(at)) return false;
  const now = input.now ?? Date.now();
  if (at > now + SKEW_MS || now - at > MAX_AGE_MS) return false;

  try {
    const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    return recovered.toLowerCase() === wallet.toLowerCase();
  } catch {
    return false;
  }
}

export function proofFromHeaders(headers: Headers): { message: string | null; signature: string | null } {
  const raw = headers.get("x-agentsouk-message");
  let message: string | null = null;
  if (raw) {
    try {
      message = Buffer.from(raw, "base64").toString("utf8");
    } catch {
      message = null;
    }
  }
  return { message, signature: headers.get("x-agentsouk-signature") };
}
