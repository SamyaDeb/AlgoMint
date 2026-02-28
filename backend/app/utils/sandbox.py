"""
Algorand Python compilation helper.

Compiles Algorand Python (.py) source code to TEAL assembly using the PuyaPy
compiler as a subprocess.

**Key insight**: Puya requires a proper Python project structure to determine
the package root.  Without it you get:

    warning: cannot determine package root for /tmp/.../contract.py

and no ARC-32 / ARC-56 files are generated.

This module creates the following scaffold inside a temp directory before
invoking the compiler:

    /tmp/algomint_XXXXX/
    ├── pyproject.toml          ← minimal [project] so Puya finds the root
    ├── .algokit.toml            ← marks the AlgoKit project root
    ├── src/
    │   ├── __init__.py
    │   └── contract.py          ← the user's Algorand Python code
    └── out/                     ← Puya writes output files here

Then: ``algokit compile python src/contract.py --out-dir out``

Output file names are determined by the **contract class name** inside the
source (not the input file name), so this module discovers them dynamically
via glob.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import tempfile
import textwrap
import traceback
from dataclasses import dataclass, field

from app.utils.logger import get_logger

logger = get_logger(__name__)

# Maximum compilation time in seconds
_COMPILE_TIMEOUT = 90

# ── Minimal project files Puya needs ─────────────────────────

_PYPROJECT_TOML = textwrap.dedent("""\
    [project]
    name = "algomint-contract"
    version = "0.1.0"
    requires-python = ">=3.12"
    dependencies = [
        "algorand-python>=2.0.0",
    ]
""")

_ALGOKIT_TOML = textwrap.dedent("""\
    [project]
    type = "contract"
    name = "algomint-contract"

    [generate.smart_contract]
    description = "Compiles Algorand Python via AlgoMint IDE"
