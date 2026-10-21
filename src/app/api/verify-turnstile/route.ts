import { NextRequest, NextResponse } from "next/server";

// Verifies a Cloudflare Turnstile token server-side. The secret never leaves
// the server; the browser only ever sees the site key.
export async function POST(req: NextRequest) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // In dev or when the gate is not configured, accept the request so the
    // app stays usable; production must set TURNSTILE_SECRET_KEY.
    return NextResponse.json({ success: true });
  }

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "");
  } catch {
    token = "";
  }
  if (!token) {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "";
  const params = new URLSearchParams();
  params.append("secret", secret);
  params.append("response", token);
  if (ip) params.append("remoteip", ip.split(",")[0].trim());

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as { success?: boolean };
    return NextResponse.json({ success: Boolean(data?.success) });
  } catch {
    return NextResponse.json({ success: false }, { status: 502 });
  }
}
