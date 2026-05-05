"use client";

import { useEffect, useRef } from "react";
import type { Message, AssistantMessage } from "@/lib/types";
import MarkdownContent from "@/components/MarkdownContent";

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-gray-800 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant bubble
// ---------------------------------------------------------------------------

function AssistantBubble({ message }: { message: AssistantMessage }) {
  // Support old sessions where content was a plain string
  const text = typeof message.content === "string"
    ? message.content
    : (message.content.description ?? "");

  return (
    <div className="flex items-end gap-2">
      <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-gray-800 px-4 py-3 text-sm text-gray-200">
        <MarkdownContent>{text}</MarkdownContent>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageList
// ---------------------------------------------------------------------------

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export default function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or loading state change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Determine if we need to show the typing indicator:
  // show when loading AND the last message is not already an assistant message
  // (i.e., description hasn't arrived yet)
  const lastMsg = messages[messages.length - 1];
  const showTyping = isLoading && (!lastMsg || lastMsg.role !== "assistant");

  return (
    <div className="flex flex-col gap-4 overflow-y-auto flex-1 px-4 py-4">
      {messages.map((msg, idx) => {
        if (msg.role === "user") {
          return (
            <div key={idx} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-3 text-sm text-white">
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          );
        }
        return <AssistantBubble key={idx} message={msg} />;
      })}

      {showTyping && <TypingIndicator />}

      <div ref={bottomRef} />
    </div>
  );
}
