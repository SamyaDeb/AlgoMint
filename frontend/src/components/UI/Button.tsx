// Button — Reusable button with variant, size, loading, and disabled props
"use client";

import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: { backgroundColor: "var(--accent)", color: "#fff" },
  secondary: { backgroundColor: "var(--bg-surface)", color: "var(--text-primary)" },
  ghost: { backgroundColor: "transparent", color: "var(--text-secondary)" },
  danger: { backgroundColor: "var(--error)", color: "#fff" },
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
  lg: "px-4 py-2 text-base",
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  children,
  style,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`rounded font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${SIZE_CLASSES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      style={{ ...VARIANT_STYLES[variant], ...style }}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
