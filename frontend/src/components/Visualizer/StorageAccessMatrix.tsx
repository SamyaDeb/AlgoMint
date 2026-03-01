"use client";

import type { AnalyzedMethod, AnalyzedSubroutine, AnalyzedStateVariable, StorageAccessEdge } from "@/types";

interface StorageAccessMatrixProps {
  methods: (AnalyzedMethod | AnalyzedSubroutine)[];
  stateVariables: AnalyzedStateVariable[];
  storageAccessMap: StorageAccessEdge[];
}

export default function StorageAccessMatrix({ methods, stateVariables, storageAccessMap }: StorageAccessMatrixProps) {
  if (stateVariables.length === 0 || methods.length === 0) return null;

  // Build lookup: { "methodName:varName" => "read" | "write" | "both" }
  const accessLookup = new Map<string, "read" | "write" | "both">();
  for (const sa of storageAccessMap) {
    const key = `${sa.method}:${sa.variable}`;
    const existing = accessLookup.get(key);
    if (existing && existing !== sa.access_type) {
      accessLookup.set(key, "both");
    } else {
      accessLookup.set(key, sa.access_type);
    }
  }

  return (
    <div className="viz-section">
      <div className="viz-section-title">Storage Access Matrix</div>
      <div style={{ overflowX: "auto" }}>
        <table className="viz-matrix">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Method</th>
              {stateVariables.map((sv) => (
                <th key={sv.name} style={{ fontSize: 10, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {sv.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.name}>
                <td style={{ textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  {m.name}
                </td>
                {stateVariables.map((sv) => {
                  const access = accessLookup.get(`${m.name}:${sv.name}`);
                  return (
                    <td key={sv.name}>
                      {access === "read" && (
                        <span className="viz-dot" style={{ background: "var(--viz-edge-read)" }} title="Read" />
                      )}
                      {access === "write" && (
                        <span className="viz-dot" style={{ background: "var(--viz-edge-write)" }} title="Write" />
                      )}
                      {access === "both" && (
                        <span className="viz-dot" style={{ background: "var(--viz-subroutine)" }} title="Read & Write" />
                      )}
                      {!access && <span style={{ opacity: 0.15 }}>·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
