"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Shield, Zap, Bell } from "lucide-react";
import type { DynHandle } from "../FlowDiagram";

export interface MethodNodeData {
  label: string;
  decorator: string;
  is_readonly: boolean;
  is_create: boolean;
  params: { name: string; type: string }[];
  return_type: string;
  guards_count: number;
  inner_txns: string[];
  emits_events: string[];
  bottomHandles?: DynHandle[];
  [key: string]: unknown;
}

function getNodeClass(data: MethodNodeData) {
  if (data.is_create) return "viz-node viz-node--create";
  if (data.is_readonly) return "viz-node viz-node--readonly";
  if (data.decorator === "baremethod") return "viz-node viz-node--bare";
  return "viz-node viz-node--abi";
}

function getTypeLabel(data: MethodNodeData) {
  if (data.is_create) return "\u25C9 Create Method";
  if (data.is_readonly) return "\u25C9 View Method";
  if (data.decorator === "baremethod") return "\u25C9 Bare Method";
  return "\u25C9 ABI Method";
}

function getAccentColor(data: MethodNodeData) {
  if (data.is_create) return "#F97316";
  if (data.is_readonly) return "#3B82F6";
  if (data.decorator === "baremethod") return "#6B7280";
  return "#14B8A6";
}

function MethodNode({ data }: NodeProps) {
  const d = data as unknown as MethodNodeData;
  const accent = getAccentColor(d);

  return (
    <div className={getNodeClass(d)}>
      {/* Top handle for incoming call graph edges */}
      <Handle id="target-top" type="target" position={Position.Top} style={{ background: accent, border: "2px solid #0a0a1a", width: 10, height: 10, borderRadius: "50%" }} />

      {/* Colored header bar */}
      <div className="viz-node__header">
        {getTypeLabel(d)}
      </div>

      {/* Body */}
      <div className="viz-node__body">
        <div className="viz-node__name">
          {d.label}({d.params.map(p => p.type).join(", ")})
        </div>

        {d.return_type && d.return_type !== "None" && (
          <div className="viz-node__meta">
            returns {d.return_type}
          </div>
        )}

        {(d.guards_count > 0 || d.inner_txns.length > 0 || d.emits_events.length > 0) && (
          <div className="viz-node__badges">
            {d.guards_count > 0 && <span><Shield size={10} color="#FBBF24" />{d.guards_count}</span>}
            {d.inner_txns.length > 0 && <span><Zap size={10} color="#C084FC" />{d.inner_txns.length}</span>}
            {d.emits_events.length > 0 && <span><Bell size={10} color="#34D399" />{d.emits_events.length}</span>}
          </div>
        )}
      </div>

      {/* Dynamic bottom handles — one per storage / call connection */}
      {d.bottomHandles?.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type={h.hType as "source" | "target"}
          position={Position.Bottom}
          style={{
            left: `${h.leftPct}%`,
            background: h.color,
            border: "2px solid #0a0a1a",
            width: 7,
            height: 7,
            borderRadius: "50%",
          }}
        />
      ))}
    </div>
  );
}

export default memo(MethodNode);
