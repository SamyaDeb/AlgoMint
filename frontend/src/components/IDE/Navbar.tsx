"use client";

import { MessageCircle, TerminalSquare, PanelLeft } from "lucide-react";

interface NavbarProps {
    isSidebarOpen: boolean;
    onToggleSidebar: () => void;
    isTerminalOpen: boolean;
    onToggleTerminal: () => void;
    isChatOpen: boolean;
    onToggleChat: () => void;
}

export default function Navbar({
    isSidebarOpen,
    onToggleSidebar,
    isTerminalOpen,
    onToggleTerminal,
    isChatOpen,
    onToggleChat,
}: NavbarProps) {
    return (
        <div
            className="flex items-center justify-between px-4 shrink-0 ide-border-bottom w-full"
            style={{
                height: "48px",
                backgroundColor: "var(--bg-icon-bar)",
            }}
        >
            {/* Brand */}
            <div className="flex items-center gap-2">
                <span style={{ color: "var(--accent)", fontSize: "20px" }}>⬡</span>
                <span
                    className="text-lg font-bold tracking-wide"
                    style={{ color: "var(--text-primary)" }}
                >
                    AlgoMint
                </span>
                <span
                    className="text-xs px-1.5 py-0.5 rounded ml-1"
                    style={{
                        background: "var(--accent-muted)",
                        color: "var(--accent)",
                        fontWeight: 600,
                    }}
                >
                    IDE
                </span>
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-2">
                <button
                    onClick={onToggleSidebar}
                    className={`icon-btn rounded ${isSidebarOpen ? "bg-[rgba(0,212,170,0.1)] text-[#00D4AA]" : ""}`}
                    title="Toggle Left Sidebar"
                >
                    <PanelLeft size={18} />
                </button>
                <button
                    onClick={onToggleTerminal}
                    className={`icon-btn rounded ${isTerminalOpen ? "bg-[rgba(0,212,170,0.1)] text-[#00D4AA]" : ""}`}
                    title="Toggle Bottom Terminal"
                >
                    <TerminalSquare size={18} />
                </button>
                <button
                    onClick={onToggleChat}
                    className={`icon-btn rounded ${isChatOpen ? "bg-[rgba(0,212,170,0.1)] text-[#00D4AA]" : ""}`}
                    title="Toggle Right Chat Panel"
                >
                    <MessageCircle size={18} />
                </button>
            </div>
        </div>
    );
}
