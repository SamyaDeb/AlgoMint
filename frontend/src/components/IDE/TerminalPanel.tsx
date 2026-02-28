"use client";

import { useRef, useEffect, useState } from "react";
import type { ConsoleLog } from "@/types";

// ── Terminal Panel — Bottom console (Remix-style) ── //

interface TerminalPanelProps {
  logs: ConsoleLog[];
  onClear: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const TYPE_CONFIG: Record<
  ConsoleLog["type"],
  { icon: string; color: string }
> = {
  info: { icon: "ℹ", color: "var(--accent)" },
  success: { icon: "✓", color: "var(--success)" },
  error: { icon: "✗", color: "var(--error)" },
  warning: { icon: "⚠", color: "var(--warning)" },
};

const FILTERS = ["all", "info", "success", "error", "warning"] as const;
type Filter = (typeof FILTERS)[number];

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Single log entry (with expandable details) ──
function LogEntry({ log }: { log: ConsoleLog }) {
  const [expanded, setExpanded] = useState(false);
  const config = TYPE_CONFIG[log.type];
  const hasDetails = !!log.details;

  return (
    <div className="py-0.5">
      <div
        className={`flex items-start gap-2 leading-5${hasDetails ? " cursor-pointer" : ""
          }`}
        onClick={hasDetails ? () => setExpanded((p) => !p) : undefined}
      >
        <span
          className="shrink-0 font-mono"
          style={{ color: "var(--text-muted)", minWidth: "60px", fontSize: "11px" }}
        >
          {formatTime(log.timestamp)}
        </span>
        <span className="shrink-0" style={{ color: config.color, minWidth: "14px" }}>
          {config.icon}
        </span>
        <span style={{ color: "var(--text-primary)" }}>
          {log.message}
          {hasDetails && (
            <span
              className="ml-1 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              {expanded ? "▼" : "▶ details"}
            </span>
          )}
        </span>
      </div>
      {expanded && log.details && (
        <pre
          className="ml-[82px] mt-0.5 mb-1 p-2 rounded text-[13px] whitespace-pre-wrap break-all"
          style={{
            backgroundColor: "rgba(0,0,0,0.25)",
            color: "var(--text-muted)",
            borderLeft: `2px solid ${config.color}`,
          }}
        >
          {log.details}
        </pre>
      )}
    </div>
  );
}

export default function TerminalPanel({
  logs,
  onClear,
  isCollapsed,
  onToggleCollapse,
}: TerminalPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>("all");

  // Resizing state
  const [height, setHeight] = useState(220); // Default terminal height
  const [isDragging, setIsDragging] = useState(false);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isCollapsed]);

  // Handle drag resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      // Calculate new height based on mouse position
      // window.innerHeight - e.clientY gives us the height from the bottom of the screen
      // We clamp it between 100px and 80vh to prevent it from being too small or too large
      const newHeight = window.innerHeight - e.clientY;
      const minHeight = 100;
      const maxHeight = window.innerHeight * 0.8;

      if (newHeight >= minHeight && newHeight <= maxHeight) {
        setHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      // Add a class to body to prevent text selection while dragging
      document.body.style.userSelect = "none";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent text selection
    // If it's collapsed, dragging the handle should expand it first
    if (isCollapsed) {
      onToggleCollapse();
    }
    setIsDragging(true);
  };

  const filteredLogs =
    filter === "all" ? logs : logs.filter((l) => l.type === filter);

  // Count by type for badges
  const errorCount = logs.filter((l) => l.type === "error").length;
  const warnCount = logs.filter((l) => l.type === "warning").length;

  return (
    <div
      className={`flex flex-col ide-border-top ${isDragging ? '' : 'terminal-animated'} relative`}
      style={{
        backgroundColor: "var(--bg-terminal)",
        height: isCollapsed ? "32px" : `${height}px`,
        overflow: "hidden",
      }}
    >
      {/* ── Drag Handle (Top Edge) ── */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 left-0 w-full z-10 hover:bg-[rgba(0,212,170,0.1)] transition-colors"
        style={{
          height: "4px",
          marginTop: "-2px",
          cursor: "ns-resize",
        }}
      />

      {/* Terminal header */}
      <div
        className="flex items-center justify-between px-3 shrink-0 cursor-pointer select-none"
        style={{
          height: "32px",
          borderBottom: isCollapsed ? "none" : "1px solid var(--border)",
        }}
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-sm font-semibold tracking-wide"
            style={{ color: "var(--text-secondary)" }}
          >
            TERMINAL
          </span>

          {/* Log count badge */}
          {logs.length > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-muted)",
              }}
            >
              {logs.length}
            </span>
          )}

          {/* Error/Warning badges */}
          {errorCount > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: "rgba(239,68,68,0.15)",
                color: "var(--error)",
              }}
            >
              {errorCount} error{errorCount > 1 ? "s" : ""}
            </span>
          )}
          {warnCount > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: "rgba(245,158,11,0.15)",
                color: "var(--warning)",
              }}
            >
              {warnCount} warn{warnCount > 1 ? "s" : ""}
            </span>
          )}

          {/* If collapsed, show most recent log preview */}
          {isCollapsed && logs.length > 0 && (
            <span
              className="text-[13px] truncate max-w-75"
              style={{ color: "var(--text-muted)" }}
            >
              {logs[logs.length - 1].message}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Filter buttons */}
          {!isCollapsed &&
            FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="text-xs px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                style={{
                  backgroundColor:
                    filter === f ? "var(--bg-surface)" : "transparent",
                  color:
                    filter === f
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                }}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}

          {/* Clear button */}
          <button
            onClick={onClear}
            className="text-xs px-1.5 py-0.5 rounded transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            title="Clear terminal"
          >
            🗑
          </button>

          {/* Collapse toggle */}
          <button
            onClick={onToggleCollapse}
            className="text-sm cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Log entries */}
      {!isCollapsed && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-1 font-mono text-sm">
          {filteredLogs.length === 0 ? (
            <div className="py-2" style={{ color: "var(--text-muted)" }}>
              {filter === "all"
                ? "AlgoMint IDE ready. Paste a Solidity contract to begin."
                : `No ${filter} logs.`}
            </div>
          ) : (
            filteredLogs.map((log) => <LogEntry key={log.id} log={log} />)
          )}
        </div>
      )}
    </div>
  );
}
