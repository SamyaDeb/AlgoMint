// TypeScript type definitions for AlgoMint

export interface StateSchema {
  global_ints: number;
  global_bytes: number;
  local_ints: number;
  local_bytes: number;
}

export interface ConvertResponse {
  algorand_python_code: string;
  state_schema: StateSchema;
  unsupported_features: string[];
}

// ── ARC-32 App Spec (from Puya compiler) ─────────────────────

export interface ARC4Method {
  name: string;
  args: { name: string; type: string; desc?: string }[];
  returns: { type: string; desc?: string };
  desc?: string;
  readonly?: boolean;
}

export interface ARC32AppSpec {
  name: string;
  desc?: string;
  methods: ARC4Method[];
  networks: Record<string, { appId: number }>;
  source: { approval: string; clear: string };
  state: {
    global: { num_uints: number; num_byte_slices: number };
    local: { num_uints: number; num_byte_slices: number };
  };
  contract?: { name: string; desc?: string; methods: ARC4Method[] };
  [key: string]: unknown; // Allow extra Puya-generated fields
}

// ── Compilation Result (from Puya via backend) ───────────────

export interface CompilationResult {
  success: boolean;
  contractName: string;
  approvalTeal: string;
  clearTeal: string;
  arc32Json: ARC32AppSpec | null;
  arc56Json: Record<string, unknown> | null;
  approvalProgramSize: number;
  clearProgramSize: number;
  compilationWarnings: string[];
}

export interface CompilationError {
  success: false;
  error: string;
  errorLine?: number;
  errorColumn?: number;
  errorType?: string;
  rawStderr?: string;
  rawStdout?: string;
}

export interface DeployedContract {
  appId: string;
  appAddress: string;
  txid: string;
  explorerUrl: string;
  network: string;
  timestamp: Date;
  contractName?: string;
  arc32Json?: ARC32AppSpec | null;
  arc56Json?: Record<string, unknown> | null;
}

export interface CompileResponse {
  success: boolean;
  contract_name: string;
  approval_teal: string;
  clear_teal: string;
  arc32_json: ARC32AppSpec | null;
  arc56_json: Record<string, unknown> | null;
  approval_program_size: number;
  clear_program_size: number;
  compilation_warnings: string[];
}

export interface SuggestedParams {
  fee: number;
  first_round: number;
  last_round: number;
  genesis_hash: string;
  genesis_id: string;
  flat_fee: boolean;
  min_fee: number;
}

export interface DeployResponse {
  approval_compiled: string; // base64-encoded compiled approval program
  clear_compiled: string;    // base64-encoded compiled clear program
  extra_pages: number;       // extra 8 KiB program pages needed (0-3)
  suggested_params: SuggestedParams;
}

export interface SubmitResponse {
  txid: string;
  explorer_url: string;
  app_id: number;
  logs: string[];
}

export interface MethodCallResult {
  txid: string;
  explorerUrl: string;
  returnValue: string | null;
  logs: string[];
  timestamp: Date;
}

export interface ApiError {
  error_code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface FixRequest {
  solidity_code: string;
  algorand_python_code: string;
  error_message: string;
}

// ── Chat ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  current_code?: string;
  current_step?: string;
  latest_error?: string;
}

export interface ChatRequest {
  message: string;
  history: ChatMessage[];
  context?: ChatContext;
}

export interface ChatResponse {
  reply: string;
  suggestions: string[];
}

export enum Step {
  PASTE = "PASTE",
  CONVERT = "CONVERT",
  COMPILE = "COMPILE",
  CONNECT = "CONNECT",
  DEPLOY = "DEPLOY",
}

export interface ConsoleLog {
  id: string;
  type: "info" | "error" | "success" | "warning";
  message: string;
  timestamp: Date;
  details?: string;
}

// ── 14.4  Comprehensive Error Codes ──────────────────────────

/** Error codes returned by the backend ErrorResponse.error_code field. */
export const ErrorCode = {
  // AI Service
  AI_SERVICE_ERROR: "AI_SERVICE_ERROR",
  AI_SERVICE_UNAVAILABLE: "AI_SERVICE_UNAVAILABLE",
  AI_PARSE_ERROR: "AI_PARSE_ERROR",

  // Compilation
  COMPILATION_ERROR: "COMPILATION_ERROR",
  COMPILATION_FAILED: "COMPILATION_FAILED",
  SANDBOX_TIMEOUT: "SANDBOX_TIMEOUT",
  SANDBOX_SECURITY: "SANDBOX_SECURITY",
  TEAL_TOO_LARGE: "TEAL_TOO_LARGE",

  // Algorand / Deploy
  ALGORAND_CONNECTION_ERROR: "ALGORAND_CONNECTION_ERROR",
  INVALID_ADDRESS: "INVALID_ADDRESS",
  INVALID_SIGNED_TXN: "INVALID_SIGNED_TXN",
  TRANSACTION_REJECTED: "TRANSACTION_REJECTED",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  TXN_SUBMIT_FAILED: "TXN_SUBMIT_FAILED",

  // Input Validation
  EMPTY_INPUT: "EMPTY_INPUT",
  INPUT_TOO_LARGE: "INPUT_TOO_LARGE",
  INVALID_SOLIDITY: "INVALID_SOLIDITY",
  DANGEROUS_INPUT: "DANGEROUS_INPUT",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Human-readable labels for each error code. */
export const ERROR_LABELS: Record<string, string> = {
  [ErrorCode.AI_SERVICE_ERROR]: "AI service failure",
  [ErrorCode.AI_SERVICE_UNAVAILABLE]: "AI service unavailable",
  [ErrorCode.AI_PARSE_ERROR]: "AI response parse error",
  [ErrorCode.COMPILATION_ERROR]: "Compilation error",
  [ErrorCode.COMPILATION_FAILED]: "Compilation failed",
  [ErrorCode.SANDBOX_TIMEOUT]: "Execution timed out",
  [ErrorCode.SANDBOX_SECURITY]: "Security violation",
  [ErrorCode.TEAL_TOO_LARGE]: "TEAL output too large",
  [ErrorCode.ALGORAND_CONNECTION_ERROR]: "Cannot reach Algorand node",
  [ErrorCode.INVALID_ADDRESS]: "Invalid wallet address",
  [ErrorCode.INVALID_SIGNED_TXN]: "Invalid signed transaction",
  [ErrorCode.TRANSACTION_REJECTED]: "Transaction rejected",
  [ErrorCode.TRANSACTION_FAILED]: "Transaction failed",
  [ErrorCode.TXN_SUBMIT_FAILED]: "Transaction submission failed",
  [ErrorCode.EMPTY_INPUT]: "Empty input",
  [ErrorCode.INPUT_TOO_LARGE]: "Input too large",
  [ErrorCode.INVALID_SOLIDITY]: "Invalid Solidity code",
  [ErrorCode.DANGEROUS_INPUT]: "Dangerous input detected",
  [ErrorCode.RATE_LIMIT_EXCEEDED]: "Rate limit exceeded",
};
