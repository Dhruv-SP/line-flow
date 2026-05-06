import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/chat");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8002";

export async function POST(req: NextRequest) {
  log.info("POST", "START | incoming chat request");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    log.warn("POST", "failed to parse request body as JSON");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { prompt, thread_id, device_id, user_id } = body as {
    prompt?: string;
    thread_id?: string;
    device_id?: string;
    user_id?: string;
  };

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    log.warn("POST", "rejected: prompt is empty or missing");
    return NextResponse.json({ error: "Prompt must not be empty." }, { status: 400 });
  }
  if (!thread_id || typeof thread_id !== "string" || !thread_id.trim()) {
    log.warn("POST", "rejected: thread_id is empty or missing");
    return NextResponse.json({ error: "thread_id must not be empty." }, { status: 400 });
  }
  if (!device_id || typeof device_id !== "string" || !device_id.trim()) {
    log.warn("POST", "rejected: device_id is empty or missing");
    return NextResponse.json({ error: "device_id must not be empty." }, { status: 400 });
  }

  log.info("POST", `forwarding to backend | thread_id=${thread_id} prompt_length=${prompt.trim().length}`);

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.trim(), thread_id, device_id, user_id }),
    });

    const data = await res.json();

    if (!res.ok) {
      log.error("POST", `backend error | status=${res.status} detail=${data?.detail}`);
      return NextResponse.json(
        { error: data?.detail ?? `Backend error ${res.status}` },
        { status: res.status }
      );
    }

    log.info("POST", "END | success");
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    log.error("POST", `failed to reach backend | ${message}`);
    return NextResponse.json({ error: `Failed to reach backend: ${message}` }, { status: 502 });
  }
}
