"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export default function Legend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="viz-legend" style={{ position: "absolute", top: 8, right: 8, zIndex: 20 }}>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          width: "100%",
        }}
      >
        Legend {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {/* Method types */}
          <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 10, color: "var(--text-muted)" }}>METHOD TYPES</div>
          <Row color="#F97316" label="Create method" />
          <Row color="#3B82F6" label="View method" />
          <Row color="#14B8A6" label="ABI method" />
          <Row color="#6B7280" label="Bare method" />
          <Row color="#8B5CF6" label="Subroutine" dashed />

          {/* State types */}
          <div style={{ marginTop: 8, marginBottom: 6, fontWeight: 600, fontSize: 10, color: "var(--text-muted)" }}>STATE VARIABLES</div>
          <Row color="#22C55E" label="GlobalState" />
          <Row color="#3B82F6" label="LocalState" />
          <Row color="#EF4444" label="Box" />
          <Row color="#F59E0B" label="BoxMap" />

          {/* Edge types */}
          <div style={{ marginTop: 8, marginBottom: 6, fontWeight: 600, fontSize: 10, color: "var(--text-muted)" }}>CONNECTIONS</div>
          <LineRow color="#FF6B6B" label="Method call" arrow />
          <LineRow color="#4ECDC4" label="Read access" dashed arrow />
          <LineRow color="#FFE66D" label="Write access" thick arrow />
          <LineRow color="#C084FC" label="Inner transaction" arrow />
        </div>
      )}
    </div>
  );
}

function Row({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: dashed ? 2 : 3,
          background: color,
          border: dashed ? `1.5px dashed ${color}` : undefined,
          flexShrink: 0,
          opacity: dashed ? 0.7 : 1,
        }}
      />
      <span style={{ fontSize: 10 }}>{label}</span>
    </div>
  );
}

function LineRow({ color, label, dashed, thick, arrow }: { color: string; label: string; dashed?: boolean; thick?: boolean; arrow?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
      <svg width={20} height={10}>
        <defs>
          <marker id={`arrow-${color.replace("#", "")}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={color} />
          </marker>
        </defs>
        <line
          x1={0}
          y1={5}
          x2={arrow ? 14 : 20}
          y2={5}
          stroke={color}
          strokeWidth={thick ? 3 : 2}
          strokeDasharray={dashed ? "3 2" : undefined}
          markerEnd={arrow ? `url(#arrow-${color.replace("#", "")})` : undefined}
        />
      </svg>
      <span style={{ fontSize: 10 }}>{label}</span>
    </div>
  );
}
