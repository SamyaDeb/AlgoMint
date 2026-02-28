/**
 * ASTViewer.tsx
 *
 * Collapsible panel that shows the enriched AST JSON in a readable format.
 * Collapsed by default, toggled with "Show AST Analysis" button.
 * Highlights nodes with warnings in orange. Shows a summary line above.
 */

"use client";

import { useState } from "react";
import type { EnrichedContract } from "@/utils/astEnricher";

interface ASTViewerProps {
  enrichedAST: EnrichedContract | null;
}

export default function ASTViewer({ enrichedAST }: ASTViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!enrichedAST) return null;

  const funcCount = enrichedAST.functions.length;
  const stateVarCount = enrichedAST.stateVariables.length;
  const eventCount = enrichedAST.events.length;
  const warningCount = enrichedAST.warnings.length;

  return (
    <div
      className="shrink-0"
      style={{
        borderTop: "1px solid var(--border)",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      {/* Toggle bar */}
      <button
        onClick={() => setIsExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors duration-150 hover:brightness-110"
        style={{ backgroundColor: "var(--bg-surface)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-mono"
            style={{ color: "var(--text-muted)" }}
          >
            {isExpanded ? "▼" : "▶"}
          </span>
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {isExpanded ? "Hide" : "Show"} AST Analysis
          </span>
        </div>
        <span
          className="text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          {funcCount} functions | {stateVarCount} state vars | {eventCount} events | {warningCount} warnings
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div
          className="overflow-auto px-3 pb-3"
          style={{ maxHeight: "300px" }}
        >
          {/* Contract header */}
          <div className="mt-2 mb-3">
            <span
              className="text-xs font-bold"
              style={{ color: "var(--accent)" }}
            >
              {enrichedAST.contractName}
            </span>
            {enrichedAST.inheritance.length > 0 && (
              <span
                className="text-xs ml-2"
                style={{ color: "var(--text-muted)" }}
              >
                extends {enrichedAST.inheritance.join(", ")}
              </span>
            )}
          </div>

          {/* State Variables */}
          {enrichedAST.stateVariables.length > 0 && (
            <Section title="State Variables">
              {enrichedAST.stateVariables.map((sv) => {
                const hasWarning =
                  sv.algorand_storage.includes("manual review") ||
                  sv.algorand_type.includes("WARNING");
                return (
                  <div
                    key={sv.name}
                    className="flex items-start gap-2 py-1 px-2 rounded text-[11px]"
                    style={{
                      backgroundColor: hasWarning
                        ? "rgba(245, 158, 11, 0.08)"
                        : "transparent",
                      borderLeft: hasWarning
                        ? "2px solid var(--warning)"
                        : "2px solid transparent",
                    }}
                  >
                    <span
                      className="font-mono font-medium shrink-0"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {sv.name}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {sv.type}
                    </span>
                    <span style={{ color: "var(--accent)" }}>→</span>
                    <span
                      className="font-mono"
                      style={{
                        color: hasWarning
                          ? "var(--warning)"
                          : "var(--success)",
                      }}
                    >
                      {sv.algorand_storage}
                    </span>
                  </div>
                );
              })}
            </Section>
          )}

          {/* Functions */}
          {enrichedAST.functions.length > 0 && (
            <Section title="Functions">
              {enrichedAST.functions.map((fn) => (
                <div
                  key={`${fn.name}-${fn.parameters.map(p => p.type).join(",")}`}
                  className="py-1 px-2 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono font-medium"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {fn.name}
                      <span style={{ color: "var(--text-muted)" }}>
                        ({fn.parameters.map((p) => p.type).join(", ")})
                      </span>
                    </span>
                    <span
                      className="px-1.5 py-0 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: "var(--accent-muted)",
                        color: "var(--accent)",
                      }}
                    >
                      {fn.visibility}
                    </span>
                    {fn.mutability !== "nonpayable" && (
                      <span
                        className="px-1.5 py-0 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor:
                            fn.mutability === "payable"
                              ? "rgba(245, 158, 11, 0.15)"
                              : "rgba(16, 185, 129, 0.15)",
                          color:
                            fn.mutability === "payable"
                              ? "var(--warning)"
                              : "var(--success)",
                        }}
                      >
                        {fn.mutability}
                      </span>
                    )}
                  </div>
                  <div
                    className="ml-2 mt-0.5 font-mono"
                    style={{ color: "var(--text-muted)" }}
                  >
                    → {fn.algorand_decorator}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Events */}
          {enrichedAST.events.length > 0 && (
            <Section title="Events">
              {enrichedAST.events.map((ev) => (
                <div
                  key={ev.name}
                  className="py-1 px-2 text-[11px]"
                >
                  <span
                    className="font-mono font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {ev.name}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    ({ev.parameters.map((p) => `${p.name}: ${p.type}`).join(", ")})
                  </span>
                  <span
                    className="ml-2"
                    style={{ color: "var(--info)" }}
                  >
                    → arc4.emit()
                  </span>
                </div>
              ))}
            </Section>
          )}

          {/* Modifiers */}
          {enrichedAST.modifiers.length > 0 && (
            <Section title="Modifiers">
              {enrichedAST.modifiers.map((mod) => (
                <div
                  key={mod.name}
                  className="py-1 px-2 text-[11px]"
                >
                  <span
                    className="font-mono font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {mod.name}
                  </span>
                  <span
                    className="ml-2"
                    style={{ color: "var(--warning)" }}
                  >
                    → @subroutine
                  </span>
                </div>
              ))}
            </Section>
          )}

          {/* Custom Errors */}
          {enrichedAST.customErrors.length > 0 && (
            <Section title="Custom Errors">
              {enrichedAST.customErrors.map((err) => (
                <div
                  key={err.name}
                  className="py-1 px-2 text-[11px] font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  {err.name}({err.parameters.join(", ")})
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
