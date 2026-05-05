import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions/[session_id]");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

/** PUT /api/sessions/[session_id] — create or replace a single cloud session */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ session_id: string }> }
) {
  const { session_id } = await params;
  log.info("PUT", `START | session_id=${session_id.slice(0, 8)}...`);

  const sessionToken = req.cookies.get("sf_auth")?.value;
  if (!sessionToken) {
    log.info("PUT", "no sf_auth cookie — unauthenticated");
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/sessions/${encodeURIComponent(session_id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      log.error("PUT", `backend error | status=${res.status} detail=${data?.detail}`);
      return NextResponse.json(
        { error: data?.detail ?? "Failed to save session." },
        { status: res.status }
      );
    }

    log.info("PUT", `session saved | session_id=${session_id.slice(0, 8)}...`);
    return NextResponse.json(data);
  } catch (err) {
    log.error("PUT", `network error | ${err}`);
    return NextResponse.json({ error: "Session service unavailable." }, { status: 502 });
  }
}
