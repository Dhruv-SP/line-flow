import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/generate-graph");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  log.info("POST", "START | incoming generate graph request");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    log.warn("POST", "failed to parse request body as JSON");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { description, device_id, thread_id, user_id } = body as {
    description?: string;
    device_id?: string;
    thread_id?: string;
    user_id?: string;
  };

  if (!description || typeof description !== "string" || !description.trim()) {
    log.warn("POST", "rejected: description is empty or missing");
    return NextResponse.json({ error: "Description must not be empty." }, { status: 400 });
  }
  if (!device_id || typeof device_id !== "string" || !device_id.trim()) {
    log.warn("POST", "rejected: device_id is empty or missing");
    return NextResponse.json({ error: "device_id must not be empty." }, { status: 400 });
  }
  if (!thread_id || typeof thread_id !== "string" || !thread_id.trim()) {
    log.warn("POST", "rejected: thread_id is empty or missing");
    return NextResponse.json({ error: "thread_id must not be empty." }, { status: 400 });
  }

  log.info("POST", `forwarding to backend | description_length=${description.trim().length}`);

  try {
    const res = await fetch(`${BACKEND_URL}/api/generate_graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: description.trim(), device_id, thread_id, user_id }),
    });

    const data = await res.json();

    if (!res.ok) {
      log.error("POST", `backend error | status=${res.status} detail=${data?.detail}`);
      return NextResponse.json(
        { error: data?.detail ?? `Backend error ${res.status}` },
        { status: res.status }
      );
    }

    log.info("POST", `END | success | nodes=${data?.graph?.nodes?.length ?? 0} edges=${data?.graph?.edges?.length ?? 0}`);
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    log.error("POST", `failed to reach backend | ${message}`);
    return NextResponse.json({ error: `Failed to reach backend: ${message}` }, { status: 502 });
  }
}
