"use client";

import type { AuthUser } from "@/lib/types";

interface AuthPanelProps {
  user: AuthUser | null;
  isAuthLoading: boolean;
  /** Pass the active session ID so state is preserved after Cognito round-trip */
  activeSessionId: string | null;
  onLogin: (state?: string) => void;
  onLogout: () => void;
}

export default function AuthPanel({
  user,
  isAuthLoading,
  activeSessionId,
  onLogin,
  onLogout,
}: AuthPanelProps) {
  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isAuthLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-1 animate-pulse">
        <div className="w-7 h-7 rounded-full bg-gray-700 flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 rounded bg-gray-700 w-3/4" />
          <div className="h-2 rounded bg-gray-800 w-1/2" />
        </div>
      </div>
    );
  }

  // ── Logged-in ─────────────────────────────────────────────────────────────
  if (user) {
    const initial = (user.name || user.email).charAt(0).toUpperCase();
    const displayName = user.name || user.email;
    const truncatedEmail =
      user.email.length > 26 ? user.email.slice(0, 24) + "…" : user.email;

    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-900 px-2 py-2">
        {/* Avatar initial */}
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-semibold text-white"
          aria-hidden="true"
        >
          {initial}
        </div>

        {/* Name + email */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-100 truncate leading-tight">
            {displayName}
          </p>
          <p className="text-[10px] text-gray-400 truncate leading-tight">
            {truncatedEmail}
          </p>
        </div>

        {/* Sign-out icon button */}
        <button
          onClick={onLogout}
          className="flex-shrink-0 text-gray-500 hover:text-gray-200 transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <span className="material-icons text-[18px]">logout</span>
        </button>
      </div>
    );
  }

  // ── Guest ─────────────────────────────────────────────────────────────────
  return (
    <button
      onClick={() => onLogin(activeSessionId ?? undefined)}
      className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors px-3 py-2 text-sm font-medium text-white"
    >
      <span className="material-icons text-[16px]">login</span>
      Sign in
    </button>
  );
}
