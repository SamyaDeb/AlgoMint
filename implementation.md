# AlgoMint — Implementation Plan

## Feature 1: Live Deployed Contract Gallery

### Phase 1.1 — Prepare Sample Contracts

1. Select 8-10 diverse Solidity contracts covering different categories:
   - Simple ERC-20 Token
   - Escrow Contract
   - Voting / DAO Proposal
   - NFT (ERC-721 style)
   - Auction (English / Dutch)
   - Multisig Wallet
   - Staking / Reward Distribution
   - Access Control / Role-Based
2. Validate each contract compiles in Remix or any Solidity compiler first
3. Store all contracts in a new folder: `backend/scripts/sample_contracts/`
4. Create one Python file listing all contracts as multi-line strings with metadata (name, category, description, complexity level)

### Phase 1.2 — Create a Testnet Deployer Account

1. Generate a new Algorand account (private key + address)
2. Go to Algorand Testnet Dispenser (`https://bank.testnet.algorand.network/`) and fund the account with 50+ testnet ALGOs
3. Store the mnemonic securely in your `.env` file under a variable like `DEPLOYER_MNEMONIC`
4. Never commit this mnemonic to GitHub — add it to `.gitignore`

### Phase 1.3 — Build a One-Time Deployment Script

1. Create `backend/scripts/deploy_gallery.py`
2. This script should loop through each sample contract and:
   - Call your existing `/api/v1/convert` endpoint to convert Solidity → Algorand Python
   - Call your existing `/api/v1/compile` endpoint to compile Algorand Python → TEAL
   - Use `algosdk` to build an `ApplicationCreateTxn` with the compiled TEAL
   - Sign with the deployer private key (from mnemonic)
   - Submit to Algorand testnet via AlgoNode
   - Wait for confirmation and capture the `app_id`
3. After each successful deployment, save the result (name, app_id, tx_id, category, explorer URL)
4. Write all results to `backend/app/data/deployed_gallery.json`
5. Log successes and failures to the terminal

### Phase 1.4 — Run the Deployment Script

1. Activate your virtual environment
2. Run `python scripts/deploy_gallery.py` from the backend directory
3. Verify each app ID exists by checking the explorer links in a browser
4. If any contract fails, note the error, skip it, and manually retry later
5. Commit `deployed_gallery.json` to the repo (this is safe — it only has public app IDs)

### Phase 1.5 — Create the Gallery API Endpoint

1. Create a new route file: `backend/app/routes/gallery.py`
2. Define a `GET /api/v1/gallery` endpoint that reads `deployed_gallery.json` and returns the list
3. Define a `GET /api/v1/gallery/{contract_id}` endpoint for individual contract details
4. Include metadata in the response: contract name, category, complexity, app_id, network, explorer URL, deployment date
5. Register the router in `backend/app/main.py`

### Phase 1.6 — Build the Frontend Gallery View

1. Create a new component: `frontend/src/components/Gallery/GalleryPanel.tsx`
2. On mount, fetch from `/api/v1/gallery`
3. Display contracts as a grid of cards, each showing:
   - Contract name and category badge
   - App ID (large, monospace font)
   - "View on Explorer" button linking to Lora/Allo/Pera explorer
   - Complexity indicator (easy / medium / hard)
   - Solidity line count vs Algorand Python line count
4. Add a "Gallery" icon to the `IconSidebar` component
5. Wire it into the `SidePanel` so clicking the gallery icon shows the gallery view
6. Add a "Try This Contract" button on each card that loads the Solidity source into the editor

### Phase 1.7 — Polish and Test

1. Verify all explorer links work in browser
2. Test the API endpoint returns correct data
3. Test the frontend renders all cards properly
4. Add a header showing total contracts deployed and network name
5. Add loading and empty states

---

## Feature 2: ARC-4 App Spec Auto-Generation

### Phase 2.1 — Understand ARC-4 / ARC-32 / ARC-56 Format

