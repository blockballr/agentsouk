import { NextRequest, NextResponse } from "next/server";
import { privateEndpointReason } from "@/lib/endpoint";

export const dynamic = "force-dynamic";

// The card urls a pasted link may serve, asked in order: the link itself first,
// then the well-known card one level above an /a2a messaging link, or beside
// the pasted path when it is not already a card. Null when the link is not a url.
export function cardUrlCandidates(raw: string): string[] | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const candidates = [`${parsed.origin}${path || "/"}`];
  if (/\/a2a$/i.test(path)) {
    // a messaging link hosts its card one level above itself, and an agent can
    // also sit that card at the origin's well-known path
    const base = path.replace(/\/a2a$/i, "");
    candidates.push(`${parsed.origin}${base}/.well-known/agent-card.json`);
    if (base) candidates.push(`${parsed.origin}/.well-known/agent-card.json`);
  } else if (!/\.well-known\/agent-card\.json$/i.test(path)) {
    candidates.push(`${parsed.origin}${path}/.well-known/agent-card.json`);
  }
  return [...new Set(candidates)];
}

// A card read for the listing wizard, proxied through the server so a card that
// does not answer browser CORS still fills the form. Public https only, never
// an internal address, and a redirect cannot carry the call onto one.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = (req.nextUrl.searchParams.get("url") ?? "").trim();
  const refusal = httpsReachableReason(url);
  if (refusal) {
    return NextResponse.json({ success: false, error: refusal }, { status: 400 });
  }

  const candidates = cardUrlCandidates(url);
  if (!candidates) {
    return NextResponse.json({ success: false, error: "that link is not a usable https url" }, { status: 400 });
  }

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      // the redirect chain ends at res.url, so the final address passes the
      // same guard the pasted link did
      if (privateEndpointReason(res.url || candidate)) continue;
      const body = (await res.json()) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const icon = [body.icon, body.image, body.avatar].find(
        (v): v is string => typeof v === "string" && v.trim().startsWith("https://"),
      );
      if (!name && !description && !icon) continue;
      return NextResponse.json(
        { success: true, url: candidate, ...(name ? { name } : {}), ...(description ? { description } : {}), ...(icon ? { image: icon.trim() } : {}) },
      );
    } catch {
      // the next candidate answers, or the wizard reports the card unread
    }
  }
  return NextResponse.json({ success: false, error: "no agent card at that link" }, { status: 404 });
}

function httpsReachableReason(url: string): string | null {
  const privateReason = privateEndpointReason(url);
  if (privateReason) return privateReason;
  return /^https:\/\//i.test(url) ? null : "only an https endpoint can be read here";
}
