import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/chat/checkpoint");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ thread_id: string }> }
) {
  const { thread_id } = await params;

  if (!thread_id || !thread_id.trim()) {
    log.warn("DELETE", "rejected: thread_id is empty or missing");
    return NextResponse.json({ error: "thread_id must not be empty." }, { status: 400 });
  }

  log.info("DELETE", `forwarding checkpoint delete to backend | thread_id=${thread_id}`);

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/chat/${encodeURIComponent(thread_id)}/checkpoint`,
      { method: "DELETE" }
    );

    if (!res.ok) {
      let detail = `Backend error ${res.status}`;
      try {
        const data = await res.json();
        if (data?.detail) detail = data.detail;
      } catch { /* ignore */ }
      log.error("DELETE", `backend error | status=${res.status} detail=${detail}`);
      return NextResponse.json({ error: detail }, { status: res.status });
    }

    log.info("DELETE", `END | checkpoint deleted | thread_id=${thread_id}`);
    return NextResponse.json({ message: "Checkpoint deleted." });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    log.error("DELETE", `failed to reach backend | ${message}`);
    return NextResponse.json({ error: `Failed to reach backend: ${message}` }, { status: 502 });
  }
}
