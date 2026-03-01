"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";

import {
  Loader2,
  Layers,
  GitBranch,
  Database,
  Code2,
  Zap,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Download,
  Image as ImageIcon,
  Info,
} from "lucide-react";
import type {
  MultiContractAnalysis,
  ContractAnalysis,
  DeployedContract,
  InterContractEdge,
  AnalyzedMethod,
  AnalyzedSubroutine,
} from "@/types";
import ContractVisualizer from "./ContractVisualizer";
import MethodNode from "./nodes/MethodNode";
import StateVariableNode from "./nodes/StateVariableNode";
import SubroutineNode from "./nodes/SubroutineNode";
import OffsetSmoothStepEdge from "./edges/OffsetSmoothStepEdge";
import type { DynHandle } from "./FlowDiagram";

/* ── Custom node types ── */
const nodeTypes = {
  method: MethodNode,
  stateVariable: StateVariableNode,
  subroutine: SubroutineNode,
  contractGroup: ContractGroupNode,
};

const edgeTypes = {
  offsetSmoothStep: OffsetSmoothStepEdge,
};

/* ── Color palette per contract index ── */
const CONTRACT_COLORS = [
  "#00D4AA", // teal
  "#3B82F6", // blue
  "#F59E0B", // amber
  "#8B5CF6", // purple
  "#EF4444", // red
  "#22C55E", // green
  "#EC4899", // pink
  "#06B6D4", // cyan
];

/* ── Edge colors ── */
const EDGE_COLORS = {
  call: "#FF6B6B",
  read: "#4ECDC4",
  write: "#FFE66D",
  itxn: "#C084FC",
  interContract: "#F97316", // orange for cross-contract
};

interface MultiContractVisualizerProps {
  multiAnalysis: MultiContractAnalysis | null;
  singleAnalysis: ContractAnalysis | null;
  isLoading: boolean;
  deployedContracts: DeployedContract[];
  onJumpToLine?: (lineNumber: number) => void;
}

interface MultiDetailTarget {
  contractName: string;
  type: "method" | "subroutine";
  name: string;
}

export default function MultiContractVisualizer({
  multiAnalysis,
  singleAnalysis,
  isLoading,
  deployedContracts,
  onJumpToLine,
}: MultiContractVisualizerProps) {
  const [focusedContract, setFocusedContract] = useState<string | null>(null);
  const [exportCopied, setExportCopied] = useState(false);
  const [detailTarget, setDetailTarget] = useState<MultiDetailTarget | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const vizContainerRef = useRef<HTMLDivElement>(null);

  const handleExportPng = useCallback(async () => {
    const el = vizContainerRef.current;
    if (!el) return;
    try {
      const dataUrl = await toPng(el, { backgroundColor: "#0a0a1a", pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = "algomint-multi-contract.png";
      link.href = dataUrl;
      link.click();
    } catch {
      // silently fail export
    }
  }, []);

  // Decide what to show
  const hasMulti = multiAnalysis && multiAnalysis.contracts.length > 1;
  const analysis = hasMulti ? multiAnalysis : null;
  const single = focusedContract
    ? analysis?.contracts.find((c) => c.contract_name === focusedContract) ?? singleAnalysis
    : singleAnalysis;

  // Loading
  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "var(--text-muted)" }}>
        <Loader2 size={28} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: 13 }}>Analyzing contracts...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Empty state
  if (!analysis && !single) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "var(--text-muted)" }}>
        <GitBranch size={32} style={{ opacity: 0.3 }} />
        <span style={{ fontSize: 13 }}>Convert a contract to see the visualization</span>
      </div>
    );
  }

  // Single contract fallback → use existing visualizer
  if (!analysis && single) {
    return (
      <ContractVisualizer
        analysis={single}
        isLoading={false}
        onJumpToLine={onJumpToLine}
      />
    );
  }

  // Focused on single contract within multi
  if (focusedContract && single) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: "#0a0a1a" }}>
        {/* Back to all contracts bar */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => setFocusedContract(null)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 6,
              background: "rgba(0,212,170,.1)", border: "1px solid rgba(0,212,170,.2)",
              color: "var(--accent)", cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}
          >
            ← All Contracts
          </button>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Viewing:</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{focusedContract}</span>
          {/* Deployment badge */}
          {(() => {
            const dc = deployedContracts.find((d) => d.contractName === focusedContract);
            return dc ? (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 9999, background: "rgba(34,197,94,.15)", color: "#22C55E", fontWeight: 700 }}>
                LIVE — App #{dc.appId}
              </span>
            ) : null;
          })()}
        </div>
        <div style={{ flex: 1 }}>
          <ContractVisualizer
            analysis={single}
            isLoading={false}
            onJumpToLine={onJumpToLine}
          />
        </div>
      </div>
    );
  }

  // Multi-contract view
  return (
    <div ref={vizContainerRef} style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: "#0a0a1a" }}>
      {/* ── Header ── */}
      <MultiContractHeader
        analysis={analysis!}
        deployedContracts={deployedContracts}
        focusedContract={focusedContract}
        onFocusContract={setFocusedContract}
        onExportPng={handleExportPng}
        showLegend={showLegend}
        onToggleLegend={() => setShowLegend(p => !p)}
      />

      {/* ── Multi-contract flow diagram ── */}
      <div style={{ flex: 1, position: "relative" }}>
        <MultiContractFlowDiagram
          analysis={analysis!}
          deployedContracts={deployedContracts}
          onContractClick={setFocusedContract}
          onNodeClick={(contractName, type, name) =>
            setDetailTarget({ contractName, type, name })
          }
          showLegend={showLegend}
        />
      </div>

      {/* ── Detail panel for clicked node ── */}
      {detailTarget && analysis && (() => {
        const contract = analysis.contracts.find(
          (c) => c.contract_name === detailTarget.contractName
        );
        if (!contract) return null;
        const method = detailTarget.type === "method"
          ? contract.methods.find((m) => m.name === detailTarget.name) ?? null
          : null;
        const subroutine = detailTarget.type === "subroutine"
          ? contract.subroutines.find((s) => s.name === detailTarget.name) ?? null
          : null;
        if (!method && !subroutine) return null;
        return (
          <MultiDetailPanel
            contractName={detailTarget.contractName}
            method={method}
            subroutine={subroutine}
            onClose={() => setDetailTarget(null)}
            onJumpToLine={onJumpToLine}
          />
        );
      })()}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * Header with contract tabs and deployment order
 * ═══════════════════════════════════════════════════════════════ */
