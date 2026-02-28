// useConvert — Custom hook for AI conversion flow
"use client";

import { useState, useCallback } from "react";
import { convertSolidity } from "@/lib/api";
import type { StateSchema } from "@/types";

interface UseConvertReturn {
  algorandPythonCode: string;
  stateSchema: StateSchema | null;
  unsupportedFeatures: string[];
  isLoading: boolean;
  error: string | null;
  convert: (solidityCode: string) => Promise<{
    algorandPythonCode: string;
    stateSchema: StateSchema;
    unsupportedFeatures: string[];
  } | null>;
  reset: () => void;
}

export function useConvert(): UseConvertReturn {
  const [algorandPythonCode, setAlgorandPythonCode] = useState("");
  const [stateSchema, setStateSchema] = useState<StateSchema | null>(null);
  const [unsupportedFeatures, setUnsupportedFeatures] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const convert = useCallback(async (solidityCode: string) => {
    if (!solidityCode.trim()) {
      setError("No Solidity code provided.");
      return null;
    }

    setIsLoading(true);
    setError(null);
    setUnsupportedFeatures([]);
    setAlgorandPythonCode("");
    setStateSchema(null);

    try {
      const response = await convertSolidity(solidityCode);

      setAlgorandPythonCode(response.algorand_python_code);
      setStateSchema(response.state_schema);
      setUnsupportedFeatures(response.unsupported_features ?? []);

      return {
        algorandPythonCode: response.algorand_python_code,
        stateSchema: response.state_schema,
        unsupportedFeatures: response.unsupported_features ?? [],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Conversion failed. Please try again.";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setAlgorandPythonCode("");
    setStateSchema(null);
    setUnsupportedFeatures([]);
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    algorandPythonCode,
    stateSchema,
    unsupportedFeatures,
    isLoading,
    error,
    convert,
    reset,
  };
}
