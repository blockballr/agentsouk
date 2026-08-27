import { NextResponse } from "next/server";
import { fetchPlatformStats } from "@/lib/scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  const platform = await fetchPlatformStats();
  return NextResponse.json({
    success: true,
    platform,
  });
}