function MultiContractHeader({
  analysis,
  deployedContracts,
  focusedContract,
  onFocusContract,
  onExportPng,
  showLegend,
  onToggleLegend,
}: {
  analysis: MultiContractAnalysis;
  deployedContracts: DeployedContract[];
  focusedContract: string | null;
  onFocusContract: (name: string | null) => void;
  onExportPng: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
}) {
  return (
    <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", flexShrink: 0, background: "linear-gradient(180deg, rgba(0,212,170,.04), transparent)" }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Layers size={16} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--accent)" }}>
          Multi-Contract View
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 8px", borderRadius: 9999, background: "rgba(255,255,255,.05)" }}>
          {analysis.contracts.length} contracts
        </span>
        {/* Export button */}
        <button
          onClick={onExportPng}
          title="Export as PNG"
          style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
            background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)",
            color: "var(--text-muted)", cursor: "pointer", fontSize: 11, fontWeight: 500,
          }}
        >
          <Download size={12} /> PNG
        </button>
        <button
          onClick={onToggleLegend}
          title="Toggle legend info"
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
            background: showLegend ? "rgba(0,212,170,.15)" : "rgba(255,255,255,.05)",
            border: showLegend ? "1px solid rgba(0,212,170,.3)" : "1px solid rgba(255,255,255,.1)",
            color: showLegend ? "var(--accent)" : "var(--text-muted)", cursor: "pointer", fontSize: 11, fontWeight: 500,
          }}
        >
          <Info size={12} /> Info
        </button>
      </div>

      {/* Deployment order + contract tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {/* "All" tab */}
        <button
          onClick={() => onFocusContract(null)}
          style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: !focusedContract ? "rgba(0,212,170,.2)" : "rgba(255,255,255,.05)",
            color: !focusedContract ? "var(--accent)" : "var(--text-muted)",
            border: !focusedContract ? "1px solid rgba(0,212,170,.3)" : "1px solid transparent",
          }}
        >
          All Contracts
        </button>

        {analysis.deployment_order.map((name, idx) => {
          const contract = analysis.contracts.find((c) => c.contract_name === name);
          const dc = deployedContracts.find((d) => d.contractName === name);
          const color = CONTRACT_COLORS[idx % CONTRACT_COLORS.length];
          const isActive = focusedContract === name;

          return (
            <button
              key={name}
              onClick={() => onFocusContract(name)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 6,
                fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: isActive ? `color-mix(in srgb, ${color} 20%, transparent)` : "rgba(255,255,255,.05)",
                color: isActive ? color : "var(--text-secondary)",
                border: isActive ? `1px solid color-mix(in srgb, ${color} 40%, transparent)` : "1px solid transparent",
              }}
            >
              {/* Deploy order badge */}
              <span style={{
                width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 800, background: `color-mix(in srgb, ${color} 25%, transparent)`, color,
              }}>
                {idx + 1}
              </span>
              {name}
              {/* Deployed indicator */}
              {dc && (
                <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 4, background: "rgba(34,197,94,.15)", color: "#22C55E", fontWeight: 700 }}>
                  LIVE
                </span>
              )}
              {/* Method count */}
              <span style={{ fontSize: 9, opacity: 0.5 }}>
                {contract?.methods.length ?? 0}m
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * Contract Group Node — rendered as a labeled container
 * ═══════════════════════════════════════════════════════════════ */
function ContractGroupNode({ data }: { data: Record<string, unknown> }) {
  const name = data.label as string;
  const color = data.color as string;
  const deployOrder = data.deployOrder as number;
  const deployed = data.deployed as DeployedContract | null;
  const methodCount = data.methodCount as number;
  const stateCount = data.stateCount as number;
  const width = data.groupWidth as number;
  const height = data.groupHeight as number;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 12,
        border: `2px solid ${deployed ? "#22C55E" : `color-mix(in srgb, ${color} 40%, transparent)`}`,
        background: deployed
          ? "rgba(34,197,94,.03)"
          : `color-mix(in srgb, ${color} 4%, transparent)`,
        position: "relative",
        pointerEvents: "none",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 36,
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
          background: deployed
            ? "linear-gradient(90deg, rgba(34,197,94,.12), rgba(34,197,94,.04))"
            : `linear-gradient(90deg, color-mix(in srgb, ${color} 12%, transparent), transparent)`,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        {/* Deploy order badge */}
        <span style={{
          width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 800, background: `color-mix(in srgb, ${color} 25%, transparent)`, color, flexShrink: 0,
        }}>
          {deployOrder}
        </span>

        <span style={{ fontSize: 13, fontWeight: 700, color: deployed ? "#22C55E" : color }}>
          {name}
        </span>

        {/* Stats badges */}
        <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: "auto" }}>
          {methodCount}m · {stateCount}s
        </span>

        {/* Deployed info */}
        {deployed && (
          <span style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 4,
            background: "rgba(34,197,94,.15)", color: "#22C55E", fontWeight: 700,
          }}>
            App #{deployed.appId}
          </span>
        )}
        {!deployed && (
          <span style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 4,
            background: "rgba(255,255,255,.05)", color: "var(--text-muted)", fontWeight: 600,
            border: "1px dashed rgba(255,255,255,.1)",
          }}>
            Not Deployed
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * Multi-Contract Flow Diagram
 * ═══════════════════════════════════════════════════════════════ */
