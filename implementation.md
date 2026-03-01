# AlgoMint — Visual Contract Explorer & Multi-Contract Deployment

## Implementation Guide (Phase-wise, Step-by-Step)

---

## FEATURE 1: Visual Contract Explorer

The goal is to build a colorful, interactive flow-diagram-based contract visualizer (inspired by Solidity Visual Developer / Solidity Visualizer). When a user clicks a "Visualizer" button, the right half of the editor area splits to show a rich visual diagram of their converted Algorand Python contract — including state variables, methods, internal flows, storage access patterns, inner transactions, and security hints.

---

### Phase 1 — Backend: Contract Analyzer Service

**Goal:** Parse the converted Algorand Python code and ARC-32 JSON on the backend, extract every structural element, and return a structured JSON payload that the frontend can render into a diagram.

**Step 1.1 — Create `backend/app/services/contract_analyzer.py`**

- Create a new service file.
- Define a function `analyze_contract(algopy_code: str, arc32_json: dict | None, solidity_code: str | None) -> dict`.
- This function should use Python's `ast` module (standard library) to parse the algopy code into an AST.
- Walk the AST and extract:
  - **Contract class name** — find the class that inherits from `ARC4Contract` or `Contract`.
  - **State variables** — look for assignments in `__init__` that call `GlobalState(...)`, `LocalState(...)`, or `BoxMap(...)` / `Box(...)`. Capture variable name, storage type (global/local/box), data type (e.g., `UInt64`, `Bytes`, `String`, `arc4.UInt64`), and default value if present.
  - **ABI methods** — find all methods decorated with `@arc4.abimethod` or `@arc4.baremethod`. Capture method name, decorator type (abimethod/baremethod), the `create` / `allow_actions` arguments on the decorator, parameter names and types, return type, whether it's read-only (decorator has `readonly=True` or `read_only=True`).
  - **Subroutines** — find methods decorated with `@subroutine`. Capture name, params, return type.
  - **Internal calls** — for each method/subroutine, find all `self.xxx()` calls. Record caller → callee relationships. This forms the internal call graph.
  - **Storage access** — for each method, scan for `self.<state_var>.get()`, `.set()`, `.value`, `self.<state_var>[]`. Record which methods read/write which state variables.
  - **Inner transactions** — scan for `itxn.` calls, `InnerTransaction`, `itxn.ApplicationCall`, `itxn.Payment`, `itxn.AssetTransfer`. Record which methods make inner transactions and what type.
  - **Assertions / Guards** — scan for `assert` statements and `op.err()` calls. Record which methods have how many guards.
  - **Events** — scan for `arc4.emit(...)` calls. Record event name and which methods emit them.

**Step 1.2 — Build the response structure**

- The returned dict should have this shape (design it as nested dicts/lists):
  - `contract_name`: string
  - `state_variables`: list of `{ name, storage_type, data_type, default_value }`
  - `methods`: list of `{ name, decorator, params, return_type, is_readonly, is_create, allowed_actions, guards_count, reads_state: [var_names], writes_state: [var_names], calls_methods: [method_names], inner_txns: [txn_types], emits_events: [event_names] }`
  - `subroutines`: list of `{ name, params, return_type, reads_state, writes_state, calls_methods }`
  - `call_graph`: list of `{ from, to }` edges
  - `storage_access_map`: list of `{ method, variable, access_type: "read" | "write" }` edges
  - `inner_txn_map`: list of `{ method, txn_type }` edges
  - `events`: list of `{ name, emitted_by: [method_names] }`
  - `security_notes`: list of `{ type, message, method? }` — auto-generated warnings like "no assertion guards", "unchecked sender", etc.
  - `solidity_mapping`: if Solidity code is provided, include a list of `{ solidity_element, algorand_element, mapping_type }` — e.g., `{ "mapping(address => uint256)", "BoxMap(Account, UInt64)", "storage" }`

**Step 1.3 — Add Solidity-to-Algorand mapping logic**

