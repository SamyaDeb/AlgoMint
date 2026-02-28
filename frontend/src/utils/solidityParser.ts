/**
 * solidityParser.ts
 *
 * Parses Solidity source code into a clean, structured JSON object
 * using @solidity-parser/parser. Handles errors gracefully.
 */

import { parse, visit } from "@solidity-parser/parser";
import type { ASTNode } from "@solidity-parser/parser/src/ast-types";

// ── Result types ────────────────────────────────────────────

export interface StateVariable {
  name: string;
  type: string;
  visibility: string;
  isMapping: boolean;
  mappingKeyType: string | null;
  mappingValueType: string | null;
  isArray: boolean;
  arrayElementType: string | null;
}

export interface FunctionParam {
  name: string;
  type: string;
}

export interface ParsedFunction {
  name: string;
  visibility: string;
  mutability: string;
  isConstructor: boolean;
  parameters: FunctionParam[];
  returnTypes: string[];
  modifiersApplied: string[];
  bodySource: string;
}

export interface ParsedEvent {
  name: string;
  parameters: { name: string; type: string; indexed: boolean }[];
}

export interface ParsedModifier {
  name: string;
  parameters: FunctionParam[];
  bodySource: string;
}

export interface CustomError {
  name: string;
  parameters: string[];
}

export interface ParsedContract {
  contractName: string;
  inheritance: string[];
  stateVariables: StateVariable[];
  functions: ParsedFunction[];
  events: ParsedEvent[];
  modifiers: ParsedModifier[];
  customErrors: CustomError[];
}

export interface ParseError {
  error: string;
  reason: string;
}

export type ParseResult = ParsedContract | ParseError;

// ── Helpers ─────────────────────────────────────────────────

function typeNameToString(node: ASTNode | null): string {
  if (!node) return "unknown";

  switch (node.type) {
    case "ElementaryTypeName": {
      const el = node as unknown as { typeName?: string; name?: string };
      return el.typeName ?? el.name ?? "unknown";
    }
    case "UserDefinedTypeName":
      return (node as { namePath: string }).namePath ?? "unknown";
    case "Mapping": {
      const m = node as { keyType: ASTNode; valueType: ASTNode };
      return `mapping(${typeNameToString(m.keyType)} => ${typeNameToString(m.valueType)})`;
    }
    case "ArrayTypeName": {
      const a = node as { baseTypeName: ASTNode; length?: ASTNode };
      return `${typeNameToString(a.baseTypeName)}[]`;
    }
    case "FunctionTypeName":
      return "function";
    default:
      return "unknown";
  }
}

function extractMappingTypes(node: ASTNode | null): {
  isMapping: boolean;
  keyType: string | null;
  valueType: string | null;
} {
  if (!node || node.type !== "Mapping") {
    return { isMapping: false, keyType: null, valueType: null };
  }
  const m = node as { keyType: ASTNode; valueType: ASTNode };
  return {
    isMapping: true,
    keyType: typeNameToString(m.keyType),
    valueType: typeNameToString(m.valueType),
  };
}

function extractArrayInfo(node: ASTNode | null): {
  isArray: boolean;
  elementType: string | null;
} {
  if (!node || node.type !== "ArrayTypeName") {
    return { isArray: false, elementType: null };
  }
  const a = node as { baseTypeName: ASTNode };
  return { isArray: true, elementType: typeNameToString(a.baseTypeName) };
}

function extractBodySource(
  node: { body?: ASTNode | null },
  sourceCode: string
): string {
  const body = node.body;
  if (!body) return "";
  const loc = (body as { loc?: { start: { line: number; column: number }; end: { line: number; column: number } } }).loc;
  if (!loc) return "";
  const lines = sourceCode.split("\n");
  const startLine = loc.start.line - 1;
  const endLine = loc.end.line;
  return lines.slice(startLine, endLine).join("\n").trim();
}

// ── Main parse function ─────────────────────────────────────