""")


# ── Data class for compile output ─────────────────────────────

@dataclass
class CompileResult:
    """Result of an Algorand Python -> TEAL compilation."""

    success: bool
    approval_teal: str = ""
    clear_teal: str = ""
    arc32_json: dict | None = None
    arc56_json: dict | None = None
    contract_name: str = ""
    error: str = ""
    traceback: str = ""
    error_line: int | None = None
    error_column: int | None = None
    error_type: str = "unknown"
    raw_stdout: str = ""
    raw_stderr: str = ""
    compilation_warnings: list[str] = field(default_factory=list)


# ── Helpers ──────────────────────────────────────────────────

def _extract_contract_class(code: str) -> str | None:
    """Return the first ARC4Contract / Contract subclass name found in *code*."""
    match = re.search(
        r"class\s+(\w+)\s*\(.*?(?:ARC4Contract|Contract).*?\)\s*:",
        code,
    )
    return match.group(1) if match else None


def _parse_error_location(stderr: str) -> tuple[int | None, int | None, str]:
    """
    Extract line number, column, and error type from PuyaPy stderr.

    Returns (line, column, error_type).
    """
    line = None
    column = None
    error_type = "unknown"

    # Pattern: contract.py:10:5: error: ...
    loc_match = re.search(r":(\d+):(\d+):\s*(error|warning)", stderr)
    if loc_match:
        line = int(loc_match.group(1))
        column = int(loc_match.group(2))
    else:
        # Pattern: line 10
        line_match = re.search(r"line\s+(\d+)", stderr, re.IGNORECASE)
        if line_match:
            line = int(line_match.group(1))

    # Determine error type
    stderr_lower = stderr.lower()
    if "syntax" in stderr_lower or "indentation" in stderr_lower:
        error_type = "syntax"
    elif "type" in stderr_lower and "error" in stderr_lower:
        error_type = "type"
    elif "opcode" in stderr_lower or "unsupported" in stderr_lower:
        error_type = "opcode"

    return line, column, error_type


def _scaffold_project(tmpdir: str, code: str) -> tuple[str, str]:
    """
    Create a minimal AlgoKit / Puya project scaffold inside *tmpdir*.

    Returns ``(src_path, out_dir)`` – the path where the source was written
    and the output directory Puya should target.
    """
    src_dir = os.path.join(tmpdir, "src")
    out_dir = os.path.join(tmpdir, "out")
    os.makedirs(src_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    # pyproject.toml — tells Puya this is a Python project root
    with open(os.path.join(tmpdir, "pyproject.toml"), "w") as f:
        f.write(_PYPROJECT_TOML)

    # .algokit.toml — marks the AlgoKit project root
    with open(os.path.join(tmpdir, ".algokit.toml"), "w") as f:
        f.write(_ALGOKIT_TOML)

    # src/__init__.py — makes src a proper Python package
    with open(os.path.join(src_dir, "__init__.py"), "w") as f:
        f.write("")

    # src/contract.py — the user's Algorand Python code
    src_path = os.path.join(src_dir, "contract.py")
    with open(src_path, "w") as f:
        f.write(code)

    return src_path, out_dir


def _collect_output_files(
    out_dir: str,
    contract_name: str,
) -> tuple[str, str, dict | None, dict | None, str]:
    """
    Discover compiled artifacts in *out_dir*.

    Puya names output files after the contract **class** name, which may
    differ from the input file name.  We first try an exact match, then fall
    back to globbing.

    Returns ``(approval_teal, clear_teal, arc32_json, arc56_json, contract_name)``.
    """
    approval_teal = ""
    clear_teal = ""
    arc32_json: dict | None = None
    arc56_json: dict | None = None

    # --- Walk the entire out tree (Puya may nest under subdirs) --------
    def _find(pattern: str) -> str | None:
        hits = glob.glob(os.path.join(out_dir, "**", pattern), recursive=True)
        return hits[0] if hits else None

    # Try exact match by contract class name first
    if contract_name:
        p = _find(f"{contract_name}.approval.teal")
        if p:
            with open(p) as f:
                approval_teal = f.read()
        p = _find(f"{contract_name}.clear.teal")
        if p:
            with open(p) as f:
                clear_teal = f.read()
        p = _find(f"{contract_name}.arc32.json")
        if p:
            with open(p) as f:
                arc32_json = json.load(f)
        p = _find(f"{contract_name}.arc56.json")
        if p:
            with open(p) as f:
                arc56_json = json.load(f)

    # Fallback: glob for any matching suffix
    if not approval_teal:
        p = _find("*.approval.teal")
        if p:
            with open(p) as f:
                approval_teal = f.read()
            if not contract_name:
                contract_name = os.path.basename(p).replace(".approval.teal", "")
    if not clear_teal:
        p = _find("*.clear.teal")
        if p:
            with open(p) as f:
                clear_teal = f.read()
    if not arc32_json:
        p = _find("*.arc32.json")
        if p:
            with open(p) as f:
                arc32_json = json.load(f)
    if not arc56_json:
        p = _find("*.arc56.json")
        if p:
            with open(p) as f:
                arc56_json = json.load(f)

    return approval_teal, clear_teal, arc32_json, arc56_json, contract_name


# ── Main entry point ─────────────────────────────────────────

def compile_algorand_python(code: str) -> CompileResult:
    """
    Compile an Algorand Python source string via PuyaPy.

    1. Creates a proper project scaffold in a temp directory
       (``pyproject.toml``, ``.algokit.toml``, ``src/__init__.py``).
    2. Writes *code* to ``src/contract.py``.
    3. Runs ``puyapy src/contract.py --out-dir <abs> --output-arc32``
       from the project root so Puya can find the package root.
    4. Dynamically discovers ``<ContractName>.approval.teal``,
       ``<ContractName>.clear.teal``, ``<ContractName>.arc32.json``,
       and ``<ContractName>.arc56.json`` in the output directory.
    5. Returns a :class:`CompileResult` with all artifacts.
    """
    logger.debug("compile_algorand_python: compiling %d chars", len(code))

    try:
        with tempfile.TemporaryDirectory(prefix="algomint_") as tmpdir:
            # ── 1. Scaffold the project ───────────────────────────
            src_path, out_dir = _scaffold_project(tmpdir, code)

            logger.debug(
                "Project scaffold created  tmpdir=%s  src=%s  out=%s",
                tmpdir, src_path, out_dir,
            )

            # ── 2. Run PuyaPy from the project root ──────────────
            #
            # Use puyapy directly (not `algokit compile python` which can
            # hang waiting for interactive prompts).
            #
            # Key flags:
            #   --out-dir <abs>     → absolute path to avoid Puya placing
            #                         output relative to the source file
            #   --output-arc32      → PuyaPy 5.x defaults to ARC-56 only;
            #                         we explicitly enable ARC-32 as well
            #   --no-output-source-map → skip .puya.map files we don't need
            #
            # cwd=tmpdir so pyproject.toml is found as the package root.
            proc = subprocess.run(
                [
                    "puyapy",
                    "src/contract.py",
                    "--out-dir",
                    out_dir,               # absolute path
                    "--output-arc32",
                    "--no-output-source-map",
                ],
                capture_output=True,
                text=True,
                timeout=_COMPILE_TIMEOUT,
                cwd=tmpdir,                # ← critical: run from project root
            )

            raw_stdout = proc.stdout.strip()
            raw_stderr = proc.stderr.strip()

            logger.debug(
                "PuyaPy exit  rc=%d  stdout=%d chars  stderr=%d chars",
                proc.returncode,
                len(raw_stdout),
                len(raw_stderr),
            )

            if proc.returncode != 0:
                stderr = raw_stderr or raw_stdout
                logger.warning("PuyaPy failed (rc=%d): %s", proc.returncode, stderr[:500])

                line, column, error_type = _parse_error_location(stderr)

                return CompileResult(
                    success=False,
                    error=f"Compilation failed:\n{stderr}",
                    traceback=stderr,
                    error_line=line,
                    error_column=column,
                    error_type=error_type,
                    raw_stdout=raw_stdout,
                    raw_stderr=raw_stderr,
                )

            # ── 3. Extract warnings ──────────────────────────────
            warnings: list[str] = []
            for warn_line in (raw_stdout + "\n" + raw_stderr).split("\n"):
                stripped = warn_line.strip()
                if stripped and "warning" in stripped.lower():
                    warnings.append(stripped)

            # ── 4. Discover output files ─────────────────────────
            contract_name = _extract_contract_class(code) or ""

            approval_teal, clear_teal, arc32_json, arc56_json, contract_name = (
                _collect_output_files(out_dir, contract_name)
            )

            if not approval_teal:
                # List everything Puya did produce for debugging
                all_files: list[str] = []
                for root, _dirs, files in os.walk(out_dir):
                    for fname in files:
                        rel = os.path.relpath(os.path.join(root, fname), out_dir)
                        all_files.append(rel)

                logger.error("No approval TEAL found. Files in out_dir: %s", all_files)
                return CompileResult(
                    success=False,
                    error="PuyaPy succeeded but no approval.teal was produced.",
                    traceback=f"Files in output directory: {all_files}",
                    raw_stdout=raw_stdout,
                    raw_stderr=raw_stderr,
                )

            logger.info(
                "Compilation successful  contract=%s  approval=%d bytes  clear=%d bytes  arc32=%s  arc56=%s",
                contract_name,
                len(approval_teal),
                len(clear_teal),
                "yes" if arc32_json else "no",
                "yes" if arc56_json else "no",
            )
            return CompileResult(
                success=True,
                approval_teal=approval_teal,
                clear_teal=clear_teal,
                arc32_json=arc32_json,
                arc56_json=arc56_json,
                contract_name=contract_name,
                compilation_warnings=warnings,
                raw_stdout=raw_stdout,
                raw_stderr=raw_stderr,
            )

    except subprocess.TimeoutExpired:
        logger.error("PuyaPy compilation timed out after %ds", _COMPILE_TIMEOUT)
        return CompileResult(
            success=False,
            error=f"Compilation timed out after {_COMPILE_TIMEOUT} seconds.",
            error_type="timeout",
        )
    except FileNotFoundError:
        logger.error("puyapy executable not found on PATH")
        return CompileResult(
            success=False,
            error=(
                "PuyaPy compiler not found. "
                "Please install it with: pip install puyapy"
            ),
            error_type="missing_dependency",
        )
    except Exception as exc:
        tb = traceback.format_exc()
        logger.error("Unexpected compilation error: %s", str(exc)[:300])
        return CompileResult(
            success=False,
            error=str(exc),
            traceback=tb,
        )
