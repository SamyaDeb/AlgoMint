// Badge — Small pill-shaped status label
"use client";

type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

const VARIANT_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  success: { backgroundColor: "rgba(16,185,129,0.15)", color: "var(--success)" },
  warning: { backgroundColor: "rgba(245,158,11,0.15)", color: "var(--warning)" },
  error: { backgroundColor: "rgba(239,68,68,0.15)", color: "var(--error)" },
  info: { backgroundColor: "rgba(0,210,255,0.15)", color: "var(--accent)" },
  neutral: { backgroundColor: "var(--bg-surface)", color: "var(--text-muted)" },
};

export default function Badge({ children, variant = "neutral" }: BadgeProps) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={VARIANT_STYLES[variant]}
    >
      {children}
    </span>
  );
}
