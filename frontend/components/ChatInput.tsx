"use client";

import { useRef, useEffect, type KeyboardEvent, type ChangeEvent } from "react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  disabled = false,
  placeholder = "Describe your system…",
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: reset height first so shrinking works correctly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && !disabled && value.trim()) {
        onSubmit();
      }
    }
  }

  const isDisabled = isLoading || disabled;

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-gray-800 px-4 py-3 border border-gray-700 focus-within:border-indigo-500 transition-colors">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
        placeholder={placeholder}
        rows={1}
        className="flex-1 resize-none bg-transparent text-lg text-gray-200 placeholder-gray-500 outline-none disabled:opacity-50 leading-relaxed"
        style={{ maxHeight: "200px", overflowY: "auto" }}
        aria-label="Message input"
        aria-disabled={isDisabled}
      />
      <button
        onClick={onSubmit}
        disabled={isDisabled || !value.trim()}
        className="flex-shrink-0 flex items-center justify-center rounded-xl bg-indigo-600 p-2 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Send message"
      >
        {isLoading ? (
          <span className="material-icons text-[20px] animate-spin">autorenew</span>
        ) : (
          <span className="material-icons text-[20px]">send</span>
        )}
      </button>
    </div>
  );
}
