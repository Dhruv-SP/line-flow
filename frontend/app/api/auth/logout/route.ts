import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth/logout");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  log.info("POST", "START | logging out");

  const sessionToken = req.cookies.get("sf_auth")?.value;

  if (sessionToken) {
    try {
      await fetch(`${BACKEND_URL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      log.info("POST", "backend session deleted");
    } catch (err) {
      // Non-fatal: still clear cookie client-side
      log.warn("POST", `backend logout failed | ${err}`);
    }
  } else {
    log.info("POST", "no sf_auth cookie — nothing to delete on backend");
  }

  // Clear the cookie in the browser regardless of backend result
  const res = NextResponse.json({ status: "logged out" });
  res.cookies.set("sf_auth", "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
  });
  return res;
}
