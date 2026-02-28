// WalletConnector — Pera Wallet connect/disconnect UI
"use client";

interface WalletConnectorProps {
  isConnected: boolean;
  isConnecting?: boolean;
  walletAddress: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  error?: string | null;
}

export default function WalletConnector({
  isConnected,
  isConnecting = false,
  walletAddress,
  onConnect,
  onDisconnect,
  error,
}: WalletConnectorProps) {
  const truncated = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "";

  if (isConnected) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "var(--success)" }}
          />
          <span className="font-mono" style={{ color: "var(--text-primary)" }}>
            {truncated}
          </span>
          <button
            onClick={onDisconnect}
            className="ml-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
            style={{ color: "var(--error)", backgroundColor: "rgba(239,68,68,0.1)" }}
          >
            Disconnect
          </button>
        </div>
        <div
          className="text-[10px] px-2 py-0.5 rounded-full w-fit"
          style={{
            backgroundColor: "rgba(34,197,94,0.1)",
            color: "var(--success)",
          }}
        >
          Connected
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onConnect}
        disabled={isConnecting}
        className="px-3 py-1.5 rounded text-xs font-medium transition-all cursor-pointer disabled:opacity-60 disabled:cursor-wait"
        style={{
          backgroundColor: "var(--accent)",
          color: "#fff",
        }}
      >
        {isConnecting ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Connecting...
          </span>
        ) : (
          "🔗 Connect Wallet"
        )}
      </button>

      {error && (
        <div
          className="text-[10px] p-1.5 rounded"
          style={{
            backgroundColor: "rgba(239,68,68,0.1)",
            color: "var(--error)",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        Requires Pera Wallet app
      </div>
    </div>
  );
}
