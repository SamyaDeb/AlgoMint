"""Re-run the 4 still-failing contracts."""
import asyncio
import json
import os
import re
import sys
import tempfile
import subprocess
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.test_50_contracts import CONTRACTS

FAILED_NAMES = {"28_reward_tracker", "29_access_control", "33_approval_flow", "40_inventory"}

async def run_tests():
    from app.services.ai_service import AIService
    svc = AIService()
    puyapy_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".venv", "bin", "puyapy"
    )

    results = []
    passed = 0
    failed = 0
    failed_contracts = [(n, c) for n, c in CONTRACTS if n in FAILED_NAMES]

    for name, sol_code in failed_contracts:
        print(f"\n{'='*60}")
        print(f"  RE-TEST2: {name}")
        print(f"{'='*60}")
        start = time.time()
        try:
            conv = await svc.convert_solidity_to_algorand_python(sol_code)
            algo_code = conv.algorand_python_code
            print(f"  Convert: OK ({time.time()-start:.1f}s, {len(algo_code)} chars)")
        except Exception as e:
            print(f"  Convert: FAILED - {str(e)[:200]}")
            results.append({"name": name, "status": "CONVERT_FAIL"})
            failed += 1
            continue

        try:
            with tempfile.TemporaryDirectory(prefix="algomint_rt2_") as tmpdir:
                contract_path = os.path.join(tmpdir, "contract.py")
                with open(contract_path, "w") as f:
                    f.write(algo_code)
                debug_path = f"/tmp/algomint_rt2_{name}.py"
                with open(debug_path, "w") as f:
                    f.write(algo_code)

                proc = subprocess.run(
                    [puyapy_path, contract_path, "--out-dir", tmpdir],
                    capture_output=True, text=True, timeout=60
                )
                if proc.returncode == 0:
                    teal_files = [f for f in os.listdir(tmpdir) if f.endswith(".approval.teal")]
                    print(f"  Compile: OK")
                    results.append({"name": name, "status": "PASS"})
                    passed += 1
                else:
                    stderr = proc.stderr or proc.stdout or ""
                    error_lines = [l for l in stderr.split("\n") if "error:" in l.lower()]
                    print(f"  Compile: FAILED")
                    for line in error_lines[:5]:
                        clean = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
                        print(f"    {clean}")
                    print(f"  Code: {debug_path}")
                    results.append({"name": name, "status": "COMPILE_FAIL", "error": "\n".join(error_lines[:5]), "code": algo_code})
                    failed += 1
        except Exception as e:
            print(f"  Error: {str(e)[:200]}")
            failed += 1

    print(f"\n  SUMMARY: {passed}/{len(failed_contracts)} passed, {failed} failed")
    return results

if __name__ == "__main__":
    asyncio.run(run_tests())
