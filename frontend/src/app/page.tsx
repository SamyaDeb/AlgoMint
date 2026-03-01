"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
import ContractVisualizer from "@/components/Visualizer/ContractVisualizer";
import MultiContractVisualizer from "@/components/Visualizer/MultiContractVisualizer";
import type { ChatContext } from "@/types";
import type { ARC32AppSpec, DeployedContract, CompilationResult, ContractAnalysis, MultiContractAnalysis, ContractFileData } from "@/types";
import { convertSolidity, compileAlgorandPython, deployPrepare, deploySubmit, getSuggestedParams, fixAlgorandPython, analyzeContract, analyzeMultiContract } from "@/lib/api";
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

  // ── Per-file contract data ── //
  const [contractFiles, setContractFiles] = useState<Map<string, ContractFileData>>(new Map());

  // Derive which .sol file is "active" based on the current tab
  const activeSolFileId = activeTabId.endsWith(".sol")
    ? activeTabId
    : activeTabId.endsWith(".algo.py")
      ? activeTabId.replace(".algo.py", ".sol")
      : "contract.sol";

  // Get the solidity source from the active .sol file
  const solidityFileNode = files.find(f => f.id === activeSolFileId);
  const solidityCode = solidityFileNode?.content || "";

  // Active tab node (for editor display purposes)
  const activeFileNode = files.find(f => f.id === activeTabId);

  // Get per-file data for the active sol file
  const activeContractData = contractFiles.get(activeSolFileId);

  // Helper to update per-file contract data
  const updateContractFile = useCallback((solFileId: string, updates: Partial<ContractFileData>) => {
    setContractFiles(prev => {
      const next = new Map(prev);
      const existing = next.get(solFileId) || {
        algorandPythonCode: "",
        approvalTeal: "",
        clearTeal: "",
        arc32AppSpec: null,
        arc56Json: null,
        compilationResult: null,
        stateSchema: null,
        isConverted: false,
        isCompiled: false,
      };
      next.set(solFileId, { ...existing, ...updates });
      return next;
    });
  }, []);

  // ── Compiled contracts list & deploy target ── //
  const compiledContracts = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    contractFiles.forEach((data, solId) => {
      if (data.isCompiled) {
        const name = data.compilationResult?.contractName || solId.replace(".sol", "");
        list.push({ id: solId, name });
      }
    });
    return list;
  }, [contractFiles]);

  const [selectedDeployContract, setSelectedDeployContract] = useState("");

  // Auto-select deploy contract when compiled contracts change
  useEffect(() => {
    if (compiledContracts.length > 0) {
      // If current selection is invalid, pick the first compiled contract
      if (!compiledContracts.find(c => c.id === selectedDeployContract)) {
        setSelectedDeployContract(compiledContracts[0].id);
      }
    } else {
      setSelectedDeployContract("");
    }
  }, [compiledContracts, selectedDeployContract]);

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

  // ── Visualizer ── //
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);
  const [contractAnalysis, setContractAnalysis] = useState<ContractAnalysis | null>(null);
  const [multiContractAnalysis, setMultiContractAnalysis] = useState<MultiContractAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [visualizerSplit, setVisualizerSplit] = useState(50);

  // Restore only the split ratio from localStorage (visualizer always starts closed)
  useEffect(() => {
    const savedSplit = localStorage.getItem("algomint_viz_split");
    if (savedSplit) {
      const v = parseInt(savedSplit, 10);
      if (v >= 25 && v <= 75) setVisualizerSplit(v);
    }
  }, []);

  // Persist split ratio
  useEffect(() => {
    localStorage.setItem("algomint_viz_split", String(visualizerSplit));
  }, [visualizerSplit]);

  // ── Resizable panels ── //
  const [sidePanelWidth, setSidePanelWidth] = useState(320);
  const [chatPanelWidth, setChatPanelWidth] = useState(350);
  const [isDraggingSide, setIsDraggingSide] = useState(false);
  const [isDraggingChat, setIsDraggingChat] = useState(false);
  const [isDraggingVisualizer, setIsDraggingVisualizer] = useState(false);
  const editorAreaRef = useRef<HTMLDivElement>(null);

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
      if (isDraggingVisualizer && editorAreaRef.current) {
        const rect = editorAreaRef.current.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        if (pct >= 25 && pct <= 75) setVisualizerSplit(pct);
      }
    };
    const handleMouseUp = () => {
      setIsDraggingSide(false);
      setIsDraggingChat(false);
      setIsDraggingVisualizer(false);
    };
    if (isDraggingSide || isDraggingChat || isDraggingVisualizer) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDraggingSide, isDraggingChat, isDraggingVisualizer]);

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

  // ── Analyze contract for visualizer ── //
  const handleAnalyze = useCallback(async () => {
    if (!algorandPythonCode) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeContract(
        algorandPythonCode,
        arc32AppSpec as Record<string, unknown> | null,
        solidityCode || undefined,
      );
      setContractAnalysis(result);
      addLog("success", `Contract analyzed: ${result.contract_name} — ${result.methods.length} methods, ${result.state_variables.length} state vars`);
    } catch (err) {
      addLog("error", `Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [algorandPythonCode, arc32AppSpec, solidityCode, addLog]);

  // ── Multi-contract analysis handler ── //
  const handleMultiAnalyze = useCallback(async () => {
    // Gather all converted contracts from contractFiles
    const convertedContracts: { name: string; algorandPythonCode: string; arc32Json?: Record<string, unknown> | null; solidityCode?: string }[] = [];
    contractFiles.forEach((cfData, fileId) => {
      if (cfData.algorandPythonCode) {
        const solFile = files.find(f => f.id === fileId);
        convertedContracts.push({
          name: fileId.replace('.sol', ''),
          algorandPythonCode: cfData.algorandPythonCode,
          arc32Json: cfData.arc32AppSpec as Record<string, unknown> | null,
          solidityCode: solFile?.content,
        });
      }
    });
    if (convertedContracts.length < 2) {
      // Fall back to single-contract analysis
      handleAnalyze();
      return;
    }
    setIsAnalyzing(true);
    try {
      const result = await analyzeMultiContract(convertedContracts);
      setMultiContractAnalysis(result);
      addLog('success', `Multi-contract analysis: ${result.contracts.length} contracts, ${result.inter_contract_edges.length} cross-contract edges`);
    } catch (err) {
      addLog('error', `Multi-contract analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [contractFiles, files, handleAnalyze, addLog]);

  // ── Auto-analyze when visualizer opens ── //
  const prevVisualizerOpen = useRef(false);
  useEffect(() => {
    if (isVisualizerOpen && !prevVisualizerOpen.current) {
      // Count converted contracts
      let convertedCount = 0;
      contractFiles.forEach((cfData) => { if (cfData.algorandPythonCode) convertedCount++; });
      if (convertedCount >= 2) {
        handleMultiAnalyze();
      } else if (algorandPythonCode && !contractAnalysis) {
        handleAnalyze();
      }
    }
    prevVisualizerOpen.current = isVisualizerOpen;
  }, [isVisualizerOpen, algorandPythonCode, contractAnalysis, contractFiles, handleAnalyze, handleMultiAnalyze]);

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
        const content = getActiveContent();
        if (content.code) {
          navigator.clipboard.writeText(content.code).then(() => {
            addLog("info", "Code copied to clipboard.");
          });
        }
      }

      // Cmd/Ctrl + Shift + V → toggle visualizer
      if (mod && e.shiftKey && e.key === "V") {
        e.preventDefault();
        setIsVisualizerOpen((p) => !p);
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
    // Determine which .sol file to convert
    const targetSolId = activeSolFileId;
    const targetFileNode = files.find(f => f.id === targetSolId);
    const codeToConvert = targetFileNode?.content || "";

    if (!codeToConvert.trim()) {
      addLog("warning", `No Solidity code in ${targetSolId}. Paste or load a contract first.`);
      return;
    }

    setIsConverting(true);
    setConvertError(null);
    setUnsupportedFeatures([]);
    setAstWarnings([]);
    setEnrichedAST(null);
    addLog("info", `Converting ${targetSolId} → Algorand Python...`);

    // ── Step 1: Parse & enrich AST (frontend-side, graceful fallback) ──
    let astAnalysis: string | undefined;
    try {
      const parseResult = parseSolidity(codeToConvert);
      if ("error" in parseResult) {
        addLog("warning", `AST parse skipped: ${parseResult.reason}`);
      } else {
        const enriched = enrichAST(parseResult, codeToConvert);
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
      const response = await convertSolidity(codeToConvert, astAnalysis);

      // Store per-file data
      updateContractFile(targetSolId, {
        algorandPythonCode: response.algorand_python_code,
        stateSchema: response.state_schema,
        isConverted: true,
        // Reset compilation state for this file
        isCompiled: false,
        approvalTeal: "",
        clearTeal: "",
        arc32AppSpec: null,
        arc56Json: null,
        compilationResult: null,
      });

      // Update legacy globals (for backward compat)
      setAlgorandPythonCode(response.algorand_python_code);
      setStateSchema(response.state_schema);
      setUnsupportedFeatures(response.unsupported_features ?? []);
      setIsConverted(true);
      setCurrentStep(2);

      // Invalidate cached analysis when code changes
      setContractAnalysis(null);

      // Reset compilation state when new conversion happens
      setCompilationResult(null);
      setArc32AppSpec(null);
      setArc56Json(null);
      setIsCompiled(false);
      setApprovalTeal("");
      setClearTeal("");

      // Open per-file algo.py tab
      const algoFileName = targetSolId.replace(".sol", ".algo.py");
      ensureTab({
        id: algoFileName,
        label: algoFileName,
        language: "python",
        closable: true,
        icon: "🐍",
      });

      const lineCount = response.algorand_python_code.split("\n").length;
      addLog("success", `${targetSolId} converted (${lineCount} lines Algorand Python).`);

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
    // Determine which file to compile
    const targetSolId = activeSolFileId;
    const cfData = contractFiles.get(targetSolId);
    const codeToCompile = cfData?.algorandPythonCode || algorandPythonCode;
    const solCode = files.find(f => f.id === targetSolId)?.content || solidityCode;

    if (!codeToCompile.trim()) {
      addLog("warning", `No Algorand Python code for ${targetSolId}. Convert first.`);
      return;
    }

    setIsCompiling(true);
    setCompileError(null);
    setRetryAttempt(0);
    addLog("info", `Compiling ${targetSolId.replace(".sol", ".algo.py")} → TEAL via PuyaPy...`);

    let currentCode = codeToCompile;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await compileAlgorandPython(currentCode);

        // Normalize ARC-32
        const normalizedSpec: ARC32AppSpec | null = response.arc32_json ? (() => {
          const rawSpec = response.arc32_json as ARC32AppSpec;
          return {
            ...rawSpec,
            name: rawSpec.name || rawSpec.contract?.name || "Contract",
            methods: rawSpec.methods?.length
              ? rawSpec.methods
              : (rawSpec.contract?.methods ?? []),
          };
        })() : null;

        const compResult: CompilationResult = {
          success: true,
          contractName: response.contract_name || "Contract",
          approvalTeal: response.approval_teal,
          clearTeal: response.clear_teal,
          arc32Json: normalizedSpec,
          arc56Json: response.arc56_json || null,
          approvalProgramSize: response.approval_program_size || response.approval_teal.length,
          clearProgramSize: response.clear_program_size || response.clear_teal.length,
          compilationWarnings: response.compilation_warnings || [],
        };

        // Derive state schema from ARC-32
        let newStateSchema = cfData?.stateSchema || stateSchema;
        if (response.arc32_json) {
          const spec = response.arc32_json as ARC32AppSpec;
          if (spec.state) {
            newStateSchema = {
              global_ints: spec.state.global?.num_uints ?? 0,
              global_bytes: spec.state.global?.num_byte_slices ?? 0,
              local_ints: spec.state.local?.num_uints ?? 0,
              local_bytes: spec.state.local?.num_byte_slices ?? 0,
            };
          }
        }

        // Store per-file compilation data
        updateContractFile(targetSolId, {
          approvalTeal: response.approval_teal,
          clearTeal: response.clear_teal,
          arc32AppSpec: normalizedSpec,
          arc56Json: response.arc56_json || null,
          compilationResult: compResult,
          stateSchema: newStateSchema,
          isCompiled: true,
        });

        // Update legacy globals
        setApprovalTeal(response.approval_teal);
        setClearTeal(response.clear_teal);
        setIsCompiled(true);
        setCurrentStep(3);
        if (normalizedSpec) setArc32AppSpec(normalizedSpec);
        if (response.arc56_json) setArc56Json(response.arc56_json);
        setCompilationResult(compResult);
        if (newStateSchema) setStateSchema(newStateSchema);

        if (normalizedSpec) {
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
          addLog("info", "ARC-56 app spec generated by Puya.");
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
              solidity_code: solCode,
              algorand_python_code: currentCode,
              error_message: cleanError,
            });

            currentCode = fixResponse.algorand_python_code;
            // Update both per-file and legacy global
            updateContractFile(targetSolId, { algorandPythonCode: currentCode });
            setAlgorandPythonCode(currentCode);

            if (fixResponse.state_schema) {
              updateContractFile(targetSolId, { stateSchema: fixResponse.state_schema });
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

  const handleDeploy = async (createArgs?: Record<string, string>, foreignAppIds?: number[]) => {
    // Use selected deploy contract from the dropdown, fall back to activeSolFileId
    const deployTargetId = selectedDeployContract || activeSolFileId;
    const cfData = contractFiles.get(deployTargetId);
    const deployApprovalTeal = cfData?.approvalTeal || approvalTeal;
    const deployClearTeal = cfData?.clearTeal || clearTeal;
    const deployArc32 = cfData?.arc32AppSpec || arc32AppSpec;
    const deployArc56 = cfData?.arc56Json || arc56Json;
    const deployCompResult = cfData?.compilationResult || compilationResult;

    if (!deployApprovalTeal || !deployClearTeal) {
      addLog("warning", "No compiled TEAL to deploy. Compile first.");
      return;
    }
    if (!walletAddress || !peraWallet) {
      addLog("warning", "Connect your Pera Wallet before deploying.");
      return;
    }

    // Use state schema from per-file data, ARC-32, or fallback
    const deploySchema = cfData?.stateSchema || stateSchema || {
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
        approvalTeal: deployApprovalTeal,
        clearTeal: deployClearTeal,
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

      // ── Encode create method args (Phase 4 Multi-Contract) ──
      let appArgs: Uint8Array[] | undefined;
      // Foreign arrays built from reference type args
      const refForeignApps: bigint[] = [];
      const refForeignAccounts: string[] = [];
      const refForeignAssets: bigint[] = [];
      // OnComplete derived from ARC-32 hints (defaults to NoOp)
      let createOnComplete: algosdk.OnApplicationComplete = algosdk.OnApplicationComplete.NoOpOC;
      // Two-step deploy: if the method is CALL-only but bare create is available
      let needsTwoStepDeploy = false;
      // Store the method info for the second step
      let postCreateMethod: { name: string; args: { name: string; type: string }[]; returns: { type: string } } | null = null;
      let postCreateEncodedArgs: Uint8Array[] | undefined;

      if (createArgs && Object.keys(createArgs).length > 0 && deployArc32) {
        try {
          const allMethods = deployArc32.contract?.methods ?? deployArc32.methods ?? [];
          const hints = deployArc32.hints as Record<string, { call_config?: Record<string, string> }> | undefined;

          // Map ARC-32 call_config keys to algosdk OnComplete values
          const OC_MAP: Record<string, algosdk.OnApplicationComplete> = {
            no_op: algosdk.OnApplicationComplete.NoOpOC,
            opt_in: algosdk.OnApplicationComplete.OptInOC,
            close_out: algosdk.OnApplicationComplete.CloseOutOC,
            update_application: algosdk.OnApplicationComplete.UpdateApplicationOC,
            delete_application: algosdk.OnApplicationComplete.DeleteApplicationOC,
          };

          // Find the create method signature from hints — one that allows CREATE
          let createMethod: { name: string; args: { name: string; type: string }[]; returns: { type: string } } | null = null;
          let createMethodSig = "";
          let methodIsCreateAllowed = false;

          if (hints) {
            for (const [sig, hint] of Object.entries(hints)) {
              const cc = hint.call_config;
              if (!cc) continue;
              // Find which OnComplete action allows CREATE
              for (const [action, config] of Object.entries(cc)) {
                if (config === "CREATE" || config === "ALL") {
                  const methodName = sig.split("(")[0];
                  const method = allMethods.find(m => m.name === methodName);
                  if (method && method.args.length > 0) {
                    createMethod = method;
                    createMethodSig = sig;
                    methodIsCreateAllowed = true;
                    // Set the OnComplete from the hint action
                    if (OC_MAP[action] !== undefined) {
                      createOnComplete = OC_MAP[action];
                    }
                    break;
                  }
                }
              }
              if (createMethod) break;
            }
          }

          // If no method with CREATE hint found, look for method by name
          // (this method will be CALL-only — needs two-step deploy)
          if (!createMethod) {
            createMethod = allMethods.find(m => (m.name === "create" || m.name === "initialize") && m.args.length > 0) || null;
          }

          if (createMethod) {
            // Check if this method can be called during creation
            if (!methodIsCreateAllowed && createMethod) {
              // Method is CALL-only — check if bare creation is available
              const bareConfig = deployArc32.bare_call_config as Record<string, string> | undefined;
              const bareCreatable = bareConfig && Object.values(bareConfig).some(v => v === "CREATE" || v === "ALL");
              if (bareCreatable) {
                needsTwoStepDeploy = true;
                addLog("info", `Method "${createMethod.name}" is CALL-only. Using two-step deploy: bare create → then call method.`);
              } else {
                addLog("warning", `Method "${createMethod.name}" is CALL-only and no bare create available. Attempting direct deploy.`);
              }
            }

            // Build ABI method and get 4-byte selector
            const abiMethod = new algosdk.ABIMethod({
              name: createMethod.name,
              args: createMethod.args.map(a => ({ type: a.type, name: a.name })),
              returns: { type: createMethod.returns.type },
            });
            const selector = abiMethod.getSelector();
            const selectorHex = Array.from(selector).map(b => b.toString(16).padStart(2, "0")).join("");
            const methodSig = `${createMethod.name}(${createMethod.args.map(a => a.type).join(",")})${createMethod.returns.type}`;
            addLog("info", `ARC-4 method: "${methodSig}" selector=0x${selectorHex} createAllowed=${methodIsCreateAllowed}`);
            if (createMethodSig) {
              addLog("info", `ARC-32 hint sig: "${createMethodSig}" OnComplete=${createOnComplete}`);
            }

            // ARC-4 reference types need special encoding:
            // - "application" -> index into foreignApps (0 = current app, 1+ = foreignApps array)
            // - "account"     -> index into foreignAccounts (0 = sender, 1+ = accounts array)
            // - "asset"       -> index into foreignAssets (0-based)

            // Encode each argument
            const encodedArgs: Uint8Array[] = [selector];
            for (const argDef of createMethod.args) {
              const rawValue = createArgs[argDef.name] ?? "";

              if (argDef.type === "application") {
                // Add app ID to foreign apps array, encode as uint8 index
                const appId = BigInt(rawValue);
                refForeignApps.push(appId);
                // Index is 1-based: 0 = current app, 1 = foreignApps[0], etc.
                const idx = refForeignApps.length;
                encodedArgs.push(new Uint8Array([idx]));
                addLog("info", `  Arg "${argDef.name}": application ref → foreignApps[${idx - 1}] = ${rawValue}`);
              } else if (argDef.type === "account") {
                // Add address to foreign accounts, encode as uint8 index
                refForeignAccounts.push(rawValue);
                // Index is 1-based: 0 = sender, 1 = accounts[0], etc.
                const idx = refForeignAccounts.length;
                encodedArgs.push(new Uint8Array([idx]));
                addLog("info", `  Arg "${argDef.name}": account ref → foreignAccounts[${idx - 1}]`);
              } else if (argDef.type === "asset") {
                // Add asset ID to foreign assets, encode as uint8 index
                const assetId = BigInt(rawValue);
                refForeignAssets.push(assetId);
                // Index is 0-based for assets
                const idx = refForeignAssets.length - 1;
                encodedArgs.push(new Uint8Array([idx]));
                addLog("info", `  Arg "${argDef.name}": asset ref → foreignAssets[${idx}] = ${rawValue}`);
              } else {
                // Regular ABI value type
                const abiType = algosdk.ABIType.from(argDef.type);
                let value: algosdk.ABIValue = rawValue;
                // Convert string to appropriate type for ABI encoding
                if (argDef.type.startsWith("uint") || argDef.type.startsWith("int")) {
                  value = BigInt(rawValue);
                } else if (argDef.type === "bool") {
                  value = rawValue === "true" || rawValue === "1";
                } else if (argDef.type === "address") {
                  value = rawValue; // already a string address
                }
                encodedArgs.push(abiType.encode(value as algosdk.ABIValue));
              }
            }

            if (needsTwoStepDeploy) {
              // Save for post-create call; don't set appArgs for the create txn
              postCreateMethod = createMethod;
              postCreateEncodedArgs = encodedArgs;
              addLog("info", `Encoded ${createMethod.args.length} arg(s) for post-create call.`);
            } else {
              appArgs = encodedArgs;
              addLog("info", `Create method "${createMethod.name}" with ${createMethod.args.length} arg(s) encoded for create txn.`);
            }
          }
        } catch (encodeErr) {
          const msg = encodeErr instanceof Error ? encodeErr.message : "Failed to encode create args";
          addLog("warning", `ABI encoding warning: ${msg}. Deploying without create args.`);
        }
      }

      // Build combined foreign apps list: from reference type args + user-provided cross-contract deps
      const combinedForeignApps: bigint[] = [...refForeignApps];
      if (foreignAppIds && foreignAppIds.length > 0) {
        for (const id of foreignAppIds) {
          const bigId = BigInt(id);
          if (!combinedForeignApps.includes(bigId)) {
            combinedForeignApps.push(bigId);
          }
        }
      }

      if (combinedForeignApps.length > 0) {
        addLog("info", `Including ${combinedForeignApps.length} foreign app(s) in transaction: [${combinedForeignApps.join(", ")}]`);
      }

      const txnObj = algosdk.makeApplicationCreateTxnFromObject({
        sender: walletAddress,
        suggestedParams,
        onComplete: appArgs ? createOnComplete : algosdk.OnApplicationComplete.NoOpOC,
        approvalProgram,
        clearProgram,
        numGlobalInts: deploySchema.global_ints,
        numGlobalByteSlices: deploySchema.global_bytes,
        numLocalInts: deploySchema.local_ints,
        numLocalByteSlices: deploySchema.local_bytes,
        extraPages,
        ...(appArgs ? { appArgs } : {}),
        ...(combinedForeignApps.length > 0 ? { foreignApps: combinedForeignApps } : {}),
        ...(refForeignAccounts.length > 0 ? { foreignAccounts: refForeignAccounts } : {}),
        ...(refForeignAssets.length > 0 ? { foreignAssets: refForeignAssets.map(id => BigInt(id)) } : {}),
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

      // ── Stage 4b: Two-step deploy — call initialize method on the new app ──
      if (needsTwoStepDeploy && postCreateEncodedArgs && postCreateMethod && submitRes.app_id > 0) {
        setDeployStage("Initializing contract (step 2)...");
        addLog("info", `App created (ID: ${submitRes.app_id}). Now calling "${postCreateMethod.name}" to initialize...`);

        // Get fresh suggested params for the method call
        const sp2Raw = await getSuggestedParams(network);
        const genesisHashBytes2 = new Uint8Array(Buffer.from(sp2Raw.genesis_hash, "base64"));
        const suggestedParams2: algosdk.SuggestedParams = {
          fee: sp2Raw.fee ?? 0,
          firstValid: sp2Raw.first_round,
          lastValid: sp2Raw.last_round,
          genesisHash: genesisHashBytes2,
          genesisID: sp2Raw.genesis_id,
          flatFee: sp2Raw.flat_fee ?? false,
          minFee: sp2Raw.min_fee ?? 1000,
        };

        // Build foreign apps for the method call — include ref args + cross-contract deps
        const step2ForeignApps: bigint[] = [...refForeignApps];
        if (foreignAppIds && foreignAppIds.length > 0) {
          for (const id of foreignAppIds) {
            const bigId = BigInt(id);
            if (!step2ForeignApps.includes(bigId)) {
              step2ForeignApps.push(bigId);
            }
          }
        }

        // Build ApplicationCallTxn to the newly created app
        const callTxn = algosdk.makeApplicationCallTxnFromObject({
          sender: walletAddress,
          suggestedParams: suggestedParams2,
          appIndex: BigInt(submitRes.app_id),
          onComplete: algosdk.OnApplicationComplete.NoOpOC,
          appArgs: postCreateEncodedArgs,
          ...(step2ForeignApps.length > 0 ? { foreignApps: step2ForeignApps } : {}),
          ...(refForeignAccounts.length > 0 ? { foreignAccounts: refForeignAccounts } : {}),
          ...(refForeignAssets.length > 0 ? { foreignAssets: refForeignAssets.map(id => BigInt(id)) } : {}),
        });

        // Sign the method call
        setDeployStage("Sign initialization in your wallet...");
        addLog("info", `Awaiting wallet signature for "${postCreateMethod.name}" call...`);

        const signedCall = await peraWallet.signTransaction([
          [{ txn: callTxn }],
        ]);

        if (!signedCall || signedCall.length === 0) {
          throw new Error("No signed transaction returned for initialization call.");
        }

        const signedCallBytes = signedCall[0] instanceof Uint8Array
          ? signedCall[0]
          : new Uint8Array(signedCall[0] as ArrayLike<number>);
        const signedCallBase64 = Buffer.from(signedCallBytes).toString("base64");

        // Submit the method call
        setDeployStage("Submitting initialization...");
        const callRes = await deploySubmit({
          signedTxn: signedCallBase64,
          network,
        });

        addLog("success", `Initialization "${postCreateMethod.name}" confirmed: ${callRes.txid.slice(0, 8)}...${callRes.txid.slice(-4)}`);
      }

      // ── Stage 5: Confirmed ──
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
        contractName: deployCompResult?.contractName || deployArc32?.name || "Contract",
        arc32Json: deployArc32 || null,
        arc56Json: deployArc56 || null,
      };
      setDeployedContracts((prev) => [deployedContract, ...prev]);

      // Update ARC-32 spec with network info
      if (deployArc32) {
        const updatedSpec = {
          ...deployArc32,
          networks: {
            ...deployArc32.networks,
            [network]: { appId: parseInt(appId) || 0 },
          },
        };
        setArc32AppSpec(updatedSpec);
        updateContractFile(deployTargetId, { arc32AppSpec: updatedSpec });
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
    // Per-file .algo.py tabs (e.g. "Token.algo.py", "contract.algo.py")
    if (activeTabId.endsWith(".algo.py")) {
      const solFileId = activeTabId.replace(".algo.py", ".sol");
      const cfData = contractFiles.get(solFileId);
      if (cfData?.algorandPythonCode) {
        return { code: cfData.algorandPythonCode, language: "python", readOnly: true };
      }
      // Legacy fallback for old "converted.algo.py" tab
      if (activeTabId === "converted.algo.py") {
        return { code: algorandPythonCode, language: "python", readOnly: true };
      }
      return { code: "", language: "python", readOnly: true };
    }

    // .sol files — editable
    if (activeTabId.endsWith(".sol")) {
      const fileNode = files.find(f => f.id === activeTabId);
      return { code: fileNode?.content || "", language: "sol", readOnly: false };
    }

    switch (activeTabId) {
      case "approval.teal":
        return { code: approvalTeal, language: "plaintext", readOnly: true };
      case "clear.teal":
        return { code: clearTeal, language: "plaintext", readOnly: true };
      case "application.json":
        return { code: arc32AppSpec ? JSON.stringify(arc32AppSpec, null, 2) : "", language: "json", readOnly: true };
      default: {
        // Check if it's a user-created file
        const fileNode = files.find(f => f.id === activeTabId);
        if (fileNode) {
          return {
            code: fileNode.content || "",
            language: fileNode.name.endsWith(".py") ? "python" : "plaintext",
            readOnly: !fileNode.name.endsWith(".sol"),
          };
        }
        return { code: "", language: "plaintext", readOnly: true };
      }
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
              contractFiles={contractFiles}
              onConvert={handleConvert}
              isConverting={isConverting}
              isConverted={activeContractData?.isConverted || false}
              convertError={convertError}
              unsupportedFeatures={unsupportedFeatures}
              onCompile={handleCompile}
              isCompiling={isCompiling}
              isCompiled={activeContractData?.isCompiled || false}
              compileError={compileError}
              approvalSize={(activeContractData?.approvalTeal || approvalTeal).length}
              clearSize={(activeContractData?.clearTeal || clearTeal).length}
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
              compiledContracts={compiledContracts}
              selectedDeployContract={selectedDeployContract}
              onSelectDeployContract={setSelectedDeployContract}
              arc32AppSpec={(() => {
                // Use deploy target's ARC-32, not active file's
                if (selectedDeployContract) {
                  const deployData = contractFiles.get(selectedDeployContract);
                  if (deployData?.arc32AppSpec) return deployData.arc32AppSpec;
                }
                return activeContractData?.arc32AppSpec || arc32AppSpec;
              })()}
              multiContractAnalysis={multiContractAnalysis}
              deployedContracts={deployedContracts}
              approvalTeal={(() => {
                if (selectedDeployContract) {
                  const d = contractFiles.get(selectedDeployContract);
                  if (d?.approvalTeal) return d.approvalTeal;
                }
                return activeContractData?.approvalTeal || approvalTeal;
              })()}
              clearTeal={(() => {
                if (selectedDeployContract) {
                  const d = contractFiles.get(selectedDeployContract);
                  if (d?.clearTeal) return d.clearTeal;
                }
                return activeContractData?.clearTeal || clearTeal;
              })()}
              compilationResult={(() => {
                if (selectedDeployContract) {
                  const d = contractFiles.get(selectedDeployContract);
                  if (d?.compilationResult) return d.compilationResult;
                }
                return activeContractData?.compilationResult || compilationResult;
              })()}
              arc56Json={(() => {
                if (selectedDeployContract) {
                  const d = contractFiles.get(selectedDeployContract);
                  if (d?.arc56Json) return d.arc56Json;
                }
                return activeContractData?.arc56Json || arc56Json;
              })()}
              peraWallet={peraWallet}
              onLog={(type, message) => addLog(type, message)}
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
            onCompileTab={(tabId) => {
              setActiveTabId(tabId);
              handleCompile();
            }}
            isCompiling={isCompiling}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((p) => !p)}
            isTerminalOpen={!terminalCollapsed}
            onToggleTerminal={() => setTerminalCollapsed((p) => !p)}
            isChatOpen={isChatOpen}
            onToggleChat={() => setIsChatOpen((p) => !p)}
            isVisualizerOpen={isVisualizerOpen}
            onToggleVisualizer={() => setIsVisualizerOpen((p) => !p)}
            isVisualizerEnabled={!!(activeContractData?.algorandPythonCode || algorandPythonCode)}
          />
          </div>

          {/* Editor pane */}
          <div className="flex-1 overflow-hidden flex flex-col" style={{ backgroundColor: "var(--bg-editor)" }}>
            {/* Warnings bar (between tab bar and editor, only when warnings exist) */}
            {astWarnings.length > 0 && activeTabId.endsWith(".sol") && (
              <WarningsPanel warnings={astWarnings} />
            )}

            {/* Main editor area — splits horizontally when visualizer is open */}
            <div className="flex-1 overflow-hidden flex flex-row" ref={editorAreaRef}>
              {/* Left: Code editor */}
              <div className="overflow-hidden" style={{ width: isVisualizerOpen ? `${visualizerSplit}%` : "100%", minWidth: isVisualizerOpen ? 250 : undefined, transition: isDraggingVisualizer ? "none" : "width 0.15s" }}>
                {activeContent.readOnly ? (
                  <ConvertedCodeViewer
                    code={activeContent.code}
                    language={activeContent.language}
                    isLoading={
                      (activeTabId.endsWith(".algo.py") && isConverting) ||
                      (activeTabId.endsWith(".teal") && isCompiling)
                    }
                  />
                ) : (
                  <SolidityEditor
                    value={activeContent.code}
                    onChange={(newCode) => {
                      if (!activeTabId.endsWith(".sol")) return;
                      setFiles(prev => prev.map(f =>
                        f.id === activeTabId ? { ...f, content: newCode } : f
                      ));
                    }}
                    readOnly={isConverting}
                    onCursorChange={handleCursorChange}
                  />
                )}
              </div>

              {/* Draggable divider + Visualizer pane */}
              {isVisualizerOpen && (
                <>
                  <div
                    className={`viz-divider${isDraggingVisualizer ? " active" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); setIsDraggingVisualizer(true); }}
                  />
                  <div style={{ width: `${100 - visualizerSplit}%`, minWidth: 250, overflow: "hidden", height: "100%" }}>
                    <MultiContractVisualizer
                      multiAnalysis={multiContractAnalysis}
                      singleAnalysis={contractAnalysis}
                      isLoading={isAnalyzing}
                      deployedContracts={deployedContracts}
                      onJumpToLine={(line) => {
                        setActiveTabId("converted.algo.py");
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            {/* AST Viewer (collapsible, below editor, above terminal) */}
            {enrichedAST && activeTabId.endsWith(".sol") && (
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
