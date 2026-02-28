// useCompile — Custom hook for Algorand Python compilation flow
"use client";

import { useState, useCallback } from "react";
import { compileAlgorandPython } from "@/lib/api";

interface UseCompileReturn {
  approvalTeal: string;
  clearTeal: string;
  isLoading: boolean;
  error: string | null;
  compile: (algorandPythonCode: string) => Promise<{
    approvalTeal: string;
    clearTeal: string;
  } | null>;
  reset: () => void;
}

export function useCompile(): UseCompileReturn {
  const [approvalTeal, setApprovalTeal] = useState("");
  const [clearTeal, setClearTeal] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compile = useCallback(async (algorandPythonCode: string) => {
    if (!algorandPythonCode.trim()) {
      setError("No Algorand Python code to compile.");
      return null;
    }

    setIsLoading(true);
    setError(null);
    setApprovalTeal("");
    setClearTeal("");

    try {
      const response = await compileAlgorandPython(algorandPythonCode);

      setApprovalTeal(response.approval_teal);
      setClearTeal(response.clear_teal);

      return {
        approvalTeal: response.approval_teal,
        clearTeal: response.clear_teal,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Compilation failed. Please try again.";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setApprovalTeal("");
    setClearTeal("");
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    approvalTeal,
    clearTeal,
    isLoading,
    error,
    compile,
    reset,
  };
}
