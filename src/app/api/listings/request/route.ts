import { NextRequest, NextResponse } from "next/server";
import { validateListingRequest } from "@/lib/listing-request";
import { recordListingRequest } from "@/lib/listing-request-store";

export const dynamic = "force-dynamic";

// a builder asks for a human review of their agent for listing. the request
// is validated and stored; the team reads the store. no notification is sent
// yet — that is a deliberate later step, not a silent omission.
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

  await recordListingRequest({
    tokenId: (input.tokenId as string).trim(),
    contact: (input.contact as string).trim(),
    note: input.note as string,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ success: true });
}