1. Read the ARC-4 spec: understand that it defines how Algorand smart contracts expose their methods (like an API contract)
2. Read the ARC-32 spec: this is the `application.json` format that tools like AlgoKit use to interact with contracts
3. Study 2-3 example `application.json` files from existing Algorand projects to understand the structure
4. Key fields to understand:
   - `name` — contract name
   - `methods` — array of method definitions
   - Each method has: `name`, `args` (array of `{name, type}`), `returns` ({type}), `desc`
   - `networks` — mapping of network IDs to deployed app IDs
   - `source` — optional approval/clear program source

### Phase 2.2 — Build the Solidity-to-ARC4 Type Mapping

1. Create a new service: `backend/app/services/abi_generator.py`
2. Define a mapping dictionary from Solidity types to ARC-4 types:
   - `uint256` / `uint128` → `uint64` (AVM is 64-bit)
   - `uint8` / `uint16` / `uint32` → keep as-is
   - `address` → `address`
   - `bool` → `bool`
   - `string` → `string`
   - `bytes` → `byte[]`
   - `bytes32` → `byte[32]`
   - `uint256[]` → `uint64[]`
3. Handle edge cases: nested mappings, structs, enums
4. For unsupported types, default to `byte[]` with a warning

### Phase 2.3 — Parse Solidity Functions for ABI Extraction

1. In `abi_generator.py`, write a function that takes Solidity source code as input
2. Use your existing Solidity parser (or regex) to extract:
   - All `public` and `external` function names
   - Parameter names and types for each function
   - Return types for each function
   - Constructor parameters
   - Events (map to log entries)
