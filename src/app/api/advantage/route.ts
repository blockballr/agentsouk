import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

// the report is committed evidence, served as-is. The page reads the chain and the
// mainnet slot from the data, so a testnet capture, a mainnet capture or an older
// capture without either all render without a route change.
export async function GET() {
  let raw: string;
  try {
    raw = await readFile(path.join(process.cwd(), "data/advantage-tasks.json"), "utf8");
  } catch {
    return NextResponse.json({ success: false, error: "no advantage report captured yet" }, { status: 404 });
  }

  try {
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== "object") {
      return NextResponse.json({ success: false, error: "advantage report is not an object" }, { status: 500 });
    }
    // a capture with no tasks is an empty shelf, not an error
    if (!Array.isArray(data.tasks)) data.tasks = [];
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ success: false, error: "advantage report is not valid json" }, { status: 500 });
  }
}
