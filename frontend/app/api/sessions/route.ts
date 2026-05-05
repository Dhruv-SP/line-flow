import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

/** GET /api/sessions — fetch all cloud sessions for the authenticated user */
export async function GET(req: NextRequest) {
  log.info("GET", "START | fetching cloud sessions");

  const sessionToken = req.cookies.get("sf_auth")?.value;
  if (!sessionToken) {
    log.info("GET", "no sf_auth cookie — unauthenticated");
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/sessions`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    const data = await res.json();

    if (!res.ok) {
      log.error("GET", `backend error | status=${res.status} detail=${data?.detail}`);
      return NextResponse.json(
        { error: data?.detail ?? "Failed to load sessions." },
        { status: res.status }
      );
    }

    log.info("GET", `returning ${Object.keys(data.sessions ?? {}).length} sessions`);
    return NextResponse.json(data);
  } catch (err) {
    log.error("GET", `network error | ${err}`);
    return NextResponse.json({ error: "Session service unavailable." }, { status: 502 });
  }
}
