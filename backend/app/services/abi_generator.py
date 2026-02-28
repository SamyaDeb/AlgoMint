"""
ARC-32 Application Spec Generator.

Parses Solidity source code and generates an ARC-32 compatible application.json
with ARC-4 method definitions. This enables frontends and SDKs to interact with
the deployed Algorand contract.

References:
  - ARC-4:  https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0004.md
  - ARC-32: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0032.md
"""

from __future__ import annotations

import re
from typing import Any

from app.utils.logger import get_logger

logger = get_logger(__name__)


# ── Solidity → ARC-4 type mapping ────────────────────────────

SOLIDITY_TO_ARC4_TYPE: dict[str, str] = {
    # Unsigned integers
    "uint8": "uint8",
    "uint16": "uint16",
    "uint32": "uint32",
    "uint64": "uint64",
    "uint128": "uint64",    # AVM is 64-bit max natively
    "uint256": "uint64",    # AVM is 64-bit max natively
    "uint": "uint64",
    # Signed integers (mapped to uint64 with warning)
    "int8": "uint8",
    "int16": "uint16",
    "int32": "uint32",
    "int64": "uint64",
    "int128": "uint64",
    "int256": "uint64",
    "int": "uint64",
    # Common types
    "address": "address",
    "bool": "bool",
    "string": "string",
    "bytes": "byte[]",
    "bytes1": "byte[1]",
    "bytes4": "byte[4]",
    "bytes8": "byte[8]",
    "bytes16": "byte[16]",
    "bytes32": "byte[32]",
    "bytes64": "byte[64]",
}


def _map_solidity_type_to_arc4(solidity_type: str) -> str:
    """Map a Solidity type to an ARC-4 compatible type."""
    t = solidity_type.strip()

    # Direct match
    if t.lower() in SOLIDITY_TO_ARC4_TYPE:
        return SOLIDITY_TO_ARC4_TYPE[t.lower()]

    # Array types: uint256[] → uint64[]
    arr_match = re.match(r"^(\w+)\[\]$", t)
    if arr_match:
        base = _map_solidity_type_to_arc4(arr_match.group(1))
        return f"{base}[]"

    # Fixed-size array: uint256[10] → uint64[10]
    fixed_arr_match = re.match(r"^(\w+)\[(\d+)\]$", t)
    if fixed_arr_match:
        base = _map_solidity_type_to_arc4(fixed_arr_match.group(1))
        size = fixed_arr_match.group(2)
        return f"{base}[{size}]"

    # Mapping types → not directly supported in ARC-4 ABI
    if t.startswith("mapping"):
        return "byte[]"

    # Fallback
    return "byte[]"


# ── Solidity function parser ─────────────────────────────────

# Regex to capture function signatures
_FUNC_PATTERN = re.compile(
    r"""
    function\s+                            # keyword
    (\w+)\s*                               # function name
    \(([^)]*)\)\s*                         # parameters
    ((?:public|external|internal|private|view|pure|payable|virtual|override|returns\s*\([^)]*\)|\s)+)  # modifiers + return
    """,
    re.VERBOSE | re.MULTILINE,
)

# Regex for constructor
_CONSTRUCTOR_PATTERN = re.compile(
    r"constructor\s*\(([^)]*)\)",
    re.MULTILINE,
)

# Regex to extract contract name
_CONTRACT_NAME_PATTERN = re.compile(
    r"(?:contract|interface)\s+(\w+)",
    re.MULTILINE,
)

# Regex to extract returns clause
_RETURNS_PATTERN = re.compile(r"returns\s*\(([^)]*)\)")

# Regex to extract events
_EVENT_PATTERN = re.compile(
    r"event\s+(\w+)\s*\(([^)]*)\)\s*;",
    re.MULTILINE,
)


def _parse_params(param_str: str) -> list[dict[str, str]]:
    """Parse a comma-separated parameter list into [{name, type}]."""
    params = []
    if not param_str or not param_str.strip():
        return params

    for part in param_str.split(","):
        part = part.strip()
        if not part:
            continue

        # Remove storage qualifiers
        part = re.sub(r"\b(memory|storage|calldata)\b", "", part).strip()

        tokens = part.split()
        if len(tokens) >= 2:
            sol_type = tokens[0]
            name = tokens[-1]
            params.append({
                "name": name,
                "type": _map_solidity_type_to_arc4(sol_type),
                "solidity_type": sol_type,
            })
        elif len(tokens) == 1:
            # Type only, no name
            sol_type = tokens[0]
            params.append({
                "name": f"arg{len(params)}",
                "type": _map_solidity_type_to_arc4(sol_type),
                "solidity_type": sol_type,
            })

    return params


