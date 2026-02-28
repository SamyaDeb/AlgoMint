"use client";

import { X, Trash2 } from "lucide-react";
import ChatMessages from "./ChatMessages";
import ChatInput from "./ChatInput";
import { useChat } from "@/hooks/useChat";
import type { ChatContext } from "@/types";

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  context?: ChatContext;
}

export default function ChatPanel({ isOpen, onClose, context }: ChatPanelProps) {
  const {
    messages,
    isLoading,
    suggestions,
    sendMessage,
    clearChat,
    askSuggestion,
  } = useChat();

  const handleSend = (text: string) => {
    sendMessage(text, context);
  };

  const handleSuggestion = (suggestion: string) => {
    askSuggestion(suggestion, context);
  };

  return (
    <div
      className={`chat-panel ${isOpen ? "chat-panel-open" : "chat-panel-closed"}`}
      style={{ borderLeft: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: "var(--tab-bar-h)",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-tab-bar)",
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--accent)", fontSize: "20px" }}>⬡</span>
          <span
            className="text-base font-semibold tracking-wide"
            style={{ color: "var(--text-primary)" }}
          >
            AlgoMint AI
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: "var(--accent-muted)",
              color: "var(--accent)",
              fontWeight: 600,
            }}
          >
            BETA
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="chat-header-btn"
            title="Clear chat"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={onClose}
            className="chat-header-btn"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <ChatMessages
        messages={messages}
        isLoading={isLoading}
        suggestions={suggestions}
        onSuggestionClick={handleSuggestion}
      />

      {/* Input */}
      <ChatInput onSend={handleSend} isLoading={isLoading} />
    </div>
  );
}
