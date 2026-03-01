"use client";

import type { PanelId } from "./IconSidebar";
import { FilePlus, FolderPlus, RefreshCw, Copy, Download, Eye, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { FileNode } from "@/app/page";
import type { ARC32AppSpec, ARC4Method, DeployedContract, CompilationResult, ContractFileData, MultiContractAnalysis } from "@/types";
import type { PeraWalletConnect } from "@perawallet/connect";
import ContractInteraction from "@/components/Deploy/ContractInteraction";

// ── Panel content for each sidebar icon ── //

interface SidePanelProps {
  activePanel: PanelId | null;
  files: FileNode[];
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenFile: (file: FileNode) => void;
  onDeleteFile: (id: string) => void;
  solidityCode: string;
  // Per-file contract data for status badges
  contractFiles: Map<string, ContractFileData>;
  // Convert panel props
  onConvert: () => void;
  isConverting: boolean;
  isConverted: boolean;
  convertError: string | null;
  unsupportedFeatures: string[];
  // Compile panel props
  onCompile: () => void;
  isCompiling: boolean;
  isCompiled: boolean;
  compileError: string | null;
  approvalSize: number;
  clearSize: number;
  retryAttempt: number;
  maxRetries: number;
  // Deploy panel props
  isWalletConnected: boolean;
  walletAddress: string | null;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onDeploy: (createArgs?: Record<string, string>, foreignAppIds?: number[]) => void;
  isDeploying: boolean;
  deployStage: string;
  deployError: string | null;
  txid: string;
  explorerUrl: string;
  network: string;
  onNetworkChange: (network: string) => void;
  // Compiled contract selection
  compiledContracts: { id: string; name: string }[];
  selectedDeployContract: string;
  onSelectDeployContract: (id: string) => void;
  // ARC-32 & Deployed contracts (from REAL Puya compilation)
  arc32AppSpec: ARC32AppSpec | null;
  multiContractAnalysis: MultiContractAnalysis | null;
  deployedContracts: DeployedContract[];
  approvalTeal: string;
  clearTeal: string;
  compilationResult: CompilationResult | null;
  arc56Json: Record<string, unknown> | null;
  // Contract interaction
  peraWallet: PeraWalletConnect | null;
  onLog?: (type: "info" | "error" | "success" | "warning", message: string) => void;
}


function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between px-3 shrink-0"
      style={{
        height: "var(--tab-bar-h)",
        color: "var(--text-secondary)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span className="text-[13px] font-semibold tracking-wider uppercase">{title}</span>
      {children && (
        <div className="flex items-center gap-1">
          {children}
        </div>
      )}
    </div>
  );
}

function PanelButton({
  children,
  onClick,
  disabled,
  loading,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const bgMap = {
    primary: "var(--accent)",
    secondary: "var(--bg-surface)",
    danger: "var(--error)",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full py-2 px-3 rounded text-base font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed btn-hover-lift"
      style={{
        backgroundColor: disabled ? "var(--bg-surface)" : bgMap[variant],
        color: variant === "secondary" ? "var(--text-primary)" : "#fff",
      }}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
          Processing...
        </span>
      ) : (
        children
      )}
    </button>
  );
}

// ── Individual panel contents ── //

import { useState, useEffect } from "react";

function EditorPanel({
  files,
  onCreateFile,
  onCreateFolder,
  onOpenFile,
  onDeleteFile,
  contractFiles,
  deployedContracts,
}: {
  files: FileNode[];
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenFile: (file: FileNode) => void;
  onDeleteFile: (id: string) => void;
  contractFiles: Map<string, ContractFileData>;
  deployedContracts: DeployedContract[];
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileNodeId: string } | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col text-sm select-none relative h-full">

      {/* File Tree */}
      <div className="flex flex-col py-1">
        {files.map(f => (
          <div
            key={f.id}
            onClick={() => f.type === "file" && onOpenFile(f)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.pageX, y: e.pageY, fileNodeId: f.id });
            }}
            className={`flex items-center gap-2 px-6 py-0.5 cursor-pointer hover:bg-[rgba(0,212,170,0.06)]`}
          >
            {f.type === "folder" ? (
              <>
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>▶</span>
                <span style={{ color: "var(--warning)" }}>📁</span>
                <span style={{ color: "var(--warning)" }}>{f.name}</span>
              </>
            ) : (
              <>
                <span style={{ color: "var(--info)" }}>
                  {f.name.endsWith('.sol') ? 'S' : f.name.endsWith('.md') ? 'M↓' : '📄'}
                </span>
                <span style={{ color: "var(--text-primary)" }}>{f.name}</span>
                {/* Phase 6: File Status Badges — priority: LIVE > TEAL > PY */}
                {f.name.endsWith('.sol') && (() => {
                  const isDeployed = deployedContracts?.some(dc => dc.contractName === f.name.replace('.sol', ''));
                  if (isDeployed) return (
                    <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider" style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>LIVE</span>
                  );
                  const cfData = contractFiles.get(f.name);
                  if (!cfData) return null;
                  if (cfData.isCompiled) return (
                    <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider" style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: '#eab308' }}>TEAL</span>
                  );
                  if (cfData.isConverted) return (
                    <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider" style={{ backgroundColor: 'rgba(0,212,170,0.12)', color: 'var(--accent)' }}>PY</span>
                  );
                  return null;
                })()}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded shadow-lg py-1 border"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: "var(--bg-editor)",
            borderColor: "var(--border)",
            minWidth: "160px"
          }}
        >
          <div className="px-3 py-1.5 hover:bg-[rgba(0,212,170,0.06)] cursor-not-allowed opacity-50" style={{ color: "var(--text-primary)" }}>Rename...</div>
          <div className="px-3 py-1.5 hover:bg-[rgba(0,212,170,0.06)] cursor-not-allowed opacity-50" style={{ color: "var(--text-primary)" }}>Copy</div>
          <div className="px-3 py-1.5 hover:bg-[rgba(0,212,170,0.06)] cursor-not-allowed opacity-50" style={{ color: "var(--text-primary)" }}>Paste</div>
          <div className="h-px w-full my-1" style={{ backgroundColor: "var(--border)" }} />
          <div
            className="px-3 py-1.5 hover:bg-[rgba(0,212,170,0.06)] cursor-pointer"
            style={{ color: "var(--error)" }}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteFile(contextMenu.fileNodeId);
              setContextMenu(null);
            }}
          >
            Delete
          </div>
        </div>
      )}
    </div>
  );
}

