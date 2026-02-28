/**
 * astEnricher.ts
 *
 * Takes the parsed Solidity AST from solidityParser.ts and enriches it with
 * Algorand-specific hints: storage mappings, decorator suggestions, type
 * mappings, and warnings about unsupported/special patterns.
 */

import type {
  ParsedContract,
  StateVariable,
  ParsedFunction,
  FunctionParam,
} from "./solidityParser";

// ── Enriched types ──────────────────────────────────────────

export interface EnrichedStateVariable extends StateVariable {
  algorand_storage: string;
  algorand_type: string;
}

export interface EnrichedParam extends FunctionParam {
  algorand_type: string;
}

export interface EnrichedFunction extends Omit<ParsedFunction, "parameters"> {
  algorand_decorator: string;
  parameters: EnrichedParam[];
  algorand_return_types: string[];
}

export interface EnrichedEvent {
  name: string;
  parameters: { name: string; type: string; indexed: boolean; algorand_type: string }[];
}

export interface EnrichedModifier {
  name: string;
  parameters: EnrichedParam[];
  bodySource: string;
}

export interface EnrichedContract {
  contractName: string;
  inheritance: string[];
  stateVariables: EnrichedStateVariable[];
  functions: EnrichedFunction[];
  events: EnrichedEvent[];
  modifiers: EnrichedModifier[];
  customErrors: { name: string; parameters: string[] }[];
  warnings: ASTWarning[];
}

export interface ASTWarning {
  type:
    | "PAYABLE"
    | "INHERITANCE"
    | "MODIFIERS"
    | "NESTED_MAPPING"
    | "SIGNED_INT"
    | "EVENTS"
    | "FALLBACK"
    | "SELFDESTRUCT";
  message: string;
  severity: "red" | "yellow" | "blue";
}

// ── Mapping helpers ─────────────────────────────────────────

function solidityTypeToAlgorandType(solidityType: string): string {
  const t = solidityType.toLowerCase().trim();

  // Unsigned integers
  if (/^uint\d*$/.test(t)) return "UInt64";
  // Signed integers
  if (/^int\d*$/.test(t)) return "UInt64 (WARNING: no signed int in Algorand)";
  if (t === "address") return "Account";
  if (t === "bool") return "bool";
  if (t === "string") return "String";
  if (/^bytes\d*$/.test(t)) return "Bytes";
  if (t === "byte") return "Bytes";

  return t; // fallback: keep original
}

function solidityTypeToAlgorandStorage(variable: StateVariable): string {
  const typeLower = variable.type.toLowerCase();

  if (variable.isMapping) {
    // Check for nested mapping
    const valueType = variable.mappingValueType || "";
    if (valueType.startsWith("mapping(")) {
      return "BoxMap - needs manual review (nested mapping)";
    }

    // Determine key type
    const keyType = variable.mappingKeyType || "";
    let algoKey: string;
    if (keyType.toLowerCase() === "address") {
      algoKey = "Account";
    } else if (/^uint\d*$/i.test(keyType)) {
      algoKey = "UInt64";
    } else if (/^int\d*$/i.test(keyType)) {
      algoKey = "UInt64";
    } else if (keyType.toLowerCase() === "string") {
      algoKey = "String";
    } else if (/^bytes\d*$/i.test(keyType)) {
      algoKey = "Bytes";
    } else {
      algoKey = keyType;
    }

    // Determine value type
    let algoValue: string;
    if (valueType.toLowerCase() === "address") {
      algoValue = "Account";
    } else if (/^uint\d*$/i.test(valueType)) {
      algoValue = "UInt64";
    } else if (/^int\d*$/i.test(valueType)) {
      algoValue = "UInt64";
    } else if (valueType.toLowerCase() === "bool") {
      algoValue = "bool";
    } else if (valueType.toLowerCase() === "string") {
      algoValue = "String";
    } else if (/^bytes\d*$/i.test(valueType)) {
      algoValue = "Bytes";
    } else {
      algoValue = valueType;
    }

    return `BoxMap[${algoKey}, ${algoValue}]`;
  }

  if (variable.isArray) {
    return "needs manual review (array)";
  }

  // Scalar types → GlobalState
  if (/^uint\d*$/i.test(typeLower)) return "GlobalState[UInt64]";
  if (/^int\d*$/i.test(typeLower)) return "GlobalState[UInt64]";
  if (typeLower === "bool") return "GlobalState[bool]";
  if (typeLower === "address") return "GlobalState[Account]";
  if (typeLower === "string") return "GlobalState[String]";
  if (/^bytes\d*$/i.test(typeLower)) return "GlobalState[Bytes]";

  return `GlobalState[${typeLower}]`;
}

