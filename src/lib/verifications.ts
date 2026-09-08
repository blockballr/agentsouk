import type { Verification } from "@/lib/types";

interface VerificationsFile {
  updatedAt: string;
  results: {
    tokenId: string;
    name: string;
    category: string;
    status: Verification["status"];
    responseMs: number;
    checkedAt: string;
    quality?: Verification["quality"];
  }[];
}

export async function loadVerifications(): Promise<Map<string, Verification>> {
  const byToken = new Map<string, Verification>();
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "data", "verifications.json");
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as VerificationsFile;
    for (const r of parsed.results ?? []) {
      if (
        r?.tokenId != null &&
        (r.status === "delivered" || r.status === "gated" || r.status === "dead" || r.status === "unreachable") &&
        typeof r.responseMs === "number" &&
        typeof r.checkedAt === "string"
      ) {
        const verification: Verification = {
          status: r.status,
          responseMs: r.responseMs,
          checkedAt: r.checkedAt,
        };
        if (
          r.quality &&
          (r.quality.grade === "good" || r.quality.grade === "partial" || r.quality.grade === "poor") &&
          typeof r.quality.reason === "string" &&
          typeof r.quality.model === "string"
        ) {
          verification.quality = {
            grade: r.quality.grade,
            reason: r.quality.reason,
            model: r.quality.model,
          };
        }
        byToken.set(String(r.tokenId), verification);
      }
    }
  } catch {
    // missing or unreadable file means no badge anywhere, which is honest
  }
  return byToken;
}
