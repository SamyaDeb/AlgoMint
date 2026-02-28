// useDeploy — Custom hook for the full deployment flow:
// prepare → sign (Pera Wallet) → submit → confirmed
"use client";

import { useState, useCallback } from "react";
import { deployPrepare, deploySubmit } from "@/lib/api";
import algosdk from "algosdk";
import type { PeraWalletConnect } from "@perawallet/connect";
import type { StateSchema } from "@/types";

export type DeployStage =
  | "idle"
  | "preparing"
  | "signing"
  | "submitting"
  | "confirmed"
  | "failed";

interface UseDeployReturn {
  txid: string;
  explorerUrl: string;
  isLoading: boolean;
  error: string | null;
  stage: DeployStage;
  failedAt: DeployStage | null;
  deploy: (params: {
    approvalTeal: string;
    clearTeal: string;
    stateSchema: StateSchema;
    senderAddress: string;
    network: string;
    peraWallet: PeraWalletConnect;
  }) => Promise<{ txid: string; explorerUrl: string } | null>;
  reset: () => void;
}

export function useDeploy(): UseDeployReturn {
  const [txid, setTxid] = useState("");
  const [explorerUrl, setExplorerUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<DeployStage>("idle");
  const [failedAt, setFailedAt] = useState<DeployStage | null>(null);

  const deploy = useCallback(
    async (params: {
      approvalTeal: string;
      clearTeal: string;
      stateSchema: StateSchema;
      senderAddress: string;
      network: string;
      peraWallet: PeraWalletConnect;
    }) => {
      const {
        approvalTeal,
        clearTeal,
        stateSchema,
        senderAddress,
        network,
        peraWallet,
      } = params;

      setIsLoading(true);
      setError(null);
      setTxid("");
      setExplorerUrl("");
      setFailedAt(null);

      try {
        // ── Stage 1: Prepare unsigned transaction on backend ──
        setStage("preparing");
        const prepareRes = await deployPrepare({
          approvalTeal,
          clearTeal,
          stateSchema,
          sender: senderAddress,
          network,
        });

        // ── Stage 2: Build transaction locally & sign with Pera Wallet ──
        setStage("signing");

        // Decode compiled programs from base64
        const approvalProgram = new Uint8Array(
          atob(prepareRes.approval_compiled).split("").map((c) => c.charCodeAt(0))
        );
        const clearProgram = new Uint8Array(
          atob(prepareRes.clear_compiled).split("").map((c) => c.charCodeAt(0))
        );

        // Build suggested params for algosdk
        const sp = prepareRes.suggested_params;
        const genesisHashBytes = new Uint8Array(
          atob(sp.genesis_hash).split("").map((c) => c.charCodeAt(0))
        );
        const suggestedParams: algosdk.SuggestedParams = {
          fee: sp.fee,
          firstValid: sp.first_round,
          lastValid: sp.last_round,
          genesisHash: genesisHashBytes,
          genesisID: sp.genesis_id,
          flatFee: sp.flat_fee,
          minFee: sp.min_fee,
        };

        // Build the unsigned ApplicationCreateTxn using JS algosdk
        const txnObj = algosdk.makeApplicationCreateTxnFromObject({
          sender: senderAddress,
          suggestedParams,
          onComplete: algosdk.OnApplicationComplete.NoOpOC,
          approvalProgram,
          clearProgram,
          numGlobalInts: stateSchema.global_ints,
          numGlobalByteSlices: stateSchema.global_bytes,
          numLocalInts: stateSchema.local_ints,
          numLocalByteSlices: stateSchema.local_bytes,
        });

        // Sign with Pera Wallet
        const signedTxns = await peraWallet.signTransaction([
          [{ txn: txnObj }],
        ]);

        if (!signedTxns || signedTxns.length === 0) {
          throw new Error("No signed transaction returned from wallet.");
        }

        // Encode signed transaction to base64 for backend
        const signedTxnBase64 = btoa(
          String.fromCharCode(...signedTxns[0])
        );

        // ── Stage 3: Submit signed transaction ──
        setStage("submitting");
        const submitRes = await deploySubmit({
          signedTxn: signedTxnBase64,
          network,
        });

        // ── Stage 4: Confirmed ──
        setStage("confirmed");
        setTxid(submitRes.txid);
        setExplorerUrl(submitRes.explorer_url);

        return {
          txid: submitRes.txid,
          explorerUrl: submitRes.explorer_url,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Deployment failed.";

        // Track which stage failed
        setFailedAt(stage === "idle" ? "preparing" : stage);
        setError(message);
        setStage("failed");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [stage]
  );

  const reset = useCallback(() => {
    setTxid("");
    setExplorerUrl("");
    setIsLoading(false);
    setError(null);
    setStage("idle");
    setFailedAt(null);
  }, []);

  return {
    txid,
    explorerUrl,
    isLoading,
    error,
    stage,
    failedAt,
    deploy,
    reset,
  };
}
