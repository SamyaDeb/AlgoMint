// ClientProviders — wraps client-only providers (WalletProvider, etc.)
"use client";

import "@/lib/polyfills"; // must be first — ensures Buffer is available globally
import { WalletProvider } from "@/context/WalletContext";
import type { ReactNode } from "react";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
