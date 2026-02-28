/**
 * Browser polyfills required by algosdk and @perawallet/connect.
 * Must be imported before any wallet or Algorand SDK usage.
 */
import { Buffer } from "buffer";

if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Buffer = Buffer;
  // Some libraries also check for global.Buffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Buffer = Buffer;
}