- If both Solidity code and algopy code are provided, generate a mapping table:
  - Parse the Solidity for `mapping(...)` → mapped to `BoxMap`/`GlobalState`
  - Parse for `modifier` → mapped to `@subroutine` helpers
  - Parse for `event` → mapped to `arc4.emit()`
  - Parse for `msg.sender` → mapped to `Txn.sender`
  - Parse for `payable` → mapped to inner payment txns
  - Parse for visibility (`public`/`external`/`internal`) → mapped to `@abimethod`/`@subroutine`
  - This mapping is informational only (displayed in a table in the visualizer).

**Step 1.4 — Handle edge cases**

- If the algopy code fails to parse (syntax error), return a partial result with an `errors` field listing parse errors.
- If there are multiple classes in the file, analyze all of them but mark which is the primary contract.
- If `arc32_json` is provided, cross-reference method names from the ABI spec and annotate methods with their ABI selector signatures.

---

### Phase 2 — Backend: Analyze Endpoint

**Goal:** Expose the contract analyzer as a REST API endpoint.

**Step 2.1 — Create request/response schemas**

- In `backend/app/models/schemas.py`, add:
  - `AnalyzeRequest` — fields: `algorand_python_code` (str, required), `arc32_json` (dict | None, optional), `solidity_code` (str | None, optional)
  - `AnalyzeResponse` — fields: mirrors the dict structure from Phase 1 (contract_name, state_variables, methods, subroutines, call_graph, storage_access_map, inner_txn_map, events, security_notes, solidity_mapping, errors)

**Step 2.2 — Create the route**

- Create `backend/app/routes/analyze.py`.
- Add a `POST /api/v1/analyze` endpoint.
- Rate limit: 30 requests per minute (similar to suggest-params).
- Call `contract_analyzer.analyze_contract(...)` with the request data.
- Return `AnalyzeResponse`.

**Step 2.3 — Register the route**

- In `backend/app/main.py`, import and include the new `analyze` router.
- Add the `/api/v1/analyze` prefix.

**Step 2.4 — Test the endpoint**

- Manually test with a sample algopy contract (e.g., the one generated by converting a simple Solidity contract).
- Verify the response contains all expected fields.
- Check that call_graph edges are correct.
- Check that storage_access_map correctly identifies reads vs writes.

---

### Phase 3 — Frontend: API Integration & State Management

**Goal:** Wire the frontend to call the analyze endpoint and store the visualization data.

**Step 3.1 — Add API function**

- In `frontend/src/lib/api.ts`, add an `analyzeContract(algorandPythonCode, arc32Json?, solidityCode?)` function.
- It should POST to `/api/v1/analyze` and return the typed response.

**Step 3.2 — Add TypeScript types**

- In `frontend/src/types/index.ts`, define all the types matching the backend response:
  - `ContractAnalysis` (top-level)
  - `AnalyzedStateVariable`, `AnalyzedMethod`, `AnalyzedSubroutine`
  - `CallGraphEdge`, `StorageAccessEdge`, `InnerTxnEdge`
  - `AnalyzedEvent`, `SecurityNote`, `SolidityMapping`

**Step 3.3 — Add state to page.tsx**

- In `page.tsx`, add state: `const [contractAnalysis, setContractAnalysis] = useState<ContractAnalysis | null>(null)`.
- Add state: `const [isVisualizerOpen, setIsVisualizerOpen] = useState(false)`.
- Add a handler function `handleAnalyze()` that calls `analyzeContract()` with the current converted code, ARC-32 JSON, and Solidity code.
- Wire this to be callable from the UI.

---

### Phase 4 — Frontend: Split Editor Layout for Visualizer

**Goal:** When the visualizer is toggled on, the editor area (right of side panel) splits into two halves — left half keeps the code editor, right half shows the visualizer. Like a VS Code split pane.

**Step 4.1 — Add a "Visualizer" toggle button**

