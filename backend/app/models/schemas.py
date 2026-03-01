"""
Pydantic request/response models (schemas).

Defines all data transfer objects used by the API routes:
ConvertRequest/Response, CompileRequest/Response, DeployRequest/Response,
SubmitRequest/Response, StateSchema, and ErrorResponse.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Shared ────────────────────────────────────────────────────

class StateSchema(BaseModel):
    """Algorand application state schema counts."""
    global_ints: int = Field(default=0, ge=0, le=64)
    global_bytes: int = Field(default=0, ge=0, le=64)
    local_ints: int = Field(default=0, ge=0, le=16)
    local_bytes: int = Field(default=0, ge=0, le=16)


class ErrorResponse(BaseModel):
    """Standardised error envelope."""
    error: bool = True
    error_code: str
    message: str
    details: dict | None = None


# ── Convert ───────────────────────────────────────────────────

class ConvertRequest(BaseModel):
    """POST /api/v1/convert request body."""
    solidity_code: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Solidity source code to convert to Algorand Python.",
    )
    ast_analysis: str | None = Field(
        default=None,
        max_length=100_000,
        description="Optional enriched AST analysis from the frontend parser.",
    )


class FixRequest(BaseModel):
    """POST /api/v1/convert/fix request body."""
    solidity_code: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Original Solidity source code (for context).",
    )
    algorand_python_code: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Broken Algorand Python code that failed compilation.",
    )
    error_message: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Compilation error message.",
    )


class ConvertResponse(BaseModel):
    """POST /api/v1/convert response body."""
    algorand_python_code: str
    state_schema: StateSchema
    unsupported_features: list[str] = Field(default_factory=list)


# ── Compile ───────────────────────────────────────────────────

class CompileRequest(BaseModel):
    """POST /api/v1/compile request body."""
    algorand_python_code: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Algorand Python source code to compile to TEAL via Puya.",
    )
    contract_name: str = Field(
        default="",
        max_length=200,
        description="Optional contract name hint.",
    )
    network: str = Field(
        default="testnet",
        pattern="^(testnet|mainnet)$",
        description="Target network.",
    )


class CompileResponse(BaseModel):
    """POST /api/v1/compile response body."""
    success: bool = True
    contract_name: str = ""
    teal_code: str = ""
    approval_teal: str = ""
    clear_teal: str = ""
    arc32_json: dict | None = None
    arc56_json: dict | None = None
    approval_program_size: int = 0
    clear_program_size: int = 0
    compilation_warnings: list[str] = Field(default_factory=list)


class CompileErrorResponse(BaseModel):
    """Compilation error detail response."""
    success: bool = False
    error: str = ""
    error_line: int | None = None
    error_column: int | None = None
    error_type: str = "unknown"
    raw_stderr: str = ""
    raw_stdout: str = ""


# ── Deploy ────────────────────────────────────────────────────

class DeployRequest(BaseModel):
    """POST /api/v1/deploy/prepare request body."""
    approval_teal: str = Field(..., min_length=1, max_length=50_000)
    clear_teal: str = Field(..., min_length=1, max_length=50_000)
    state_schema: StateSchema
    sender: str = Field(
        ...,
        min_length=58,
        max_length=58,
        description="Algorand address of the deployer.",
    )
    network: str = Field(default="testnet", pattern="^(testnet|mainnet)$")


class SuggestedParamsResponse(BaseModel):
    """Algorand suggested params for transaction building."""
    fee: int = 0
    first_round: int
    last_round: int
    genesis_hash: str
    genesis_id: str
    flat_fee: bool = False
    min_fee: int = 1000


class DeployResponse(BaseModel):
    """POST /api/v1/deploy/prepare response body."""
    approval_compiled: str = Field(..., description="Base64-encoded compiled approval program.")
    clear_compiled: str = Field(..., description="Base64-encoded compiled clear program.")
    extra_pages: int = Field(default=0, ge=0, le=3, description="Extra 8 KiB program pages needed.")
    suggested_params: SuggestedParamsResponse


class SubmitRequest(BaseModel):
    """POST /api/v1/deploy/submit request body."""
    signed_txn: str = Field(
        ...,
        min_length=1,
        max_length=100_000,
        description="Base64-encoded signed transaction.",
    )
    network: str = Field(default="testnet", pattern="^(testnet|mainnet)$")


class SubmitResponse(BaseModel):
    """POST /api/v1/deploy/submit response body."""
    txid: str
    explorer_url: str
    app_id: int = Field(default=0, description="Application ID assigned by the network.")
    logs: list[str] = Field(default_factory=list, description="Base64-encoded log entries from the confirmed transaction.")


class SuggestParamsRequest(BaseModel):
    """POST /api/v1/deploy/suggest-params request body."""
    network: str = Field(default="testnet", pattern="^(testnet|mainnet)$")


# ── Chat ──────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    """Single chat conversation message."""
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=10_000)


class ChatContext(BaseModel):
    """Optional IDE context sent alongside a chat message."""
    current_code: str | None = None
    current_step: str | None = None
    latest_error: str | None = None


class ChatRequest(BaseModel):
    """POST /api/v1/chat request body."""
    message: str = Field(
        ...,
        min_length=1,
        max_length=2_000,
        description="User's chat message.",
    )
    history: list[ChatMessage] = Field(
        default_factory=list,
        max_length=20,
        description="Previous conversation messages (max 20).",
    )
    context: ChatContext | None = Field(
        default=None,
        description="Current IDE context (code, step, errors).",
    )


class ChatResponse(BaseModel):
    """POST /api/v1/chat response body."""
    reply: str
    suggestions: list[str] = Field(default_factory=list)


# ── Analyze (Contract Visualizer) ─────────────────────────────

class AnalyzeRequest(BaseModel):
    """POST /api/v1/analyze request body."""
    algorand_python_code: str = Field(
        ...,
        min_length=1,
        max_length=100_000,
        description="Converted Algorand Python source code to analyze.",
    )
    arc32_json: dict | None = Field(
        default=None,
        description="Optional ARC-32 app spec JSON from Puya compilation.",
    )
    solidity_code: str | None = Field(
        default=None,
        max_length=50_000,
        description="Optional original Solidity source for mapping table.",
    )


class AnalyzedStateVariable(BaseModel):
    """A single state variable extracted from algopy code."""
    name: str
    storage_type: str
    data_type: str
    default_value: str | None = None


class AnalyzedMethodParam(BaseModel):
    """A single method parameter."""
    name: str
    type: str


class AnalyzedMethod(BaseModel):
    """An ABI method or baremethod extracted from algopy code."""
    name: str
    decorator: str
    params: list[AnalyzedMethodParam] = Field(default_factory=list)
    return_type: str = "None"
    is_readonly: bool = False
    is_create: bool = False
    allowed_actions: list[str] = Field(default_factory=list)
    guards_count: int = 0
    reads_state: list[str] = Field(default_factory=list)
    writes_state: list[str] = Field(default_factory=list)
    calls_methods: list[str] = Field(default_factory=list)
    inner_txns: list[str] = Field(default_factory=list)
    emits_events: list[str] = Field(default_factory=list)
    line_number: int | None = None
    abi_signature: str | None = None
    description: str | None = None


class AnalyzedSubroutine(BaseModel):
    """A subroutine or helper function extracted from algopy code."""
    name: str
    decorator: str = "subroutine"
    params: list[AnalyzedMethodParam] = Field(default_factory=list)
    return_type: str = "None"
    reads_state: list[str] = Field(default_factory=list)
    writes_state: list[str] = Field(default_factory=list)
    calls_methods: list[str] = Field(default_factory=list)
    inner_txns: list[str] = Field(default_factory=list)
    emits_events: list[str] = Field(default_factory=list)
    guards_count: int = 0
    line_number: int | None = None


class CallGraphEdge(BaseModel):
    """An edge in the internal call graph."""
    from_: str = Field(alias="from")
    to: str

    model_config = {"populate_by_name": True}


class StorageAccessEdge(BaseModel):
    """An edge representing a method's access to a state variable."""
    method: str
    variable: str
    access_type: str  # "read" | "write"