export function parseSolidity(sourceCode: string): ParseResult {
  try {
    const ast = parse(sourceCode, {
      tolerant: true,
      loc: true,
      range: true,
    });

    // Find the first contract definition
    let result: ParsedContract | null = null;

    visit(ast, {
      ContractDefinition: (node) => {
        // Only parse the first contract (or the main one)
        if (result) return;

        const contractNode = node as {
          name: string;
          baseContracts: { baseName: { namePath: string } }[];
          subNodes: ASTNode[];
        };

        const stateVariables: StateVariable[] = [];
        const functions: ParsedFunction[] = [];
        const events: ParsedEvent[] = [];
        const modifiers: ParsedModifier[] = [];
        const customErrors: CustomError[] = [];

        for (const sub of contractNode.subNodes) {
          switch (sub.type) {
            case "StateVariableDeclaration": {
              const svNode = sub as {
                variables: {
                  name: string;
                  typeName: ASTNode;
                  visibility?: string;
                }[];
              };
              for (const v of svNode.variables) {
                const typeName = typeNameToString(v.typeName);
                const mapping = extractMappingTypes(v.typeName);
                const array = extractArrayInfo(v.typeName);

                stateVariables.push({
                  name: v.name,
                  type: typeName,
                  visibility: v.visibility || "internal",
                  isMapping: mapping.isMapping,
                  mappingKeyType: mapping.keyType,
                  mappingValueType: mapping.valueType,
                  isArray: array.isArray,
                  arrayElementType: array.elementType,
                });
              }
              break;
            }

            case "FunctionDefinition": {
              const fnNode = sub as {
                name: string | null;
                visibility?: string;
                stateMutability?: string | null;
                isConstructor?: boolean;
                isReceiveEther?: boolean;
                isFallback?: boolean;
                parameters?: { name: string; typeName: ASTNode }[];
                returnParameters?: { typeName: ASTNode }[] | null;
                modifiers?: { name: string }[];
                body?: ASTNode | null;
              };

              const isConstructor = fnNode.isConstructor === true;
              let name = fnNode.name || "";
              if (isConstructor) name = "constructor";
              if (fnNode.isReceiveEther) name = "receive";
              if (fnNode.isFallback) name = "fallback";

              const params: FunctionParam[] = (fnNode.parameters || []).map(
                (p) => ({
                  name: p.name || "",
                  type: typeNameToString(p.typeName),
                })
              );

              const returnTypes = (fnNode.returnParameters || []).map((r) =>
                typeNameToString(r.typeName)
              );

              const modifiersApplied = (fnNode.modifiers || []).map(
                (m) => m.name
              );

              functions.push({
                name,
                visibility: fnNode.visibility || (isConstructor ? "public" : "internal"),
                mutability: fnNode.stateMutability || "nonpayable",
                isConstructor,
                parameters: params,
                returnTypes,
                modifiersApplied,
                bodySource: extractBodySource(fnNode as { body?: ASTNode | null }, sourceCode),
              });
              break;
            }

            case "EventDefinition": {
              const evNode = sub as {
                name: string;
                parameters: {
                  name: string;
                  typeName: ASTNode;
                  isIndexed?: boolean;
                }[];
              };
              events.push({
                name: evNode.name,
                parameters: (evNode.parameters || []).map((p) => ({
                  name: p.name || "",
                  type: typeNameToString(p.typeName),
                  indexed: p.isIndexed === true,
                })),
              });
              break;
            }

            case "ModifierDefinition": {
              const modNode = sub as {
                name: string;
                parameters?: { name: string; typeName: ASTNode }[];
                body?: ASTNode | null;
              };
              modifiers.push({
                name: modNode.name,
                parameters: (modNode.parameters || []).map((p) => ({
                  name: p.name || "",
                  type: typeNameToString(p.typeName),
                })),
                bodySource: extractBodySource(modNode as { body?: ASTNode | null }, sourceCode),
              });
              break;
            }

            case "CustomErrorDefinition": {
              const errNode = sub as {
                name: string;
                parameters: { typeName: ASTNode }[];
              };
              customErrors.push({
                name: errNode.name,
                parameters: (errNode.parameters || []).map((p) =>
                  typeNameToString(p.typeName)
                ),
              });
              break;
            }
          }
        }

        result = {
          contractName: contractNode.name,
          inheritance: contractNode.baseContracts.map(
            (b) => b.baseName.namePath
          ),
          stateVariables,
          functions,
          events,
          modifiers,
          customErrors,
        };
      },
    });

    if (!result) {
      return { error: "Parse failed", reason: "No contract definition found in the source code." };
    }

    return result;
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Unknown parse error";
    return { error: "Parse failed", reason };
  }
}
