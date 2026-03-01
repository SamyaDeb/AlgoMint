# Multi-Contract Interconnected Deployment — Implementation Guide

> **Goal:** Users create multiple Solidity files, convert/compile each independently, deploy in order, and manually paste App IDs from earlier deployments into the create-method parameters of dependent contracts.

---

## Architecture Overview

1. User creates multiple `.sol` files (e.g., Token.sol, Staking.sol) in the file explorer
2. Converts each file's Solidity → Algorand Python one at a time
3. Compiles each file → TEAL + ARC-32 one at a time
4. Deploys Token first → gets App ID (shown with Copy button)
5. Clicks Deploy on Staking → IDE reads ARC-32, finds `create(uint64)` method
6. IDE shows input field for `token_app_id (uint64)` — user pastes Token's App ID
7. Deploys Staking with Token's App ID baked into the create transaction
8. Both contracts are now live and linked on-chain

---

## Phase 1 — Multi-File State Management

### Goal
Currently `page.tsx` stores a single `solidityCode` string derived from `contract.sol`. You need **per-file** storage of converted code, compilation results, and deploy state.

### Steps

1. **Define a `ContractFile` interface** in `types/index.ts` with fields: `id` (filename), `solidityCode`, `algorandPythonCode`, `compilationResult`, `arc32AppSpec`, `arc56Json`, `approvalTeal`, `clearTeal`, `stateSchema`, `deployResult`, and a `status` enum (`"empty" | "pasted" | "converted" | "compiled" | "deployed"`).

2. **Add `contractFiles` state** in `page.tsx` as a `Map<string, ContractFile>` alongside the existing `files` (FileNode[]) state. Also add an `activeContractId` string state.

3. **Create helper functions** `getContractFile(id)` and `updateContractFile(id, partialUpdates)` for reading/updating entries in the map.

4. **Sync FileNode edits with ContractFile**: In the SolidityEditor's `onChange` handler (around line 1060 of page.tsx), when the user edits a `.sol` file, update both the `files` array (FileNode content) and the `contractFiles` map (solidityCode + status).

5. **Initialize on mount**: Add a `useEffect` that iterates over `files` and populates `contractFiles` for any `.sol` FileNode that doesn't already have an entry.

---

## Phase 2 — Per-File Convert Flow

### Goal
`handleConvert()` currently always converts the single `solidityCode`. Change it to convert whichever `.sol` file is currently active.

### Steps

1. **Determine target file**: At the start of `handleConvert`, check if `activeTabId` ends with `.sol`. If so, use that as the target. Otherwise fall back to `"contract.sol"`.

2. **Read source from ContractFile**: Use `getContractFile(targetFileId).solidityCode` instead of the global `solidityCode` variable.

3. **Store result in ContractFile**: After a successful conversion, call `updateContractFile(targetFileId, { algorandPythonCode, stateSchema, status: "converted" })`.

4. **Keep legacy state updated**: Also set the existing global `algorandPythonCode`, `stateSchema`, `isConverted` etc. for backward compatibility with other components.

5. **Open per-file algopy tab**: Create/open a tab named `Token.algo.py` (derived from `Token.sol`) instead of always using `converted.algo.py`.

6. **Update `getActiveContent()`**: Add a case for tabs ending in `.algo.py` — look up the corresponding `.sol` file's ContractFile and return its `algorandPythonCode`.

---

## Phase 3 — Per-File Compile Flow

### Goal
`handleCompile()` currently compiles the global `algorandPythonCode`. Change it to compile the active file's converted code.

### Steps

1. **Determine target file**: If `activeTabId` ends with `.algo.py`, derive the `.sol` file ID. If it ends with `.sol`, use that directly. Otherwise fall back to `"contract.sol"`.

2. **Read code from ContractFile**: Use `getContractFile(targetSolId).algorandPythonCode` as the code to compile.

3. **Store all compilation artifacts in ContractFile**: After successful compilation, update the ContractFile with `approvalTeal`, `clearTeal`, `arc32AppSpec`, `arc56Json`, `compilationResult`, `stateSchema`, and set `status: "compiled"`.

4. **AI fix retry loop**: Keep the existing retry logic (up to `maxRetries` attempts), but read/write the algopy code from/to the ContractFile instead of the global variable.

5. **Keep legacy state updated**: Also set global `approvalTeal`, `clearTeal`, `isCompiled`, `arc32AppSpec` for backward compatibility.

