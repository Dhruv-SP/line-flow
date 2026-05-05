"use client";

import type { RetryContext } from "@/lib/types";

interface RetryBannerProps {
  retryContext: RetryContext;
  onRetry: () => void;
  onNewSession: () => void;
}

// Steps where retrying the same prompt makes sense
const RETRYABLE_STEPS: RetryContext["step"][] = ["description", "graph", "chat"];

const STEP_LABELS: Record<RetryContext["step"], string> = {
  description: "Description generation failed",
  graph:       "Graph generation failed",
  chat:        "Chat request failed",
  corrupted:   "Session state corrupted",
  quota:       "Daily token quota reached",
};

export default function RetryBanner({ retryContext, onRetry, onNewSession }: RetryBannerProps) {
  const isQuota = retryContext.step === "quota";
  const canRetry = RETRYABLE_STEPS.includes(retryContext.step);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${
        isQuota
          ? "bg-amber-950 border border-amber-700 text-amber-200"
          : "bg-red-950 border border-red-700 text-red-200"
      }`}
      role="alert"
    >
      <span
        className={`material-icons mt-0.5 text-[18px] flex-shrink-0 ${
          isQuota ? "text-amber-400" : "text-red-400"
        }`}
      >
        {isQuota ? "block" : "error_outline"}
      </span>

      <div className="flex-1 min-w-0">
        <p className="font-semibold">{STEP_LABELS[retryContext.step]}</p>
        <p className="mt-0.5 text-xs opacity-80">{retryContext.message}</p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 ml-2">
        {canRetry && (
          <button
            onClick={onRetry}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              isQuota
                ? "bg-amber-700 hover:bg-amber-600 text-white"
                : "bg-red-700 hover:bg-red-600 text-white"
            }`}
          >
            Retry
          </button>
        )}
        <button
          onClick={onNewSession}
          className="rounded-lg bg-gray-700 hover:bg-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors"
        >
          New Session
        </button>
      </div>
    </div>
  );
}
