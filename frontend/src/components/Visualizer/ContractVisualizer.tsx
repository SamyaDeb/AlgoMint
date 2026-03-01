"use client";

import { useState, useCallback } from "react";
import { Loader2, X, Database, Code2, Zap, ShieldCheck, Bell, GitBranch } from "lucide-react";
import type { ContractAnalysis, AnalyzedMethod, AnalyzedSubroutine } from "@/types";
import FlowDiagram from "./FlowDiagram";
import Legend from "./Legend";

interface ContractVisualizerProps {
  analysis: ContractAnalysis | null;
  isLoading: boolean;
  onJumpToLine?: (lineNumber: number) => void;
}

interface DetailTarget {
  type: "method" | "subroutine";
  name: string;
}

export default function ContractVisualizer({ analysis, isLoading, onJumpToLine }: ContractVisualizerProps) {
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const handleNodeClick = useCallback((nodeId: string, nodeType: string) => {
    if (nodeType === "method" || nodeType === "subroutine") {
      setDetailTarget({ type: nodeType as "method" | "subroutine", name: nodeId });
    }
  }, []);

  const handleNodeDoubleClick = useCallback(
    (_nodeId: string, lineNumber: number | null) => {
      if (lineNumber && onJumpToLine) {
        onJumpToLine(lineNumber);
      }
    },
    [onJumpToLine]
  );

  // Loading state
  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "var(--text-muted)" }}>
        <Loader2 size={28} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: 13 }}>Analyzing contract...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Empty state
  if (!analysis) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "var(--text-muted)" }}>
        <GitBranch size={32} style={{ opacity: 0.3 }} />
        <span style={{ fontSize: 13 }}>Convert a contract to see the visualization</span>
      </div>
    );
  }

  // Find detail data
  const detailMethod = detailTarget?.type === "method"
    ? analysis.methods.find((m) => m.name === detailTarget.name) ?? null
    : null;
  const detailSub = detailTarget?.type === "subroutine"
    ? analysis.subroutines.find((s) => s.name === detailTarget.name) ?? null
    : null;

  // Summary counts
  const totalInnerTxns = analysis.methods.reduce((sum, m) => sum + m.inner_txns.length, 0);
  const dangerCount = analysis.security_notes.filter((n) => n.type === "danger").length;
  const warnCount = analysis.security_notes.filter((n) => n.type === "warning").length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", background: "#0a0a1a" }}>
      {/* ── Header ── */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", flexShrink: 0, background: "linear-gradient(180deg, rgba(0,212,170,.04), transparent)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--accent)", marginBottom: 5 }}>
          {analysis.contract_name}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Badge icon={<Database size={10} />} count={analysis.state_variables.length} label="State" color="#22C55E" />
          <Badge icon={<Code2 size={10} />} count={analysis.methods.length} label="Methods" color="#00D4AA" />
          <Badge icon={<GitBranch size={10} />} count={analysis.subroutines.length} label="Subs" color="#8B5CF6" />
          {totalInnerTxns > 0 && (
            <Badge icon={<Zap size={10} />} count={totalInnerTxns} label="Txns" color="#C084FC" />
          )}
          {analysis.events.length > 0 && (
            <Badge icon={<Bell size={10} />} count={analysis.events.length} label="Events" color="#34D399" />
          )}
          {(dangerCount > 0 || warnCount > 0) && (
            <Badge icon={<ShieldCheck size={10} />} count={dangerCount + warnCount} label="Issues" color={dangerCount > 0 ? "#EF4444" : "#F59E0B"} />
          )}
        </div>
      </div>

      {/* ── Full-size Flow Diagram ── */}
      <div style={{ flex: 1, position: "relative" }}>
        <FlowDiagram
          analysis={analysis}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
        />
        <Legend />
      </div>

      {/* ── Detail panel ── */}
      {detailTarget && (detailMethod || detailSub) && (
        <DetailPanel
          method={detailMethod}
          subroutine={detailSub}
          onClose={() => setDetailTarget(null)}
          onJumpToLine={onJumpToLine}
        />
      )}
    </div>
  );
}

