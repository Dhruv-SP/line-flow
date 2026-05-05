"use client";

import { useState } from "react";
import MarkdownContent from "@/components/MarkdownContent";

interface DescriptionPanelProps {
  description: string | null;
  isLoading: boolean;
}

function DescriptionSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      <div className="h-3 w-3/4 rounded bg-gray-700" />
      <div className="h-3 w-full rounded bg-gray-700" />
      <div className="h-3 w-5/6 rounded bg-gray-700" />
      <div className="h-3 w-2/3 rounded bg-gray-700" />
    </div>
  );
}

export default function DescriptionPanel({ description, isLoading }: DescriptionPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!description) return;
    navigator.clipboard.writeText(description).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          className="flex items-center gap-1 group"
          aria-expanded={!isCollapsed}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 group-hover:text-gray-200 transition-colors">
            System Description
          </h2>
          <span className={`material-icons text-[16px] text-gray-500 group-hover:text-gray-200 transition-all ${isCollapsed ? "-rotate-90" : ""}`}>
            expand_more
          </span>
        </button>
        {description && !isCollapsed && (
          <div className="relative group">
            <button
              onClick={handleCopy}
              className="flex items-center justify-center w-6 h-6 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
              aria-label="Copy to clipboard"
            >
              <span className="material-icons text-[15px]">{copied ? "check" : "content_copy"}</span>
            </button>
            <div className="pointer-events-none absolute bottom-full mb-1.5 right-0 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <div className="whitespace-nowrap rounded-md bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 shadow-lg">
                {copied ? "Copied!" : "Copy to clipboard"}
              </div>
            </div>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="rounded-xl bg-gray-900 p-4 text-sm leading-relaxed text-gray-200 overflow-y-auto max-h-72">
          {isLoading && !description ? (
            <DescriptionSkeleton />
          ) : description ? (
            <MarkdownContent>{description}</MarkdownContent>
          ) : (
            <p className="text-gray-500 italic">
              Description will appear here after your first message.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
