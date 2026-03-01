"""
Contract Analyzer Service.

Parses converted Algorand Python (algopy) code using Python's ast module,
extracts structural elements (state variables, ABI methods, subroutines,
internal calls, storage access, inner transactions, events, assertions),
and returns a structured JSON payload for the frontend visualizer.
"""

from __future__ import annotations

import ast
import re
from typing import Any

from app.utils.logger import get_logger

logger = get_logger(__name__)


# ── Helpers ───────────────────────────────────────────────────


def _unparse_node(node: ast.AST) -> str:
    """Turn an AST node back into source text (Python 3.9+)."""
    try:
        return ast.unparse(node)
    except Exception:
        return "?"


def _get_decorator_name(dec: ast.AST) -> str:
    """Extract full dotted name from a decorator node."""
    if isinstance(dec, ast.Attribute):
        return f"{_get_decorator_name(dec.value)}.{dec.attr}"
    if isinstance(dec, ast.Name):
        return dec.id
    if isinstance(dec, ast.Call):
        return _get_decorator_name(dec.func)
    return _unparse_node(dec)


def _get_decorator_kwargs(dec: ast.AST) -> dict[str, Any]:
    """Extract keyword arguments from a decorator Call node."""
    if not isinstance(dec, ast.Call):
        return {}
    result: dict[str, Any] = {}
    for kw in dec.keywords:
        if kw.arg is not None:
            try:
                result[kw.arg] = ast.literal_eval(kw.value)
            except Exception:
                result[kw.arg] = _unparse_node(kw.value)
    return result


def _annotation_str(node: ast.AST | None) -> str:
    """Convert a type-annotation AST node to a readable string."""
    if node is None:
        return "None"
    return _unparse_node(node)


# ── Storage-type detection ────────────────────────────────────

_STORAGE_CONSTRUCTORS: dict[str, str] = {
    "GlobalState": "GlobalState",
    "LocalState": "LocalState",
    "Box": "Box",
    "BoxMap": "BoxMap",
    "BoxRef": "BoxRef",
}


# Direct-value type inference for non-GlobalState assignments
# e.g.  self.count = UInt64(0)  →  storage_type=GlobalState, data_type=UInt64
_DIRECT_TYPE_MAP: dict[str, str] = {
    "UInt64": "UInt64",
    "Bytes": "Bytes",
    "Account": "Account",
    "Bool": "Bool",
    "String": "String",
    "arc4.UInt64": "arc4.UInt64",
    "arc4.Bool": "arc4.Bool",
    "arc4.String": "arc4.String",
    "arc4.Address": "arc4.Address",
    "arc4.Byte": "arc4.Byte",
}


def _detect_storage_call(value_node: ast.AST) -> tuple[str, str, str | None] | None:
    """
    If *value_node* is a call like ``GlobalState(UInt64, default=UInt64(0))``,
    return ``(storage_type, data_type, default_value | None)``.

    Also handles direct type constructors like ``UInt64(0)`` or ``Account()``
    which imply GlobalState storage.
    """
    if not isinstance(value_node, ast.Call):
        return None

    func_name = _unparse_node(value_node.func)
    # Strip module prefix  e.g. algopy.GlobalState → GlobalState
    short = func_name.rsplit(".", 1)[-1]

    if short not in _STORAGE_CONSTRUCTORS:
        # Check if it's a direct type constructor like UInt64(0), Account()
        if func_name in _DIRECT_TYPE_MAP or short in _DIRECT_TYPE_MAP:
            data_type = _DIRECT_TYPE_MAP.get(func_name, _DIRECT_TYPE_MAP.get(short, short))
            default_value = _unparse_node(value_node) if value_node.args else None
            return "GlobalState", data_type, default_value
        return None

    storage_type = _STORAGE_CONSTRUCTORS[short]
    data_type = "Unknown"
    default_value: str | None = None

    # First positional arg is the type
    if value_node.args:
        data_type = _unparse_node(value_node.args[0])

    # ``default=...`` keyword
    for kw in value_node.keywords:
        if kw.arg == "default":
            default_value = _unparse_node(kw.value)
        elif kw.arg == "key_type":
            # BoxMap has key_type as first positional sometimes
            pass

    return storage_type, data_type, default_value


