"use client";

// ── Status Bar — Bottom info bar (VS Code / Remix style) ── //

interface StatusBarProps {
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
  network: string;
  walletAddress: string | null;
  isWalletConnected: boolean;
  cursorLine?: number;
  cursorCol?: number;
  activeFileName?: string;
}

const STEP_LABELS = ["Paste", "Convert", "Compile", "Connect", "Deploy"];

export default function StatusBar({
  currentStep,
  network,
  walletAddress,
  isWalletConnected,
  cursorLine = 1,
  cursorCol = 1,
  activeFileName,
}: StatusBarProps) {
  const truncatedAddr = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : "No Wallet";

  return (
    <div
      className="flex items-center justify-between px-3 text-[11px] font-medium select-none"
      style={{
        height: "var(--status-bar-h)",
        backgroundColor: "var(--bg-status-bar)",
        borderTop: "1px solid var(--border)",
        color: "var(--text-secondary)",
      }}
    >
      {/* Left side */}
      <div className="flex items-center gap-3">
        {/* Brand */}
        <span style={{ color: "var(--accent)" }} className="flex items-center gap-1">
          <span>⬡</span>
          <span className="tracking-wider font-semibold">AlgoMint</span>
        </span>
        <span className="opacity-30">│</span>
        <span>
          Step {currentStep + 1}/5: {STEP_LABELS[currentStep] || "Done"}
        </span>
        <span className="opacity-30">│</span>
        <span className="uppercase text-[10px] tracking-wider">
          {network}
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Cursor position */}
        <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
          Ln {cursorLine}, Col {cursorCol}
        </span>
        <span className="opacity-30">│</span>
        {/* File language */}
        {activeFileName && (
          <>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {activeFileName.endsWith(".sol")
                ? "Solidity"
                : activeFileName.endsWith(".pyteal")
                ? "Python"
                : "TEAL"}
            </span>
            <span className="opacity-30">│</span>
          </>
        )}
        <span className="font-mono text-[10px]">{truncatedAddr}</span>
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: isWalletConnected
              ? "var(--success)"
              : "var(--text-muted)",
          }}
        />
      </div>
    </div>
  );
}
