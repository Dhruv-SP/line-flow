"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { Sessions, DailyUsage } from "@/lib/types";
import SessionList from "@/components/SessionList";
import TokenProgressBar from "@/components/TokenProgressBar";

interface SidebarProps {
  sessions: Sessions;
  activeSessionId: string | null;
  dailyUsage: DailyUsage;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  authSlot?: ReactNode;
  // Mobile
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({
  sessions,
  activeSessionId,
  dailyUsage,
  onSelectSession,
  onNewSession,
  authSlot,
  isOpen,
  onClose,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  function handleSelect(sessionId: string) {
    onSelectSession(sessionId);
    onClose();
  }

  function handleNew() {
    onNewSession();
    onClose();
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          flex flex-col flex-shrink-0 h-full bg-gray-950 border-r border-gray-800
          fixed inset-y-0 left-0 z-30 transition-all duration-300
          md:static md:translate-x-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          ${isCollapsed ? "md:w-14 w-72" : "w-72"}
        `}
      >
        {/* Brand header — layout differs between collapsed and expanded */}
        {isCollapsed ? (
          /* Collapsed: vertical stack — chevron → logo → new session */
          <div className="hidden md:flex flex-col items-center pt-3 pb-2 gap-3 flex-shrink-0">
            {/* Expand tooltip */}
            <div className="relative group flex items-center justify-center">
              <button
                onClick={() => setIsCollapsed(false)}
                className="flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
                aria-label="Expand sidebar"
              >
                <span className="material-icons text-[20px]">chevron_right</span>
              </button>
              <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <div className="whitespace-nowrap rounded-md bg-gray-800 border border-gray-700 px-2.5 py-1.5 text-xs text-gray-200 shadow-lg">Expand sidebar</div>
              </div>
            </div>
            <span className="material-symbols-outlined text-indigo-400 text-[22px]">graph_3</span>
            {/* New session tooltip */}
            <div className="relative group flex items-center justify-center">
              <button
                onClick={handleNew}
                className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
                aria-label="New session"
              >
                <span className="material-icons text-[20px]">add</span>
              </button>
              <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <div className="whitespace-nowrap rounded-md bg-gray-800 border border-gray-700 px-2.5 py-1.5 text-xs text-gray-200 shadow-lg">New session</div>
              </div>
            </div>
          </div>
        ) : (
          /* Expanded: horizontal row */
          <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-800 flex-shrink-0">
            <span className="material-symbols-outlined text-indigo-400 text-[22px] flex-shrink-0">graph_3</span>
            <span className="text-base font-semibold text-gray-100 tracking-tight truncate">SystemFlow</span>
            {/* Mobile close */}
            <button
              onClick={onClose}
              className="ml-auto md:hidden text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Close sidebar"
            >
              <span className="material-icons text-[22px]">close</span>
            </button>
            {/* Desktop collapse toggle */}
            <button
              onClick={() => setIsCollapsed(true)}
              className="ml-auto hidden md:flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Collapse sidebar"
            >
              <span className="material-icons text-[20px]">chevron_left</span>
            </button>
          </div>
        )}

        {/* Session list — scrollable (expanded) or empty flex spacer (collapsed) */}
        {isCollapsed ? (
          <div className="flex-1" />
        ) : (
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={handleSelect}
              onNewSession={handleNew}
            />
          </div>
        )}

        {/* Bottom area: token bar + auth slot */}
        <div className="border-t border-gray-800 flex-shrink-0">
          {isCollapsed ? (
            /* Collapsed: circular token progress + person icon */
            <div className="flex flex-col items-center py-3 gap-3">
              {(() => {
                const pct = dailyUsage.limit > 0 ? Math.min(dailyUsage.total / dailyUsage.limit, 1) : 0;
                const radius = 10;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference * (1 - pct);
                const colour = pct >= 1 ? "#ef4444" : pct >= 0.8 ? "#fbbf24" : "#10b981";
                const pctLabel = Math.round(pct * 100);
                return (
                  <div className="relative group flex items-center justify-center">
                    <svg width="28" height="28" viewBox="0 0 28 28">
                      {/* Track */}
                      <circle cx="14" cy="14" r={radius} fill="none" stroke="#374151" strokeWidth="3" />
                      {/* Fill — starts at top (−90°), goes clockwise */}
                      <circle
                        cx="14" cy="14" r={radius}
                        fill="none"
                        stroke={colour}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        transform="rotate(-90 14 14)"
                      />
                    </svg>
                    {/* Hover tooltip */}
                    <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <div className="whitespace-nowrap rounded-md bg-gray-800 border border-gray-700 px-2.5 py-1.5 text-xs text-gray-200 shadow-lg">
                        <span style={{ color: colour }} className="font-semibold">{pctLabel}%</span>
                        <span className="text-gray-400 ml-1">— {dailyUsage.total.toLocaleString()} / {dailyUsage.limit.toLocaleString()} tokens</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* Login/signup tooltip */}
              <div className="relative group flex items-center justify-center">
                <span className="material-icons text-[20px] text-gray-500 cursor-default">person</span>
                <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <div className="whitespace-nowrap rounded-md bg-gray-800 border border-gray-700 px-2.5 py-1.5 text-xs text-gray-200 shadow-lg">Login / Sign up</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <TokenProgressBar dailyUsage={dailyUsage} />
              {authSlot && (
                <div className="px-3 pb-3">
                  {authSlot}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
