# AlgoMint

**AI-Powered Solidity → Algorand Python Converter & Deployer**

> ![Compilation Success Rate](https://img.shields.io/badge/Compilation%20Success%20Rate-48%2F50%20contracts%20(96%25)-brightgreen)
> ![Algorand](https://img.shields.io/badge/Algorand-Testnet%20%26%20Mainnet-blue)
> ![Stack](https://img.shields.io/badge/Stack-Next.js%20%2B%20FastAPI%20%2B%20PuyaPy-blueviolet)

A VS Code-style web IDE that converts Ethereum Solidity smart contracts into production-ready **Algorand Python (algopy)** using Google Gemini AI, compiles them via **PuyaPy** to TEAL bytecode, and deploys to Algorand Testnet or Mainnet via **Pera Wallet** — all in one seamless flow.

## 96% Compilation Success Rate

Validated against a suite of 50 real-world Solidity contracts spanning:
- ERC-20 tokens, escrow, voting, auctions, multisig wallets
- Complex state management (GlobalState, LocalState, Boxes)
- Cross-contract calls, inner transactions, ARC4 ABI methods

**48 out of 50 contracts compile to valid TEAL bytecode end-to-end.**

## Features

- **Monaco Editor** — full Solidity syntax highlighting in-browser
- **AI Conversion** — Gemini-powered Solidity → Algorand Python with deep algopy knowledge
- **PuyaPy Compilation** — converts Algorand Python to AVM-ready TEAL (approval + clear programs)
- **Pera Wallet Integration** — one-click sign & deploy to testnet or mainnet
- **AI Chat Assistant** — context-aware AlgoMint assistant for Algorand dev questions
- **AST Viewer** — real-time Solidity AST analysis with warnings
- **Rate Limiting & Sandboxing** — production-ready backend with request isolation

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Monaco Editor, TailwindCSS, `@perawallet/connect`, `algosdk`
- **Backend:** FastAPI, PuyaPy (Algorand Python compiler), `py-algorand-sdk`, Google Gemini AI (`gemini-2.5-flash`)
- **Infrastructure:** Docker, AlgoNode (free Algorand node API)

## Getting Started

### With Docker
```bash
docker-compose up --build
```
Frontend: http://localhost:3000 · Backend: http://localhost:8000

### Without Docker
```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

## Project Structure

```
AlgoMint/
├── frontend/         # Next.js IDE application
│   └── src/
│       ├── app/      # App Router pages
│       ├── components/  # Editor, Chat, Deploy, Wallet UI
│       ├── hooks/    # useCompile, useConvert, useDeploy, useChat
│       └── lib/      # Algorand SDK, API client
├── backend/          # FastAPI application
│   └── app/
│       ├── routes/   # /convert, /compile, /deploy, /chat
│       ├── services/ # AI, Algorand, Compiler, Chat services
│       └── middleware/  # CORS, rate limiting, error handling
└── docker-compose.yml
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/convert` | Solidity → Algorand Python via Gemini AI |
| `POST` | `/api/v1/compile` | Algorand Python → TEAL via PuyaPy |
| `POST` | `/api/v1/deploy/prepare` | Build unsigned ApplicationCreateTxn |
| `POST` | `/api/v1/deploy/submit` | Submit wallet-signed transaction |
| `POST` | `/api/v1/chat` | Algorand AI assistant |
| `GET`  | `/health` | Health check |