function functionToAlgorandDecorator(fn: ParsedFunction): string {
  if (fn.isConstructor) {
    return "@arc4.baremethod(create='require')";
  }
  if (fn.name === "receive" || fn.name === "fallback") {
    return "@arc4.baremethod(allow_actions=['NoOp'])";
  }
  if (fn.mutability === "view" || fn.mutability === "pure") {
    return "@arc4.abimethod(readonly=True)";
  }
  if (fn.mutability === "payable") {
    return "@arc4.abimethod  # NOTE: needs payment txn group";
  }
  if (fn.visibility === "internal" || fn.visibility === "private") {
    return "@subroutine";
  }
  return "@arc4.abimethod";
}

// ── Warning detection ───────────────────────────────────────

const SEVERITY_MAP: Record<ASTWarning["type"], ASTWarning["severity"]> = {
  SIGNED_INT: "red",
  SELFDESTRUCT: "red",
  NESTED_MAPPING: "red",
  PAYABLE: "yellow",
  INHERITANCE: "yellow",
  MODIFIERS: "yellow",
  FALLBACK: "yellow",
  EVENTS: "blue",
};

const WARNING_MESSAGES: Record<ASTWarning["type"], string> = {
  PAYABLE: "PAYABLE: needs payment transaction group",
  INHERITANCE: "INHERITANCE: verify parent methods are included",
  MODIFIERS: "MODIFIERS: converted to subroutines",
  NESTED_MAPPING: "NESTED_MAPPING: manual BoxMap design needed",
  SIGNED_INT: "SIGNED_INT: no native signed int in Algorand",
  EVENTS: "EVENTS: use arc4.emit() with ARC-28",
  FALLBACK: "FALLBACK: use baremethod",
  SELFDESTRUCT: "SELFDESTRUCT: no equivalent, needs redesign",
};

function detectWarnings(contract: ParsedContract, sourceCode: string): ASTWarning[] {
  const warnings: ASTWarning[] = [];
  const seen = new Set<ASTWarning["type"]>();

  const addWarning = (type: ASTWarning["type"]) => {
    if (seen.has(type)) return;
    seen.add(type);
    warnings.push({
      type,
      message: WARNING_MESSAGES[type],
      severity: SEVERITY_MAP[type],
    });
  };

  // Check inheritance
  if (contract.inheritance.length > 0) {
    addWarning("INHERITANCE");
  }

  // Check modifiers
  if (contract.modifiers.length > 0) {
    addWarning("MODIFIERS");
  }

  // Check events
  if (contract.events.length > 0) {
    addWarning("EVENTS");
  }

  // Check state variables
  for (const sv of contract.stateVariables) {
    // Nested mapping
    if (sv.isMapping && sv.mappingValueType?.startsWith("mapping(")) {
      addWarning("NESTED_MAPPING");
    }
    // Signed int
    const typeLower = sv.type.toLowerCase();
    if (/^int\d*$/i.test(typeLower) && !typeLower.startsWith("uint")) {
      addWarning("SIGNED_INT");
    }
  }

  // Check functions
  for (const fn of contract.functions) {
    if (fn.mutability === "payable") {
      addWarning("PAYABLE");
    }
    if (fn.name === "fallback" || fn.name === "receive") {
      addWarning("FALLBACK");
    }

    // Check parameter types for signed int
    for (const p of fn.parameters) {
      if (/^int\d*$/i.test(p.type) && !p.type.toLowerCase().startsWith("uint")) {
        addWarning("SIGNED_INT");
      }
    }

    // Check body for selfdestruct
    if (fn.bodySource.includes("selfdestruct")) {
      addWarning("SELFDESTRUCT");
    }
    // Check body for msg.value
    if (fn.bodySource.includes("msg.value")) {
      addWarning("PAYABLE");
    }
  }

  // Also scan full source for selfdestruct
  if (sourceCode.includes("selfdestruct")) {
    addWarning("SELFDESTRUCT");
  }

  return warnings;
}

// ── Main enrichment function ────────────────────────────────

export function enrichAST(
  contract: ParsedContract,
  sourceCode: string
): EnrichedContract {
  const enrichedStateVars: EnrichedStateVariable[] = contract.stateVariables.map(
    (sv) => ({
      ...sv,
      algorand_storage: solidityTypeToAlgorandStorage(sv),
      algorand_type: solidityTypeToAlgorandType(sv.type),
    })
  );

  const enrichedFunctions: EnrichedFunction[] = contract.functions.map((fn) => ({
    ...fn,
    algorand_decorator: functionToAlgorandDecorator(fn),
    parameters: fn.parameters.map((p) => ({
      ...p,
      algorand_type: solidityTypeToAlgorandType(p.type),
    })),
    algorand_return_types: fn.returnTypes.map((rt) =>
      solidityTypeToAlgorandType(rt)
    ),
  }));

  const enrichedEvents: EnrichedEvent[] = contract.events.map((ev) => ({
    ...ev,
    parameters: ev.parameters.map((p) => ({
      ...p,
      algorand_type: solidityTypeToAlgorandType(p.type),
    })),
  }));

  const enrichedModifiers: EnrichedModifier[] = contract.modifiers.map(
    (mod) => ({
      ...mod,
      parameters: mod.parameters.map((p) => ({
        ...p,
        algorand_type: solidityTypeToAlgorandType(p.type),
      })),
    })
  );

  const warnings = detectWarnings(contract, sourceCode);

  return {
    contractName: contract.contractName,
    inheritance: contract.inheritance,
    stateVariables: enrichedStateVars,
    functions: enrichedFunctions,
    events: enrichedEvents,
    modifiers: enrichedModifiers,
    customErrors: contract.customErrors,
    warnings,
  };
}

