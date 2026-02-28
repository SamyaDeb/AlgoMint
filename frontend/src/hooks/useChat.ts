"use client";

import { useState, useCallback } from "react";
import { sendChatMessage } from "@/lib/api";
import type { ChatMessage, ChatContext } from "@/types";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const sendMessage = useCallback(
    async (text: string, context?: ChatContext) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      // Add user message
      const userMsg: ChatMessage = { role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      try {
        // Send only last 18 messages as history (to stay under token limits)
        const history = [...messages, userMsg].slice(-18);
        const response = await sendChatMessage({
          message: trimmed,
          history: history.slice(0, -1), // exclude the current message from history
          context,
        });

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: response.reply,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setSuggestions(response.suggestions || []);
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Failed to get a response.";
        setError(errMsg);
        // Add error as a system-style assistant message
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${errMsg}`,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setSuggestions([]);
    setError(null);
  }, []);

  const askSuggestion = useCallback(
    (suggestion: string, context?: ChatContext) => {
      sendMessage(suggestion, context);
    },
    [sendMessage],
  );

  return {
    messages,
    isLoading,
    error,
    suggestions,
    sendMessage,
    clearChat,
    askSuggestion,
  };
}
