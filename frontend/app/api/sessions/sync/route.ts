import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions/sync");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8002";

/**
 * POST /api/sessions/sync — bulk-write localStorage sessions to the cloud on first login.
 * Body: { sessions: Record<string, unknown> }
 */
export async function POST(req: NextRequest) {
  log.info("POST", "START | bulk syncing local sessions to cloud");

  const sessionToken = req.cookies.get("sf_auth")?.value;
  if (!sessionToken) {
    log.info("POST", "no sf_auth cookie — unauthenticated");
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { sessions } = body as { sessions?: Record<string, unknown> };
  if (!sessions || typeof sessions !== "object") {
    log.warn("POST", "rejected: sessions field missing or invalid");
    return NextResponse.json({ error: "sessions must be an object." }, { status: 400 });
  }

  log.info("POST", `forwarding ${Object.keys(sessions).length} sessions to backend`);

  try {
    const res = await fetch(`${BACKEND_URL}/api/sessions/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ sessions }),
    });

    const data = await res.json();

    if (!res.ok) {
      log.error("POST", `backend error | status=${res.status} detail=${data?.detail}`);
      return NextResponse.json(
        { error: data?.detail ?? "Sync failed." },
        { status: res.status }
      );
    }

    log.info("POST", `sync complete | written=${data?.written}`);
    return NextResponse.json(data);
  } catch (err) {
    log.error("POST", `network error | ${err}`);
    return NextResponse.json({ error: "Session service unavailable." }, { status: 502 });
  }
}