class InnerTxnEdge(BaseModel):
    """An edge representing a method's inner transaction."""
    method: str
    txn_type: str


class AnalyzedEvent(BaseModel):
    """An event emitted by the contract."""
    name: str
    emitted_by: list[str] = Field(default_factory=list)


class SecurityNote(BaseModel):
    """An auto-generated security observation."""
    type: str  # "safe" | "warning" | "danger" | "info"
    message: str
    method: str | None = None


class SolidityMappingEntry(BaseModel):
    """A single Solidity → Algorand concept mapping."""
    solidity_element: str
    algorand_element: str
    mapping_type: str  # "storage" | "context" | "control_flow" | "event" | "visibility" | etc.


class AnalyzeResponse(BaseModel):
    """POST /api/v1/analyze response body."""
    contract_name: str
    state_variables: list[AnalyzedStateVariable] = Field(default_factory=list)
    methods: list[AnalyzedMethod] = Field(default_factory=list)
    subroutines: list[AnalyzedSubroutine] = Field(default_factory=list)
    call_graph: list[CallGraphEdge] = Field(default_factory=list)
    storage_access_map: list[StorageAccessEdge] = Field(default_factory=list)
    inner_txn_map: list[InnerTxnEdge] = Field(default_factory=list)
    events: list[AnalyzedEvent] = Field(default_factory=list)
    security_notes: list[SecurityNote] = Field(default_factory=list)
    solidity_mapping: list[SolidityMappingEntry] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


# ── Multi-contract Analyze ────────────────────────────────────

class MultiAnalyzeContractEntry(BaseModel):
    """A single contract entry in a multi-contract analysis request."""
    name: str = Field(..., description="Contract name/identifier.")
    algorand_python_code: str = Field(..., min_length=1, max_length=100_000)
    arc32_json: dict | None = None
    solidity_code: str | None = None


class MultiAnalyzeRequest(BaseModel):
    """POST /api/v1/analyze-multi request body."""
    contracts: list[MultiAnalyzeContractEntry] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="List of contracts to analyze together.",
    )


class InterContractEdge(BaseModel):
    """An edge representing a relationship between two contracts."""
    from_contract: str
    to_contract: str
    relationship_type: str
    via_method: str | None = None


class MultiAnalyzeResponse(BaseModel):
    """POST /api/v1/analyze-multi response body."""
    contracts: list[AnalyzeResponse] = Field(default_factory=list)
    inter_contract_edges: list[InterContractEdge] = Field(default_factory=list)
    deployment_order: list[str] = Field(default_factory=list)