---

## Phase 4 — Per-File Deploy with Create Method Arg Inputs

### Goal
This is the **most important phase**. When the user clicks Deploy, the IDE reads the ARC-32 spec, checks if the `create` method has parameters, and shows input fields. The user pastes App IDs (or other values) into those fields.

### Steps

1. **Create `getCreateMethodArgs()` helper** in `SidePanel.tsx` (inside DeployPanel):
   - Takes an `ARC32AppSpec | null`
   - Iterates through `spec.hints` looking for a method with `call_config.no_op === "CREATE"` or `call_config.opt_in === "CREATE"`
   - If found, returns that method's `args` array
   - Fallback: look for a method named `"create"` and return its args
   - Returns empty array if no create args found

2. **Add create arg state**: In DeployPanel, add `createArgValues` state (`Record<string, string>`) and an `updateCreateArg` function.

3. **Render input fields**: When `createArgs.length > 0` and the contract is compiled, show a section titled "CREATE METHOD PARAMETERS" with one text input per argument. Each input shows the arg name and type (e.g., `token_app_id (uint64)`).

4. **Update `onDeploy` prop signature**: Change `onDeploy` to accept an optional `createArgs?: Record<string, string>` parameter. Pass `createArgValues` when the Deploy button is clicked.

5. **Disable deploy button** if create args exist but any input is empty.

6. **Update `handleDeploy` in page.tsx**: Accept `createArgValues` parameter. When create args are provided:
   - Find the create method in the ARC-32 spec (same logic as `getCreateMethodArgs`)
   - Build the ARC-4 method signature string
   - Use `algosdk.ABIMethod` to get the 4-byte method selector
   - Encode each argument using `algosdk.ABIType.from(argType).encode(value)` — convert to `BigInt` for uint types, boolean for bool, decode address for address type
   - Build `appArgs` array: `[selector, encodedArg1, encodedArg2, ...]`
   - Pass `appArgs` into `makeApplicationCreateTxnFromObject()`
   - Log the method signature and arg values

7. **When no create args**: Keep the existing bare `makeApplicationCreateTxnFromObject()` call (no `appArgs`).

8. **Store deploy result in ContractFile**: After successful deployment, call `updateContractFile(targetFileId, { deployResult, status: "deployed" })`.

---

## Phase 5 — "Previously Deployed" Quick-Reference Panel

### Goal
When deploying a contract that needs an App ID, show a clickable list of previously deployed contracts so the user can easily copy App IDs.

### Steps

1. **Add a "DEPLOYED APP IDs" section** in DeployPanel, shown only when `deployedContracts.length > 0` AND `createArgs.length > 0`.

2. **List each deployed contract** with its name and App ID side by side.

3. **Click to copy**: Clicking any row copies that App ID to the clipboard (use `navigator.clipboard.writeText`). Show a checkmark icon briefly after copying.

4. **Position it above the create args input fields** so the user sees available App IDs right before the input where they need to paste.

---

## Phase 6 — File Status Badges in Sidebar

### Goal
Show the workflow status of each `.sol` file in the file explorer so the user knows at a glance what stage each contract is at.

### Steps

1. **Pass `contractFiles` map as a prop** to SidePanel from page.tsx.

2. **Create a `FileStatusBadge` component** that renders a small colored label based on status:
   - `empty` → dim dash
   - `pasted` → "SOL" (neutral)
   - `converted` → "PY" (teal color)
   - `compiled` → "TEAL" (yellow)
   - `deployed` → "LIVE" (green/accent)

3. **Render the badge** next to each `.sol` file in the file explorer list, pulling the status from `contractFiles.get(fileId)`.

---

## Phase 7 — Deploy Panel Shows Active File's Compilation

### Goal
The deploy panel should clearly indicate which contract is about to be deployed.

### Steps

1. **Add a "DEPLOY TARGET" section** at the top of DeployPanel showing the active contract's name (from `compilationResult.contractName`).

2. **Show basic stats**: approval.teal size in bytes, number of ARC-4 methods detected.

3. **If no contract is compiled**, show "No contract compiled" as a placeholder.

---

## Phase 8 — Conversion Prompt Enhancement for Cross-Contract Calls

### Goal
When the Solidity code references external contracts (imports, interface calls, constructor address params), instruct the AI to generate proper Algorand inner transaction code.

### Steps

