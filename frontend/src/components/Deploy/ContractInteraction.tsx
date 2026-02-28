"use client";

import { useState, useCallback } from "react";
import { Play, Copy, Check, ExternalLink, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { ARC4Method, DeployedContract, MethodCallResult } from "@/types";
import { getSuggestedParams, deploySubmit } from "@/lib/api";
import algosdk from "algosdk";
import { Buffer } from "buffer";
import type { PeraWalletConnect } from "@perawallet/connect";

// ARC-4 return value prefix: sha512_256("return")[:4] = 0x151f7c75
const ARC4_RETURN_PREFIX = "FR98dQ=="; // base64 of 0x151f7c75

interface ContractInteractionProps {
  contract: DeployedContract;
  walletAddress: string;
  peraWallet: PeraWalletConnect;
  network: string;
  onLog?: (type: "info" | "error" | "success" | "warning", message: string) => void;
}

/** Parse a user-entered value to the appropriate JS type for ABI encoding */
function parseArgValue(
  value: string,
  abiType: string,
): bigint | number | boolean | Uint8Array | string | bigint[] | number[] {
  const trimmed = value.trim();

  // Boolean
  if (abiType === "bool") {
    return trimmed === "true" || trimmed === "1";
  }

  // Uint / Int types (uint8..uint512, int8..int512)
  if (/^u?int\d*$/.test(abiType)) {
    return BigInt(trimmed);
  }

  // Byte arrays
  if (abiType === "byte[]" || abiType === "bytes") {
    // Accept hex (0x...) or raw string
    if (trimmed.startsWith("0x")) {
      const hex = trimmed.slice(2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes;
    }
    return new TextEncoder().encode(trimmed);
  }

  // Fixed-size byte arrays (byte[N])
  if (/^byte\[\d+\]$/.test(abiType)) {
    if (trimmed.startsWith("0x")) {
      const hex = trimmed.slice(2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes;
    }
    return new TextEncoder().encode(trimmed);
  }

  // Address type
  if (abiType === "address" || abiType === "account") {
    return trimmed;
  }

  // String type
  if (abiType === "string") {
    return trimmed;
  }

  // Array of uints (e.g., uint64[])
  if (/^u?int\d*\[\]$/.test(abiType)) {
    const items = trimmed.replace(/[\[\]]/g, "").split(",").map(s => BigInt(s.trim()));
    return items;
  }

  // Fallback: try as BigInt, then string
  try {
    return BigInt(trimmed);
  } catch {
    return trimmed;
  }
}

/** Decode an ARC-4 return value from base64 log entry */
function decodeReturnValue(logB64: string, returnType: string): string {
  try {
    const logBytes = Buffer.from(logB64, "base64");

    // Check for ARC-4 return prefix (0x151f7c75 = first 4 bytes)
    const prefix = logBytes.subarray(0, 4);
    const expectedPrefix = Buffer.from([0x15, 0x1f, 0x7c, 0x75]);

    if (!prefix.equals(expectedPrefix)) {
      return logB64; // Not an ARC-4 return value
    }

    const valueBytes = logBytes.subarray(4);

    if (returnType === "void" || !returnType) {
      return "void";
    }

    // Use algosdk ABI type to decode
    try {
      const abiType = algosdk.ABIType.from(returnType);
      const decoded = abiType.decode(new Uint8Array(valueBytes));
      return String(decoded);
    } catch {
      // Fallback: show hex
      return "0x" + Buffer.from(valueBytes).toString("hex");
    }
  } catch {
    return logB64;
  }
}

/** Get a placeholder hint for an ABI argument type */
function getPlaceholder(argType: string): string {
  if (/^u?int\d*$/.test(argType)) return "e.g. 42";
  if (argType === "bool") return "true / false";
  if (argType === "string") return "enter text";
  if (argType === "address" || argType === "account") return "ALGO address";
  if (argType.includes("byte")) return "0x... or text";
  if (argType.includes("[]")) return "comma-separated";
  return "value";
}

// ── Single method interaction card ──

function MethodCard({
  method,
  contract,
  walletAddress,
  peraWallet,
  network,
  onLog,
}: {
  method: ARC4Method;
  contract: DeployedContract;
  walletAddress: string;
  peraWallet: PeraWalletConnect;
  network: string;
  onLog?: (type: "info" | "error" | "success" | "warning", message: string) => void;
}) {
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<MethodCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCall = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      onLog?.("info", `Calling ${method.name}()...`);

      // 1. Get suggested params
      const sp = await getSuggestedParams(network);

      // 2. Build ABI method object
      const abiMethod = new algosdk.ABIMethod({
        name: method.name,
        args: method.args.map((a) => ({ name: a.name, type: a.type })),
        returns: { type: method.returns.type },
      });

      // 3. Build method selector and encode arguments
      const selector = abiMethod.getSelector();

      const appArgs: Uint8Array[] = [selector];
      for (const arg of method.args) {
        const rawValue = argValues[arg.name] ?? "";
        if (!rawValue.trim() && arg.type !== "bool") {
          throw new Error(`Missing value for argument "${arg.name}" (${arg.type})`);
        }
        const parsed = parseArgValue(rawValue, arg.type);
        const abiType = algosdk.ABIType.from(arg.type);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const encoded = abiType.encode(parsed as any);
        appArgs.push(new Uint8Array(encoded));
      }

      // 4. Build suggested params for algosdk
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

      // 5. Build the ApplicationCallTxn (NoOp)
      const appId = parseInt(contract.appId);
      if (!appId || appId <= 0) {
        throw new Error("Invalid App ID");
      }

      const txnObj = algosdk.makeApplicationCallTxnFromObject({
        sender: walletAddress,
        suggestedParams,
        appIndex: appId,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs,
      });

      // 6. Sign with Pera Wallet
      onLog?.("info", "Awaiting wallet signature...");
      const signedTxns = await peraWallet.signTransaction([
        [{ txn: txnObj }],
      ]);

      if (!signedTxns || signedTxns.length === 0) {
        throw new Error("No signed transaction returned from wallet.");
      }

      // 7. Encode to base64
      const signedTxnBytes =
        signedTxns[0] instanceof Uint8Array
          ? signedTxns[0]
          : new Uint8Array(signedTxns[0] as ArrayLike<number>);
      const signedTxnBase64 = Buffer.from(signedTxnBytes).toString("base64");

      // 8. Submit
      onLog?.("info", "Submitting method call...");
      const submitRes = await deploySubmit({
        signedTxn: signedTxnBase64,
        network,
      });

      // 9. Parse return value from logs
      let returnValue: string | null = null;
      if (submitRes.logs && submitRes.logs.length > 0) {
        // The last log entry with ARC-4 prefix contains the return value
        for (let i = submitRes.logs.length - 1; i >= 0; i--) {
          const logBytes = Buffer.from(submitRes.logs[i], "base64");
          if (
            logBytes.length >= 4 &&
            logBytes[0] === 0x15 &&
            logBytes[1] === 0x1f &&
            logBytes[2] === 0x7c &&
            logBytes[3] === 0x75
          ) {
            returnValue = decodeReturnValue(submitRes.logs[i], method.returns.type);
            break;
          }
        }
      }
      if (method.returns.type === "void") {
        returnValue = "void";
      }

      const explorerUrl = `https://${network === "mainnet" ? "" : "testnet."}explorer.perawallet.app/tx/${submitRes.txid}`;

      const callResult: MethodCallResult = {
        txid: submitRes.txid,
        explorerUrl,
        returnValue,
        logs: submitRes.logs || [],
        timestamp: new Date(),
      };
      setResult(callResult);

      const truncatedTxid = `${submitRes.txid.slice(0, 8)}...${submitRes.txid.slice(-4)}`;
      onLog?.("success", `${method.name}() confirmed: ${truncatedTxid}${returnValue ? ` → ${returnValue}` : ""}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Method call failed.";
      // User cancellation is not an error
      if (
        message.includes("rejected") ||
        message.includes("cancelled") ||
        message.includes("closed") ||
        message.includes("CONNECT_MODAL_CLOSED")
      ) {
        onLog?.("warning", `${method.name}() cancelled by user.`);
      } else {
        setError(message);
        onLog?.("error", `${method.name}() failed: ${message}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [method, argValues, contract, walletAddress, peraWallet, network, onLog]);

  const hasArgs = method.args.length > 0;

  return (
    <div
      className="rounded text-xs"
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--bg-terminal)",
      }}
    >
      {/* Method header */}
      <div
        className="flex items-center justify-between px-2 py-1.5 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-1.5">
          {isExpanded ? (
            <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
          )}
          <span
            className="font-mono font-medium"
            style={{ color: method.readonly ? "var(--info)" : "var(--accent)" }}
          >
            {method.name}
          </span>
          <span className="font-mono" style={{ color: "var(--text-muted)" }}>
            ({method.args.map((a) => a.type).join(", ")})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {method.returns.type !== "void" && (
            <span className="font-mono" style={{ color: "var(--text-muted)" }}>
              → {method.returns.type}
            </span>
          )}
          <span
            className="px-1 py-0.5 rounded text-[10px] font-medium"
            style={{
              backgroundColor: method.readonly
                ? "rgba(59,130,246,0.1)"
                : "rgba(0,212,170,0.1)",
              color: method.readonly ? "var(--info)" : "var(--accent)",
            }}
          >
            {method.readonly ? "read" : "call"}
          </span>
        </div>
      </div>

      {/* Expanded: args + call button + result */}
      {isExpanded && (
        <div className="px-2 pb-2 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
          {/* Arguments */}
          {hasArgs && (
            <div className="space-y-1.5 pt-1.5">
              {method.args.map((arg) => (
                <div key={arg.name} className="flex flex-col gap-0.5">
                  <label className="flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                    <span className="font-mono">{arg.name}</span>
                    <span style={{ color: "var(--text-muted)" }}>({arg.type})</span>
                  </label>
                  <input
                    type="text"
                    value={argValues[arg.name] ?? ""}
                    onChange={(e) =>
                      setArgValues((prev) => ({
                        ...prev,
                        [arg.name]: e.target.value,
                      }))
                    }
                    placeholder={getPlaceholder(arg.type)}
                    className="w-full px-2 py-1 rounded text-xs font-mono outline-none"
                    style={{
                      backgroundColor: "var(--bg-editor)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Call button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCall();
            }}
            disabled={isLoading}
            className="w-full py-1.5 px-2 rounded text-xs font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{
              backgroundColor: method.readonly ? "rgba(59,130,246,0.15)" : "var(--accent)",
              color: method.readonly ? "var(--info)" : "#fff",
            }}
          >
            {isLoading ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play size={12} />
                {method.readonly ? "Read" : "Call"} {method.name}
              </>
            )}
          </button>

          {/* Error */}
          {error && (
            <div
              className="p-1.5 rounded text-xs"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--error)" }}
            >
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div
              className="p-1.5 rounded space-y-1"
              style={{ backgroundColor: "var(--bg-editor)", border: "1px solid var(--border)" }}
            >
              {/* Return value */}
              {result.returnValue !== null && result.returnValue !== "void" && (
                <div className="flex items-center justify-between">
                  <span style={{ color: "var(--text-muted)" }}>Return:</span>
                  <span className="font-mono font-medium" style={{ color: "var(--success)" }}>
                    {result.returnValue}
                  </span>
                </div>
              )}
              {result.returnValue === "void" && (
                <div className="flex items-center justify-between">
                  <span style={{ color: "var(--text-muted)" }}>Return:</span>
                  <span className="font-mono" style={{ color: "var(--text-secondary)" }}>void (success)</span>
                </div>
              )}

              {/* TX ID */}
              <div className="flex items-center justify-between">
                <a
                  href={result.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:underline flex items-center gap-1"
                  style={{ color: "var(--accent)" }}
                >
                  TX: {result.txid.slice(0, 12)}...
                  <ExternalLink size={10} />
                </a>
                <button
                  onClick={() => handleCopy(result.txid, `call-txid-${method.name}`)}
                  className="p-0.5 rounded hover:bg-[rgba(0,212,170,0.08)]"
                >
                  {copiedId === `call-txid-${method.name}` ? (
                    <Check size={10} style={{ color: "var(--success)" }} />
                  ) : (
                    <Copy size={10} style={{ color: "var(--text-muted)" }} />
                  )}
                </button>
              </div>

              {/* Timestamp */}
              <div
                className="text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {result.timestamp.toLocaleTimeString()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Contract Interaction Component ──

export default function ContractInteraction({
  contract,
  walletAddress,
  peraWallet,
  network,
  onLog,
}: ContractInteractionProps) {
  // Extract methods from ARC-32
  const methods: ARC4Method[] =
    (contract.arc32Json?.contract?.methods as ARC4Method[] | undefined) ??
    contract.arc32Json?.methods ??
    [];

  if (methods.length === 0) {
    return (
      <div className="text-xs p-2" style={{ color: "var(--text-muted)" }}>
        No ABI methods found in this contract.
      </div>
    );
  }

  const writeMethods = methods.filter((m) => !m.readonly);
  const readMethods = methods.filter((m) => m.readonly);

  return (
    <div className="space-y-1.5">
      <div
        className="text-xs font-medium"
        style={{ color: "var(--text-secondary)" }}
      >
        INTERACT ({methods.length} method{methods.length !== 1 ? "s" : ""})
      </div>

      {/* Write methods first */}
      {writeMethods.map((m) => (
        <MethodCard
          key={`write-${m.name}`}
          method={m}
          contract={contract}
          walletAddress={walletAddress}
          peraWallet={peraWallet}
          network={network}
          onLog={onLog}
        />
      ))}

      {/* Then read methods */}
      {readMethods.map((m) => (
        <MethodCard
          key={`read-${m.name}`}
          method={m}
          contract={contract}
          walletAddress={walletAddress}
          peraWallet={peraWallet}
          network={network}
          onLog={onLog}
        />
      ))}
    </div>
  );
}
