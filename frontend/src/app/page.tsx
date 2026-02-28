"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import IconSidebar, { type PanelId } from "@/components/IDE/IconSidebar";
import SidePanel from "@/components/IDE/SidePanel";
import TabBar, { type EditorTab } from "@/components/IDE/TabBar";
import TerminalPanel from "@/components/IDE/TerminalPanel";
import StatusBar from "@/components/IDE/StatusBar";
import SolidityEditor from "@/components/Editor/SolidityEditor";
import ConvertedCodeViewer from "@/components/Viewer/ConvertedCodeViewer";
import WarningsPanel from "@/components/WarningsPanel";
import ASTViewer from "@/components/ASTViewer";
import ChatPanel from "@/components/Chat/ChatPanel";
import type { ChatContext } from "@/types";
import type { ARC32AppSpec, DeployedContract, CompilationResult } from "@/types";
import { convertSolidity, compileAlgorandPython, deployPrepare, deploySubmit, fixAlgorandPython } from "@/lib/api";
import { parseSolidity } from "@/utils/solidityParser";
import { enrichAST, buildASTPromptSection } from "@/utils/astEnricher";
import type { EnrichedContract, ASTWarning } from "@/utils/astEnricher";
import { useWallet } from "@/hooks/useWallet";
import algosdk from "algosdk";
import { Buffer } from "buffer";
import type { ConsoleLog, StateSchema } from "@/types";

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  content?: string;
  parentId: string | null;
  isOpen?: boolean; // For folders
}

// ─── Default tab ─── //
const DEFAULT_TAB: EditorTab = {
  id: "contract.sol",
  label: "contract.sol",
  language: "sol",
  closable: false,
  icon: "◆",
};