1. **Detect cross-contract references** in the Solidity source (new utility function or extend `solidityParser.ts`):
   - Scan for `import "./OtherContract.sol"` patterns
   - Scan for interface-style calls like `Token(addr).method()`
   - Scan for constructor params of type `address` with names like `_tokenAddress`

2. **Pass detected references to the backend** as part of the conversion request. Add an optional `cross_contract_refs: string[]` field to the conversion request schema.

3. **Update the AI prompt in `ai_service.py`**: When cross-contract references are detected, append instructions telling the AI to:
   - Store the dependency's App ID in a `GlobalState(UInt64)` field
   - Accept it as a parameter in the `create` method with `create="require"` decorator
   - Replace external contract calls with inner transactions (`itxn.ApplicationCall`) targeting `Application(self.dep_app_id.value)`

---

## Files To Change

| File | What to Change | Phase |
|------|----------------|-------|
| `frontend/src/types/index.ts` | Add `ContractFile` interface | 1 |
| `frontend/src/app/page.tsx` | Add `contractFiles` state + helpers | 1 |
| `frontend/src/app/page.tsx` | Per-file `handleConvert` + `getActiveContent` update | 2 |
| `frontend/src/app/page.tsx` | Per-file `handleCompile` | 3 |
| `frontend/src/components/IDE/SidePanel.tsx` | `getCreateMethodArgs()` helper + create arg inputs UI | 4 |
| `frontend/src/app/page.tsx` | `handleDeploy(createArgValues?)` with ARC-4 encoding | 4 |
| `frontend/src/components/IDE/SidePanel.tsx` | "Previously Deployed" App ID reference panel | 5 |
| `frontend/src/components/IDE/SidePanel.tsx` | `FileStatusBadge` component | 6 |
| `frontend/src/components/IDE/SidePanel.tsx` | Deploy target indicator | 7 |
| `frontend/src/utils/solidityParser.ts` | Cross-contract reference detection | 8 |
| `backend/app/services/ai_service.py` | Cross-contract prompt instructions | 8 |

---

## Build Order & Priority

| Priority | Phase | Description | Effort |
|----------|-------|-------------|--------|
| Must | Phase 1 | Multi-file state management | 2 hrs |
| Must | Phase 2 | Per-file convert flow | 1.5 hrs |
| Must | Phase 3 | Per-file compile flow | 1.5 hrs |
| Must | Phase 4 | Create method arg detection + deploy with args | 3 hrs |
| High | Phase 5 | Previously Deployed quick-reference panel | 30 min |
| Nice | Phase 6 | File status badges | 30 min |
| Nice | Phase 7 | Deploy target indicator | 20 min |
| High | Phase 8 | AI prompt enhancement for cross-contract | 1 hr |

**Minimum viable feature (Phases 1–4):** ~8 hours
**Full feature (all phases):** ~10.5 hours

---

## Testing Checklist

### Test 1 — Basic Multi-File
- [ ] Create Token.sol and Staking.sol files
- [ ] Paste Solidity into each
- [ ] Verify file explorer shows both files
- [ ] Click each file tab — editor shows correct content

### Test 2 — Per-File Convert
- [ ] Select Token.sol tab → click Convert
- [ ] Verify Token.algo.py tab appears with converted code
- [ ] Select Staking.sol tab → click Convert
- [ ] Verify Staking.algo.py tab appears with different converted code

### Test 3 — Per-File Compile
- [ ] Select Token.algo.py → click Compile
- [ ] Verify compilation succeeds, ARC-32 generated
- [ ] Select Staking.algo.py → click Compile
- [ ] Verify compilation succeeds with its own ARC-32

### Test 4 — Deploy Token (no create args)
- [ ] Token's ARC-32 create method has no args
- [ ] No input fields shown in deploy panel
- [ ] Deploy succeeds → App ID displayed with Copy button

### Test 5 — Deploy Staking (with create args)
- [ ] Staking's ARC-32 create method has `token_app_id: uint64`
- [ ] Input field shown: `token_app_id (uint64): [___________]`
- [ ] "Previously Deployed" section shows Token's App ID
- [ ] Paste Token's App ID into the input
- [ ] Deploy succeeds → App ID displayed

### Test 6 — Verify On-Chain
- [ ] Open Staking's App ID on Pera Explorer
- [ ] Check Global State → `token_app_id` = Token's App ID
- [ ] Call a method on Staking that triggers an inner txn to Token
