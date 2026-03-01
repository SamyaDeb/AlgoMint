"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Database } from "lucide-react";
import type { DynHandle } from "../FlowDiagram";

export interface StateVariableNodeData {
  label: string;
  storage_type: string;
  data_type: string;
  default_value: string | null;
  topHandles?: DynHandle[];
  [key: string]: unknown;
}

const STORAGE_COLORS: Record<string, string> = {
  GlobalState: "#22C55E",
  LocalState: "#3B82F6",
  Box: "#EF4444",
  BoxMap: "#F59E0B",
  Unknown: "#64748B",
};

function StateVariableNode({ data }: NodeProps) {
  const d = data as unknown as StateVariableNodeData;
  const storageClass = `viz-state-node viz-state-node--${d.storage_type}`;

  return (
    <div className={storageClass}>
      {/* Dynamic top handles — one per method connection */}
      {d.topHandles?.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type={h.hType as "source" | "target"}
          position={Position.Top}
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

      {/* Colored header */}
      <div className="viz-state-node__header">
        <Database size={10} />
        {d.storage_type}
      </div>

      {/* Body */}
      <div className="viz-state-node__body">
        <div className="viz-state-node__name">{d.label}</div>
        <div className="viz-state-node__type">{d.data_type}</div>
      </div>

    </div>
  );
}

export default memo(StateVariableNode);
