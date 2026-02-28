// WalletContext — React context for Pera Wallet state
"use client";

import "@/lib/polyfills"; // Buffer polyfill — must be first
import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PeraWalletConnect } from "@perawallet/connect";

export interface WalletContextType {
  walletAddress: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Exposed for transaction signing in deploy flow */
  peraWallet: PeraWalletConnect | null;
}

export const WalletContext = createContext<WalletContextType>({
  walletAddress: null,
  isConnected: false,
  isConnecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
  peraWallet: null,
});

// ── Provider ────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const peraWalletRef = useRef<PeraWalletConnect | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = walletAddress !== null;

  // ── Initialise PeraWalletConnect & attempt session restore ──
  useEffect(() => {
    const pera = new PeraWalletConnect();
    peraWalletRef.current = pera;

    // Handle disconnect events initiated from wallet side
    pera.connector?.on("disconnect", () => {
      setWalletAddress(null);
    });

    // Try to restore a previous session
    pera
      .reconnectSession()
      .then((accounts) => {
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
        }
      })
      .catch(() => {
        // No previous session — that's fine
      });

    return () => {
      // Cleanup on unmount
      pera.connector?.off("disconnect");
    };
  }, []);

  // ── Connect ──
  const connect = useCallback(async () => {
    const pera = peraWalletRef.current;
    if (!pera) return;

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await pera.connect();
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
      }

      // Listen for disconnect after successful connection
      pera.connector?.on("disconnect", () => {
        setWalletAddress(null);
      });
    } catch (err) {
      // User rejected or Pera not available
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet.";

      // Don't show error if user simply closed the modal
      if (
        message.includes("rejected") ||
        message.includes("cancelled") ||
        message.includes("closed") ||
        message.includes("CONNECT_MODAL_CLOSED")
      ) {
        // User cancelled — not an error
      } else {
        setError(message);
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    const pera = peraWalletRef.current;
    if (pera) {
      pera.disconnect().catch(() => {
        // Ignore disconnect errors
      });
    }
    setWalletAddress(null);
    setError(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        walletAddress,
        isConnected,
        isConnecting,
        error,
        connect,
        disconnect,
        peraWallet: peraWalletRef.current,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
