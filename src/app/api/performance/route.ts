import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

// the scan output is committed evidence, served as-is
// a 404 is honest: no performance scan captured yet
export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), "data/performance.json"), "utf8");
    return NextResponse.json({ success: true, data: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ success: false, error: "no performance scan captured yet" }, { status: 404 });
  }
}
