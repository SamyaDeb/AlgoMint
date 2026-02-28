"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
}

export default function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`; // max 4 lines
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue("");
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = value.trim().length > 0 && !isLoading;

  return (
    <div
      className="chat-input-bar flex items-end gap-2 px-3 py-2.5"
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg-icon-bar)",
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about Algorand..."
        disabled={isLoading}
        rows={1}
        className="chat-textarea flex-1 text-[13px] resize-none outline-none"
        style={{
          background: "var(--bg-input)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "8px 12px",
          maxHeight: "96px",
          lineHeight: "1.4",
        }}
      />
      <button
        onClick={handleSend}
        disabled={!canSend}
        className="chat-send-btn flex items-center justify-center shrink-0"
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "8px",
          background: canSend ? "var(--accent)" : "var(--bg-surface)",
          color: canSend ? "#000" : "var(--text-muted)",
          border: "none",
          cursor: canSend ? "pointer" : "not-allowed",
          transition: "all 150ms ease",
        }}
        title="Send message"
      >
        <Send size={14} />
      </button>
    </div>
  );
}
