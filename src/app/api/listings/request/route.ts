import { NextRequest, NextResponse } from "next/server";
import { validateListingRequest } from "@/lib/listing-request";
import { recordListingRequest } from "@/lib/listing-request-store";
import { notifyListingRequest } from "@/lib/notify";

export const dynamic = "force-dynamic";

// a builder asks for a human review of their agent for listing. the request
// is stored, then the team (and the lister when the contact is an email) is
// notified when RESEND_API_KEY / NOTIFY_EMAIL are configured
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as { tokenId?: unknown; contact?: unknown; note?: unknown };
  const validation = validateListingRequest({
    tokenId: typeof input.tokenId === "string" ? input.tokenId : "",
    contact: typeof input.contact === "string" ? input.contact : "",
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
    contact: (input.contact as string).trim(),
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
