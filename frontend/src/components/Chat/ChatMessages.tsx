"use client";

import { useRef, useEffect } from "react";
import type { ChatMessage } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading: boolean;
  suggestions: string[];
  onSuggestionClick: (suggestion: string) => void;
}

const STARTER_QUESTIONS = [
  "What is PyTeal?",
  "How does Algorand differ from Ethereum?",
  "Explain TEAL opcodes",
  "Help me debug my contract",
];

function timeAgo(index: number, total: number): string {
  if (index === total - 1) return "just now";
  const diff = total - 1 - index;
  if (diff === 1) return "1m ago";
  return `${diff}m ago`;
}

export default function ChatMessages({
  messages,
  isLoading,
  suggestions,
  onSuggestionClick,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // ── Welcome screen ──
  if (messages.length === 0 && !isLoading) {
    return (
      <div className="chat-messages-container flex flex-col items-center justify-center h-full px-4 py-6">
        <div
          className="text-3xl mb-3"
          style={{ color: "var(--accent)" }}
        >
          ⬡
        </div>
        <h3
          className="text-sm font-semibold mb-1"
          style={{ color: "var(--text-primary)" }}
        >
          AlgoMint AI Assistant
        </h3>
        <p
          className="text-xs text-center mb-5 max-w-65"
          style={{ color: "var(--text-secondary)" }}
        >
          I can help you with Algorand development, PyTeal, and smart contracts.
        </p>
        <div className="flex flex-wrap gap-2 justify-center max-w-[320px]">
          {STARTER_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => onSuggestionClick(q)}
              className="chat-suggestion-chip"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Message list ──
  return (
    <div className="chat-messages-container flex-1 overflow-y-auto px-3 py-3 space-y-3">
      {messages.map((msg, i) => {
        const isUser = msg.role === "user";
        return (
          <div
            key={i}
            className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
          >
            {/* Avatar */}
            <div
              className="chat-avatar shrink-0"
              style={{
                color: isUser ? "var(--text-secondary)" : "var(--accent)",
              }}
            >
              {isUser ? "👤" : "⬡"}
            </div>

            {/* Bubble */}
            <div
              className={`chat-bubble ${isUser ? "chat-message-user" : "chat-message-ai"}`}
            >
              {isUser ? (
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
              ) : (
                <div className="chat-markdown text-[13px] leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
              <div
                className="text-[10px] mt-1.5 opacity-50 select-none"
                style={{ textAlign: isUser ? "right" : "left" }}
              >
                {timeAgo(i, messages.length)}
              </div>
            </div>
          </div>
        );
      })}

      {/* Typing indicator */}
      {isLoading && (
        <div className="flex gap-2 items-end">
          <div
            className="chat-avatar shrink-0"
            style={{ color: "var(--accent)" }}
          >
            ⬡
          </div>
          <div className="chat-bubble chat-message-ai">
            <div className="chat-typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}

      {/* Suggestion chips after last AI message */}
      {!isLoading && suggestions.length > 0 && messages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-8 pt-1">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSuggestionClick(s)}
              className="chat-suggestion-chip"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
