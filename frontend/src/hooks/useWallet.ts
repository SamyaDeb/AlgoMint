// useWallet — Convenience hook that consumes WalletContext
"use client";

import { useContext } from "react";
import { WalletContext, type WalletContextType } from "@/context/WalletContext";

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
