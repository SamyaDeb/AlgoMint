"use client";

import { MessageCircle, X } from "lucide-react";

interface ChatToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

export default function ChatToggleButton({
  isOpen,
  onClick,
}: ChatToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`chat-toggle-btn ${isOpen ? "chat-toggle-active" : ""}`}
      aria-label={isOpen ? "Close chat" : "Open chat"}
      title={isOpen ? "Close AI Assistant" : "AlgoMint AI Assistant"}
    >
      <div className={`chat-toggle-icon ${isOpen ? "chat-toggle-icon-rotate" : ""}`}>
        {isOpen ? <X size={20} /> : <MessageCircle size={20} />}
      </div>

      {/* Notification dot on first load */}
      {!isOpen && (
        <span className="chat-notification-dot" />
      )}
    </button>
  );
}