// ── Build enriched prompt section for Gemini ────────────────

export function buildASTPromptSection(enriched: EnrichedContract): string {
  const lines: string[] = [];

  lines.push("=== CONTRACT ANALYSIS ===");
  lines.push("");
  lines.push(`Contract Name: ${enriched.contractName}`);
  lines.push(
    `Inherits From: ${enriched.inheritance.length > 0 ? enriched.inheritance.join(", ") : "None"}`
  );
  lines.push("");

  // State Variables
  lines.push("STATE VARIABLES:");
  if (enriched.stateVariables.length === 0) {
    lines.push("  (none)");
  } else {
    for (const sv of enriched.stateVariables) {
      lines.push(
        `- ${sv.name}: Solidity type '${sv.type}' -> Algorand: ${sv.algorand_storage}`
      );
      if (sv.isMapping) {
        lines.push(
          `  Key: ${sv.mappingKeyType} -> ${solidityTypeToAlgorandType(sv.mappingKeyType || "unknown")}, Value: ${sv.mappingValueType} -> ${solidityTypeToAlgorandType(sv.mappingValueType || "unknown")}`
        );
      }
    }
  }
  lines.push("");

  // Functions
  lines.push("FUNCTIONS:");
  if (enriched.functions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const fn of enriched.functions) {
      const paramStr = fn.parameters
        .map((p) => `${p.name}: ${p.type}`)
        .join(", ");
      lines.push(
        `- ${fn.name}(${paramStr}) [${fn.visibility} ${fn.mutability}]`
      );
      lines.push(`  Algorand decorator: ${fn.algorand_decorator}`);
      if (fn.isConstructor) {
        lines.push("  This is the constructor");
      }
      if (fn.parameters.length > 0) {
        const algoParams = fn.parameters
          .map((p) => `${p.name}: ${p.algorand_type}`)
          .join(", ");
        lines.push(`  Parameters (Algorand types): ${algoParams}`);
      }
      if (fn.returnTypes.length > 0) {
        lines.push(
          `  Returns: ${fn.algorand_return_types.join(", ")}`
        );
      }
      if (fn.modifiersApplied.length > 0) {
        lines.push(
          `  Modifiers applied: ${fn.modifiersApplied.join(", ")}`
        );
      }
    }
  }
  lines.push("");

  // Events
  lines.push("EVENTS (convert to ARC-28 arc4.emit()):");
  if (enriched.events.length === 0) {
    lines.push("  (none)");
  } else {
    for (const ev of enriched.events) {
      const paramStr = ev.parameters
        .map((p) => `${p.name}: ${p.type}${p.indexed ? " (indexed)" : ""}`)
        .join(", ");
      lines.push(`- ${ev.name}(${paramStr})`);
    }
  }
  lines.push("");

  // Modifiers
  lines.push("MODIFIERS (convert to @subroutine):");
  if (enriched.modifiers.length === 0) {
    lines.push("  (none)");
  } else {
    for (const mod of enriched.modifiers) {
      lines.push(`- ${mod.name}`);
    }
  }
  lines.push("");

  // Warnings
  lines.push("WARNINGS TO ADDRESS IN YOUR OUTPUT:");
  if (enriched.warnings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const w of enriched.warnings) {
      lines.push(`- ${w.message}`);
    }
  }
  lines.push("");

  // Conversion rules
  lines.push("=== CONVERSION RULES ===");
  lines.push("1. import algopy and use arc4.ARC4Contract as base class");
  lines.push("2. msg.sender -> Txn.sender");
  lines.push("3. msg.value -> Txn.amount");
  lines.push("4. require(x, 'msg') -> assert x, 'msg'");
  lines.push("5. mapping reads -> self.mapName[key].value");
  lines.push("6. mapping writes -> self.mapName[key].value = val");
  lines.push("7. emit EventName(args) -> arc4.emit(EventName(args))");
  lines.push("8. block.timestamp -> Global.latest_timestamp");
  lines.push("9. block.number -> Global.round");
  lines.push("10. address(this) -> Global.current_application_address");
  lines.push("11. All modifiers -> @subroutine helper functions");
  lines.push("12. Add inline comments where Algorand differs from Solidity");

  return lines.join("\n");
}