- In `TabBar.tsx`, add a new toggle button in the right-side button group (next to the existing Sidebar, Terminal, Chat toggles).
- Use a lucide-react icon like `Share2` or `GitBranch` or `Network` — something that suggests a diagram/graph.
- The button should be visually distinct (use the accent teal color when active).
- The button should only be visible/enabled when there is converted Algorand Python code available (i.e., after a successful conversion).
- Clicking it toggles `isVisualizerOpen` state.

**Step 4.2 — Modify the editor area layout in page.tsx**

- The editor area is currently a single flex column: TabBar → content → terminal.
- When `isVisualizerOpen` is true, the content area (between TabBar and Terminal) should become a horizontal flex container with two children:
  - **Left half:** The existing code editor (SolidityEditor or ConvertedCodeViewer), taking 50% width.
  - **Right half:** The new `ContractVisualizer` component, taking 50% width.
- Add a draggable divider between them so the user can resize the split (similar to how the side panel resize handle works).
- When `isVisualizerOpen` is false, the editor takes full width as it does today.

**Step 4.3 — Handle responsive behavior**

- Set a minimum width for each half (e.g., 250px) so neither pane gets too small.
- Store the split ratio in state so it persists during the session.
- On narrow screens (below a breakpoint), consider stacking vertically instead of side-by-side, or just disable the split.

**Step 4.4 — Auto-trigger analysis**

- When the user opens the visualizer for the first time (or when the converted code changes), automatically call `handleAnalyze()` to fetch fresh analysis data.
- Show a loading spinner in the visualizer pane while waiting.
- Cache the analysis result so toggling the visualizer on/off doesn't re-fetch unnecessarily.

---

### Phase 5 — Frontend: ContractVisualizer Component (Single Contract)

**Goal:** Build the main visualization component that renders a colorful, interactive flow diagram inside the right half of the editor area.

**Step 5.1 — Create `frontend/src/components/Visualizer/ContractVisualizer.tsx`**

- This is the top-level visualizer component.
- Props: `{ analysis: ContractAnalysis | null; isLoading: boolean }`.
- It should render a scrollable container with a dark background (matching the IDE theme) and several visual sections.

**Step 5.2 — Contract Header Section**

- At the top, render the contract name in a large, bold font with the accent teal color.
- Below it, show a summary bar with colored badges:
  - Number of state variables (purple badge)
  - Number of ABI methods (teal badge)
  - Number of subroutines (blue badge)
  - Number of inner transactions (orange badge)
  - Number of events (green badge)
  - Number of security warnings (red/yellow badge)
- This is similar to how the ASTViewer shows its summary bar, but more colorful.

**Step 5.3 — State Variables Section**

- Render a titled section "State Variables" with a purple left border.
- Each state variable is a small card/pill showing:
  - Variable name (bold)
  - Storage type badge (color-coded): GlobalState → green, LocalState → blue, Box → orange, BoxMap → yellow
  - Data type (monospace, muted text)
  - Default value if present
- Arrange them in a responsive grid (2-3 per row).

**Step 5.4 — Methods Flow Diagram (THE CORE)**

This is the centerpiece — a visual flow diagram showing all methods, their relationships, state access, and inner transactions.

**Layout approach — Use a node-and-edge diagram:**

- Each ABI method is a **node** (colored card):
  - Background color by type: `create` methods → green tint, `readonly` methods → blue tint, regular methods → teal tint, `baremethod` → gray tint.
  - Show method name (bold), parameter types (small text), return type (small text).
  - Show small icons/badges for: number of guards (shield icon), inner txns (link icon), events emitted (bell icon).
- Each subroutine is a **smaller node** (dashed border, lighter color).
- Draw **edges (arrows)** between nodes:
  - Method → Method calls: solid arrows
  - Method → Subroutine calls: dashed arrows
- Draw **edges to state variables:**
  - Read access: thin arrow from state variable to method (blue)
  - Write access: thick arrow from method to state variable (orange/red)

**Rendering approach :**

