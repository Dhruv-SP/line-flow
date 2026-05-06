import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth/me");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8002";

export async function GET(req: NextRequest) {
  log.info("GET", "START | checking auth session");

  // Read the HttpOnly sf_auth cookie set by the backend callback
  const sessionToken = req.cookies.get("sf_auth")?.value;

  if (!sessionToken) {
    log.info("GET", "no sf_auth cookie — unauthenticated");
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    const data = await res.json();

    if (!res.ok) {
      log.warn("GET", `backend rejected session | status=${res.status}`);
      return NextResponse.json(
        { error: data?.detail ?? "Session invalid." },
        { status: res.status }
      );
    }

    log.info("GET", `authenticated | user_id=${String(data.user_id).slice(0, 8)}...`);
    return NextResponse.json(data);
  } catch (err) {
    log.error("GET", `network error | ${err}`);
    return NextResponse.json({ error: "Auth service unavailable." }, { status: 502 });
  }
}
