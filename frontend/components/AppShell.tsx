"use client";

import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import type { Session, RetryContext } from "@/lib/types";
import MessageList from "@/components/MessageList";
import ChatInput from "@/components/ChatInput";
import RetryBanner from "@/components/RetryBanner";
import WelcomeScreen from "@/components/WelcomeScreen";
import DescriptionPanel from "@/components/DescriptionPanel";
import GraphPanel from "@/components/GraphPanel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AppShellProps {
  activeSession: Session | null;
  isLoading: boolean;
  retryContext: RetryContext | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onNewSession: () => void;
  onSelectPrompt: (prompt: string) => void;
}

// ---------------------------------------------------------------------------
// AppShell — always shows two-column layout
// ---------------------------------------------------------------------------

export default function AppShell({
  activeSession,
  isLoading,
  retryContext,
  inputValue,
  onInputChange,
  onSubmit,
  onRetry,
  onNewSession,
  onSelectPrompt,
}: AppShellProps) {
  const hasMessages = (activeSession?.messages?.length ?? 0) > 0;
  const currentDescription = activeSession?.current_description ?? null;
  const currentGraph = activeSession?.current_graph ?? null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ---- Resizable columns ---- */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* ---- Left: welcome screen or message history ---- */}
        <Panel defaultSize="40" minSize="25">
          <div className="flex flex-col h-full overflow-hidden">
            {hasMessages ? (
              <MessageList messages={activeSession!.messages} isLoading={isLoading} />
            ) : (
              <WelcomeScreen onSelectPrompt={onSelectPrompt} />
            )}
          </div>
        </Panel>

        {/* ---- Drag handle ---- */}
        <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-indigo-500 active:bg-indigo-400 transition-colors cursor-col-resize" />

        {/* ---- Right: description + graph ---- */}
        <Panel defaultSize="60" minSize="30">
          <aside className="flex flex-col h-full border-l border-gray-800 overflow-hidden">
            {/* Description panel — fixed height, scrolls internally */}
            <div className="flex-shrink-0 p-4 border-b border-gray-800">
              <DescriptionPanel
                description={currentDescription}
                isLoading={isLoading && !currentDescription}
              />
            </div>

            {/* Graph panel — takes remaining height */}
            <div className="flex-1 p-4 min-h-0">
              <GraphPanel
                graph={currentGraph}
                isLoading={isLoading && !currentGraph}
              />
            </div>
          </aside>
        </Panel>
      </PanelGroup>

      {/* ---- Full-width input bar ---- */}
      <div className="flex-shrink-0 px-4 pb-4 pt-3 border-t border-gray-800 flex flex-col gap-3">
        {retryContext && (
          <RetryBanner
            retryContext={retryContext}
            onRetry={onRetry}
            onNewSession={onNewSession}
          />
        )}
        <ChatInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onSubmit}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
