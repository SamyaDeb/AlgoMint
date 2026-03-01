"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export interface SubroutineNodeData {
  label: string;
  params: { name: string; type: string }[];
  return_type: string;
  [key: string]: unknown;
}

function SubroutineNode({ data }: NodeProps) {
  const d = data as unknown as SubroutineNodeData;

  return (
    <div className="viz-node viz-node--sub">
      <Handle id="target-top" type="target" position={Position.Top} style={{ background: "#8B5CF6", border: "2px solid #0a0a1a", width: 10, height: 10, borderRadius: "50%" }} />

      {/* Purple header */}
      <div className="viz-node__header">
        <GitBranch size={10} />
        Subroutine
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
      </div>

      <Handle id="source-bottom" type="source" position={Position.Bottom} style={{ background: "#8B5CF6", border: "2px solid #0a0a1a", width: 10, height: 10, borderRadius: "50%" }} />
    </div>
  );
}

export default memo(SubroutineNode);
