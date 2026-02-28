"use client";

import { useState } from "react";
import {
  Code,
  ArrowLeftRight,
  Hammer,
  Rocket,
  Settings,
  Wallet,
} from "lucide-react";

// ── Sidebar panel IDs ── //
export type PanelId = "editor" | "convert" | "compile" | "deploy" | "settings";

interface IconSidebarProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  isWalletConnected: boolean;
}

const PANEL_ITEMS: { id: PanelId; icon: React.ReactNode; tooltip: string }[] = [
  { id: "editor", icon: <Code size={20} />, tooltip: "File Explorer" },
  { id: "convert", icon: <ArrowLeftRight size={20} />, tooltip: "Convert" },
  { id: "compile", icon: <Hammer size={20} />, tooltip: "Compile" },
  { id: "deploy", icon: <Rocket size={20} />, tooltip: "Deploy & Run" },
  { id: "settings", icon: <Settings size={20} />, tooltip: "Settings" },
];

export default function IconSidebar({
  activePanel,
  onPanelChange,
  isWalletConnected,
}: IconSidebarProps) {
  const [hoveredId, setHoveredId] = useState<PanelId | null>(null);

  const handleClick = (id: PanelId) => {
    // Toggle: clicking the active icon collapses the panel
    onPanelChange(activePanel === id ? null : id);
  };

  return (
    <div
      className="flex flex-col items-center justify-between h-full ide-border-right select-none"
      style={{
        width: "var(--icon-bar-w)",
        backgroundColor: "var(--bg-icon-bar)",
      }}
    >
      {/* Top: Logo */}
      <div className="flex flex-col items-center w-full">
        <div
          className="flex items-center justify-center w-full py-3"
          title="AlgoMint"
        >
          <span
            className="text-base font-bold tracking-wider"
            style={{ color: "var(--accent)" }}
          >
            ⬡
          </span>
        </div>

        {/* Panel Icons */}
        <div className="flex flex-col items-center w-full mt-1">
          {PANEL_ITEMS.map(({ id, icon, tooltip }) => (
            <div key={id} className="relative w-full">
              <button
                className={`icon-btn w-full ${activePanel === id ? "active" : ""}`}
                onClick={() => handleClick(id)}
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId(null)}
                aria-label={tooltip}
              >
                {icon}
              </button>

              {/* Tooltip */}
              {hoveredId === id && (
                <div
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 text-base rounded whitespace-nowrap z-50 pointer-events-none"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {tooltip}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: Wallet indicator */}
      <div className="flex flex-col items-center w-full pb-2">
        <button
          className="icon-btn w-full"
          title={isWalletConnected ? "Wallet Connected" : "No Wallet"}
        >
          <div className="relative">
            <Wallet size={18} />
            <span
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
              style={{
                backgroundColor: isWalletConnected
                  ? "var(--success)"
                  : "var(--text-muted)",
              }}
            />
          </div>
        </button>
      </div>
    </div>
  );
}
