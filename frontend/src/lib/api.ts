/**
 * API client — typed fetch wrapper for AlgoMint backend.
 */

import type {
  ConvertResponse,
  CompileResponse,
  DeployResponse,
  SubmitResponse,
  StateSchema,
  FixRequest,
  ChatRequest,
  ChatResponse,
} from "@/types";
import { ERROR_LABELS } from "@/types";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000/api/v1";

// ── Custom API error with error_code ─────────────────────────

export class ApiRequestError extends Error {
  errorCode: string;
  details?: Record<string, unknown>;

  constructor(message: string, errorCode: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.errorCode = errorCode;
    this.details = details;
  }
}

// ── Generic fetch helper ─────────────────────────────────────

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    const errorCode = error.error_code || "UNKNOWN_ERROR";
    const label = ERROR_LABELS[errorCode];
    const baseMsg = error.message || `HTTP ${res.status}`;
    // Append the raw backend detail so the developer can see what failed
    const detail = error.details?.error
      ? ` -- ${error.details.error}`
      : error.details?.traceback
        ? ` -- ${error.details.traceback}`
        : "";
    const message = label ? `${label}: ${baseMsg}${detail}` : `${baseMsg}${detail}`;
    throw new ApiRequestError(message, errorCode, error.details);
  }
  return res.json();
}

// ── Health check ─────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string; version: string }> {
  // Health endpoint is at root, not under /api/v1
  const baseUrl = BACKEND_URL.replace(/\/api\/v1$/, "");
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return res.json();
}

// ── Convert Solidity → Algorand Python ───────────────────────

export async function convertSolidity(
  solidityCode: string,
  astAnalysis?: string,
): Promise<ConvertResponse> {
  const body: Record<string, string> = { solidity_code: solidityCode };
  if (astAnalysis) body.ast_analysis = astAnalysis;
  return apiFetch<ConvertResponse>("/convert", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Compile Algorand Python → TEAL + ARC-32/56 ──────────────

export async function compileAlgorandPython(
  algorandPythonCode: string,
  contractName?: string,
  network?: string,
): Promise<CompileResponse> {
  return apiFetch<CompileResponse>("/compile", {
    method: "POST",
    body: JSON.stringify({
      algorand_python_code: algorandPythonCode,
      contract_name: contractName || "",
      network: network || "testnet",
    }),
  });
}

// ── Deploy: prepare unsigned transaction ─────────────────────

export async function deployPrepare(params: {
  approvalTeal: string;
  clearTeal: string;
  stateSchema: StateSchema;
  sender: string;
  network: string;
}): Promise<DeployResponse> {
  return apiFetch<DeployResponse>("/deploy/prepare", {
    method: "POST",
    body: JSON.stringify({
      approval_teal: params.approvalTeal,
      clear_teal: params.clearTeal,
      state_schema: params.stateSchema,
      sender: params.sender,
      network: params.network,
    }),
  });
}

// ── Deploy: submit signed transaction ────────────────────────

export async function deploySubmit(params: {
  signedTxn: string;
  network: string;
}): Promise<SubmitResponse> {
  return apiFetch<SubmitResponse>("/deploy/submit", {
    method: "POST",
    body: JSON.stringify({
      signed_txn: params.signedTxn,
      network: params.network,
    }),
  });
}

// ── Fix broken Algorand Python (AI retry) ───────────────────

export async function fixAlgorandPython(
  params: FixRequest,
): Promise<ConvertResponse> {
  return apiFetch<ConvertResponse>("/convert/fix", {
    method: "POST",
    body: JSON.stringify({
      solidity_code: params.solidity_code,
      algorand_python_code: params.algorand_python_code,
      error_message: params.error_message,
    }),
  });
}

// ── Chat ─────────────────────────────────────────────────────

export async function sendChatMessage(
  params: ChatRequest,
): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({
      message: params.message,
      history: params.history,
      context: params.context,
    }),
  });
}

// ── File download helpers ────────────────────────────────────

export function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJSON(json: object, filename: string): void {
  downloadFile(JSON.stringify(json, null, 2), filename);
}