# ── Inner-txn detection ──────────────────────────────────────

_INNER_TXN_PATTERNS = re.compile(
    r"\b(itxn\.Payment|itxn\.AssetTransfer|itxn\.ApplicationCall|"
    r"itxn\.AssetConfig|itxn\.KeyRegistration|itxn\.AssetFreeze|"
    r"InnerTransaction|itxn\.submit)\b"
)

_INNER_TXN_TYPE_MAP: dict[str, str] = {
    "itxn.Payment": "Payment",
    "itxn.AssetTransfer": "AssetTransfer",
    "itxn.ApplicationCall": "ApplicationCall",
    "itxn.AssetConfig": "AssetConfig",
    "itxn.KeyRegistration": "KeyRegistration",
    "itxn.AssetFreeze": "AssetFreeze",
    "InnerTransaction": "InnerTransaction",
    "itxn.submit": "InnerTransaction",
}


def _find_inner_txns(body_nodes: list[ast.stmt]) -> list[str]:
    """Scan a function body for inner-transaction calls and return types."""
    source = ""
    for node in body_nodes:
        try:
            source += ast.unparse(node) + "\n"
        except Exception:
            pass

    found: list[str] = []
    for match in _INNER_TXN_PATTERNS.finditer(source):
        txn_type = _INNER_TXN_TYPE_MAP.get(match.group(0), "InnerTransaction")
        if txn_type not in found:
            found.append(txn_type)
    return found


# ── Event detection ───────────────────────────────────────────


def _find_events(body_nodes: list[ast.stmt]) -> list[str]:
    """Scan a function body for ``arc4.emit(...)`` calls."""
    events: list[str] = []
    for node in ast.walk(ast.Module(body=body_nodes, type_ignores=[])):
        if isinstance(node, ast.Call):
            func_str = _unparse_node(node.func)
            if "emit" in func_str:
                # Try to grab event name from first arg
                if node.args:
                    arg = node.args[0]
                    if isinstance(arg, ast.Call):
                        name = _unparse_node(arg.func)
                    else:
                        name = _unparse_node(arg)
                    if name not in events:
                        events.append(name)
    return events


# ── Assertion / guard detection ──────────────────────────────


def _count_guards(body_nodes: list[ast.stmt]) -> int:
    """Count assert statements and op.err() calls."""
    count = 0
    for node in ast.walk(ast.Module(body=body_nodes, type_ignores=[])):
        if isinstance(node, ast.Assert):
            count += 1
        elif isinstance(node, ast.Call):
            func_str = _unparse_node(node.func)
            if "op.err" in func_str or "op.exit" in func_str:
                count += 1
    return count


# ── Self.xxx() call detection ────────────────────────────────


def _find_self_calls(body_nodes: list[ast.stmt]) -> list[str]:
    """Find all ``self.method_name()`` calls in form of a method name list."""
    calls: list[str] = []
    for node in ast.walk(ast.Module(body=body_nodes, type_ignores=[])):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name) and node.func.value.id == "self":
                    method_name = node.func.attr
                    if method_name not in calls:
                        calls.append(method_name)
    return calls


# ── Storage access detection ─────────────────────────────────


