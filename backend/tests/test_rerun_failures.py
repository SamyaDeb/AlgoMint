"""Re-run only the 7 failed contracts from the first batch."""
import asyncio
import json
import os
import re
import sys
import tempfile
import subprocess
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the full contract list and pick just the failed ones
from tests.test_50_contracts import CONTRACTS

FAILED_NAMES = {"08_max_min", "15_string_registry", "28_reward_tracker",
                "29_access_control", "33_approval_flow", "40_inventory", "50_vesting"}


async def run_tests():
    from app.services.ai_service import AIService

    svc = AIService()
    puyapy_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".venv", "bin", "puyapy"
    )
    if not os.path.exists(puyapy_path):
        result = subprocess.run(["which", "puyapy"], capture_output=True, text=True)
        puyapy_path = result.stdout.strip() if result.returncode == 0 else "puyapy"

    results = []
    passed = 0
    failed = 0

    failed_contracts = [(n, c) for n, c in CONTRACTS if n in FAILED_NAMES]

    for name, sol_code in failed_contracts:
        print(f"\n{'='*60}")
        print(f"  RE-TEST: {name}")
        print(f"{'='*60}")
        start = time.time()

        try:
            conv = await svc.convert_solidity_to_algorand_python(sol_code)
            algo_code = conv.algorand_python_code
            convert_time = time.time() - start
            print(f"  Convert: OK ({convert_time:.1f}s, {len(algo_code)} chars)")
        except Exception as e:
            elapsed = time.time() - start
            err = str(e)[:200]
            print(f"  Convert: FAILED ({elapsed:.1f}s) - {err}")
            results.append({"name": name, "status": "CONVERT_FAIL", "error": err})
            failed += 1
            continue

        try:
            with tempfile.TemporaryDirectory(prefix="algomint_retest_") as tmpdir:
                contract_path = os.path.join(tmpdir, "contract.py")
                with open(contract_path, "w") as f:
                    f.write(algo_code)

                # Also save for debugging
                debug_path = f"/tmp/algomint_retest_{name}.py"
                with open(debug_path, "w") as f:
                    f.write(algo_code)

                proc = subprocess.run(
                    [puyapy_path, contract_path, "--out-dir", tmpdir],
                    capture_output=True, text=True, timeout=60
                )
                compile_time = time.time() - start - convert_time

                if proc.returncode == 0:
                    teal_files = [f for f in os.listdir(tmpdir) if f.endswith(".approval.teal")]
                    teal_size = os.path.getsize(os.path.join(tmpdir, teal_files[0])) if teal_files else 0
                    print(f"  Compile: OK ({compile_time:.1f}s, TEAL={teal_size}B)")
                    results.append({"name": name, "status": "PASS", "teal_size": teal_size})
                    passed += 1
                else:
                    stderr = proc.stderr or proc.stdout or ""
                    error_lines = [l for l in stderr.split("\n") if "error:" in l.lower()]
                    error_summary = "\n".join(error_lines[:5]) if error_lines else stderr[:500]
                    print(f"  Compile: FAILED ({compile_time:.1f}s)")
                    for line in error_lines[:5]:
                        clean = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
                        print(f"    {clean}")
                    print(f"  Code saved to: {debug_path}")
                    results.append({"name": name, "status": "COMPILE_FAIL", "error": error_summary, "code": algo_code})
                    failed += 1

        except Exception as e:
            print(f"  Compile: ERROR - {str(e)[:200]}")
            results.append({"name": name, "status": "COMPILE_ERROR", "error": str(e)[:200]})
            failed += 1

    total = len(failed_contracts)
    print(f"\n{'='*60}")
    print(f"  RE-TEST SUMMARY: {passed}/{total} passed, {failed} failed")
    print(f"{'='*60}")

    if failed > 0:
        print("\nSTILL FAILING:")
        for r in results:
            if r["status"] != "PASS":
                print(f"  - {r['name']}: {r['status']}")
                clean_err = re.sub(r"\x1b\[[0-9;]*m", "", r.get("error", ""))
                for line in clean_err.strip().split("\n")[:3]:
                    print(f"      {line.strip()}")

    with open("/tmp/algomint_retest_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)

    return results

if __name__ == "__main__":
    asyncio.run(run_tests())
