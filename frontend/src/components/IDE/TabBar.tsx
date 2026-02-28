"use client";

import { Sidebar, TerminalSquare, MessageSquare } from "lucide-react";

// ── Tab Bar — Remix-style file tabs above the editor ── //

export interface EditorTab {
  id: string;
  label: string;
  language: string;
  closable: boolean;
  icon?: string;
}

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  isSidebarOpen,
  onToggleSidebar,
  isTerminalOpen,
  onToggleTerminal,
  isChatOpen,
  onToggleChat,
}: TabBarProps) {
  return (
    <div
      className="flex items-end h-full overflow-x-auto"
      style={{
        backgroundColor: "var(--bg-tab-bar)",
        height: "var(--tab-bar-h)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex items-center gap-2 px-4 h-full text-[15px] font-medium transition-colors duration-100 relative group whitespace-nowrap"
            style={{
              backgroundColor: isActive
                ? "var(--bg-tab-active)"
                : "transparent",
              color: isActive
                ? "var(--text-primary)"
                : "var(--text-muted)",
              borderRight: "1px solid var(--border)",
              borderBottom: isActive ? "1px solid transparent" : "1px solid var(--border)",
            }}
          >
            {/* Language icon */}
            <span className="text-[12px] opacity-60">
              {tab.icon || (tab.language === "sol" ? "◆" : tab.language === "python" ? "🐍" : "📄")}
            </span>

            <span>{tab.label}</span>

            {/* Close button */}
            {tab.closable && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className="ml-1 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[rgba(0,212,170,0.1)]"
                style={{ color: "var(--text-muted)" }}
              >
                ×
              </span>
            )}

            {/* Active tab top accent */}
            {isActive && (
              <div
                className="absolute top-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: "var(--accent)" }}
              />
            )}
          </button>
        );
      })}

      {/* Spacer fill */}
      <div
        className="flex-1 h-full"
        style={{ borderBottom: "1px solid var(--border)" }}
      />

      {/* View Toggles */}
      <div
        className="flex items-center gap-1.5 px-3 h-full"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded transition-colors hover:bg-[rgba(0,212,170,0.08)]"
          style={{ color: isSidebarOpen ? "var(--accent)" : "var(--text-muted)" }}
          title="Toggle Sidebar"
        >
          <Sidebar size={20} />
        </button>
        <button
          onClick={onToggleTerminal}
          className="p-2 rounded transition-colors hover:bg-[rgba(0,212,170,0.08)]"
          style={{ color: isTerminalOpen ? "var(--accent)" : "var(--text-muted)" }}
          title="Toggle Terminal"
        >
          <TerminalSquare size={20} />
        </button>
        <button
          onClick={onToggleChat}
          className="p-2 rounded transition-colors hover:bg-[rgba(0,212,170,0.08)]"
          style={{ color: isChatOpen ? "var(--accent)" : "var(--text-muted)" }}
          title="Toggle Chat"
        >
          <MessageSquare size={20} />
        </button>
      </div>
    </div>
  );
}