def _find_storage_access(
    body_nodes: list[ast.stmt],
    state_var_names: set[str],
) -> tuple[list[str], list[str]]:
    """
    For a method body, find which state variables are read / written.
    Returns (reads, writes).

    Handles multiple access patterns:
    - ``self.var.value = ...`` or ``self.var = ...`` → write
    - ``self.var += / -= / *= ...`` → read + write
    - ``self.var.value`` or ``self.var`` (in expressions) → read
    - ``self.var.set(...)`` / ``self.var.get(...)`` → write / read
    - ``self.var[...] = ...`` → write ; ``self.var[...]`` → read
    """
    reads: list[str] = []
    writes: list[str] = []

    source = ""
    for node in body_nodes:
        try:
            source += ast.unparse(node) + "\n"
        except Exception:
            pass

    for var in state_var_names:
        v = re.escape(var)
        # Write patterns (order matters — more specific first)
        write_patterns = [
            rf"self\.{v}\.value\s*[+\-*/|&^]?=",     # self.var.value =  or +=
            rf"self\.{v}\s*[+\-*/|&^]?=",             # self.var =  or self.var +=
            rf"self\.{v}\.set\(",                      # self.var.set(...)
            rf"self\.{v}\[.*?\]\s*[+\-*/|&^]?=",      # self.var[...] =
            rf"self\.{v}\.value\[.*?\]\s*[+\-*/|&^]?=",  # self.var.value[...] =
        ]
        # Read patterns
        read_patterns = [
            rf"self\.{v}\.value",                       # self.var.value (any context)
            rf"self\.{v}\.get\(",                       # self.var.get(...)
            rf"self\.{v}\[",                             # self.var[...]
        ]
        # Direct read: self.var used in an expression (not just lhs of plain =)
        # Matches self.var followed by common expression contexts
        direct_read_patterns = [
            rf"self\.{v}\s*[+\-*/><!=&|^%]",           # self.var + / > / == etc.
            rf"self\.{v}\s*\)",                         # ...(..., self.var)
            rf"\(self\.{v}",                             # (self.var ..)
            rf"return.*self\.{v}",                       # return self.var
            rf"assert.*self\.{v}",                       # assert self.var
            rf"self\.{v}\s*,",                           # self.var as arg
            rf",\s*self\.{v}",                           # , self.var
            rf"arc4\.\w+\(self\.{v}",                   # arc4.UInt64(self.var)
        ]
        # Augmented assign (+=, -=, etc.) means both read & write
        augmented_patterns = [
            rf"self\.{v}\s*[+\-*/|&^]=" ,               # self.var += ...
            rf"self\.{v}\.value\s*[+\-*/|&^]=",        # self.var.value += ...
        ]

        is_write = any(re.search(p, source) for p in write_patterns)
        is_read = any(re.search(p, source) for p in read_patterns)
        is_direct_read = any(re.search(p, source) for p in direct_read_patterns)
        is_augmented = any(re.search(p, source) for p in augmented_patterns)

        if is_augmented:
            # augmented assignment is both read and write
            if var not in writes:
                writes.append(var)
            if var not in reads:
                reads.append(var)
        else:
            if is_write:
                writes.append(var)
            if is_read or is_direct_read:
                reads.append(var)

    return reads, writes


# ── Solidity-to-Algorand mapping ─────────────────────────────