function ConvertPanel({
  onConvert,
  isConverting,
  isConverted,
  convertError,
  unsupportedFeatures,
  solidityCode,
}: {
  onConvert: () => void;
  isConverting: boolean;
  isConverted: boolean;
  convertError: string | null;
  unsupportedFeatures: string[];
  solidityCode: string;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <PanelButton
        onClick={onConvert}
        disabled={!solidityCode.trim() || isConverting}
        loading={isConverting}
      >
        Convert to Algorand Python
      </PanelButton>

      {/* Status */}
      <div className="text-base flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: isConverted
              ? "var(--success)"
              : isConverting
                ? "var(--accent)"
                : convertError
                  ? "var(--error)"
                  : "var(--text-muted)",
          }}
        />
        <span>
          {isConverting
            ? "Converting..."
            : isConverted
              ? "Converted"
              : convertError
                ? "Failed ✗"
                : "Ready"}
        </span>
      </div>

      {/* Error */}
      {convertError && (
        <div className="text-base p-2 rounded" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--error)" }}>
          {convertError}
        </div>
      )}

      {/* Unsupported features */}
      {unsupportedFeatures.length > 0 && (
        <div className="text-base space-y-1">
          <div className="font-medium" style={{ color: "var(--warning)" }}>
            ⚠ Unsupported Features
          </div>
          <ul className="list-disc pl-4 space-y-0.5" style={{ color: "var(--text-muted)" }}>
            {unsupportedFeatures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CompilePanel({
  onCompile,
  isCompiling,
  isCompiled,
  compileError,
  approvalSize,
  clearSize,
  hasPyTeal,
  retryAttempt,
  maxRetries,
  compilationResult,
  arc32AppSpec,
  arc56Json,
  approvalTeal,
  clearTeal,
}: {
  onCompile: () => void;
  isCompiling: boolean;
  isCompiled: boolean;
  compileError: string | null;
  approvalSize: number;
  clearSize: number;
  hasPyTeal: boolean;
  retryAttempt: number;
  maxRetries: number;
  compilationResult: CompilationResult | null;
  arc32AppSpec: ARC32AppSpec | null;
  arc56Json: Record<string, unknown> | null;
  approvalTeal: string;
  clearTeal: string;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAppSpec, setShowAppSpec] = useState(false);
  const [activeSpecTab, setActiveSpecTab] = useState<"teal" | "arc32" | "info">("arc32");

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <PanelButton
        onClick={onCompile}
        disabled={!hasPyTeal || isCompiling}
        loading={isCompiling}
      >
        {isCompiling
          ? "Compiling..."
          : isCompiled
            ? "Compiled Successfully"
            : "Compile Contract"}
      </PanelButton>

      <div className="text-base" style={{ color: "var(--text-muted)" }}>
        Target: TEAL v10 / AVM via PuyaPy
      </div>

      {/* Retry progress */}
      {retryAttempt > 0 && isCompiling && (
        <div
          className="text-base p-2 rounded flex items-center gap-2"
          style={{ backgroundColor: "rgba(234,179,8,0.1)", color: "var(--warning)" }}
        >
          <span className="animate-spin">⟳</span>
          <span>AI fixing attempt {retryAttempt}/{maxRetries}...</span>
        </div>
      )}

      {/* Status */}
      <div className="text-base flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: isCompiled
              ? "var(--success)"
              : isCompiling
                ? "var(--accent)"
                : compileError
                  ? "var(--error)"
                  : "var(--text-muted)",
          }}
        />
        <span>
          {isCompiling
            ? retryAttempt > 0
              ? `Retrying (${retryAttempt}/${maxRetries})...`
              : "Compiling..."
            : isCompiled
              ? "Compiled"
              : compileError
                ? "Compilation Failed"
                : "Ready"}
        </span>
      </div>

      {/* ═══ SUCCESS BANNER ═══ */}
      {isCompiled && compilationResult && (
        <div className="p-2.5 rounded" style={{ backgroundColor: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold" style={{ color: "var(--success)" }}>
              Contract compiled successfully
            </span>
          </div>
          <div className="text-xs space-y-0.5" style={{ color: "var(--text-secondary)" }}>
            <div>Contract: <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{compilationResult.contractName}</span></div>
            <div>Approval program: <span className="font-mono">{compilationResult.approvalProgramSize.toLocaleString()} bytes</span></div>
            <div>Clear program: <span className="font-mono">{compilationResult.clearProgramSize.toLocaleString()} bytes</span></div>
            {arc32AppSpec && (
              <div>ARC-32 methods: <span className="font-mono">{arc32AppSpec.methods?.length ?? 0}</span></div>
            )}
          </div>
          {/* Compilation warnings */}
          {compilationResult.compilationWarnings.length > 0 && (
            <div className="mt-1.5 text-xs" style={{ color: "var(--warning)" }}>
              {compilationResult.compilationWarnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ TABS: TEAL / ARC-32 / Contract Info ═══ */}
      {isCompiled && compilationResult && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
          {/* Tab headers */}
          <div className="flex gap-0.5 mb-2">
            {(["teal", "arc32", "info"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveSpecTab(tab)}
                className="flex-1 py-1.5 px-1 rounded text-xs font-medium transition-all"
                style={{
                  backgroundColor: activeSpecTab === tab ? "var(--accent)" : "var(--bg-surface)",
                  color: activeSpecTab === tab ? "#fff" : "var(--text-muted)",
                }}
              >
                {tab === "teal" ? "TEAL" : tab === "arc32" ? "ARC-32" : "Info"}
              </button>
            ))}
          </div>

          {/* TAB 1: TEAL Output */}
          {activeSpecTab === "teal" && (
            <div className="space-y-2">
              {/* Approval TEAL */}
              <div className="flex items-center justify-between p-2 rounded" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-surface)" }}>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>📄 approval.teal</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleCopy(approvalTeal, "c-approval-copy")}
                    className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                    title="Copy"
                  >
                    {copiedId === "c-approval-copy" ? <Check size={12} style={{ color: "var(--success)" }} /> : <Copy size={12} style={{ color: "var(--text-muted)" }} />}
                  </button>
                  <button
                    onClick={() => handleDownloadFile(approvalTeal, "approval.teal")}
                    className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                    title="Download"
                  >
                    <Download size={12} style={{ color: "var(--text-muted)" }} />
                  </button>
                </div>
              </div>
              {/* Clear TEAL */}
              <div className="flex items-center justify-between p-2 rounded" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-surface)" }}>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>📄 clear.teal</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleCopy(clearTeal, "c-clear-copy")}
                    className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                    title="Copy"
                  >
                    {copiedId === "c-clear-copy" ? <Check size={12} style={{ color: "var(--success)" }} /> : <Copy size={12} style={{ color: "var(--text-muted)" }} />}
                  </button>
                  <button
                    onClick={() => handleDownloadFile(clearTeal, "clear.teal")}
                    className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                    title="Download"
                  >
                    <Download size={12} style={{ color: "var(--text-muted)" }} />
                  </button>
                </div>
              </div>
              {/* TEAL Preview */}
              <div className="p-2 rounded font-mono text-xs overflow-auto" style={{ backgroundColor: "var(--bg-terminal)", maxHeight: "200px", border: "1px solid var(--border)" }}>
                <pre style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                  {approvalTeal.slice(0, 1500)}{approvalTeal.length > 1500 ? "\n... (truncated)" : ""}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 2: ARC-32 JSON (REAL from Puya) */}
          {activeSpecTab === "arc32" && (
            <div className="space-y-2">
              {arc32AppSpec ? (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>
                      📋 arc32.json
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--accent-muted)", color: "var(--accent)" }}>
                      REAL from Puya
                    </span>
                  </div>

                  {/* Method signatures from real ARC-32 */}
                  {arc32AppSpec.methods?.length > 0 && (
                    <div className="p-1.5 rounded text-xs font-mono" style={{ backgroundColor: "var(--bg-terminal)", maxHeight: "120px", overflowY: "auto" }}>
                      {arc32AppSpec.methods.map((m, mi) => (
                        <div key={mi} className="py-0.5" style={{ color: "var(--text-secondary)" }}>
                          <span style={{ color: "var(--accent)" }}>{m.name}</span>
                          ({m.args?.map(a => `${a.name}: ${a.type}`).join(", ") ?? ""})
                          {m.returns?.type && m.returns.type !== "void" && <span> → {m.returns.type}</span>}
                          {m.readonly && <span style={{ color: "var(--info)" }}> [view]</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setShowAppSpec(!showAppSpec)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[rgba(0,212,170,0.08)]"
                      style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                    >
                      <Eye size={12} /> {showAppSpec ? "Hide" : "View"}
                    </button>
                    <button
                      onClick={() => handleCopy(JSON.stringify(arc32AppSpec, null, 2), "c-arc32-copy")}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[rgba(0,212,170,0.08)]"
                      style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                    >
                      {copiedId === "c-arc32-copy" ? <Check size={12} style={{ color: "var(--success)" }} /> : <Copy size={12} />}
                      {copiedId === "c-arc32-copy" ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => handleDownloadFile(JSON.stringify(arc32AppSpec, null, 2), "arc32.json")}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[rgba(0,212,170,0.08)]"
                      style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                    >
                      <Download size={12} /> ARC-32
                    </button>
                    {arc56Json && (
                      <button
                        onClick={() => handleDownloadFile(JSON.stringify(arc56Json, null, 2), "arc56.json")}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[rgba(0,212,170,0.08)]"
                        style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                      >
                        <Download size={12} /> ARC-56
                      </button>
                    )}
                  </div>

                  {/* Inline JSON viewer */}
                  {showAppSpec && (
                    <div className="mt-1 p-2 rounded font-mono text-xs overflow-auto" style={{ backgroundColor: "var(--bg-terminal)", maxHeight: "300px", border: "1px solid var(--border)" }}>
                      <pre style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {JSON.stringify(arc32AppSpec, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs p-2 rounded" style={{ backgroundColor: "var(--bg-surface)", color: "var(--text-muted)" }}>
                  No ARC-32 spec generated by Puya for this contract. The contract may not use ARC4Contract.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Contract Info */}
          {activeSpecTab === "info" && (
            <div className="space-y-2">
              <div className="text-xs space-y-1.5" style={{ color: "var(--text-secondary)" }}>
                <div className="flex justify-between">
                  <span>Contract Name</span>
                  <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{compilationResult.contractName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Approval Size</span>
                  <span className="font-mono">{compilationResult.approvalProgramSize.toLocaleString()} bytes</span>
                </div>
                <div className="flex justify-between">
                  <span>Clear Size</span>
                  <span className="font-mono">{compilationResult.clearProgramSize.toLocaleString()} bytes</span>
                </div>
                {arc32AppSpec?.state && (
                  <>
                    <div className="mt-1 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                      <span className="font-medium" style={{ color: "var(--accent)" }}>Global State</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Integers</span>
                      <span className="font-mono">{arc32AppSpec.state.global?.num_uints ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Byte slices</span>
                      <span className="font-mono">{arc32AppSpec.state.global?.num_byte_slices ?? 0}</span>
                    </div>
                    <div className="mt-1 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                      <span className="font-medium" style={{ color: "var(--accent)" }}>Local State</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Integers</span>
                      <span className="font-mono">{arc32AppSpec.state.local?.num_uints ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Byte slices</span>
                      <span className="font-mono">{arc32AppSpec.state.local?.num_byte_slices ?? 0}</span>
                    </div>
                  </>
                )}
                {arc32AppSpec?.methods && arc32AppSpec.methods.length > 0 && (
                  <>
                    <div className="mt-1 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                      <span className="font-medium" style={{ color: "var(--accent)" }}>Methods ({arc32AppSpec.methods.length})</span>
                    </div>
                    {arc32AppSpec.methods.map((m, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="font-mono" style={{ color: "var(--text-primary)" }}>{m.name}</span>
                        <span className="font-mono" style={{ color: "var(--text-muted)" }}>
                          {m.readonly ? "readonly" : "call"}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {compileError && (
        <div className="text-base p-2 rounded" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--error)" }}>
          {compileError}
        </div>
      )}
    </div>
  );
}

function DeployPanel({
  isWalletConnected,
  walletAddress,
  onConnectWallet,
  onDisconnectWallet,
  onDeploy,
  isDeploying,
  deployStage,
  deployError,
  txid,
  explorerUrl,
  network,
  onNetworkChange,
  isCompiled,
  arc32AppSpec,
  multiContractAnalysis,
  deployedContracts,
  approvalTeal,
  clearTeal,
  compilationResult,
  arc56Json,
  peraWallet,
  onLog,
  compiledContracts,
  selectedDeployContract,
  onSelectDeployContract,
}: {
  isWalletConnected: boolean;
  walletAddress: string | null;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onDeploy: (createArgs?: Record<string, string>, foreignAppIds?: number[]) => void;
  isDeploying: boolean;
  deployStage: string;
  deployError: string | null;
  txid: string;
  explorerUrl: string;
  network: string;
  onNetworkChange: (network: string) => void;
  isCompiled: boolean;
  arc32AppSpec: ARC32AppSpec | null;
  multiContractAnalysis: MultiContractAnalysis | null;
  deployedContracts: DeployedContract[];
  compiledContracts: { id: string; name: string }[];
  selectedDeployContract: string;
  onSelectDeployContract: (id: string) => void;
  approvalTeal: string;
  clearTeal: string;
  compilationResult: CompilationResult | null;
  arc56Json: Record<string, unknown> | null;
  peraWallet: PeraWalletConnect | null;
  onLog?: (type: "info" | "error" | "success" | "warning", message: string) => void;
}) {
  const truncatedAddr = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "";

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedContract, setExpandedContract] = useState<number | null>(null);
  const [createArgValues, setCreateArgValues] = useState<Record<string, string>>({});
  const [foreignAppIdValues, setForeignAppIdValues] = useState<Record<string, string>>({});

  // ── Detect create method args from ARC-32 hints ──
  const getCreateMethodArgs = (): { methodName: string; args: { name: string; type: string }[] } | null => {
    if (!arc32AppSpec) return null;

    const allMethods = arc32AppSpec.contract?.methods ?? arc32AppSpec.methods ?? [];
    const hints = arc32AppSpec.hints as Record<string, { call_config?: Record<string, string> }> | undefined;

    if (hints) {
      // PuyaPy ARC-32: hints keys are method signatures like "create(uint64)void"
      for (const [sig, hint] of Object.entries(hints)) {
        const cc = hint.call_config;
        if (!cc) continue;
        // Check if any action has CREATE
        const isCreate = Object.values(cc).some(v => v === "CREATE" || v === "ALL");
        if (isCreate) {
          // Extract method name from signature
          const methodName = sig.split("(")[0];
          // Find the matching method in methods array
          const method = allMethods.find(m => m.name === methodName);
          if (method && method.args.length > 0) {
            return { methodName: method.name, args: method.args.map(a => ({ name: a.name, type: a.type })) };
          }
        }
      }
    }

    // Fallback: look for a method named "create" or "initialize" with args
    for (const m of allMethods) {
      if ((m.name === "create" || m.name === "initialize") && m.args.length > 0) {
        return { methodName: m.name, args: m.args.map(a => ({ name: a.name, type: a.type })) };
      }
    }

    return null;
  };

  const createMethodInfo = getCreateMethodArgs();
  const hasCreateArgs = createMethodInfo !== null && createMethodInfo.args.length > 0;
  const allCreateArgsFilled = hasCreateArgs
    ? createMethodInfo.args.every(a => (createArgValues[a.name] ?? "").trim() !== "")
    : true;

  const updateCreateArg = (name: string, value: string) => {
    setCreateArgValues(prev => ({ ...prev, [name]: value }));
  };

  // ── Detect cross-contract dependencies for the selected deploy target ──
  const deployContractName = compiledContracts.find(c => c.id === selectedDeployContract)?.name || "";
  const contractDependencies: { contractName: string; relationshipType: string }[] = [];
  if (multiContractAnalysis && deployContractName) {
    for (const edge of multiContractAnalysis.inter_contract_edges) {
      if (edge.from_contract === deployContractName) {
        // This contract depends on another
        if (!contractDependencies.find(d => d.contractName === edge.to_contract)) {
          contractDependencies.push({ contractName: edge.to_contract, relationshipType: edge.relationship_type });
        }
      }
    }
  }

  // Check which dependencies are NOT already deployed
  const unresolvedDeps = contractDependencies.filter(
    dep => !deployedContracts.find(dc => dc.contractName === dep.contractName)
  );
  const resolvedDeps = contractDependencies.filter(
    dep => deployedContracts.find(dc => dc.contractName === dep.contractName)
  );

  // Collect foreign app IDs: from resolved deps (auto) + manual input
  const getForeignAppIds = (): number[] => {
    const ids: number[] = [];
    // Auto-include deployed dependency app IDs
    for (const dep of resolvedDeps) {
      const dc = deployedContracts.find(d => d.contractName === dep.contractName);
      if (dc) {
        const num = parseInt(dc.appId, 10);
        if (!isNaN(num) && !ids.includes(num)) ids.push(num);
      }
    }
    // Include manually entered app IDs for unresolved deps
    for (const dep of unresolvedDeps) {
      const val = foreignAppIdValues[dep.contractName]?.trim();
      if (val) {
        const num = parseInt(val, 10);
        if (!isNaN(num) && !ids.includes(num)) ids.push(num);
      }
    }
    return ids;
  };

  // All foreign app deps must be filled (either from deployed or manual input)
  const allDependenciesFilled = contractDependencies.every(dep => {
    const deployed = deployedContracts.find(dc => dc.contractName === dep.contractName);
    if (deployed) return true;
    const val = foreignAppIdValues[dep.contractName]?.trim();
    return val !== undefined && val !== "";
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generate integration snippet for a deployed contract
  const getIntegrationSnippet = (dc: DeployedContract) => {
    const networkStr = dc.network === "mainnet" ? "mainNet" : "testNet";

    // Extract methods from ARC-32 spec (contract.methods or top-level methods)
    const methods: ARC4Method[] =
      (dc.arc32Json?.contract?.methods as ARC4Method[] | undefined) ??
      dc.arc32Json?.methods ??
      [];

    const writeMethods = methods.filter((m) => !m.readonly);
    const readMethods = methods.filter((m) => m.readonly);

    let methodLines = "";

    if (writeMethods.length > 0) {
      methodLines += "\n// Write methods (costs fee):";
      for (const m of writeMethods) {
        const argsList = m.args.map((a) => `/* ${a.type} ${a.name} */`).join(", ");
        methodLines += `\nawait client.send.${m.name}({ args: [${argsList}] })`;
      }
    }

    if (readMethods.length > 0) {
      methodLines += "\n\n// Read methods (free):";
      for (const m of readMethods) {
        const argsList = m.args.map((a) => `/* ${a.type} ${a.name} */`).join(", ");
        methodLines += `\nconst ${m.name}Result = await client.send.${m.name}({ args: [${argsList}] })`;
        methodLines += `\nconsole.log('${m.name} result:', ${m.name}Result.return)`;
      }
    }

    if (!methodLines) {
      methodLines = "\n// Call your methods:\n// await client.send.yourMethod({ args: [] })";
    }

    return `import { AlgorandClient } from '@algorand/algokit-utils'
import contractABI from './arc32.json'

const algorand = AlgorandClient.${networkStr}()
const client = algorand.client.getAppClientById({
  appId: ${dc.appId}n,
  appSpec: contractABI,
})
${methodLines}`;
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Contract selector */}
      <div className="text-base font-medium" style={{ color: "var(--text-secondary)" }}>
        CONTRACT
      </div>
      {compiledContracts.length === 0 ? (
        <div
          className="text-xs p-2 rounded"
          style={{ backgroundColor: "var(--bg-surface)", color: "var(--text-muted)" }}
        >
          No compiled contracts yet. Compile a contract first.
        </div>
      ) : (
        <select
          value={selectedDeployContract}
          onChange={(e) => onSelectDeployContract(e.target.value)}
          className="w-full py-2 px-2.5 rounded text-sm font-medium cursor-pointer transition-all"
          style={{
            backgroundColor: "var(--bg-surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            outline: "none",
          }}
        >
          {compiledContracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      {/* Deploy target indicator (Phase 7) */}
      {selectedDeployContract && compilationResult && (
        <div className="p-2 rounded text-xs" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--text-muted)" }}>Deploy Target</span>
            <span className="font-semibold" style={{ color: "var(--accent)" }}>
              {compilationResult.contractName || selectedDeployContract.replace(".sol", "")}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span style={{ color: "var(--text-muted)" }}>Approval TEAL</span>
            <span className="font-mono" style={{ color: "var(--text-secondary)" }}>
              {compilationResult.approvalProgramSize.toLocaleString()} B
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span style={{ color: "var(--text-muted)" }}>ARC-4 Methods</span>
            <span className="font-mono" style={{ color: "var(--text-secondary)" }}>
              {arc32AppSpec?.methods?.length ?? 0}
            </span>
          </div>
        </div>
      )}

      {/* Network selector */}
      <div className="text-base font-medium mt-1" style={{ color: "var(--text-secondary)" }}>
        ENVIRONMENT
      </div>
      <div className="flex gap-1">
        {["testnet", "mainnet"].map((n) => (
          <button
            key={n}
            onClick={() => onNetworkChange(n)}
            className="flex-1 py-1.5 px-2 rounded text-base font-medium transition-all"
            style={{
              backgroundColor: network === n ? "var(--accent)" : "var(--bg-surface)",
              color: network === n ? "#fff" : "var(--text-muted)",
            }}
          >
            {n.charAt(0).toUpperCase() + n.slice(1)}
          </button>
        ))}
      </div>

      {/* Wallet */}
      <div className="text-base font-medium mt-1" style={{ color: "var(--text-secondary)" }}>
        ACCOUNT
      </div>
      {isWalletConnected ? (
        <div className="flex items-center justify-between p-2 rounded text-base" style={{ backgroundColor: "var(--bg-surface)" }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--success)" }} />
            <span className="font-mono" style={{ color: "var(--text-primary)" }}>{truncatedAddr}</span>
          </div>
          <button
            onClick={onDisconnectWallet}
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ color: "var(--error)", backgroundColor: "rgba(239,68,68,0.1)" }}
          >
            ✕
          </button>
        </div>
      ) : (
        <PanelButton onClick={onConnectWallet} variant="secondary">
          Connect Pera Wallet
        </PanelButton>
      )}

      {/* Create method parameters (Phase 4) */}
      {hasCreateArgs && selectedDeployContract && (() => {
        // Determine if any arg is an app reference (by type or name heuristic)
        const REFERENCE_TYPES = new Set(["application", "account", "asset"]);
        const isAppIdArg = (name: string, type?: string) => {
          if (type && REFERENCE_TYPES.has(type)) return true;
          const lower = name.toLowerCase();
          return lower.includes("app_id") || lower.includes("app_") || lower.endsWith("_app") || lower.endsWith("_id");
        };
        const hasAppIdArgs = createMethodInfo.args.some(a => isAppIdArg(a.name, a.type));
        const hasRegularArgs = createMethodInfo.args.some(a => !isAppIdArg(a.name, a.type));

        // Smart placeholder based on param name & type
        const getPlaceholder = (name: string, type: string) => {
          if (REFERENCE_TYPES.has(type)) return `Enter ${type === "application" ? "App ID" : type === "asset" ? "Asset ID" : "address"} of referenced ${type}`;
          const lower = name.toLowerCase();
          if (isAppIdArg(lower)) return "Paste App ID from deployed contract";
          if (lower.includes("supply") || lower.includes("total")) return "e.g. 1000000";
          if (lower.includes("amount") || lower.includes("price") || lower.includes("limit") || lower.includes("fee")) return "e.g. 1000";
          if (lower.includes("name") || lower.includes("symbol")) return "e.g. MyToken";
          if (lower.includes("decimals")) return "e.g. 6";
          if (type === "address") return "Enter Algorand address";
          if (type === "bool") return "true or false";
          if (type.startsWith("uint") || type.startsWith("int")) return "e.g. 1000000";
          return `Enter ${type} value`;
        };

        // Smart hint based on param name & type
        const getHint = (name: string, type?: string) => {
          if (type && REFERENCE_TYPES.has(type)) return `← ${type === "application" ? "App ID" : type === "asset" ? "Asset ID" : "Address"} (reference type — will be included in transaction)`;
          const lower = name.toLowerCase();
          if (isAppIdArg(lower)) return "← App ID of another deployed contract";
          if (lower.includes("supply")) return "← Initial token supply (pick any number)";
          if (lower.includes("amount")) return "← Amount value (pick any number)";
          if (lower.includes("price")) return "← Price value";
          return null;
        };

        return (
        <div className="flex flex-col gap-2">
          <div className="text-base font-medium" style={{ color: "var(--text-secondary)" }}>
            CREATE METHOD PARAMETERS
          </div>
          <div className="text-xs p-2 rounded" style={{ backgroundColor: "rgba(0,212,170,0.05)", color: "var(--text-muted)" }}>
            {hasAppIdArgs && hasRegularArgs
              ? "Fill in the values below. For app IDs, paste from a previously deployed contract. For other parameters, enter your desired values."
              : hasAppIdArgs
              ? "This contract depends on another contract. Paste the App ID from a previously deployed contract."
              : "This contract needs initial configuration values. Enter the values below — they are set once at deployment and cannot be changed later."
            }
          </div>

          {/* Previously deployed App IDs for quick reference (Phase 5) */}
          {deployedContracts.length > 0 && (
            <div className="p-2 rounded" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <div className="text-xs font-semibold tracking-wider uppercase mb-1.5" style={{ color: "var(--text-secondary)" }}>
                DEPLOYED APP IDs (click to copy)
              </div>
              <div className="flex flex-col gap-1">
                {deployedContracts.map((dc, i) => (
                  <div
                    key={`ref-${dc.txid}-${i}`}
                    onClick={() => handleCopy(dc.appId, `ref-appid-${i}`)}
                    className="flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                    style={{ backgroundColor: "var(--bg-terminal)" }}
                  >
                    <span className="text-xs" style={{ color: "var(--text-primary)" }}>
                      {dc.contractName || "Contract"}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-mono" style={{ color: "var(--accent)" }}>
                      {dc.appId}
                      {copiedId === `ref-appid-${i}` ? (
                        <Check size={10} style={{ color: "var(--success)" }} />
                      ) : (
                        <Copy size={10} style={{ color: "var(--text-muted)" }} />
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input fields for each create arg */}
          {createMethodInfo.args.map((arg) => {
            const hint = getHint(arg.name, arg.type);
            const appIdStyle = isAppIdArg(arg.name, arg.type);
            return (
            <div key={arg.name} className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                {arg.name} <span className="font-mono" style={{ color: "var(--text-muted)" }}>({arg.type})</span>
              </label>
              <input
                type="text"
                value={createArgValues[arg.name] ?? ""}
                onChange={(e) => updateCreateArg(arg.name, e.target.value)}
                placeholder={getPlaceholder(arg.name, arg.type)}
                className="w-full py-1.5 px-2.5 rounded text-sm font-mono transition-all"
                style={{
                  backgroundColor: "var(--bg-terminal)",
                  color: "var(--text-primary)",
                  border: appIdStyle ? "1px solid rgba(0,212,170,0.3)" : "1px solid var(--border)",
                  outline: "none",
                }}
                onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { e.target.style.borderColor = appIdStyle ? "rgba(0,212,170,0.3)" : "var(--border)"; }}
              />
              {hint && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{hint}</span>
              )}
            </div>
            );
          })}
        </div>
        );
      })()}

      {/* Cross-contract dependency App IDs */}
      {contractDependencies.length > 0 && selectedDeployContract && (
        <div className="flex flex-col gap-2">
          <div className="text-base font-medium" style={{ color: "var(--text-secondary)" }}>
            REFERENCED CONTRACT APP IDs
          </div>
          <div className="text-xs p-2 rounded" style={{ backgroundColor: "rgba(249,115,22,0.08)", color: "var(--text-muted)", border: "1px solid rgba(249,115,22,0.15)" }}>
            This contract references {contractDependencies.length === 1 ? "another contract" : `${contractDependencies.length} other contracts`}.
            {unresolvedDeps.length > 0 
              ? " Enter the App ID(s) of the deployed contract(s) below."
              : " App IDs will be included automatically from your deployed contracts."}
          </div>

          {contractDependencies.map((dep) => {
            const deployed = deployedContracts.find(dc => dc.contractName === dep.contractName);
            return (
              <div key={`dep-${dep.contractName}`} className="flex flex-col gap-1">
                <label className="text-xs font-medium flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                  {dep.contractName}
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                    ({dep.relationshipType})
                  </span>
                  {deployed && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,.15)", color: "#22C55E" }}>
                      ✓ Deployed
                    </span>
                  )}
                </label>
                {deployed ? (
                  <div
                    className="flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer"
                    style={{ backgroundColor: "rgba(34,197,94,.06)", border: "1px solid rgba(34,197,94,.2)" }}
                    onClick={() => handleCopy(deployed.appId, `dep-${dep.contractName}`)}
                  >
                    <span className="text-xs font-mono" style={{ color: "#22C55E" }}>
                      App ID: {deployed.appId}
                    </span>
                    {copiedId === `dep-${dep.contractName}` ? (
                      <Check size={10} style={{ color: "var(--success)" }} />
                    ) : (
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Auto-included</span>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={foreignAppIdValues[dep.contractName] ?? ""}
                    onChange={(e) => setForeignAppIdValues(prev => ({ ...prev, [dep.contractName]: e.target.value }))}
                    placeholder={`Enter ${dep.contractName} App ID`}
                    className="w-full py-1.5 px-2.5 rounded text-sm font-mono transition-all"
                    style={{
                      backgroundColor: "var(--bg-terminal)",
                      color: "var(--text-primary)",
                      border: "1px solid rgba(249,115,22,0.3)",
                      outline: "none",
                    }}
                    onFocus={(e) => { e.target.style.borderColor = "#F97316"; }}
                    onBlur={(e) => { e.target.style.borderColor = "rgba(249,115,22,0.3)"; }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Deploy button */}
      <PanelButton
        onClick={() => {
          const foreignIds = contractDependencies.length > 0 ? getForeignAppIds() : undefined;
          onDeploy(
            hasCreateArgs ? createArgValues : undefined,
            foreignIds && foreignIds.length > 0 ? foreignIds : undefined
          );
        }}
        disabled={compiledContracts.length === 0 || !selectedDeployContract || !isWalletConnected || isDeploying || !allCreateArgsFilled || !allDependenciesFilled}
        loading={isDeploying}
      >
        Deploy to {network === "testnet" ? "Testnet" : "Mainnet"} ▶
      </PanelButton>

      {/* Deploy stage */}
      {isDeploying && deployStage && (
        <div className="text-base animate-pulse-accent" style={{ color: "var(--accent)" }}>
          {deployStage}
        </div>
      )}

      {/* Deploy error */}
      {deployError && (
        <div className="text-base p-2 rounded" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--error)" }}>
          {deployError}
        </div>
      )}

      {network === "mainnet" && (
        <div className="text-base p-2 rounded" style={{ backgroundColor: "rgba(245,158,11,0.1)", color: "var(--warning)" }}>
          ⚠ Mainnet deploys use real ALGO tokens.
        </div>
      )}

      {/* ═══ DEPLOYED CONTRACTS WITH FULL POST-DEPLOY INFO ═══ */}
      {deployedContracts.length > 0 && (
        <div className="mt-2" style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
          <div className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: "var(--text-secondary)" }}>
            DEPLOYED CONTRACTS
          </div>
          <div className="flex flex-col gap-2">
            {deployedContracts.map((dc, i) => (
              <div
                key={`${dc.txid}-${i}`}
                className="rounded text-sm"
                style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between p-2 cursor-pointer"
                  onClick={() => setExpandedContract(expandedContract === i ? null : i)}
                >
                  <div className="flex items-center gap-2">
                    {expandedContract === i ? <ChevronDown size={14} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />}
                    <span className="text-sm font-semibold" style={{ color: "var(--success)" }}>
                      {dc.contractName || "Contract"}
                    </span>
                  </div>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{
                    backgroundColor: dc.network === "testnet" ? "var(--accent-muted)" : "rgba(245,158,11,0.1)",
                    color: dc.network === "testnet" ? "var(--accent)" : "var(--warning)",
                  }}>
                    {dc.network}
                  </span>
                </div>

                {/* Expanded details */}
                {(expandedContract === i || i === 0) && (
                  <div className="px-2 pb-2 space-y-1.5">
                    {/* App ID with copy + explorer link */}
                    <div className="flex items-center justify-between p-1.5 rounded" style={{ backgroundColor: "var(--bg-terminal)" }}>
                      <a
                        href={`https://${dc.network === "mainnet" ? "" : "testnet."}explorer.perawallet.app/application/${dc.appId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs hover:underline"
                        style={{ color: "var(--accent)" }}
                        title="View Application on Explorer"
                      >
                        App ID: {dc.appId} ↗
                      </a>
                      <button
                        onClick={() => handleCopy(dc.appId, `appid-${i}`)}
                        className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                        title="Copy App ID"
                      >
                        {copiedId === `appid-${i}` ? (
                          <Check size={12} style={{ color: "var(--success)" }} />
                        ) : (
                          <Copy size={12} style={{ color: "var(--text-muted)" }} />
                        )}
                      </button>
                    </div>

                    {/* App Address with copy + explorer link */}
                    {dc.appAddress && (
                      <div className="flex items-center justify-between p-1.5 rounded" style={{ backgroundColor: "var(--bg-terminal)" }}>
                        <a
                          href={`https://${dc.network === "mainnet" ? "" : "testnet."}explorer.perawallet.app/address/${dc.appAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs truncate mr-1 hover:underline"
                          style={{ color: "var(--text-secondary)" }}
                          title="View Contract Address on Explorer"
                        >
                          Addr: {dc.appAddress.slice(0, 10)}...{dc.appAddress.slice(-6)} ↗
                        </a>
                        <button
                          onClick={() => handleCopy(dc.appAddress, `addr-${i}`)}
                          className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                          title="Copy Address"
                        >
                          {copiedId === `addr-${i}` ? (
                            <Check size={12} style={{ color: "var(--success)" }} />
                          ) : (
                            <Copy size={12} style={{ color: "var(--text-muted)" }} />
                          )}
                        </button>
                      </div>
                    )}

                    {/* TX ID with copy + explorer link */}
                    <div className="flex items-center justify-between p-1.5 rounded" style={{ backgroundColor: "var(--bg-terminal)" }}>
                      <a
                        href={`https://${dc.network === "mainnet" ? "" : "testnet."}explorer.perawallet.app/tx/${dc.txid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs truncate mr-1 hover:underline"
                        style={{ color: "var(--text-secondary)" }}
                        title="View Deploy Transaction on Explorer"
                      >
                        TX: {dc.txid.slice(0, 16)}... ↗
                      </a>
                      <button
                        onClick={() => handleCopy(dc.txid, `txid-${i}`)}
                        className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)] transition-colors"
                        title="Copy TX ID"
                      >
                        {copiedId === `txid-${i}` ? (
                          <Check size={12} style={{ color: "var(--success)" }} />
                        ) : (
                          <Copy size={12} style={{ color: "var(--text-muted)" }} />
                        )}
                      </button>
                    </div>

                    {/* Explorer link — deployment transaction */}
                    <a
                      href={`https://${dc.network === "mainnet" ? "" : "testnet."}explorer.perawallet.app/tx/${dc.txid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs underline"
                      style={{ color: "var(--accent)" }}
                    >
                      View Block Explorer →
                    </a>

                    {/* Downloads section */}
                    <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                      <div className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                        Downloads
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {dc.arc32Json && (
                          <button
                            onClick={() => handleDownloadFile(JSON.stringify(dc.arc32Json, null, 2), "arc32.json")}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-[rgba(0,212,170,0.08)]"
                            style={{ border: "1px solid var(--border)", color: "var(--accent)" }}
                          >
                            <Download size={10} /> ARC-32
                          </button>
                        )}
                        {dc.arc56Json && (
                          <button
                            onClick={() => handleDownloadFile(JSON.stringify(dc.arc56Json, null, 2), "arc56.json")}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-[rgba(0,212,170,0.08)]"
                            style={{ border: "1px solid var(--border)", color: "var(--accent)" }}
                          >
                            <Download size={10} /> ARC-56
                          </button>
                        )}
                        {approvalTeal && (
                          <button
                            onClick={() => handleDownloadFile(approvalTeal, "approval.teal")}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-[rgba(0,212,170,0.08)]"
                            style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                          >
                            <Download size={10} /> approval.teal
                          </button>
                        )}
                        {clearTeal && (
                          <button
                            onClick={() => handleDownloadFile(clearTeal, "clear.teal")}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-[rgba(0,212,170,0.08)]"
                            style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                          >
                            <Download size={10} /> clear.teal
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Integration snippet */}
                    <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                          Integration Snippet
                        </span>
                        <button
                          onClick={() => handleCopy(getIntegrationSnippet(dc), `snippet-${i}`)}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs hover:bg-[rgba(0,212,170,0.08)]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {copiedId === `snippet-${i}` ? (
                            <><Check size={10} style={{ color: "var(--success)" }} /> Copied</>
                          ) : (
                            <><Copy size={10} /> Copy</>
                          )}
                        </button>
                      </div>
                      <div className="p-2 rounded font-mono text-xs overflow-auto" style={{ backgroundColor: "var(--bg-terminal)", maxHeight: "160px", border: "1px solid var(--border)" }}>
                        <pre style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                          {getIntegrationSnippet(dc)}
                        </pre>
                      </div>
                    </div>

                    {/* ═══ CONTRACT INTERACTION ═══ */}
                    {isWalletConnected && walletAddress && peraWallet && (
                      <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                        <ContractInteraction
                          contract={dc}
                          walletAddress={walletAddress}
                          peraWallet={peraWallet}
                          network={dc.network}
                          onLog={onLog}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ network }: { network: string }) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone/.test(navigator.userAgent);
  const mod = isMac ? "⌘" : "Ctrl";

  const shortcuts = [
    { keys: `${mod} + Enter`, desc: "Next action" },
    { keys: `${mod} + \``, desc: "Toggle terminal" },
    { keys: `${mod} + Shift + C`, desc: "Copy code" },
    { keys: `${mod} + Shift + V`, desc: "Toggle visualizer" },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-base space-y-2" style={{ color: "var(--text-muted)" }}>
        <div className="flex justify-between">
          <span>Network</span>
          <span style={{ color: "var(--text-secondary)" }}>{network}</span>
        </div>
        <div className="flex justify-between">
          <span>TEAL Version</span>
          <span style={{ color: "var(--text-secondary)" }}>v10</span>
        </div>
        <div className="flex justify-between">
          <span>AI Model</span>
          <span style={{ color: "var(--text-secondary)" }}>Gemini 2.0 Flash</span>
        </div>
        <div className="flex justify-between">
          <span>Max Retries</span>
          <span style={{ color: "var(--text-secondary)" }}>3</span>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="mt-2" style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
        <div className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: "var(--text-secondary)" }}>
          Keyboard Shortcuts
        </div>
        <div className="text-base space-y-1.5">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex justify-between items-center">
              <span style={{ color: "var(--text-muted)" }}>{s.desc}</span>
              <kbd
                className="px-1.5 py-0.5 rounded text-xs font-mono"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      {/* Built with Algorand */}
      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div
          className="flex items-center justify-center gap-2 py-2 px-3 rounded text-base"
          style={{
            backgroundColor: "var(--accent-muted)",
            color: "var(--accent)",
          }}
        >
          <span>⬡</span>
          <span className="font-medium">Built with Algorand</span>
        </div>
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 mt-2 text-xs underline"
          style={{ color: "var(--text-muted)" }}
        >
          View on GitHub →
        </a>
      </div>

      <div className="text-xs mt-2 text-center" style={{ color: "var(--text-muted)" }}>
        AlgoMint v1.0.0
      </div>
    </div>
  );
}

// ── Main SidePanel component ── //

const PANEL_TITLES: Record<PanelId, string> = {
  editor: "EXPLORER",
  convert: "SOLIDITY → ALGORAND PYTHON",
  compile: "PUYA COMPILER",
  deploy: "DEPLOY & RUN",
  settings: "SETTINGS",
};

export default function SidePanel(props: SidePanelProps) {
  const { activePanel } = props;

  const isOpen = activePanel !== null;

  return (
    <div
      className="flex flex-col h-full overflow-hidden ide-border-right side-panel-animated"
      style={{
        width: isOpen ? "100%" : "0px",
        minWidth: isOpen ? "100%" : "0px",
        backgroundColor: "var(--bg-side-panel)",
        opacity: isOpen ? 1 : 0,
      }}
    >
      {isOpen && (
        <>
          <PanelHeader title={PANEL_TITLES[activePanel]}>
            {activePanel === "editor" && (
              <>
                <button onClick={() => props.onCreateFile()} className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)]" style={{ color: "var(--text-secondary)" }} title="New File...">
                  <FilePlus size={14} />
                </button>
                <button onClick={() => props.onCreateFolder()} className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)]" style={{ color: "var(--text-secondary)" }} title="New Folder...">
                  <FolderPlus size={14} />
                </button>
                <button className="p-1 rounded hover:bg-[rgba(0,212,170,0.08)]" style={{ color: "var(--text-secondary)" }} title="Refresh Explorer">
                  <RefreshCw size={14} />
                </button>
              </>
            )}
          </PanelHeader>

          <div className="flex-1 overflow-y-auto">
            {activePanel === "editor" && (
              <EditorPanel
                files={props.files}
                onCreateFile={props.onCreateFile}
                onCreateFolder={props.onCreateFolder}
                onOpenFile={props.onOpenFile}
                onDeleteFile={props.onDeleteFile}
                contractFiles={props.contractFiles}
                deployedContracts={props.deployedContracts}
              />
            )}
            {activePanel === "convert" && (
              <ConvertPanel
                onConvert={props.onConvert}
                isConverting={props.isConverting}
                isConverted={props.isConverted}
                convertError={props.convertError}
                unsupportedFeatures={props.unsupportedFeatures}
                solidityCode={props.solidityCode}
              />
            )}
            {activePanel === "compile" && (
              <CompilePanel
                onCompile={props.onCompile}
                isCompiling={props.isCompiling}
                isCompiled={props.isCompiled}
                compileError={props.compileError}
                approvalSize={props.approvalSize}
                clearSize={props.clearSize}
                hasPyTeal={props.isConverted}
                retryAttempt={props.retryAttempt}
                maxRetries={props.maxRetries}
                compilationResult={props.compilationResult}
                arc56Json={props.arc56Json}
                arc32AppSpec={props.arc32AppSpec}
                approvalTeal={props.approvalTeal}
                clearTeal={props.clearTeal}
              />
            )}
            {activePanel === "deploy" && (
              <DeployPanel
                isWalletConnected={props.isWalletConnected}
                walletAddress={props.walletAddress}
                onConnectWallet={props.onConnectWallet}
                onDisconnectWallet={props.onDisconnectWallet}
                onDeploy={props.onDeploy}
                isDeploying={props.isDeploying}
                deployStage={props.deployStage}
                deployError={props.deployError}
                txid={props.txid}
                explorerUrl={props.explorerUrl}
                network={props.network}
                onNetworkChange={props.onNetworkChange}
                isCompiled={props.isCompiled}
                arc32AppSpec={props.arc32AppSpec}
                multiContractAnalysis={props.multiContractAnalysis}
                deployedContracts={props.deployedContracts}
                approvalTeal={props.approvalTeal}
                clearTeal={props.clearTeal}
                compilationResult={props.compilationResult}
                arc56Json={props.arc56Json}
                peraWallet={props.peraWallet}
                onLog={props.onLog}
                compiledContracts={props.compiledContracts}
                selectedDeployContract={props.selectedDeployContract}
                onSelectDeployContract={props.onSelectDeployContract}
              />
            )}
            {activePanel === "settings" && (
              <SettingsPanel network={props.network} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
