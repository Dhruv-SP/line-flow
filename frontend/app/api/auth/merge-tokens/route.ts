import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth/merge-tokens");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  log.info("POST", "START | merging guest tokens into user account");

  const sessionToken = req.cookies.get("sf_auth")?.value;
  if (!sessionToken) {
    log.warn("POST", "rejected: no sf_auth cookie");
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { device_id } = body as { device_id?: string };
  if (!device_id || typeof device_id !== "string" || !device_id.trim()) {
    log.warn("POST", "rejected: device_id missing");
    return NextResponse.json({ error: "device_id must not be empty." }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/auth/merge_tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ device_id }),
    });

    const data = await res.json();

    if (!res.ok) {
      log.error("POST", `backend error | status=${res.status} detail=${data?.detail}`);
      return NextResponse.json(
        { error: data?.detail ?? "Merge failed." },
        { status: res.status }
      );
    }

    log.info("POST", `merge complete | merged_total=${data?.merged_total}`);
    return NextResponse.json(data);
  } catch (err) {
    log.error("POST", `network error | ${err}`);
    return NextResponse.json({ error: "Auth service unavailable." }, { status: 502 });
  }
}
