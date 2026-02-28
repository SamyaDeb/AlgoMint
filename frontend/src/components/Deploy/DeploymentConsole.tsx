// DeploymentConsole — Live console output for deployment logs
// This component is now integrated into IDE/TerminalPanel.
// It remains as a re-export for backward compatibility.
"use client";

export default function DeploymentConsole() {
  return (
    <div
      className="p-3 text-xs font-mono"
      style={{ color: "var(--text-muted)" }}
    >
      Console output is rendered in the Terminal Panel below.
    </div>
  );
}
