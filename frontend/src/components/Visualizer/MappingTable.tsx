"use client";

import type { SolidityMappingEntry } from "@/types";
import { ArrowRight } from "lucide-react";

interface MappingTableProps {
  mappings: SolidityMappingEntry[];
}

const typeColors: Record<string, string> = {
  storage: "var(--viz-subroutine)",
  access_control: "var(--viz-danger)",
  event: "var(--viz-safe)",
  visibility: "var(--viz-abimethod)",
  payment: "var(--viz-edge-write)",
  type: "var(--viz-edge-read)",
};

export default function MappingTable({ mappings }: MappingTableProps) {
  if (mappings.length === 0) return null;

  return (
    <div className="viz-section">
      <div className="viz-section-title">Solidity → Algorand Mapping</div>
      <table className="viz-mapping-table">
        <thead>
          <tr>
            <th>Solidity</th>
            <th style={{ width: 30 }}></th>
            <th>Algorand Python</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((m, i) => (
            <tr key={i}>
              <td style={{ color: "#e5e7eb" }}>{m.solidity_element}</td>
              <td style={{ textAlign: "center" }}>
                <ArrowRight size={12} style={{ color: "var(--text-muted)" }} />
              </td>
              <td style={{ color: "var(--accent)" }}>{m.algorand_element}</td>
              <td>
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,.06)",
                    color: typeColors[m.mapping_type] || "var(--text-secondary)",
                  }}
                >
                  {m.mapping_type}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
