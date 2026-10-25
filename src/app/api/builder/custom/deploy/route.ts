import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// CreateOS retired permanently: uploads returned 500 and the account was
// banned, so there is no recovery path. The supported lane is export and
// deploy anywhere, then attach the endpoint.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      ok: false,
      code: "DEPLOY_ARCHIVED",
      error: "CreateOS is retired. Download the agent files and deploy them anywhere, then attach the endpoint.",
      export: "/api/builder/custom/export",
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
