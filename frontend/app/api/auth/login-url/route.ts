import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth/login-url");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") ?? "";

  log.info("GET", `START | state=${state || "(none)"}`);

  try {
    // Ask backend for the Cognito login URL.
    // redirect: "manual" prevents fetch from following the redirect — we need the Location header.
    const res = await fetch(
      `${BACKEND_URL}/auth/login?state=${encodeURIComponent(state)}`,
      { redirect: "manual" }
    );

    // Backend returns 302 — grab the Location header
    const loginUrl = res.headers.get("location");
    if (!loginUrl) {
      log.error("GET", "backend did not return a Location header");
      return NextResponse.json(
        { error: "Failed to build login URL." },
        { status: 502 }
      );
    }

    log.info("GET", "returning Cognito login URL");
    return NextResponse.json({ url: loginUrl });
  } catch (err) {
    log.error("GET", `network error | ${err}`);
    return NextResponse.json({ error: "Auth service unavailable." }, { status: 502 });
  }
}