def _parse_return_type(modifiers_str: str) -> dict[str, str]:
    """Extract the return type from a function's modifier string."""
    match = _RETURNS_PATTERN.search(modifiers_str)
    if not match:
        return {"type": "void"}

    ret_str = match.group(1).strip()
    if not ret_str:
        return {"type": "void"}

    # Multiple returns → tuple
    parts = [p.strip() for p in ret_str.split(",") if p.strip()]
    if len(parts) == 1:
        # Single return: extract type (ignore name if present)
        tokens = parts[0].split()
        sol_type = tokens[0]
        return {"type": _map_solidity_type_to_arc4(sol_type)}
    else:
        # Multiple returns → ARC-4 tuple
        types = []
        for p in parts:
            tokens = p.split()
            types.append(_map_solidity_type_to_arc4(tokens[0]))
        return {"type": f"({','.join(types)})"}


def generate_arc32_app_spec(solidity_code: str) -> dict[str, Any]:
    """
    Generate an ARC-32 application spec from Solidity source code.

    Returns a dict matching the ARC-32 application.json format:
    {
      "name": "ContractName",
      "desc": "...",
      "methods": [...],
      "networks": {},
      "source": {...}
    }
    """
    warnings: list[str] = []

    # Extract contract name
    contract_match = _CONTRACT_NAME_PATTERN.search(solidity_code)
    contract_name = contract_match.group(1) if contract_match else "UnknownContract"

    methods: list[dict[str, Any]] = []

    # Parse regular functions
    for match in _FUNC_PATTERN.finditer(solidity_code):
        func_name = match.group(1)
        params_str = match.group(2)
        modifiers_str = match.group(3)

        # Skip internal/private functions — they aren't part of ABI
        if "internal" in modifiers_str or "private" in modifiers_str:
            continue

        args = _parse_params(params_str)
        returns = _parse_return_type(modifiers_str)

        # Determine read-only
        is_readonly = "view" in modifiers_str or "pure" in modifiers_str

        method: dict[str, Any] = {
            "name": func_name,
            "args": [{"name": a["name"], "type": a["type"]} for a in args],
            "returns": returns,
            "desc": f"Converted from Solidity {'view ' if is_readonly else ''}function {func_name}",
        }

        if is_readonly:
            method["readonly"] = True

        methods.append(method)

    # Parse constructor
    ctor_match = _CONSTRUCTOR_PATTERN.search(solidity_code)
    if ctor_match and ctor_match.group(1).strip():
        ctor_args = _parse_params(ctor_match.group(1))
        if ctor_args:
            # ARC-4 create method
            methods.insert(0, {
                "name": "create",
                "args": [{"name": a["name"], "type": a["type"]} for a in ctor_args],
                "returns": {"type": "void"},
                "desc": f"Constructor — initializes {contract_name}",
            })

    # Parse events (informational)
    events: list[dict[str, Any]] = []
    for ev_match in _EVENT_PATTERN.finditer(solidity_code):
        ev_name = ev_match.group(1)
        ev_params_str = ev_match.group(2)
        ev_args = []
        if ev_params_str.strip():
            for part in ev_params_str.split(","):
                part = part.strip()
                tokens = re.sub(r"\bindexed\b", "", part).strip().split()
                if len(tokens) >= 2:
                    ev_args.append({
                        "name": tokens[-1],
                        "type": _map_solidity_type_to_arc4(tokens[0]),
                        "indexed": "indexed" in part,
                    })
        events.append({"name": ev_name, "args": ev_args})

    # Check for signed ints
    if re.search(r"\bint\d*\b", solidity_code) and not re.search(r"\buint\d*\b", solidity_code):
        pass  # Only signed ints
    for m in re.finditer(r"\bint(\d+)?\b", solidity_code):
        full = m.group(0)
        if not full.startswith("uint"):
            warnings.append(f"Signed integer type '{full}' mapped to unsigned — AVM has no signed ints")
            break

    # Check for unsupported types
    if "mapping" in solidity_code:
        warnings.append("Mappings are stored as BoxMap on Algorand — not directly ABI-callable")

    # Count methods
    public_count = len(methods)
    readonly_count = sum(1 for m in methods if m.get("readonly"))

    # Build the ARC-32 spec
    app_spec: dict[str, Any] = {
        "name": contract_name,
        "desc": f"ARC-32 application spec for {contract_name} — auto-generated by AlgoMint from Solidity",
        "methods": methods,
        "networks": {},
        "source": {
            "approval": "",
            "clear": "",
        },
        "state": {
            "global": {"num_uints": 0, "num_byte_slices": 0},
            "local": {"num_uints": 0, "num_byte_slices": 0},
        },
        "contract": {
            "name": contract_name,
            "desc": f"Converted from Solidity by AlgoMint",
            "methods": methods,
        },
        # AlgoMint metadata (non-standard, informational)
        "algomint_metadata": {
            "total_methods": public_count,
            "readonly_methods": readonly_count,
            "events": events,
            "warnings": warnings,
            "generator": "AlgoMint v1.0.0",
        },
    }

    logger.info(
        "Generated ARC-32 spec  contract=%s  methods=%d  events=%d  warnings=%d",
        contract_name, public_count, len(events), len(warnings),
    )

    return app_spec