export default function Home() {
  // ── Wallet (from context) ── //
  const {
    walletAddress,
    isConnected: isWalletConnected,
    isConnecting: isWalletConnecting,
    error: walletError,
    connect: walletConnect,
    disconnect: walletDisconnect,
    peraWallet,
  } = useWallet();

  // ── Sidebar state ── //
  const [activePanel, setActivePanel] = useState<PanelId | null>("editor");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // ── Tabs ── //
  const [tabs, setTabs] = useState<EditorTab[]>([DEFAULT_TAB]);
  const [activeTabId, setActiveTabId] = useState("contract.sol");

  // ── File System state ── //
  const [files, setFiles] = useState<FileNode[]>([
    {
      id: "contract.sol",
      name: "contract.sol",
      type: "file",
      content: "",
      parentId: null,
    }
  ]);

  // Always get the Solidity source from the contract.sol file node,
  // regardless of which tab is active. This ensures convert/fix flows have the
  // original Solidity even when the user is viewing converted.algo.py or TEAL.
  const solidityFileNode = files.find(f => f.id === "contract.sol");
  const solidityCode = solidityFileNode?.content || "";

  // Active tab node (for editor display purposes)
  const activeFileNode = files.find(f => f.id === activeTabId);

  // ── Editor state ── //
  const [algorandPythonCode, setAlgorandPythonCode] = useState("");
  const [approvalTeal, setApprovalTeal] = useState("");
  const [clearTeal, setClearTeal] = useState("");

  // ── Terminal ── //
  const [logs, setLogs] = useState<ConsoleLog[]>([]);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);

  // ── Workflow state ── //
  const [currentStep, setCurrentStep] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [isConverted, setIsConverted] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [unsupportedFeatures, setUnsupportedFeatures] = useState<string[]>([]);
  const [astWarnings, setAstWarnings] = useState<ASTWarning[]>([]);
  const [enrichedAST, setEnrichedAST] = useState<EnrichedContract | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isCompiled, setIsCompiled] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [maxRetries] = useState(3);

  // ── Deploy ── //
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStage, setDeployStage] = useState("");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [txid, setTxid] = useState("");
  const [explorerUrl, setExplorerUrl] = useState("");
  const [network, setNetwork] = useState("testnet");
  const [stateSchema, setStateSchema] = useState<StateSchema | null>(null);

  // ── ARC-32 App Spec (from Puya compilation — REAL data) ── //
  const [arc32AppSpec, setArc32AppSpec] = useState<ARC32AppSpec | null>(null);
  const [arc56Json, setArc56Json] = useState<Record<string, unknown> | null>(null);

  // ── Full compilation result ── //
  const [compilationResult, setCompilationResult] = useState<CompilationResult | null>(null);

  // ── Deployed contracts history ── //
  const [deployedContracts, setDeployedContracts] = useState<DeployedContract[]>([]);

  // ── Cursor / responsive ── //
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [isMobile, setIsMobile] = useState(false);

  // ── Chat ── //
  const [isChatOpen, setIsChatOpen] = useState(false);

  // ── Resizable panels ── //
  const [sidePanelWidth, setSidePanelWidth] = useState(320);
  const [chatPanelWidth, setChatPanelWidth] = useState(350);
  const [isDraggingSide, setIsDraggingSide] = useState(false);
  const [isDraggingChat, setIsDraggingChat] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSide) {
        const iconBarW = 52;
        const newWidth = e.clientX - iconBarW;
        if (newWidth >= 200 && newWidth <= 500) setSidePanelWidth(newWidth);
      }
      if (isDraggingChat) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= 250 && newWidth <= 600) setChatPanelWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsDraggingSide(false);
      setIsDraggingChat(false);
    };
    if (isDraggingSide || isDraggingChat) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDraggingSide, isDraggingChat]);

  // ── Helper: Add log ── //
  const addLog = useCallback(
    (type: ConsoleLog["type"], message: string, details?: string) => {
      setLogs((prev) => [
        ...prev.slice(-199),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type,
          message,
          timestamp: new Date(),
          ...(details ? { details } : {}),
        },
      ]);
    },
    []
  );

  // ── Helper: ensure a tab exists ── //
  const ensureTab = useCallback(
    (tab: EditorTab) => {
      setTabs((prev) => {
        if (prev.find((t) => t.id === tab.id)) return prev;
        return [...prev, tab];
      });
      setActiveTabId(tab.id);
    },
    []
  );

  // ── Track wallet connection changes ── //
  const prevWalletConnected = useRef(isWalletConnected);
  useEffect(() => {
    if (isWalletConnected && !prevWalletConnected.current && walletAddress) {
      const truncated = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
      setCurrentStep((s) => Math.max(s, 3));
      addLog("success", `Wallet connected: ${truncated}`);
    } else if (!isWalletConnected && prevWalletConnected.current) {
      addLog("info", "Wallet disconnected.");
    }
    prevWalletConnected.current = isWalletConnected;
  }, [isWalletConnected, walletAddress, addLog]);

  // ── Responsive check ── //
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Keyboard shortcuts ── //
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + Enter → trigger next action
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (currentStep === 0 && solidityCode.trim()) handleConvert();
        else if (currentStep === 2 && algorandPythonCode.trim()) handleCompile();
        else if (currentStep === 3 && !isWalletConnected) handleConnectWallet();
        else if (currentStep >= 3 && isWalletConnected && approvalTeal) handleDeploy();
      }

      // Cmd/Ctrl + ` → toggle terminal
      if (mod && e.key === "`") {
        e.preventDefault();
        setTerminalCollapsed((p) => !p);
      }

      // Cmd/Ctrl + B → toggle sidebar
      if (mod && e.key === "b") {
        e.preventDefault();
        setIsSidebarOpen((p) => !p);
      }

      // Cmd/Ctrl + J → toggle chat
      if (mod && e.key === "j") {
        e.preventDefault();
        setIsChatOpen((p) => !p);
      }

      // Cmd/Ctrl + Shift + C → copy active viewer code
      if (mod && e.shiftKey && e.key === "C") {
        e.preventDefault();
        const codeToCopy =
          activeTabId === "contract.sol" ? solidityCode
            : activeTabId === "converted.algo.py" ? algorandPythonCode
              : activeTabId === "approval.teal" ? approvalTeal
                : activeTabId === "clear.teal" ? clearTeal
                  : "";
        if (codeToCopy) {
          navigator.clipboard.writeText(codeToCopy).then(() => {
            addLog("info", "Code copied to clipboard.");
          });
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, solidityCode, algorandPythonCode, approvalTeal, clearTeal, isWalletConnected, activeTabId]);

  // ── File System Actions ── //
  const handleCreateFile = () => {
    const name = window.prompt("Enter new file name:", "new_contract.sol");
    if (!name) return;
    if (files.some(f => f.name === name && f.parentId === null)) {
      addLog("warning", "File already exists.");
      return;
    }
    const newFile: FileNode = {
      id: name,
      name,
      type: "file",
      content: "",
      parentId: null,
    };
    setFiles(prev => [...prev, newFile]);
    ensureTab({
      id: newFile.id,
      label: newFile.name,
      language: newFile.name.endsWith(".py") ? "python" : "sol",
      closable: true,
      icon: "📄",
    });
    addLog("success", `Created file ${name}`);
  };

  const handleCreateFolder = () => {
    const name = window.prompt("Enter new folder name:", "src");
    if (!name) return;
    if (files.some(f => f.name === name && f.parentId === null)) {
      addLog("warning", "Folder already exists.");
      return;
    }
    const newFolder: FileNode = {
      id: name,
      name,
      type: "folder",
      parentId: null,
      isOpen: true,
    };
    setFiles(prev => [...prev, newFolder]);
    addLog("success", `Created folder ${name}`);
  };

  const handleDeleteFile = (id: string) => {
    // 1. Remove from files
    setFiles(prev => prev.filter(f => f.id !== id));

    // 2. Remove from tabs if open
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== id);
      // 3. Fallback active tab if we just closed it
      if (activeTabId === id) {
        if (remaining.length > 0) {
          setActiveTabId(remaining[remaining.length - 1].id);
        } else {
          setActiveTabId("");
        }
      }
      return remaining;
    });

    addLog("info", `Deleted item: ${id}`);
  };

  // ── Actions ── //
  const handleConvert = async () => {
    if (!solidityCode.trim()) {
      addLog("warning", "No Solidity code to convert. Paste or load a contract first.");
      return;
    }

    setIsConverting(true);
    setConvertError(null);
    setUnsupportedFeatures([]);
    setAstWarnings([]);
    setEnrichedAST(null);
    addLog("info", "Starting AI conversion -- Solidity -> Algorand Python...");

    // ── Step 1: Parse & enrich AST (frontend-side, graceful fallback) ──
    let astAnalysis: string | undefined;
    try {
      const parseResult = parseSolidity(solidityCode);
      if ("error" in parseResult) {
        addLog("warning", `AST parse skipped: ${parseResult.reason}`);
      } else {
        const enriched = enrichAST(parseResult, solidityCode);
        setEnrichedAST(enriched);
        setAstWarnings(enriched.warnings);
        astAnalysis = buildASTPromptSection(enriched);

        const warnCount = enriched.warnings.length;
        addLog(
          "info",
          `AST analysis complete: ${enriched.functions.length} functions, ` +
            `${enriched.stateVariables.length} state vars, ` +
            `${enriched.events.length} events` +
            (warnCount > 0 ? `, ${warnCount} warnings` : "")
        );
      }
    } catch (astErr) {
      addLog("warning", "AST parsing failed -- falling back to raw Solidity.");
    }

    // ── Step 2: Call Gemini with optional AST enrichment ──
    try {
      const response = await convertSolidity(solidityCode, astAnalysis);

      setAlgorandPythonCode(response.algorand_python_code);
      setStateSchema(response.state_schema);
      setUnsupportedFeatures(response.unsupported_features ?? []);
      setIsConverted(true);
      setCurrentStep(2);

      // Reset compilation state when new conversion happens
      setCompilationResult(null);
      setArc32AppSpec(null);
      setArc56Json(null);
      setIsCompiled(false);
      setApprovalTeal("");
      setClearTeal("");

      ensureTab({
        id: "converted.algo.py",
        label: "converted.algo.py",
        language: "python",
        closable: true,
        icon: "🐍",
      });

      const lineCount = response.algorand_python_code.split("\n").length;
      addLog("success", `Conversion complete (${lineCount} lines Algorand Python).`);

      if (response.unsupported_features?.length) {
        addLog(
          "warning",
          `Unsupported features detected: ${response.unsupported_features.join(", ")}`
        );
      }

      if (response.state_schema) {
        const s = response.state_schema;
        addLog(
          "info",
          `State schema — Global: ${s.global_ints} ints, ${s.global_bytes} bytes | Local: ${s.local_ints} ints, ${s.local_bytes} bytes`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setConvertError(message);
      addLog("error", `Conversion failed: ${message}`);
    } finally {
      setIsConverting(false);
    }
  };

  const handleCompile = async () => {
    if (!algorandPythonCode.trim()) {
      addLog("warning", "No Algorand Python code to compile. Convert a Solidity contract first.");
      return;
    }

    setIsCompiling(true);
    setCompileError(null);
    setRetryAttempt(0);
    addLog("info", "Compiling Algorand Python to TEAL via PuyaPy...");

    let currentCode = algorandPythonCode;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await compileAlgorandPython(currentCode);

        setApprovalTeal(response.approval_teal);
        setClearTeal(response.clear_teal);
        setIsCompiled(true);
        setCurrentStep(3);

        // Store the REAL ARC-32 & ARC-56 from Puya compiler
        if (response.arc32_json) {
          // Normalize: PuyaPy puts methods in contract.methods, not top-level
          const rawSpec = response.arc32_json as ARC32AppSpec;
          const normalizedSpec: ARC32AppSpec = {
            ...rawSpec,
            name: rawSpec.name || rawSpec.contract?.name || "Contract",
            methods: rawSpec.methods?.length
              ? rawSpec.methods
              : (rawSpec.contract?.methods ?? []),
          };
          setArc32AppSpec(normalizedSpec);
          const methodCount = normalizedSpec.methods?.length ?? 0;
          addLog("success", `ARC-32 app spec from Puya: ${methodCount} methods`);

          ensureTab({
            id: "application.json",
            label: "application.json",
            language: "json",
            closable: true,
            icon: "📋",
          });
        }
        if (response.arc56_json) {
          setArc56Json(response.arc56_json);
          addLog("info", "ARC-56 app spec generated by Puya.");
        }

        // Store full compilation result (use normalized spec)
        const normalizedArc32 = response.arc32_json ? (() => {
          const raw = response.arc32_json as ARC32AppSpec;
          return {
            ...raw,
            name: raw.name || raw.contract?.name || "Contract",
            methods: raw.methods?.length ? raw.methods : (raw.contract?.methods ?? []),
          } as ARC32AppSpec;
        })() : null;

        const compResult: CompilationResult = {
          success: true,
          contractName: response.contract_name || "Contract",
          approvalTeal: response.approval_teal,
          clearTeal: response.clear_teal,
          arc32Json: normalizedArc32,
          arc56Json: response.arc56_json || null,
          approvalProgramSize: response.approval_program_size || response.approval_teal.length,
          clearProgramSize: response.clear_program_size || response.clear_teal.length,
          compilationWarnings: response.compilation_warnings || [],
        };
        setCompilationResult(compResult);

        // Update state schema from ARC-32 if available
        if (response.arc32_json) {
          const spec = response.arc32_json as ARC32AppSpec;
          if (spec.state) {
            setStateSchema({
              global_ints: spec.state.global?.num_uints ?? 0,
              global_bytes: spec.state.global?.num_byte_slices ?? 0,
              local_ints: spec.state.local?.num_uints ?? 0,
              local_bytes: spec.state.local?.num_byte_slices ?? 0,
            });
          }
        }

        ensureTab({
          id: "approval.teal",
          label: "approval.teal",
          language: "plaintext",
          closable: true,
          icon: "📄",
        });
        ensureTab({
          id: "clear.teal",
          label: "clear.teal",
          language: "plaintext",
          closable: true,
          icon: "📄",
        });

        if (attempt > 0) {
          addLog("success", `AI fix successful on attempt ${attempt}/${maxRetries}.`);
        }

        addLog(
          "success",
          `Compilation successful — approval.teal (${response.approval_teal.length} bytes), clear.teal (${response.clear_teal.length} bytes).`
        );

        if (response.approval_teal.startsWith("#pragma version")) {
          addLog("info", `TEAL target: ${response.approval_teal.split("\n")[0]}`);
        }

        setIsCompiling(false);
        setRetryAttempt(0);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";

        if (attempt < maxRetries) {
          // Retry with AI fix
          const retryNum = attempt + 1;
          setRetryAttempt(retryNum);
          addLog(
            "warning",
            `Compilation failed. Attempting AI fix (${retryNum}/${maxRetries})...`,
            message
          );

          try {
            // Strip ANSI escape codes from PuyaPy's colored output
            let cleanError = message.replace(/\x1b\[[0-9;]*m/g, "");
            // Truncate error message to avoid 422 from backend validation
            if (cleanError.length > 10000) {
              cleanError = cleanError.slice(0, 10000) + "\n... (truncated)";
            }
            const fixResponse = await fixAlgorandPython({
              solidity_code: solidityCode,
              algorand_python_code: currentCode,
              error_message: cleanError,
            });

            currentCode = fixResponse.algorand_python_code;
            setAlgorandPythonCode(currentCode);

            if (fixResponse.state_schema) {
              setStateSchema(fixResponse.state_schema);
            }

            addLog("info", `Received AI-fixed Algorand Python (attempt ${retryNum}). Recompiling...`);
          } catch (fixErr) {
            const fixMsg = fixErr instanceof Error ? fixErr.message : "AI fix failed";
            addLog("error", `AI fix request failed: ${fixMsg}`);
            setCompileError(fixMsg);
            setIsCompiling(false);
            setRetryAttempt(0);
            return;
          }
        } else {
          // All retries exhausted
          setCompileError(message);
          addLog(
            "error",
            attempt > 0
              ? `Compilation failed after ${maxRetries} AI fix attempts.`
              : `Compilation error: ${message}`,
            message
          );
          setIsCompiling(false);
          setRetryAttempt(0);
          return;
        }
      }
    }

    setIsCompiling(false);
    setRetryAttempt(0);
  };

  const handleConnectWallet = async () => {
    addLog("info", "Opening Pera Wallet connection...");
    try {
      await walletConnect();
      // Success logging handled by useEffect above
    } catch {
      addLog("error", walletError || "Wallet connection failed.");
    }
  };

  const handleDisconnectWallet = () => {
    walletDisconnect();
    // Disconnect logging handled by useEffect above
  };

  const handleDeploy = async () => {
    if (!approvalTeal || !clearTeal) {
      addLog("warning", "No compiled TEAL to deploy. Compile first.");
      return;
    }
    if (!walletAddress || !peraWallet) {
      addLog("warning", "Connect your Pera Wallet before deploying.");
      return;
    }

    // Use state schema from ARC-32 (real Puya data) or fallback to convert-time schema
    const deploySchema = stateSchema || {
      global_ints: 0, global_bytes: 0, local_ints: 0, local_bytes: 0,
    };

    setIsDeploying(true);
    setDeployError(null);
    setTxid("");
    setExplorerUrl("");

    try {
      // ── Stage 1: Prepare unsigned transaction ──
      setDeployStage("Preparing transaction...");
      addLog("info", "Preparing deployment transaction...");

      const prepareRes = await deployPrepare({
        approvalTeal,
        clearTeal,
        stateSchema: deploySchema,
        sender: walletAddress,
        network,
      });

      // ── Stage 2: Build transaction locally with JS algosdk ──
      setDeployStage("Building transaction...");

      // Decode compiled programs from base64 — use Buffer for reliable binary decoding
      const approvalProgram = new Uint8Array(Buffer.from(prepareRes.approval_compiled, "base64"));
      const clearProgram = new Uint8Array(Buffer.from(prepareRes.clear_compiled, "base64"));

      // Build suggested params object for algosdk v3
      const sp = prepareRes.suggested_params;
      const genesisHashBytes = new Uint8Array(Buffer.from(sp.genesis_hash, "base64"));
      const suggestedParams: algosdk.SuggestedParams = {
        fee: sp.fee ?? 0,
        firstValid: sp.first_round,
        lastValid: sp.last_round,
        genesisHash: genesisHashBytes,
        genesisID: sp.genesis_id,
        flatFee: sp.flat_fee ?? false,
        minFee: sp.min_fee ?? 1000,
      };

      // Build the unsigned ApplicationCreateTxn using JS algosdk
      const extraPages = prepareRes.extra_pages ?? 0;
      if (extraPages > 0) {
        addLog("info", `Program needs ${extraPages} extra page(s) (larger contract).`);
      }
      const txnObj = algosdk.makeApplicationCreateTxnFromObject({
        sender: walletAddress,
        suggestedParams,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        approvalProgram,
        clearProgram,
        numGlobalInts: deploySchema.global_ints,
        numGlobalByteSlices: deploySchema.global_bytes,
        numLocalInts: deploySchema.local_ints,
        numLocalByteSlices: deploySchema.local_bytes,
        extraPages,
      });

      // ── Stage 3: Sign with Pera Wallet ──
      setDeployStage("Please sign in your wallet...");
      addLog("info", "Awaiting wallet signature...");

      // Sign with Pera Wallet
      const signedTxns = await peraWallet.signTransaction([
        [{ txn: txnObj }],
      ]);

      if (!signedTxns || signedTxns.length === 0) {
        throw new Error("No signed transaction returned from wallet.");
      }

      // Encode signed transaction bytes to base64 — Buffer handles large arrays reliably
      const signedTxnBytes = signedTxns[0] instanceof Uint8Array
        ? signedTxns[0]
        : new Uint8Array(signedTxns[0] as ArrayLike<number>);
      const signedTxnBase64 = Buffer.from(signedTxnBytes).toString("base64");

      // ── Stage 4: Submit to Algorand ──
      setDeployStage("Submitting to Algorand...");
      addLog("info", `Submitting to Algorand ${network === "mainnet" ? "Mainnet" : "Testnet"}...`);

      const submitRes = await deploySubmit({
        signedTxn: signedTxnBase64,
        network,
      });

      // ── Stage 4: Confirmed ──
      setTxid(submitRes.txid);
      setExplorerUrl(submitRes.explorer_url);
      setDeployStage("");
      setCurrentStep(4);

      // Use the real App ID returned by the backend
      const appId = String(submitRes.app_id || 0);

      // Derive application address from App ID
      let appAddress = "";
      try {
        const appIdNum = submitRes.app_id;
        if (appIdNum > 0) {
          appAddress = algosdk.getApplicationAddress(BigInt(appIdNum)).toString();
        }
      } catch {
        // Fallback — address derivation not critical
      }

      // Build explorer URL for the application (not just the txn)
      const appExplorerUrl = submitRes.app_id > 0
        ? submitRes.explorer_url.replace(`/tx/${submitRes.txid}`, `/application/${submitRes.app_id}`)
        : submitRes.explorer_url;

      // Record deployed contract with REAL ARC-32/56 from compilation
      const deployedContract: DeployedContract = {
        appId,
        appAddress,
        txid: submitRes.txid,
        explorerUrl: appExplorerUrl,
        network,
        timestamp: new Date(),
        contractName: compilationResult?.contractName || arc32AppSpec?.name || "Contract",
        arc32Json: arc32AppSpec || null,
        arc56Json: arc56Json || null,
      };
      setDeployedContracts((prev) => [deployedContract, ...prev]);

      // Update ARC-32 spec with network info
      if (arc32AppSpec) {
        setArc32AppSpec({
          ...arc32AppSpec,
          networks: {
            ...arc32AppSpec.networks,
            [network]: { appId: parseInt(appId) || 0 },
          },
        });
      }

      const truncatedTxid = `${submitRes.txid.slice(0, 8)}...${submitRes.txid.slice(-4)}`;
      addLog("success", `Transaction confirmed: ${truncatedTxid}`);
      addLog("info", `App ID: ${appId}`);
      addLog("info", `Explorer: ${submitRes.explorer_url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deployment failed.";
      setDeployError(message);
      addLog("error", `Deploy failed: ${message}`);
    } finally {
      setDeployStage("");
      setIsDeploying(false);
    }
  };

  const handleNetworkChange = (n: string) => {
    setNetwork(n);
    addLog("info", `Switched to ${n}.`);
    // Disconnect wallet when switching networks — account may differ
    if (isWalletConnected) {
      walletDisconnect();
      addLog("info", "Wallet disconnected due to network change.");
    }
    if (n === "mainnet") {
      addLog("warning", "Deploying to Mainnet uses real ALGO tokens. Proceed with caution.");
    }
  };

  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursorLine(line);
    setCursorCol(col);
  }, []);

  const handleTabClose = (id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    if (activeTabId === id) {
      setActiveTabId("contract.sol");
    }
  };

  // ── Determine what to show in the editor pane based on active tab ── //
  const getActiveContent = (): { code: string; language: string; readOnly: boolean } => {
    switch (activeTabId) {
      case "contract.sol":
        return { code: solidityCode, language: "sol", readOnly: false };
      case "converted.algo.py":
        return { code: algorandPythonCode, language: "python", readOnly: true };
      case "approval.teal":
        return { code: approvalTeal, language: "plaintext", readOnly: true };
      case "clear.teal":
        return { code: clearTeal, language: "plaintext", readOnly: true };
      case "application.json":
        return { code: arc32AppSpec ? JSON.stringify(arc32AppSpec, null, 2) : "", language: "json", readOnly: true };
      default:
        return { code: "", language: "plaintext", readOnly: true };
    }
  };

  const activeContent = getActiveContent();
  const stepLabels = ["Paste", "Convert", "Compile", "Connect", "Deploy"];

  // ── Chat context (dynamic) ── //
  const chatContext: ChatContext = {
    current_code: solidityCode || algorandPythonCode || approvalTeal || undefined,
    current_step: stepLabels[currentStep] || undefined,
    latest_error:
      logs
        .filter((l) => l.type === "error")
        .pop()?.message || undefined,
  };

  // ── Mobile fallback ── //
  if (isMobile) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen p-6 text-center ide-mobile-fallback" style={{ backgroundColor: "var(--bg-icon-bar)" }}>
        <div className="text-4xl mb-4">⬡</div>
        <h1 className="text-xl font-bold mb-2" style={{ color: "var(--accent)" }}>AlgoMint</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          AlgoMint requires a desktop browser for the full IDE experience.
        </p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Please open this page on a screen wider than 768px.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden ide-desktop-only">
      {/* Main content area (everything above status bar) */}
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - var(--status-bar-h))" }}>
        {/* Icon Sidebar */}
        <div style={{ display: isSidebarOpen ? "block" : "none" }}>
          <IconSidebar
            activePanel={activePanel}
            onPanelChange={setActivePanel}
            isWalletConnected={isWalletConnected}
          />
        </div>

        {/* Side Panel + Drag Handle */}
        <div className="ide-border-right" style={{ display: isSidebarOpen ? "flex" : "none", position: "relative" }}>
          <div style={{ width: `${sidePanelWidth}px` }}>
            <SidePanel
              activePanel={activePanel}
              files={files}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onOpenFile={(file) => ensureTab({
                id: file.id,
                label: file.name,
                language: file.name.endsWith(".py") ? "python" : "sol",
                closable: true,
                icon: "📄",
              })}
              onDeleteFile={handleDeleteFile}
              solidityCode={solidityCode}
              onConvert={handleConvert}
              isConverting={isConverting}
              isConverted={isConverted}
              convertError={convertError}
              unsupportedFeatures={unsupportedFeatures}
              onCompile={handleCompile}
              isCompiling={isCompiling}
              isCompiled={isCompiled}
              compileError={compileError}
              approvalSize={approvalTeal.length}
              clearSize={clearTeal.length}
              retryAttempt={retryAttempt}
              maxRetries={maxRetries}
              isWalletConnected={isWalletConnected}
              walletAddress={walletAddress}
              onConnectWallet={handleConnectWallet}
              onDisconnectWallet={handleDisconnectWallet}
              onDeploy={handleDeploy}
              isDeploying={isDeploying}
              deployStage={deployStage}
              deployError={deployError}
              txid={txid}
              explorerUrl={explorerUrl}
              network={network}
              onNetworkChange={handleNetworkChange}
              arc32AppSpec={arc32AppSpec}
              deployedContracts={deployedContracts}
              approvalTeal={approvalTeal}
              clearTeal={clearTeal}
              compilationResult={compilationResult}
              arc56Json={arc56Json}
            />
          </div>
          {/* Side Panel Drag Handle */}
          <div
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingSide(true); }}
            style={{
              width: "4px",
              cursor: "ew-resize",
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              zIndex: 10,
              background: isDraggingSide ? "var(--accent)" : "transparent",
              transition: isDraggingSide ? "none" : "background 0.15s",
            }}
            className="hover:bg-[rgba(0,212,170,0.1)]"
          />
        </div>

        {/* Editor area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tab bar */}
          <div className="ide-border-bottom">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabChange={setActiveTabId}
            onTabClose={handleTabClose}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((p) => !p)}
            isTerminalOpen={!terminalCollapsed}
            onToggleTerminal={() => setTerminalCollapsed((p) => !p)}
            isChatOpen={isChatOpen}
            onToggleChat={() => setIsChatOpen((p) => !p)}
          />
          </div>

          {/* Editor pane */}
          <div className="flex-1 overflow-hidden flex flex-col" style={{ backgroundColor: "var(--bg-editor)" }}>
            {/* Warnings bar (between tab bar and editor, only when warnings exist) */}
            {astWarnings.length > 0 && activeTabId === "contract.sol" && (
              <WarningsPanel warnings={astWarnings} />
            )}

            {/* Main editor */}
            <div className="flex-1 overflow-hidden">
            {activeContent.readOnly ? (
              <ConvertedCodeViewer
                code={activeContent.code}
                language={activeContent.language}
                isLoading={
                  (activeTabId === "converted.algo.py" && isConverting) ||
                  (activeTabId.endsWith(".teal") && isCompiling)
                }
              />
            ) : (
              <SolidityEditor
                value={solidityCode}
                onChange={(newCode) => {
                  if (!activeFileNode) return;
                  setFiles(prev => prev.map(f =>
                    f.id === activeTabId ? { ...f, content: newCode } : f
                  ));
                }}
                readOnly={isConverting}
                onCursorChange={handleCursorChange}
              />
            )}
            </div>

            {/* AST Viewer (collapsible, below editor, above terminal) */}
            {enrichedAST && activeTabId === "contract.sol" && (
              <ASTViewer enrichedAST={enrichedAST} />
            )}
          </div>

          {/* Terminal Panel */}
          <TerminalPanel
            logs={logs}
            onClear={() => setLogs([])}
            isCollapsed={terminalCollapsed}
            onToggleCollapse={() => setTerminalCollapsed((p) => !p)}
          />
        </div>

        {/* Right Sidebar - ChatPanel + Drag Handle */}
        {isChatOpen && (
          <div className="h-full" style={{ width: `${chatPanelWidth}px`, minWidth: `${chatPanelWidth}px`, backgroundColor: "var(--bg-side-panel)", position: "relative" }}>
            {/* Chat Panel Drag Handle */}
            <div
              onMouseDown={(e) => { e.preventDefault(); setIsDraggingChat(true); }}
              style={{
                width: "4px",
                cursor: "ew-resize",
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                zIndex: 10,
                background: isDraggingChat ? "var(--accent)" : "transparent",
                transition: isDraggingChat ? "none" : "background 0.15s",
              }}
              className="hover:bg-[rgba(0,212,170,0.1)]"
            />
            <ChatPanel
              isOpen={isChatOpen}
              onClose={() => setIsChatOpen(false)}
              context={chatContext}
            />
          </div>
        )}
      </div>

      <StatusBar
        currentStep={currentStep}
        totalSteps={5}
        stepLabel={stepLabels[currentStep] || "Done"}
        network={network}
        walletAddress={walletAddress}
        isWalletConnected={isWalletConnected}
        cursorLine={cursorLine}
        cursorCol={cursorCol}
        activeFileName={activeTabId}
      />
    </div>
  );
}