3. Ignore `private` and `internal` functions (they're not part of the ABI)
4. Handle the `view` and `pure` modifiers (mark as read-only in spec)

### Phase 2.4 — Generate the ARC-32 Application JSON

1. Write a function that takes the parsed function data and produces a dictionary matching ARC-32 format
2. For each Solidity public function:
   - Convert the function name to the ARC-4 method name
   - Convert each parameter type using the mapping from Phase 2.2
   - Convert the return type
   - Add a description noting it was converted from Solidity
3. Add contract-level metadata: name, description, version
4. Add the `networks` field (empty by default, populated after deployment)
5. Add the `source` field with approval/clear TEAL if available

### Phase 2.5 — Integrate into the Conversion Pipeline

1. In your convert route (`backend/app/routes/convert.py`), after AI conversion completes:
   - Call the ABI generator with the original Solidity code
   - Generate the ARC-32 `application.json`
   - Include it in the API response as a new field (e.g., `arc32_app_spec`)
2. Update the `ConvertResponse` schema in `backend/app/models/schemas.py` to include the new field
3. The conversion endpoint now returns THREE things:
   - Algorand Python code
   - State schema hints
   - ARC-32 application spec

### Phase 2.6 — Display in Frontend

1. Create a new component: `frontend/src/components/Viewer/AppSpecViewer.tsx`
2. After conversion, show a new tab "App Spec" in the TabBar
3. Display the `application.json` in a pretty-printed JSON viewer with syntax highlighting
4. Add a "Copy" button and a "Download application.json" button
5. Show a summary section above the JSON:
   - Number of methods detected
   - List of method names with their signatures
   - Warnings for unsupported types

### Phase 2.7 — Add Download as AlgoKit Project (Bonus)

1. In the backend, create an endpoint `POST /api/v1/export` that takes:
   - Algorand Python code
   - ARC-32 app spec
   - Contract name
2. Generate a ZIP file containing:
   - `contract.py` — the Algorand Python code
   - `application.json` — the ARC-32 spec
   - `pyproject.toml` — basic project config
   - `.algokit.toml` — AlgoKit project marker
3. Return the ZIP as a downloadable file
4. In the frontend, add a "Download AlgoKit Project" button after successful conversion

---

## Feature 3: Algorand Testnet Faucet Integration

### Phase 3.1 — Understand the Algorand Testnet Dispenser

1. The Algorand Foundation runs a testnet dispenser (faucet) that gives free test ALGO tokens
2. The dispenser has an API endpoint that accepts an Algorand address and sends testnet tokens
3. The dispenser URL: `https://dispenser.testnet.aws.algodev.network` (verify current URL)
4. Alternative: Use AlgoKit's dispenser API if the above doesn't have a public API
5. Research the exact API format: what endpoint, what parameters, what rate limits

### Phase 3.2 — Create the Backend Faucet Endpoint

1. Create a new route file: `backend/app/routes/faucet.py`
2. Define a `POST /api/v1/faucet/fund` endpoint that accepts:
   - `address` — the user's Algorand wallet address
   - `network` — must be "testnet" (reject mainnet requests)
3. Server-side, make an HTTP request to Algorand's testnet dispenser API
4. Pass the user's address to request 5-10 testnet ALGO
5. Return the result: success/failure, amount funded, transaction ID
6. Add rate limiting: max 3 faucet requests per address per hour
7. Register the router in `backend/app/main.py`

### Phase 3.3 — Add Balance Checking

1. In the faucet route (or in the deploy route), add a `GET /api/v1/faucet/balance/{address}` endpoint
2. This calls `algod.account_info(address)` to check the user's current ALGO balance
3. Return the balance in microALGO and ALGO (human-readable)
4. The frontend will use this to decide whether to show the "Fund Wallet" button

### Phase 3.4 — Integrate into Frontend Wallet Flow

1. Open `frontend/src/components/Wallet/WalletConnector.tsx`
2. After the user connects their Pera Wallet:
   - Immediately call `GET /api/v1/faucet/balance/{address}`
   - If balance is below 1 ALGO, show a yellow warning: "Low balance — you need ALGO to deploy"
   - Show a "Get Free Testnet ALGO" button next to the balance display
3. When the button is clicked:
   - Call `POST /api/v1/faucet/fund` with the connected address
   - Show a loading spinner: "Requesting testnet ALGO..."
   - On success: show green checkmark "Funded! You received X ALGO"
   - On failure: show error message with retry option
   - Auto-refresh the balance display

### Phase 3.5 — Add Balance Display to Status Bar

1. Open `frontend/src/components/IDE/StatusBar.tsx`
2. When a wallet is connected, show the balance in the bottom status bar:
   - Format: `◆ 12.345 ALGO (testnet)`
   - Color: green if enough to deploy (>0.5 ALGO), yellow if low (<0.5), red if zero
3. Poll balance every 30 seconds while wallet is connected
4. Show a small "Fund" button in the status bar if balance is low

### Phase 3.6 — Pre-Deploy Balance Check

1. Open the deploy flow in your frontend
2. Before starting deployment:
   - Check balance via API
   - If balance < 0.2 ALGO (minimum needed for app creation):
     - Block deployment
     - Show modal: "Insufficient balance. You need at least 0.2 ALGO to deploy."
     - Show the "Get Free Testnet ALGO" button inside the modal
     - After funding, re-check balance and enable deploy
   - If balance is sufficient, proceed normally
3. This prevents confusing errors during deployment

### Phase 3.7 — Safety and Rate Limiting

1. Ensure faucet endpoint ONLY works for testnet (hardcode check, reject mainnet)
2. Add rate limiting: 3 requests per wallet address per hour
3. Add IP-based rate limiting: 10 requests per IP per hour
4. Log all faucet requests for monitoring
5. Add a disclaimer in the UI: "These are testnet tokens with no real value"

---

## Implementation Timeline

| Day | Phase | Task | Time |
|-----|-------|------|------|
| Day 1 AM | 1.1 | Prepare 8-10 sample Solidity contracts | 1 hr |
| Day 1 AM | 1.2 | Create testnet deployer account and fund it | 30 min |
| Day 1 PM | 1.3 | Build the deployment script | 2 hr |
| Day 1 PM | 1.4 | Run deployment and verify all app IDs | 1 hr |
| Day 1 EVE | 1.5 | Create gallery API endpoint | 1 hr |
| Day 1 EVE | 1.6 | Build frontend gallery view | 2 hr |
| Day 1 | 1.7 | Polish and test gallery | 30 min |
| | | | |
| Day 2 AM | 2.1 | Study ARC-4/ARC-32 spec format | 1 hr |
| Day 2 AM | 2.2 | Build Solidity-to-ARC4 type mapping | 1 hr |
| Day 2 PM | 2.3 | Parse Solidity functions for ABI extraction | 2 hr |
| Day 2 PM | 2.4 | Generate ARC-32 application JSON | 1.5 hr |
| Day 2 EVE | 2.5 | Integrate into conversion pipeline | 1 hr |
| Day 2 EVE | 2.6 | Display app spec in frontend | 1.5 hr |
| Day 2 | 2.7 | AlgoKit export (bonus) | 1 hr |
| | | | |
| Day 3 AM | 3.1 | Research Algorand testnet dispenser API | 30 min |
| Day 3 AM | 3.2 | Create backend faucet endpoint | 1.5 hr |
| Day 3 AM | 3.3 | Add balance checking endpoint | 30 min |
| Day 3 PM | 3.4 | Integrate faucet into wallet flow | 2 hr |
| Day 3 PM | 3.5 | Add balance display to status bar | 1 hr |
| Day 3 EVE | 3.6 | Pre-deploy balance check | 1 hr |
| Day 3 EVE | 3.7 | Safety checks and rate limiting | 30 min |

**Total estimated time: ~3 days / ~22 hours of work**

---

## Files to Create / Modify

### New Files
- `backend/scripts/sample_contracts.py` — sample Solidity contracts
- `backend/scripts/deploy_gallery.py` — one-time deployment script
- `backend/app/data/deployed_gallery.json` — deployment results (generated)
- `backend/app/routes/gallery.py` — gallery API endpoint
- `backend/app/routes/faucet.py` — faucet API endpoint
- `backend/app/services/abi_generator.py` — ARC-4 spec generator
- `frontend/src/components/Gallery/GalleryPanel.tsx` — gallery UI

### Modified Files
- `backend/app/main.py` — register gallery + faucet routers
- `backend/app/models/schemas.py` — add gallery + faucet response schemas
- `backend/app/routes/convert.py` — include ARC-32 spec in response
- `frontend/src/components/IDE/IconSidebar.tsx` — add gallery icon
- `frontend/src/components/IDE/SidePanel.tsx` — render gallery panel
- `frontend/src/components/IDE/StatusBar.tsx` — show wallet balance
- `frontend/src/components/IDE/TabBar.tsx` — add App Spec tab
- `frontend/src/components/Wallet/WalletConnector.tsx` — add fund button
- `frontend/src/app/page.tsx` — wire up new components
- `frontend/src/lib/api.ts` — add gallery + faucet API calls
- `frontend/src/types/index.ts` — add gallery + faucet types

---

## Verification Checklist

### Feature 1 — Gallery
- [ ] At least 5 contracts deployed to Algorand testnet
- [ ] All app IDs are verifiable on Algorand explorer
- [ ] Gallery API returns all deployed contracts
- [ ] Frontend displays gallery cards with explorer links
- [ ] "Try This Contract" button loads Solidity into editor

### Feature 2 — ARC-4 App Spec
- [ ] Type mapping covers all common Solidity types
- [ ] Public/external functions are correctly extracted
- [ ] Generated JSON matches ARC-32 format
- [ ] App spec appears as a new tab after conversion
- [ ] Copy and download buttons work
- [ ] JSON is valid and pretty-printed

### Feature 3 — Faucet Integration
- [ ] Faucet endpoint successfully funds testnet accounts
- [ ] Mainnet requests are rejected
- [ ] Balance is displayed in status bar after wallet connect
- [ ] "Get Free Testnet ALGO" button appears when balance is low
- [ ] Pre-deploy check prevents deployment without sufficient funds
- [ ] Rate limiting prevents abuse