- Use React Flow** — Install `reactflow` npm package. It provides a proper node-edge graph with drag, zoom, pan. More polished but adds a dependency.


Decision point: Pick one approach. Option A is fastest for a hackathon. Option B looks most professional.

**Step 5.5 — Storage Access Pattern View**

- Below the flow diagram, show a matrix/table:
  - Rows: methods
  - Columns: state variables
  - Cells: colored dots — blue for read, orange for write, purple for read+write, empty for no access.
- This gives a quick at-a-glance view of which methods touch which state.

**Step 5.6 — Inner Transaction View**

- If any methods make inner transactions, show a sub-section with cards for each method that makes inner txns.
- Each card shows: method name → transaction type (Payment, AssetTransfer, ApplicationCall) with an icon and arrow to indicate "this method triggers an inner transaction of type X."
- Use distinct colors: Payment → green, AssetTransfer → blue, ApplicationCall → purple.

**Step 5.7 — Events Section**

- If the contract emits events (via `arc4.emit()`), show them in a separate row.
- Each event is a small bell-shaped or signal-shaped badge with:
  - Event name
  - List of methods that emit it (linked as arrows or text).

**Step 5.8 — Solidity ↔ Algorand Mapping Table**

- If Solidity source was provided, render a comparison table:
  - Left column: Solidity concept (e.g., `mapping(address => uint256)`, `payable`, `modifier onlyOwner`)  
  - Arrow →
  - Right column: Algorand equivalent (e.g., `BoxMap(Account, UInt64)`, `itxn.Payment`, `@subroutine + assert`)
  - Color-code rows by mapping type (storage → purple, access control → red, events → green, etc.)

**Step 5.9 — Security Notes Section**

- At the bottom, render security observations in warning-style cards:
  - Yellow cards for medium concerns (e.g., "method X has no assertion guards")
  - Red cards for high concerns (e.g., "method X performs inner transaction without sender check")
  - Green cards for positive notes (e.g., "all methods have sender validation")

---

### Phase 6 — Styling & Color Scheme

