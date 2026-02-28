/**
 * WarningsPanel.tsx
 *
 * Displays AST analysis warnings as colored badges between the editors.
 * RED = critical, YELLOW = attention, BLUE = informational.
 */

"use client";

import { useState } from "react";
import type { ASTWarning } from "@/utils/astEnricher";

const TOOLTIP_CONTENT: Record<ASTWarning["type"], string> = {
  PAYABLE:
    "Algorand requires a separate payment transaction in an atomic group. The converted code includes a comment showing where to handle this.",
  INHERITANCE:
    "Algorand Python supports inheritance but parent contract methods need to be available. Verify all inherited methods are included.",
  MODIFIERS:
    "Solidity modifiers have been converted to @subroutine helper functions. Check the logic is preserved.",
  NESTED_MAPPING:
    "Algorand BoxMap does not support nested mappings directly. You may need to use a composite key or separate BoxMaps.",
  SIGNED_INT:
    "Algorand has no native signed integers. UInt64 is used. If your contract uses negative numbers, manual redesign is needed.",
  EVENTS:
    "Converted to ARC-28 arc4.emit() calls. Ensure your frontend listens to ARC-28 logs.",
  SELFDESTRUCT:
    "No direct equivalent in Algorand. The TODO comment in the output shows where to add close-out logic manually.",
  FALLBACK:
    "Converted to a baremethod. Verify the logic handles your intended fallback behavior.",
};

const SEVERITY_COLORS: Record<ASTWarning["severity"], { bg: string; text: string; border: string }> = {
  red: {
    bg: "rgba(239, 68, 68, 0.15)",
    text: "#f87171",
    border: "rgba(239, 68, 68, 0.4)",
  },
  yellow: {
    bg: "rgba(245, 158, 11, 0.15)",
    text: "#fbbf24",
    border: "rgba(245, 158, 11, 0.4)",
  },
  blue: {
    bg: "rgba(59, 130, 246, 0.15)",
    text: "#60a5fa",
    border: "rgba(59, 130, 246, 0.4)",
  },
};

interface WarningsPanelProps {
  warnings: ASTWarning[];
}

export default function WarningsPanel({ warnings }: WarningsPanelProps) {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  if (!warnings || warnings.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 py-2 shrink-0"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wider mr-1"
        style={{ color: "var(--text-muted)" }}
      >
        AST Warnings
      </span>
      {warnings.map((w) => {
        const colors = SEVERITY_COLORS[w.severity];
        const isActive = activeTooltip === w.type;

        return (
          <div key={w.type} className="relative">
            <button
              onClick={() =>
                setActiveTooltip(isActive ? null : w.type)
              }
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all duration-150 cursor-pointer"
              style={{
                backgroundColor: colors.bg,
                color: colors.text,
                border: `1px solid ${colors.border}`,
              }}
              title={TOOLTIP_CONTENT[w.type]}
            >
              <span>
                {w.severity === "red"
                  ? "●"
                  : w.severity === "yellow"
                  ? "▲"
                  : "ℹ"}
              </span>
              {w.type}
            </button>

            {/* Tooltip popover */}
            {isActive && (
              <div
                className="absolute z-50 mt-1 p-3 rounded-lg shadow-lg text-xs leading-relaxed"
                style={{
                  width: "280px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "var(--bg-icon-bar)",
                  border: `1px solid ${colors.border}`,
                  color: "var(--text-primary)",
                }}
              >
                <div
                  className="font-semibold mb-1"
                  style={{ color: colors.text }}
                >
                  {w.type}
                </div>
                <p style={{ color: "var(--text-secondary)" }}>
                  {TOOLTIP_CONTENT[w.type]}
                </p>
                <button
                  onClick={() => setActiveTooltip(null)}
                  className="mt-2 text-[10px] underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
