import { NextRequest, NextResponse } from "next/server";
import { validateListingRequest } from "@/lib/listing-request";
import { recordListingRequest } from "@/lib/listing-request-store";
import { notifyListingRequest } from "@/lib/notify";

export const dynamic = "force-dynamic";

// a builder asks for a human review of their agent for listing; the request is stored and
// the team (and lister, at the email they give) is notified when RESEND_API_KEY / NOTIFY_EMAIL are set
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as {
    tokenId?: unknown;
    email?: unknown;
    telegram?: unknown;
    note?: unknown;
  };
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const rawTelegram = typeof input.telegram === "string" ? input.telegram.trim() : "";
  // store the handle in its display form, so the queue and the reply read alike
  const telegram = rawTelegram && !rawTelegram.startsWith("@") ? `@${rawTelegram}` : rawTelegram;

  const validation = validateListingRequest({
    tokenId: typeof input.tokenId === "string" ? input.tokenId : "",
    email,
    telegram,
    note: typeof input.note === "string" ? input.note : "",
  });
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.errors[0] ?? "Invalid request." },
      { status: 400 },
    );
  }

  const record = {
    tokenId: (input.tokenId as string).trim(),
    email,
    telegram,
    note: input.note as string,
    createdAt: new Date().toISOString(),
  };
  await recordListingRequest(record);
  const notifications = await notifyListingRequest(record);
  return NextResponse.json({
    success: true,
    notified: notifications.some((n) => n.ok),
  });
}