def _build_solidity_mapping(
    solidity_code: str,
    algopy_code: str,
) -> list[dict[str, str]]:
    """
    Build a rough mapping table between Solidity concepts and their
    Algorand equivalents found in the converted code.
    """
    mappings: list[dict[str, str]] = []

    # mapping(...) → BoxMap / GlobalState
    for m in re.finditer(r"mapping\s*\(([^)]+)\)", solidity_code):
        mapping_sig = m.group(0)
        if "BoxMap" in algopy_code:
            mappings.append({
                "solidity_element": mapping_sig,
                "algorand_element": "BoxMap(...)",
                "mapping_type": "storage",
            })
        else:
            mappings.append({
                "solidity_element": mapping_sig,
                "algorand_element": "GlobalState(...)",
                "mapping_type": "storage",
            })

    # State variables (uint, string, etc.)
    for m in re.finditer(
        r"\b(uint\d*|int\d*|bool|string|address|bytes\d*)\s+(?:public\s+|private\s+|internal\s+)?(\w+)\s*[;=]",
        solidity_code,
    ):
        sol_type, sol_name = m.group(1), m.group(2)
        # Find corresponding algopy
        algo_type = "UInt64" if "uint" in sol_type or "int" in sol_type else (
            "Bytes" if "bytes" in sol_type else (
                "arc4.Bool" if sol_type == "bool" else (
                    "arc4.String" if sol_type == "string" else (
                        "Account" if sol_type == "address" else sol_type
                    )
                )
            )
        )
        mappings.append({
            "solidity_element": f"{sol_type} {sol_name}",
            "algorand_element": f"GlobalState({algo_type})",
            "mapping_type": "storage",
        })

    # msg.sender → Txn.sender
    if "msg.sender" in solidity_code:
        mappings.append({
            "solidity_element": "msg.sender",
            "algorand_element": "Txn.sender",
            "mapping_type": "context",
        })

    # require(...) → assert ...
    if "require(" in solidity_code:
        mappings.append({
            "solidity_element": "require(...)",
            "algorand_element": "assert ...",
            "mapping_type": "control_flow",
        })

    # event → arc4.emit()
    for m in re.finditer(r"\bevent\s+(\w+)", solidity_code):
        event_name = m.group(1)
        mappings.append({
            "solidity_element": f"event {event_name}",
            "algorand_element": f"arc4.emit({event_name}(...))",
            "mapping_type": "event",
        })

    # modifier → @subroutine
    for m in re.finditer(r"\bmodifier\s+(\w+)", solidity_code):
        modifier_name = m.group(1)
        mappings.append({
            "solidity_element": f"modifier {modifier_name}",
            "algorand_element": f"@subroutine {modifier_name}()",
            "mapping_type": "access_control",
        })

    # payable → inner Payment
    if "payable" in solidity_code:
        mappings.append({
            "solidity_element": "payable",
            "algorand_element": "itxn.Payment / PaymentTxn",
            "mapping_type": "payment",
        })

    # constructor → __init__ or create baremethod
    if "constructor" in solidity_code:
        mappings.append({
            "solidity_element": "constructor(...)",
            "algorand_element": "@arc4.baremethod(create='require')",
            "mapping_type": "lifecycle",
        })

    # public/external → @arc4.abimethod
    if re.search(r"\b(public|external)\b", solidity_code):
        mappings.append({
            "solidity_element": "public / external function",
            "algorand_element": "@arc4.abimethod",
            "mapping_type": "visibility",
        })

    # internal/private → @subroutine
    if re.search(r"\b(internal|private)\s+function\b", solidity_code):
        mappings.append({
            "solidity_element": "internal / private function",
            "algorand_element": "@subroutine",
            "mapping_type": "visibility",
        })

    # block.timestamp → Global.latest_timestamp
    if "block.timestamp" in solidity_code:
        mappings.append({
            "solidity_element": "block.timestamp",
            "algorand_element": "Global.latest_timestamp",
            "mapping_type": "context",
        })

    # msg.value → PaymentTxn.amount
    if "msg.value" in solidity_code:
        mappings.append({
            "solidity_element": "msg.value",
            "algorand_element": "PaymentTxn.amount (grouped txn)",
            "mapping_type": "context",
        })

    return mappings


# ── Security notes generator ─────────────────────────────────


def _generate_security_notes(
    methods: list[dict[str, Any]],
    subroutines: list[dict[str, Any]],
) -> list[dict[str, str | None]]:
    """Generate automatic security observations."""
    notes: list[dict[str, str | None]] = []

    # Check methods with no guards
    for m in methods:
        if m["guards_count"] == 0 and not m.get("is_readonly"):
            notes.append({
                "type": "warning",
                "message": f"Method '{m['name']}' has no assertion guards — consider adding sender/state checks.",
                "method": m["name"],
            })

    # Check methods with inner txns but no guards
    for m in methods:
        if m["inner_txns"] and m["guards_count"] == 0:
            notes.append({
                "type": "danger",
                "message": f"Method '{m['name']}' makes inner transactions without any assertion guards!",
                "method": m["name"],
            })

    # Positive: all public methods have guards
    guarded = [m for m in methods if m["guards_count"] > 0 and not m.get("is_readonly")]
    non_readonly = [m for m in methods if not m.get("is_readonly")]
    if non_readonly and len(guarded) == len(non_readonly):
        notes.append({
            "type": "safe",
            "message": "All state-changing methods have assertion guards.",
            "method": None,
        })

    # Check for create method
    has_create = any(m.get("is_create") for m in methods)
    if not has_create:
        notes.append({
            "type": "info",
            "message": "No explicit create method found — contract may use a bare 'create' method.",
            "method": None,
        })

    return notes