**Goal:** Make the visualizer colorful, polished, and visually consistent with the IDE theme while being vibrant enough to stand out (inspired by Solidity Visualizer's colorful style).

**Step 6.1 — Define a color palette for the visualizer**

Add CSS custom properties in `globals.css` specifically for the visualizer:

- Method node colors:
  - Create method: `#10B981` (emerald green) background with `#064E3B` text
  - Read-only method: `#3B82F6` (blue) background
  - Regular ABI method: `#00D4AA` (accent teal) background
  - Bare method: `#6B7280` (gray) background
  - Subroutine: `#8B5CF6` (purple) background with dashed border

- State variable colors:
  - GlobalState: `#22C55E` (green)
  - LocalState: `#3B82F6` (blue)
  - Box: `#F59E0B` (amber)
  - BoxMap: `#EAB308` (yellow)

- Edge/arrow colors:
  - Method-to-method call: `#94A3B8` (slate gray)
  - Read access: `#60A5FA` (light blue)
  - Write access: `#F97316` (orange)
  - Inner transaction: `#A855F7` (purple)

- Security colors:
  - Safe: `#22C55E`
  - Warning: `#F59E0B`
  - Danger: `#EF4444`

**Step 6.2 — Node card styling**

- Each method node card should have:
  - Rounded corners (8-12px)
  - Semi-transparent background (using the palette above with 15-20% opacity)
  - Left border (4px solid) in the full color
  - Subtle box-shadow for depth
  - Hover effect: slightly brighter background + stronger shadow
  - Click effect: opens a detail popover or expands the card to show full method details

**Step 6.3 — Connection/arrow styling**

- If using SVG overlays:
  - Arrows should be smooth (use quadratic or cubic bezier paths, not straight lines)
  - Different stroke widths for different edge types (1px for reads, 2px for writes, 2px dashed for calls)
  - Arrowhead markers at the end
  - On hover, highlight the arrow and both connected nodes
- If using React Flow:
  - Use animated edges for active transactions
  - Use different edge styles (default, step, smoothstep) for different types

**Step 6.4 — Animations**

- Nodes should fade-in with a slight stagger when the visualizer opens.
- When hovering a method node, connected state variables and called methods should highlight (other nodes dim slightly).
- Connection lines should have a subtle dash animation (CSS `stroke-dashoffset` animation) to show flow direction.

**Step 6.5 — Legend**

- Add a small legend panel (collapsible) at the top-right corner of the visualizer:
  - Shows what each color means (method types, access types)
  - Shows what each line style means (solid, dashed, thick)
  - Uses small colored squares/circles and labels.

---

### Phase 7 — Interactivity

**Goal:** Make the visualizer interactive — clickable nodes, hover highlights, zoom/pan.

**Step 7.1 — Click-to-detail**

- When a user clicks a method node, show a detail panel (popover/modal/inline expansion) with:
  - Full method signature
  - List of parameters with types and descriptions (from ARC-32)
  - Return type
  - Which state variables it reads/writes
  - Which methods it calls
  - Inner transactions it creates
  - Events it emits
  - Number of assertion guards
  - The ABI method selector (from ARC-32)

**Step 7.2 — Hover highlighting**

- When hovering over a method node:
  - All state variables accessed by that method glow/highlight
  - All methods called by it highlight
  - All connection arrows to/from it become bright, others fade to ~20% opacity
- When hovering over a state variable card:
  - All methods that access it highlight
  - Connection arrows from/to it become bright

**Step 7.3 — Zoom and pan (if using React Flow)**

- Enable zoom (scroll wheel), pan (drag background), fit-to-view button.
- Add a minimap in the corner for large contracts.

**Step 7.4 — Navigation: Click to jump to code**

- When a user double-clicks a method node in the visualizer, scroll the left-side code editor to that method's position in the converted code.
- This requires passing line number information from the backend analysis (the Python `ast` module provides `lineno` for each node).
- In the Monaco editor, use `editor.revealLineInCenter(lineNumber)` to scroll to the relevant line.

---

## FEATURE 2: Multi-Contract Visualization

When the user deploys multiple contracts (or converts multiple contracts), the visualizer should show all contracts together with their inter-contract relationships.

---

### Phase 8 — Multi-Contract Data Model

**Goal:** Extend the data model to support analyzing and visualizing multiple contracts at once.

**Step 8.1 — Extend the backend analyzer for multi-contract**

- Add a new function `analyze_multi_contract(contracts: list[dict]) -> dict` in `contract_analyzer.py`.
- Each dict in the list contains: `{ name, algopy_code, arc32_json?, solidity_code? }`.
- For each contract, call `analyze_contract(...)` to get individual analyses.
- Then, build **inter-contract relationships**:
  - Scan each contract's methods for `itxn.ApplicationCall` that references another contract's app_id.
  - Scan for constructor parameters or state variables that store other contract app IDs (e.g., `self.other_app = GlobalState(Application)`).
  - Build a list of `{ from_contract, to_contract, relationship_type, via_method? }` edges.
- Return: `{ contracts: [individual analyses], inter_contract_edges: [edges], deployment_order: [names in topological order] }`.

**Step 8.2 — Add multi-analyze endpoint**

- Add `POST /api/v1/analyze-multi` endpoint.
- Request: `{ contracts: [{ name, algorand_python_code, arc32_json?, solidity_code? }] }`.
- Response: the multi-contract analysis result.
- Rate limit: 10 requests per minute (heavier operation).

**Step 8.3 — Frontend types for multi-contract analysis**

- In `types/index.ts`, add:
  - `MultiContractAnalysis` — `{ contracts: ContractAnalysis[], inter_contract_edges: InterContractEdge[], deployment_order: string[] }`
  - `InterContractEdge` — `{ from_contract: string, to_contract: string, relationship_type: string, via_method?: string }`

**Step 8.4 — Frontend state for multi-contract**

- In `page.tsx`, update `contractAnalysis` state to accept either single or multi-contract analysis.
- OR add a separate `multiContractAnalysis` state.
- Determine which to use based on whether the user has multiple converted contracts or multiple deployed contracts.

---

### Phase 9 — Multi-Contract Visualizer UI

**Goal:** Render multiple contracts together in the visualizer with inter-contract connections.

**Step 9.1 — Multi-contract layout**

- When multiple contracts are analyzed:
  - Each contract gets its own **swimlane** (horizontal band) or **grouped box** in the visualizer.
  - Contracts are arranged vertically or in a grid layout.
  - Each contract box has a colored header with the contract name and a border in a distinct color.
  - Inside each box, show the same flow diagram as single-contract (methods, state, etc.), but more compact.

**Step 9.2 — Inter-contract connection arrows**

- Between contract groups, draw **cross-contract arrows**:
  - If Contract A's method calls Contract B via `itxn.ApplicationCall`, draw a thick purple arrow from that method node in A's group to Contract B's header.
  - Label the arrow with the relationship type (e.g., "ApplicationCall", "reads state from", "depends on").
  - These arrows should be visually distinct from intra-contract arrows (thicker, different color, possibly animated).

**Step 9.3 — Deployment order indicator**

- If the multi-analysis includes a `deployment_order`, show a small numbered badge on each contract header indicating its deployment sequence:
  - Contract 1: "Deploy 1st" (green)
  - Contract 2: "Deploy 2nd" (blue)
  - Contract 3: "Deploy 3rd" (purple)
- Draw downward arrows between them in deployment order.

**Step 9.4 — Contract focus/filter**

- Add a toggle or tab bar at the top of the visualizer to:
  - "All Contracts" — shows the full multi-contract view
  - Click a specific contract name — zooms into just that contract's detailed view (full single-contract visualizer)
- Smooth transition between views.

---

### Phase 10 — Connecting Deployed Contracts to Visualizer

**Goal:** After deploying contracts, the deployed contract data (app IDs, addresses) should be reflected in the visualizer.

**Step 10.1 — Pass deployed contract data to visualizer**

- When contracts are deployed, each gets an `appId` and `appAddress`.
- Pass the list of `DeployedContract` objects to the visualizer component.
- In the visualizer, overlay deployment badges on the contract headers:
  - Show the app ID (e.g., "App #12345") in a green badge
  - Show the app address (truncated)
  - Show the network (testnet/mainnet)
  - Show the deployment timestamp

**Step 10.2 — Visual state for deployed vs undeployed**

- Contracts that are deployed: full color, solid borders, "LIVE" badge
- Contracts that are not yet deployed: muted/dimmed colors, dashed borders, "NOT DEPLOYED" label
- If a contract depends on another that isn't deployed yet, show a warning arrow in red: "Dependency not deployed"

**Step 10.3 — Link deployed contracts in multi-contract view**

- When multiple contracts are deployed and one references another:
  - Show the actual app ID in the connection arrows (e.g., "calls App #12345")
  - The connection becomes "live" (animated green arrow) if both contracts are deployed
  - The connection stays "pending" (dashed gray arrow) if the target isn't deployed yet

---

### Phase 11 — Polish & Edge Cases

**Goal:** Handle all edge cases, add final polish.

**Step 11.1 — Empty states**

- No code converted yet → show a friendly message: "Convert a Solidity contract to see the visualization"
- Analysis failed → show error message with retry button
- Single-method contract → still show the flow diagram, just simpler

**Step 11.2 — Performance**

- For large contracts (50+ methods), consider:
  - Lazy rendering (only render visible nodes)
  - Collapsible sections (collapse subroutines by default)
  - Simplified view toggle (show only method names without details)

**Step 11.3 — Export options**

- Add a small toolbar at the top-right of the visualizer:
  - "Export as PNG" — use `html-to-image` or similar library to capture the visualizer DOM as an image
  - "Export as SVG" — if using SVG-based rendering
  - These are useful for documentation and presentations

**Step 11.4 — Keyboard shortcuts**

- `Cmd+Shift+V` (Mac) / `Ctrl+Shift+V` (Win) — toggle visualizer
- `Escape` when visualizer is focused — close it

**Step 11.5 — Persistence**

- Remember whether the visualizer was open in `localStorage` so it stays open on page reload.
- Remember the split ratio (how wide each half is).

---

## Summary of Files to Create/Modify

### New Files to Create

| File | Purpose |
|------|---------|
| `backend/app/services/contract_analyzer.py` | Core analysis logic — parses algopy code, extracts structure |
| `backend/app/routes/analyze.py` | REST endpoints for `/analyze` and `/analyze-multi` |
| `frontend/src/components/Visualizer/ContractVisualizer.tsx` | Main visualizer component (single contract) |
| `frontend/src/components/Visualizer/MultiContractVisualizer.tsx` | Multi-contract wrapper with swimlanes and cross-contract arrows |
| `frontend/src/components/Visualizer/nodes/MethodNode.tsx` | Reusable method node card component |
| `frontend/src/components/Visualizer/nodes/StateVariableNode.tsx` | Reusable state variable card component |
| `frontend/src/components/Visualizer/nodes/SubroutineNode.tsx` | Reusable subroutine node component |
| `frontend/src/components/Visualizer/FlowDiagram.tsx` | The core flow diagram with nodes and edges |
| `frontend/src/components/Visualizer/StorageAccessMatrix.tsx` | Method × state variable access pattern table |
| `frontend/src/components/Visualizer/MappingTable.tsx` | Solidity ↔ Algorand mapping comparison table |
| `frontend/src/components/Visualizer/SecurityNotes.tsx` | Security observation cards |
| `frontend/src/components/Visualizer/Legend.tsx` | Color/style legend panel |

### Existing Files to Modify

| File | Changes |
|------|---------|
| `backend/app/models/schemas.py` | Add `AnalyzeRequest`, `AnalyzeResponse`, `MultiAnalyzeRequest`, `MultiAnalyzeResponse` schemas |
| `backend/app/main.py` | Register the new analyze router |
| `frontend/src/types/index.ts` | Add all visualization-related TypeScript types |
| `frontend/src/lib/api.ts` | Add `analyzeContract()` and `analyzeMultiContract()` API functions |
| `frontend/src/app/page.tsx` | Add visualizer state, split editor layout logic, pass analysis data down |
| `frontend/src/components/IDE/TabBar.tsx` | Add Visualizer toggle button |
| `frontend/src/app/globals.css` | Add visualizer color palette and styling variables |

---

## Recommended Build Order

1. **Phase 1 + 2** — Backend analyzer + endpoint (get the data flowing first)
2. **Phase 3** — Frontend API integration + types (connect frontend to backend)
3. **Phase 4** — Split editor layout (get the panel placement right)
4. **Phase 5 + 6** — Build the single-contract visualizer with styling (this is the big phase)
5. **Phase 7** — Add interactivity (hover, click, navigation)
6. **Phase 8 + 9** — Multi-contract analysis and visualization
7. **Phase 10** — Deployed contract overlay
8. **Phase 11** — Polish, edge cases, export

Each phase is independently testable. After Phase 4, you can show a placeholder in the right pane and confirm the layout works before building the actual diagram components.

---

## Dependency Decisions to Make Before Starting

1. **Flow diagram rendering library**: CSS/HTML+SVG (no deps, fastest) vs React Flow (`reactflow` npm package, most polished) vs D3 (`d3` npm package, most flexible). Recommendation: React Flow for best hackathon result.

2. **Image export library**: `html-to-image` or `html2canvas` — only needed in Phase 11.

3. **Backend AST parsing approach**: Python `ast` module (standard library, no deps) vs tree-sitter (more robust but heavier). Recommendation: Python `ast` module is sufficient.
