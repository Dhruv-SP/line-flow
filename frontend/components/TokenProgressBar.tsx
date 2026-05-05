"use client";

import type { DailyUsage } from "@/lib/types";

interface TokenProgressBarProps {
  dailyUsage: DailyUsage;
}

function getBarColour(pct: number): string {
  if (pct >= 1)   return "bg-red-500";
  if (pct >= 0.8) return "bg-amber-400";
  return "bg-emerald-500";
}

function getLabelColour(pct: number): string {
  if (pct >= 1)   return "text-red-400";
  if (pct >= 0.8) return "text-amber-400";
  return "text-emerald-400";
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export default function TokenProgressBar({ dailyUsage }: TokenProgressBarProps) {
  const { total, limit } = dailyUsage;
  const pct = limit > 0 ? Math.min(total / limit, 1) : 0;
  const barColour = getBarColour(pct);
  const labelColour = getLabelColour(pct);
  const pctLabel = Math.round(pct * 100);

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Daily tokens</span>
        <span className={`text-xs font-medium tabular-nums ${labelColour}`}>
          {formatNumber(total)} / {formatNumber(limit)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColour}`}
          style={{ width: `${pctLabel}%` }}
          role="progressbar"
          aria-valuenow={total}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${pctLabel}% of daily token quota used`}
        />
      </div>
      {pct >= 1 && (
        <p className="mt-1 text-[10px] text-red-400">
          Quota reached — resets tomorrow.
        </p>
      )}
    </div>
  );
}