# ══════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════


def analyze_contract(
    algopy_code: str,
    arc32_json: dict | None = None,
    solidity_code: str | None = None,
) -> dict[str, Any]:
    """
    Analyse an Algorand Python (algopy) contract and return a structured
    dict suitable for the frontend visualizer.

    Parameters
    ----------
    algopy_code : str
        The converted Algorand Python source code.
    arc32_json : dict | None
        Optional ARC-32 app spec JSON from the Puya compiler.
    solidity_code : str | None
        Optional original Solidity source (for the mapping table).

    Returns
    -------
    dict
        Structured analysis result with keys: contract_name,
        state_variables, methods, subroutines, call_graph,
        storage_access_map, inner_txn_map, events, security_notes,
        solidity_mapping, errors.
    """
    errors: list[str] = []

    # ── Parse the algopy code ─────────────────────────────────
    try:
        tree = ast.parse(algopy_code)
    except SyntaxError as exc:
        logger.warning("Contract analysis: syntax error in algopy code: %s", exc)
        return {
            "contract_name": "Unknown",
            "state_variables": [],
            "methods": [],
            "subroutines": [],
            "call_graph": [],
            "storage_access_map": [],
            "inner_txn_map": [],
            "events": [],
            "security_notes": [],
            "solidity_mapping": [],
            "errors": [f"Syntax error: {exc}"],
        }

    # ── Find contract class(es) ──────────────────────────────
    contract_classes: list[ast.ClassDef] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                base_str = _unparse_node(base)
                if any(
                    kw in base_str
                    for kw in ("ARC4Contract", "Contract", "ARC4Client")
                ):
                    contract_classes.append(node)
                    break

    if not contract_classes:
        # Fall back: treat the first class as the contract
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                contract_classes.append(node)
                break

    if not contract_classes:
        return {
            "contract_name": "Unknown",
            "state_variables": [],
            "methods": [],
            "subroutines": [],
            "call_graph": [],
            "storage_access_map": [],
            "inner_txn_map": [],
            "events": [],
            "security_notes": [],
            "solidity_mapping": [],
            "errors": ["No contract class found in the code."],
        }

    # Use the first (primary) contract class
    contract_cls = contract_classes[0]
    contract_name = contract_cls.name

    # ── Extract state variables ──────────────────────────────
    state_variables: list[dict[str, Any]] = []
    state_var_names: set[str] = set()

    for node in contract_cls.body:
        # Look in __init__
        if isinstance(node, ast.FunctionDef) and node.name == "__init__":
            for stmt in node.body:
                if isinstance(stmt, ast.Assign):
                    for target in stmt.targets:
                        if (
                            isinstance(target, ast.Attribute)
                            and isinstance(target.value, ast.Name)
                            and target.value.id == "self"
                        ):
                            var_name = target.attr
                            info = _detect_storage_call(stmt.value)
                            if info:
                                storage_type, data_type, default_value = info
                                state_variables.append({
                                    "name": var_name,
                                    "storage_type": storage_type,
                                    "data_type": data_type,
                                    "default_value": default_value,
                                })
                                state_var_names.add(var_name)
                            else:
                                # Direct assignment (might still be state)
                                state_variables.append({
                                    "name": var_name,
                                    "storage_type": "Unknown",
                                    "data_type": _unparse_node(stmt.value),
                                    "default_value": None,
                                })
                                state_var_names.add(var_name)

        # Also check class-level annotated assignments
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            var_name = node.target.id
            ann_str = _annotation_str(node.annotation)
            for key in _STORAGE_CONSTRUCTORS:
                if key in ann_str:
                    state_variables.append({
                        "name": var_name,
                        "storage_type": _STORAGE_CONSTRUCTORS[key],
                        "data_type": ann_str,
                        "default_value": _unparse_node(node.value) if node.value else None,
                    })
                    state_var_names.add(var_name)
                    break

    # ── Extract methods & subroutines ────────────────────────
    methods: list[dict[str, Any]] = []
    subroutines: list[dict[str, Any]] = []

    for node in contract_cls.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name in ("__init__",):
            continue

        dec_names = [_get_decorator_name(d) for d in node.decorator_list]
        dec_kwargs_list = [_get_decorator_kwargs(d) for d in node.decorator_list]

        # Determine decorator type
        is_abimethod = any("abimethod" in d for d in dec_names)
        is_baremethod = any("baremethod" in d for d in dec_names)
        is_subroutine_dec = any("subroutine" in d for d in dec_names)

        # Merge all decorator kwargs
        dec_kwargs: dict[str, Any] = {}
        for kw in dec_kwargs_list:
            dec_kwargs.update(kw)

        # Extract params (skip 'self')
        params: list[dict[str, str]] = []
        for arg in node.args.args:
            if arg.arg == "self":
                continue
            params.append({
                "name": arg.arg,
                "type": _annotation_str(arg.annotation),
            })

        return_type = _annotation_str(node.returns)

        # Storage access
        reads, writes = _find_storage_access(node.body, state_var_names)

        # Internal calls
        calls = _find_self_calls(node.body)
        # Filter out state variable accesses (only keep real method calls)
        method_calls = [c for c in calls if c not in state_var_names and c != "__init__"]

        # Inner transactions
        inner_txns = _find_inner_txns(node.body)

        # Events
        events_emitted = _find_events(node.body)

        # Guards
        guards_count = _count_guards(node.body)

        entry = {
            "name": node.name,
            "params": params,
            "return_type": return_type,
            "reads_state": reads,
            "writes_state": writes,
            "calls_methods": method_calls,
            "inner_txns": inner_txns,
            "emits_events": events_emitted,
            "guards_count": guards_count,
            "line_number": node.lineno,
        }

        if is_abimethod or is_baremethod:
            decorator = "abimethod" if is_abimethod else "baremethod"
            is_readonly = dec_kwargs.get("readonly", dec_kwargs.get("read_only", False))
            is_create = False
            allowed_actions: list[str] = []

            create_val = dec_kwargs.get("create", None)
            if create_val == "require" or create_val is True:
                is_create = True

            allow_acts = dec_kwargs.get("allow_actions", [])
            if isinstance(allow_acts, list):
                allowed_actions = [str(a) for a in allow_acts]
            elif isinstance(allow_acts, str):
                allowed_actions = [allow_acts]

            entry.update({
                "decorator": decorator,
                "is_readonly": bool(is_readonly),
                "is_create": is_create,
                "allowed_actions": allowed_actions,
            })
            methods.append(entry)

        elif is_subroutine_dec:
            entry["decorator"] = "subroutine"
            subroutines.append(entry)

        else:
            # Methods without decorators — treat as private helpers (subroutine-like)
            entry["decorator"] = "helper"
            subroutines.append(entry)

    # ── Build call graph ─────────────────────────────────────
    call_graph: list[dict[str, str]] = []
    all_func_names = {m["name"] for m in methods} | {s["name"] for s in subroutines}

    for m in methods + subroutines:
        for callee in m["calls_methods"]:
            if callee in all_func_names:
                call_graph.append({"from": m["name"], "to": callee})

    # ── Build storage access map ─────────────────────────────
    storage_access_map: list[dict[str, str]] = []
    for m in methods + subroutines:
        for var in m["reads_state"]:
            storage_access_map.append({
                "method": m["name"],
                "variable": var,
                "access_type": "read",
            })
        for var in m["writes_state"]:
            storage_access_map.append({
                "method": m["name"],
                "variable": var,
                "access_type": "write",
            })

    # ── Build inner txn map ──────────────────────────────────
    inner_txn_map: list[dict[str, str]] = []
    for m in methods + subroutines:
        for txn_type in m["inner_txns"]:
            inner_txn_map.append({
                "method": m["name"],
                "txn_type": txn_type,
            })

    # ── Build events list ────────────────────────────────────
    events_agg: dict[str, list[str]] = {}
    for m in methods + subroutines:
        for ev in m["emits_events"]:
            events_agg.setdefault(ev, []).append(m["name"])

    events_list = [
        {"name": name, "emitted_by": emitters}
        for name, emitters in events_agg.items()
    ]

    # ── ARC-32 cross-reference ───────────────────────────────
    if arc32_json:
        arc32_methods_list = arc32_json.get("methods", [])
        if not arc32_methods_list:
            contract_section = arc32_json.get("contract", {})
            if isinstance(contract_section, dict):
                arc32_methods_list = contract_section.get("methods", [])

        arc32_by_name: dict[str, dict] = {}
        for am in arc32_methods_list:
            if isinstance(am, dict) and "name" in am:
                arc32_by_name[am["name"]] = am

        for m in methods:
            arc32_info = arc32_by_name.get(m["name"])
            if arc32_info:
                # Build ABI selector signature
                arg_types = ",".join(a.get("type", "?") for a in arc32_info.get("args", []))
                ret_type = arc32_info.get("returns", {}).get("type", "void")
                m["abi_signature"] = f"{m['name']}({arg_types}){ret_type}"
                if arc32_info.get("desc"):
                    m["description"] = arc32_info["desc"]

    # ── Security notes ───────────────────────────────────────
    security_notes = _generate_security_notes(methods, subroutines)

    # ── Solidity mapping ─────────────────────────────────────
    solidity_mapping: list[dict[str, str]] = []
    if solidity_code:
        solidity_mapping = _build_solidity_mapping(solidity_code, algopy_code)

    # ── Compose result ───────────────────────────────────────
    return {
        "contract_name": contract_name,
        "state_variables": state_variables,
        "methods": methods,
        "subroutines": subroutines,
        "call_graph": call_graph,
        "storage_access_map": storage_access_map,
        "inner_txn_map": inner_txn_map,
        "events": events_list,
        "security_notes": security_notes,
        "solidity_mapping": solidity_mapping,
        "errors": errors,
    }