/* ── Badge sub-component ── */
function Badge({ icon, count, label, color }: { icon: React.ReactNode; count: number; label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 9999,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
      }}
    >
      {icon}
      <span style={{ fontWeight: 700 }}>{count}</span>
      <span style={{ opacity: 0.7 }}>{label}</span>
    </span>
  );
}

/* ── Detail panel sub-component ── */
function DetailPanel({
  method,
  subroutine,
  onClose,
  onJumpToLine,
}: {
  method: AnalyzedMethod | null;
  subroutine: AnalyzedSubroutine | null;
  onClose: () => void;
  onJumpToLine?: (line: number) => void;
}) {
  const item = method || subroutine;
  if (!item) return null;

  const line = item.line_number;

  return (
    <div className="viz-detail-panel">
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        <X size={16} />
      </button>

      {/* Title */}
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", marginBottom: 12 }}>
        {item.name}()
      </div>

      {/* Type badge */}
      <div style={{ marginBottom: 12 }}>
        {method && (
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              background: method.is_create
                ? "rgba(16,185,129,.15)"
                : method.is_readonly
                ? "rgba(59,130,246,.15)"
                : "rgba(0,212,170,.15)",
              color: method.is_create
                ? "var(--viz-create)"
                : method.is_readonly
                ? "var(--viz-readonly)"
                : "var(--viz-abimethod)",
            }}
          >
            {method.is_create ? "create" : method.is_readonly ? "readonly" : method.decorator}
          </span>
        )}
        {subroutine && (
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(139,92,246,.15)",
              color: "var(--viz-subroutine)",
            }}
          >
            subroutine
          </span>
        )}
      </div>

      {/* Parameters */}
      {item.params.length > 0 && (
        <Section title="Parameters">
          {item.params.map((p, i) => (
            <div key={i} style={{ fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 2 }}>
              <span style={{ color: "#e5e7eb" }}>{p.name}</span>
              <span style={{ color: "var(--text-muted)" }}>: {p.type}</span>
            </div>
          ))}
        </Section>
      )}

      {/* Return type */}
      <Section title="Returns">
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          {item.return_type || "None"}
        </span>
      </Section>

      {/* ABI signature */}
      {method?.abi_signature && (
        <Section title="ABI Selector">
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            {method.abi_signature}
          </span>
        </Section>
      )}

      {/* State reads */}
      {item.reads_state.length > 0 && (
        <Section title="Reads State">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.reads_state.map((s) => (
              <span key={s} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(96,165,250,.1)", color: "var(--viz-edge-read)", fontFamily: "var(--font-mono)" }}>
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* State writes */}
      {item.writes_state.length > 0 && (
        <Section title="Writes State">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.writes_state.map((s) => (
              <span key={s} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(249,115,22,.1)", color: "var(--viz-edge-write)", fontFamily: "var(--font-mono)" }}>
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Calls */}
      {item.calls_methods.length > 0 && (
        <Section title="Calls Methods">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.calls_methods.map((c) => (
              <span key={c} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(148,163,184,.1)", color: "var(--viz-edge-call)", fontFamily: "var(--font-mono)" }}>
                {c}()
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Inner transactions */}
      {item.inner_txns.length > 0 && (
        <Section title="Inner Transactions">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.inner_txns.map((t, i) => (
              <span key={i} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(168,85,247,.1)", color: "var(--viz-edge-itxn)" }}>
                {t}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Events */}
      {item.emits_events.length > 0 && (
        <Section title="Emits Events">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.emits_events.map((e) => (
              <span key={e} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(34,197,94,.1)", color: "var(--viz-safe)" }}>
                {e}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Guards */}
      <Section title="Assertions / Guards">
        <span style={{ fontSize: 12, color: item.guards_count > 0 ? "var(--viz-safe)" : "var(--viz-warn)" }}>
          {item.guards_count} {item.guards_count === 1 ? "guard" : "guards"}
        </span>
      </Section>

      {/* Jump to code */}
      {line && onJumpToLine && (
        <button
          onClick={() => onJumpToLine(line)}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(0,212,170,.1)",
            border: "1px solid rgba(0,212,170,.3)",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Jump to line {line} →
        </button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.05em" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
