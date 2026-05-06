"use client";

import { useState, useEffect, useCallback } from "react";
import type { DailyUsage, TokenInitResponse } from "@/lib/types";

const STORAGE_KEY = "sf_daily_usage";
const DEFAULT_LIMIT = 100000;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function makeInitial(): DailyUsage {
  return { date: todayISO(), total: 0, limit: DEFAULT_LIMIT };
}

export function useTokenUsage() {
  const [dailyUsage, setDailyUsage] = useState<DailyUsage>(makeInitial);

  // Hydrate from localStorage on mount; discard if date has changed
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: DailyUsage = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.date === todayISO() &&
          typeof parsed.total === "number" &&
          typeof parsed.limit === "number"
        ) {
          setDailyUsage(parsed);
        }
        // If date differs, leave the fresh initial state (today, total=0)
      }
    } catch {
      // Corrupted storage — keep initial
    }
  }, []);

  // Persist whenever usage changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dailyUsage));
    } catch {
      // Storage unavailable — ignore
    }
  }, [dailyUsage]);

  // Add tokens to the running total (called after each API response)
  const addUsage = useCallback((tokens: number) => {
    setDailyUsage((prev) => {
      // Reset if calendar day rolled over
      const today = todayISO();
      const base = prev.date === today ? prev : { ...prev, date: today, total: 0 };
      return { ...base, total: base.total + tokens };
    });
  }, []);

  // Sync from a server TokenInitResponse (resets total + limit to authoritative values)
  // Uses Math.max when the date matches so a stale/zeroed server record never
  // clobbers a higher value already tracked locally (e.g. if logout sync failed).
  const setUsageFromServer = useCallback((response: TokenInitResponse) => {
    setDailyUsage((prev) => {
      const serverTotal = response.total_tokens;
      const total =
        prev.date === response.date
          ? Math.max(prev.total, serverTotal)
          : serverTotal;
      return { date: response.date, total, limit: response.token_limit };
    });
  }, []);

  const isBlocked = dailyUsage.total >= dailyUsage.limit;

  return { dailyUsage, isBlocked, addUsage, setUsageFromServer };
}