# ══════════════════════════════════════════════════════════════
# MULTI-CONTRACT ANALYSIS
# ══════════════════════════════════════════════════════════════


def analyze_multi_contract(
    contracts: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Analyse multiple contracts and detect inter-contract relationships.

    Parameters
    ----------
    contracts : list[dict]
        Each dict has keys: name, algopy_code, arc32_json?, solidity_code?.

    Returns
    -------
    dict
        { contracts: [...], inter_contract_edges: [...], deployment_order: [...] }
    """
    analyses: list[dict[str, Any]] = []
    contract_names: list[str] = []

    for c in contracts:
        result = analyze_contract(
            algopy_code=c.get("algopy_code", ""),
            arc32_json=c.get("arc32_json"),
            solidity_code=c.get("solidity_code"),
        )
        # Override name from input if provided
        if c.get("name"):
            result["contract_name"] = c["name"]
        analyses.append(result)
        contract_names.append(result["contract_name"])

    # ── Detect inter-contract relationships ──────────────────
    inter_contract_edges: list[dict[str, str | None]] = []

    # Build name variants for fuzzy matching (e.g. "Token" -> "token", "token_app_id")
    name_variants: dict[str, list[str]] = {}
    for name in contract_names:
        lower = name.lower()
        # CamelCase -> snake_case  (e.g. "MyToken" -> "my_token")
        snake = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name).lower()
        variants = {lower, snake, f"{lower}_app_id", f"{snake}_app_id",
                     f"{lower}_app", f"{snake}_app", f"{lower}_id", f"{snake}_id"}
        name_variants[name] = list(variants)

    for i, analysis in enumerate(analyses):
        code = contracts[i].get("algopy_code", "")
        code_lower = code.lower()
        methods_data = analysis.get("methods", [])
        subroutines_data = analysis.get("subroutines", [])

        for j, other_name in enumerate(contract_names):
            if i == j:
                continue

            # --- Strategy 1: Direct class name reference ---
            if other_name in code:
                via_method = None
                rel_type = "references"
                if "itxn.ApplicationCall" in code:
                    rel_type = "ApplicationCall"
                inter_contract_edges.append({
                    "from_contract": analysis["contract_name"],
                    "to_contract": other_name,
                    "relationship_type": rel_type,
                    "via_method": via_method,
                })
                continue

            # --- Strategy 2: State variable naming convention ---
            # e.g. self.token_app_id with contract named "Token"
            matched_via_state = False
            for variant in name_variants[other_name]:
                if variant in code_lower:
                    # Found a reference — determine relationship type
                    rel_type = "references"
                    via_method = None

                    # Check each method for ApplicationCall + this reference
                    for m in methods_data + subroutines_data:
                        if "ApplicationCall" in m.get("inner_txns", []):
                            # Check if this method reads/writes the matched state var
                            all_accessed = set(m.get("reads_state", []) + m.get("writes_state", []))
                            for sv in all_accessed:
                                if variant in sv.lower():
                                    rel_type = "ApplicationCall"
                                    via_method = m["name"]
                                    break
                            if via_method:
                                break

                    # If no specific method found, check if any method has the inner txn
                    if rel_type != "ApplicationCall":
                        for m in methods_data + subroutines_data:
                            if "ApplicationCall" in m.get("inner_txns", []):
                                rel_type = "ApplicationCall"
                                via_method = m["name"]
                                break

                    inter_contract_edges.append({
                        "from_contract": analysis["contract_name"],
                        "to_contract": other_name,
                        "relationship_type": rel_type,
                        "via_method": via_method,
                    })
                    matched_via_state = True
                    break

            if matched_via_state:
                continue

            # --- Strategy 3: itxn.ApplicationCall in a method that takes app_id param ---
            for m in methods_data:
                if "ApplicationCall" not in m.get("inner_txns", []):
                    continue
                # Check if any param name hints at the other contract
                for p in m.get("params", []):
                    p_name = p.get("name", "").lower() if isinstance(p, dict) else str(p).lower()
                    for variant in name_variants[other_name]:
                        if variant in p_name:
                            inter_contract_edges.append({
                                "from_contract": analysis["contract_name"],
                                "to_contract": other_name,
                                "relationship_type": "ApplicationCall",
                                "via_method": m["name"],
                            })
                            matched_via_state = True
                            break
                    if matched_via_state:
                        break
                if matched_via_state:
                    break

    # ── Deployment order (simple topological sort) ───────────
    # Contracts that are referenced by others should be deployed first
    dependency_count: dict[str, int] = {name: 0 for name in contract_names}
    for edge in inter_contract_edges:
        to_c = edge["to_contract"]
        if to_c and to_c in dependency_count:
            dependency_count[to_c] += 0  # being depended on = deploy first
            from_c = edge["from_contract"]
            if from_c and from_c in dependency_count:
                dependency_count[from_c] += 1  # depends on others = deploy later

    deployment_order = sorted(contract_names, key=lambda n: dependency_count.get(n, 0))

    return {
        "contracts": analyses,
        "inter_contract_edges": inter_contract_edges,
        "deployment_order": deployment_order,
    }
