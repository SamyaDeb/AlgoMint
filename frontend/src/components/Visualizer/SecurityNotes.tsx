"use client";

import type { SecurityNote } from "@/types";
import { ShieldCheck, AlertTriangle, XCircle, Info } from "lucide-react";

interface SecurityNotesProps {
  notes: SecurityNote[];
}

const iconMap = {
  safe: ShieldCheck,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

export default function SecurityNotes({ notes }: SecurityNotesProps) {
  if (notes.length === 0) return null;

  // Sort: danger first, then warning, then info, then safe
  const priorityOrder: Record<string, number> = { danger: 0, warning: 1, info: 2, safe: 3 };
  const sorted = [...notes].sort((a, b) => (priorityOrder[a.type] ?? 4) - (priorityOrder[b.type] ?? 4));

  return (
    <div className="viz-section">
      <div className="viz-section-title">Security Notes</div>
      {sorted.map((note, i) => {
        const Icon = iconMap[note.type] || Info;
        return (
          <div key={i} className={`viz-security-card viz-security-card--${note.type}`}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <Icon size={14} style={{ marginTop: 1, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12 }}>{note.message}</div>
                {note.method && (
                  <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, fontFamily: "var(--font-mono)" }}>
                    in {note.method}()
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
