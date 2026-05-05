"use client";

import type { Sessions } from "@/lib/types";

interface SessionListProps {
  sessions: Sessions;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
}

function formatRelativeTime(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60)         return "just now";
  if (diffSec < 3600)       return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400)      return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onNewSession,
}: SessionListProps) {
  // Sort initialized sessions newest-first; exclude empty uninitialized ones
  // except if they are the active session (so it always shows).
  const sorted = Object.values(sessions)
    .filter((s) => s.initialized || s.session_id === activeSessionId)
    .sort((a, b) => b.created_at - a.created_at);

  return (
    <div className="flex flex-col gap-1">
      {/* New session button */}
      <button
        onClick={onNewSession}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors w-full text-left"
      >
        <span className="material-icons text-[18px]">add</span>
        New session
      </button>

      <div className="mt-1 border-t border-gray-800" />

      {sorted.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-600 italic">No sessions yet.</p>
      )}

      {sorted.map((session) => {
        const isActive = session.session_id === activeSessionId;
        const label = session.first_prompt.trim() || "New session";

        return (
          <button
            key={session.session_id}
            onClick={() => onSelect(session.session_id)}
            title={session.first_prompt || undefined}
            className={`group flex flex-col rounded-lg px-3 py-2 text-left transition-colors w-full ${
              isActive
                ? "bg-indigo-600/20 border border-indigo-500/40 text-gray-100"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200 border border-transparent"
            }`}
          >
            <span className="truncate text-sm font-medium leading-snug">
              {label.length > 45 ? label.slice(0, 45) + "…" : label}
            </span>
            <span className={`text-[10px] mt-0.5 ${isActive ? "text-indigo-300" : "text-gray-600 group-hover:text-gray-500"}`}>
              {formatRelativeTime(session.created_at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