function MultiContractFlowDiagram({
  analysis,
  deployedContracts,
  onContractClick,
  onNodeClick,
  showLegend,
}: {
  analysis: MultiContractAnalysis;
  deployedContracts: DeployedContract[];
  onContractClick: (name: string) => void;
  onNodeClick?: (contractName: string, type: "method" | "subroutine", name: string) => void;
  showLegend: boolean;
}) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildMultiContractGraph(analysis, deployedContracts),
    [analysis, deployedContracts]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_, node) => {
      // If clicking a contract group header, focus that contract
      if (node.type === "contractGroup") {
        onContractClick(node.data.label as string);
      }
    },
    [onContractClick]
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if ((node.type === "method" || node.type === "subroutine") && onNodeClick) {
        // Node IDs are prefixed: contractName__methodName
        const id = node.id;
        const sepIdx = id.indexOf("__");
        if (sepIdx > 0) {
          const contractName = id.substring(0, sepIdx);
          const name = id.substring(sepIdx + 2);
          onNodeClick(contractName, node.type as "method" | "subroutine", name);
        }
      }
    },
    [onNodeClick]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDoubleClick={handleNodeDoubleClick}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={true}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(255,255,255,.06)" />
      <Controls showInteractive={false} />

      {/* Legend overlay — toggled by Info button */}
      {showLegend && (
        <div style={{
          position: "absolute", bottom: 12, left: 12, padding: "8px 12px", borderRadius: 8,
          background: "rgba(10,10,26,.9)", border: "1px solid rgba(255,255,255,.08)",
          display: "flex", flexDirection: "column", gap: 4, fontSize: 10, color: "var(--text-muted)", zIndex: 10,
        }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>Multi-Contract</div>
          <LegendItem color="#F97316" label="Cross-contract call" dashed={false} />
          <LegendItem color="#FF6B6B" label="Internal call" dashed={false} />
          <LegendItem color="#FFE66D" label="State write" dashed={false} />
          <LegendItem color="#4ECDC4" label="State read" dashed={true} />
          <div style={{ marginTop: 4, borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: 4 }}>
            <span style={{ color: "#22C55E" }}>■</span> Deployed &nbsp;
            <span style={{ color: "var(--text-muted)" }}>□</span> Pending
          </div>
          <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>Click node for details · Double-click header to zoom in</div>
        </div>
      )}
    </ReactFlow>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 16, height: 2, background: color, borderRadius: 1, ...(dashed ? { background: "none", borderTop: `2px dashed ${color}` } : {}) }} />
      <span>{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * Detail Panel for multi-contract node clicks
 * ═══════════════════════════════════════════════════════════════ */
function MultiDetailPanel({
  contractName,
  method,
  subroutine,
  onClose,
  onJumpToLine,
}: {
  contractName: string;
  method: AnalyzedMethod | null;
  subroutine: AnalyzedSubroutine | null;
  onClose: () => void;
  onJumpToLine?: (line: number) => void;
}) {
  const item = method || subroutine;
  if (!item) return null;

  const line = item.line_number;

  return (
    <div className="viz-detail-panel" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
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

      {/* Contract + Title */}
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>{contractName}</div>
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
        <MCSection title="Parameters">
          {item.params.map((p, i) => (
            <div key={i} style={{ fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 2 }}>
              <span style={{ color: "#e5e7eb" }}>{p.name}</span>
              <span style={{ color: "var(--text-muted)" }}>: {p.type}</span>
            </div>
          ))}
        </MCSection>
      )}

      {/* Return type */}
      <MCSection title="Returns">
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          {item.return_type || "None"}
        </span>
      </MCSection>

      {/* ABI signature */}
      {method?.abi_signature && (
        <MCSection title="ABI Selector">
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            {method.abi_signature}
          </span>
        </MCSection>
      )}

      {/* State reads */}
      {item.reads_state.length > 0 && (
        <MCSection title="Reads State">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.reads_state.map((s) => (
              <span key={s} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(96,165,250,.1)", color: "var(--viz-edge-read)", fontFamily: "var(--font-mono)" }}>
                {s}
              </span>
            ))}
          </div>
        </MCSection>
      )}

      {/* State writes */}
      {item.writes_state.length > 0 && (
        <MCSection title="Writes State">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.writes_state.map((s) => (
              <span key={s} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(249,115,22,.1)", color: "var(--viz-edge-write)", fontFamily: "var(--font-mono)" }}>
                {s}
              </span>
            ))}
          </div>
        </MCSection>
      )}

      {/* Calls */}
      {item.calls_methods.length > 0 && (
        <MCSection title="Calls Methods">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.calls_methods.map((c) => (
              <span key={c} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(148,163,184,.1)", color: "var(--viz-edge-call)", fontFamily: "var(--font-mono)" }}>
                {c}()
              </span>
            ))}
          </div>
        </MCSection>
      )}

      {/* Inner transactions */}
      {item.inner_txns.length > 0 && (
        <MCSection title="Inner Transactions">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.inner_txns.map((t, i) => (
              <span key={i} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(168,85,247,.1)", color: "var(--viz-edge-itxn)" }}>
                {t}
              </span>
            ))}
          </div>
        </MCSection>
      )}

      {/* Events */}
      {item.emits_events.length > 0 && (
        <MCSection title="Emits Events">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.emits_events.map((e) => (
              <span key={e} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "rgba(34,197,94,.1)", color: "var(--viz-safe)" }}>
                {e}
              </span>
            ))}
          </div>
        </MCSection>
      )}

      {/* Guards */}
      <MCSection title="Assertions / Guards">
        <span style={{ fontSize: 12, color: item.guards_count > 0 ? "var(--viz-safe)" : "var(--viz-warn)" }}>
          {item.guards_count} {item.guards_count === 1 ? "guard" : "guards"}
        </span>
      </MCSection>

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

function MCSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.05em" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * Graph builder — creates swimlane layout with inter-contract edges
 * ═══════════════════════════════════════════════════════════════ */

/** Helper to spread N items across a range */
function spreadPos(index: number, total: number): number {
  if (total <= 1) return 50;
  return 15 + (index * 70) / (total - 1);
}

function buildMultiContractGraph(
  analysis: MultiContractAnalysis,
  deployedContracts: DeployedContract[]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  /* ── Layout constants ── */
  const NODE_W = 220;
  const H_GAP = 60;
  const V_GAP = 260;
  const GROUP_PAD_X = 30;
  const GROUP_PAD_TOP = 48; // space for contract header
  const GROUP_PAD_BOT = 30;
  const GROUP_GAP = 80; // vertical gap between contract swimlanes

  let globalY = 0;
  let edgeOrdinal = 0;
  const OFFSET_STEP = 25;

  // Map for cross-contract edge anchoring
  const contractGroupPositions: Record<string, { x: number; y: number; w: number; h: number }> = {};

  analysis.deployment_order.forEach((contractName, contractIdx) => {
    const contract = analysis.contracts.find((c) => c.contract_name === contractName);
    if (!contract) return;

    const color = CONTRACT_COLORS[contractIdx % CONTRACT_COLORS.length];
    const dc = deployedContracts.find((d) => d.contractName === contractName);

    const nM = contract.methods.length;
    const nS = contract.state_variables.length;
    const nSub = contract.subroutines.length;
    const maxCols = Math.max(nM, nS, nSub, 1);
    const groupContentW = maxCols * NODE_W + Math.max(0, maxCols - 1) * H_GAP;
    const groupW = groupContentW + GROUP_PAD_X * 2;

    // Row positions within the group
    const row1Y = GROUP_PAD_TOP + 10;
    const row2Y = row1Y + 130 + (V_GAP * 0.6);
    const row3Y = nSub > 0 ? row2Y + 90 + (V_GAP * 0.4) : row2Y + 90;
    const groupH = (nSub > 0 ? row3Y + 80 : row2Y + 90) + GROUP_PAD_BOT;

    // Store group position for cross-contract edges
    contractGroupPositions[contractName] = { x: 0, y: globalY, w: groupW, h: groupH };

    // Contract group background node
    const groupNodeId = `group-${contractName}`;
    nodes.push({
      id: groupNodeId,
      type: "contractGroup",
      position: { x: 0, y: globalY },
      data: {
        label: contractName,
        color,
        deployOrder: contractIdx + 1,
        deployed: dc || null,
        methodCount: nM,
        stateCount: nS,
        groupWidth: groupW,
        groupHeight: groupH,
      },
      // Group node should be in background
      style: { zIndex: -1 },
      draggable: false,
      selectable: false,
    } as Node);

    const offXForRow = (n: number) => GROUP_PAD_X + (groupContentW - (n * NODE_W + Math.max(0, n - 1) * H_GAP)) / 2;

    // Pre-compute storage map for this contract
    const storageMap = new Map<string, { reads: boolean; writes: boolean }>();
    for (const sa of contract.storage_access_map) {
      const key = `${sa.method}|${sa.variable}`;
      const ex = storageMap.get(key) || { reads: false, writes: false };
      if (sa.access_type === "write") ex.writes = true;
      else ex.reads = true;
      storageMap.set(key, ex);
    }

    const mVars = new Map<string, string[]>();
    const vMethods = new Map<string, string[]>();
    storageMap.forEach((_, key) => {
      const [m, v] = key.split("|");
      if (!mVars.has(m)) mVars.set(m, []);
      if (!mVars.get(m)!.includes(v)) mVars.get(m)!.push(v);
      if (!vMethods.has(v)) vMethods.set(v, []);
      if (!vMethods.get(v)!.includes(m)) vMethods.get(v)!.push(m);
    });

    const mCalls = new Map<string, string[]>();
    contract.call_graph.forEach((cg) => {
      if (!mCalls.has(cg.from)) mCalls.set(cg.from, []);
      mCalls.get(cg.from)!.push(cg.to);
    });

    const prefix = `${contractName}__`;

    /* ── Method nodes ── */
    contract.methods.forEach((m, i) => {
      const x = offXForRow(nM) + i * (NODE_W + H_GAP);
      const connVars = mVars.get(m.name) || [];
      const callTargets = mCalls.get(m.name) || [];

      const slots: { id: string; hType: "source" | "target"; color: string }[] = [];
      connVars.forEach((v) => {
        const acc = storageMap.get(`${m.name}|${v}`)!;
        if (acc.writes) slots.push({ id: `w-${v}`, hType: "source", color: EDGE_COLORS.write });
        if (acc.reads) slots.push({ id: `r-${v}`, hType: "target", color: EDGE_COLORS.read });
      });
      callTargets.forEach((t) => {
        slots.push({ id: `c-${prefix}${t}`, hType: "source", color: EDGE_COLORS.call });
      });

      const bottomHandles: DynHandle[] = slots.map((s, idx) => ({
        ...s,
        leftPct: spreadPos(idx, slots.length),
      }));

      nodes.push({
        id: `${prefix}${m.name}`,
        type: "method",
        position: { x, y: globalY + row1Y },
        data: {
          label: m.name,
          decorator: m.decorator,
          is_readonly: m.is_readonly,
          is_create: m.is_create,
          params: m.params,
          return_type: m.return_type,
          guards_count: m.guards_count,
          inner_txns: m.inner_txns,
          emits_events: m.emits_events,
          bottomHandles,
        },
      });
    });

    /* ── State variable nodes ── */
    contract.state_variables.forEach((sv, i) => {
      const x = offXForRow(nS) + i * (NODE_W + H_GAP);
      const connMethods = vMethods.get(sv.name) || [];
      const nodeId = `${prefix}state-${sv.name}`;

      const slots: { id: string; hType: "source" | "target"; color: string }[] = [];
      connMethods.forEach((m) => {
        const acc = storageMap.get(`${m}|${sv.name}`)!;
        if (acc.writes) slots.push({ id: `w-${m}`, hType: "target", color: EDGE_COLORS.write });
        if (acc.reads) slots.push({ id: `r-${m}`, hType: "source", color: EDGE_COLORS.read });
      });

      const topHandles: DynHandle[] = slots.map((s, idx) => ({
        ...s,
        leftPct: spreadPos(idx, slots.length),
      }));

      nodes.push({
        id: nodeId,
        type: "stateVariable",
        position: { x, y: globalY + row2Y },
        data: {
          label: sv.name,
          storage_type: sv.storage_type,
          data_type: sv.data_type,
          default_value: sv.default_value,
          topHandles,
        },
      });
    });

    /* ── Subroutine nodes ── */
    contract.subroutines.forEach((sub, i) => {
      const x = offXForRow(nSub) + i * (NODE_W + H_GAP);
      nodes.push({
        id: `${prefix}${sub.name}`,
        type: "subroutine",
        position: { x, y: globalY + row3Y },
        data: {
          label: sub.name,
          params: sub.params,
          return_type: sub.return_type,
        },
      });
    });

    /* ── Intra-contract call graph edges ── */
    contract.call_graph.forEach((cg, i) => {
      edges.push({
        id: `${prefix}call-${i}`,
        source: `${prefix}${cg.from}`,
        target: `${prefix}${cg.to}`,
        sourceHandle: `c-${prefix}${cg.to}`,
        targetHandle: "target-top",
        type: "offsetSmoothStep",
        animated: true,
        data: { routingOffset: edgeOrdinal * OFFSET_STEP },
        style: { stroke: EDGE_COLORS.call, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.call, width: 14, height: 14 },
        label: "calls",
        labelStyle: { fill: EDGE_COLORS.call, fontSize: 9, fontWeight: 700 },
        labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 5, ry: 5 },
        labelBgPadding: [6, 3] as [number, number],
      } as Edge);
      edgeOrdinal++;
    });

    /* ── Storage access edges ── */
    let sIdx = 0;
    storageMap.forEach((access, key) => {
      const [method, variable] = key.split("|");
      const stateId = `${prefix}state-${variable}`;

      if (access.writes) {
        edges.push({
          id: `${prefix}sw-${sIdx}`,
          source: `${prefix}${method}`,
          target: stateId,
          sourceHandle: `w-${variable}`,
          targetHandle: `w-${method}`,
          type: "offsetSmoothStep",
          animated: true,
          data: { routingOffset: edgeOrdinal * OFFSET_STEP },
          style: { stroke: EDGE_COLORS.write, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.write, width: 14, height: 14 },
          label: "writes",
          labelStyle: { fill: EDGE_COLORS.write, fontSize: 8, fontWeight: 700 },
          labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 4, ry: 4 },
          labelBgPadding: [4, 2] as [number, number],
        } as Edge);
        edgeOrdinal++;
      }

      if (access.reads) {
        edges.push({
          id: `${prefix}sr-${sIdx}`,
          source: stateId,
          target: `${prefix}${method}`,
          sourceHandle: `r-${method}`,
          targetHandle: `r-${variable}`,
          type: "offsetSmoothStep",
          data: { routingOffset: edgeOrdinal * OFFSET_STEP },
          style: { stroke: EDGE_COLORS.read, strokeWidth: 1.5, strokeDasharray: "6 4" },
          markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.read, width: 12, height: 12 },
          label: "reads",
          labelStyle: { fill: EDGE_COLORS.read, fontSize: 8, fontWeight: 700 },
          labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 4, ry: 4 },
          labelBgPadding: [4, 2] as [number, number],
        } as Edge);
        edgeOrdinal++;
      }

      sIdx++;
    });

    /* ── Inner transaction edges ── */
    contract.inner_txn_map.forEach((itx, i) => {
      const methodNodeId = `${prefix}${itx.method}`;
      const exists = nodes.find((n) => n.id === methodNodeId);
      if (exists) {
        edges.push({
          id: `${prefix}itxn-${i}`,
          source: methodNodeId,
          target: methodNodeId,
          type: "offsetSmoothStep",
          animated: true,
          data: { routingOffset: edgeOrdinal * OFFSET_STEP },
          style: { stroke: EDGE_COLORS.itxn, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS.itxn, width: 12, height: 12 },
          label: `⚡ ${itx.txn_type}`,
          labelStyle: { fill: "#E9D5FF", fontSize: 8, fontWeight: 700 },
          labelBgStyle: { fill: "#1e1040", fillOpacity: 0.95, rx: 4, ry: 4 },
          labelBgPadding: [4, 2] as [number, number],
        } as Edge);
        edgeOrdinal++;
      }
    });

    globalY += groupH + GROUP_GAP;
  });

  /* ── Inter-contract edges ── */
  analysis.inter_contract_edges.forEach((ice, i) => {
    const fromPrefix = `${ice.from_contract}__`;
    const toPrefix = `${ice.to_contract}__`;

    // Find a suitable source node (method that makes the cross-call, or first method)
    const fromContract = analysis.contracts.find((c) => c.contract_name === ice.from_contract);
    const sourceMethod = ice.via_method
      ? `${fromPrefix}${ice.via_method}`
      : fromContract?.methods[0]
        ? `${fromPrefix}${fromContract.methods[0].name}`
        : `group-${ice.from_contract}`;

    // Target is the group header of the target contract
    const toContract = analysis.contracts.find((c) => c.contract_name === ice.to_contract);
    const targetNode = toContract?.methods[0]
      ? `${toPrefix}${toContract.methods[0].name}`
      : `group-${ice.to_contract}`;

    // Determine if this connection is "live" (both contracts deployed)
    const fromDeployed = deployedContracts.find((d) => d.contractName === ice.from_contract);
    const toDeployed = deployedContracts.find((d) => d.contractName === ice.to_contract);
    const isLive = !!fromDeployed && !!toDeployed;
    const isPending = !!fromDeployed && !toDeployed;

    const edgeColor = isLive ? "#22C55E" : isPending ? "#EF4444" : EDGE_COLORS.interContract;
    const labelText = isLive
      ? `${ice.relationship_type} → App #${toDeployed?.appId}`
      : isPending
        ? `${ice.relationship_type} ⚠ Not deployed`
        : ice.relationship_type;

    edges.push({
      id: `inter-${i}`,
      source: sourceMethod,
      target: targetNode,
      type: "offsetSmoothStep",
      animated: isLive,
      data: { routingOffset: edgeOrdinal * OFFSET_STEP },
      style: {
        stroke: edgeColor,
        strokeWidth: 3,
        strokeDasharray: isLive ? undefined : "8 4",
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 20, height: 20 },
      label: labelText,
      labelStyle: { fill: edgeColor, fontSize: 10, fontWeight: 700 },
      labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 6, ry: 6 },
      labelBgPadding: [8, 4] as [number, number],
    } as Edge);
    edgeOrdinal++;
  });

  return { nodes, edges };
}
