"use client";

import { useState, useEffect, useCallback } from "react";
import { createLogger } from "@/lib/logger";
import type { AuthUser } from "@/lib/types";

const log = createLogger("useAuth");

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Check session on mount — silent, never throws
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json() as AuthUser;
          setUser(data);
          log.info("mount", `authenticated as ${data.email}`);
        } else {
          setUser(null);
          log.info("mount", "not authenticated — guest mode");
        }
      } catch {
        setUser(null);
        log.warn("mount", "auth check failed — treating as guest");
      } finally {
        setIsAuthLoading(false);
      }
    }

    checkAuth();
  }, []);

  /**
   * Redirect the browser to the Cognito Hosted UI.
   * @param state  Optional session ID to restore after the OAuth round-trip.
   */
  const login = useCallback(async (state?: string) => {
    try {
      const qs = state ? `?state=${encodeURIComponent(state)}` : "";
      const res = await fetch(`/api/auth/login-url${qs}`);
      if (!res.ok) throw new Error(`login-url returned ${res.status}`);
      const { url } = await res.json() as { url: string };
      log.info("login", "redirecting to Cognito Hosted UI");
      window.location.href = url;
    } catch (err) {
      log.error("login", `${err}`);
    }
  }, []);

  /**
   * Clear the server session + cookie and reset local user state.
   * Pass device_id so the BFF can sync the user's token total back to the
   * device record before the session is deleted.
   * Cookie is cleared by the BFF route regardless of backend result.
   */
  const logout = useCallback(async (device_id?: string) => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: device_id ?? null }),
      });
      log.info("logout", "session cleared");
      window.location.reload();
    } catch (err) {
      log.warn("logout", `backend call failed | ${err}`);
    } finally {
      setUser(null);
    }
  }, []);

  return { user, isAuthLoading, login, logout };
}
