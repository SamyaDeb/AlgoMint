// Alert — Dismissable alert box
"use client";

import { useState } from "react";

type AlertType = "error" | "warning" | "success" | "info";

interface AlertProps {
  type: AlertType;
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

const TYPE_CONFIG: Record<AlertType, { icon: string; bg: string; color: string }> = {
  error: { icon: "✗", bg: "rgba(239,68,68,0.1)", color: "var(--error)" },
  warning: { icon: "⚠", bg: "rgba(245,158,11,0.1)", color: "var(--warning)" },
  success: { icon: "✓", bg: "rgba(16,185,129,0.1)", color: "var(--success)" },
  info: { icon: "ℹ", bg: "rgba(0,210,255,0.1)", color: "var(--accent)" },
};

export default function Alert({ type, message, dismissible = true, onDismiss }: AlertProps) {
  const [visible, setVisible] = useState(true);
  const config = TYPE_CONFIG[type];

  if (!visible) return null;

  return (
    <div
      className="flex items-start gap-2 p-3 rounded text-sm"
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      <span className="mt-0.5">{config.icon}</span>
      <span className="flex-1">{message}</span>
      {dismissible && (
        <button
          onClick={() => { setVisible(false); onDismiss?.(); }}
          className="text-xs opacity-60 hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}
