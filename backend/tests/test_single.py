"""Quick re-test of 40_inventory."""
import asyncio, json, os, re, sys, tempfile, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.test_50_contracts import CONTRACTS

async def main():
    from app.services.ai_service import AIService
    svc = AIService()
    puyapy = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".venv", "bin", "puyapy")
    
    for name, sol_code in CONTRACTS:
        if name != "40_inventory":
            continue
        print(f"Testing {name}...")
        conv = await svc.convert_solidity_to_algorand_python(sol_code)
        code = conv.algorand_python_code
        print(f"Converted ({len(code)} chars)")
        
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "contract.py")
            with open(path, "w") as f:
                f.write(code)
            with open("/tmp/algomint_40_inventory.py", "w") as f:
                f.write(code)
            
            proc = subprocess.run([puyapy, path, "--out-dir", tmpdir], capture_output=True, text=True, timeout=60)
            if proc.returncode == 0:
                print("PASS")
            else:
                stderr = re.sub(r"\x1b\[[0-9;]*m", "", proc.stderr or proc.stdout or "")
                for line in stderr.split("\n"):
                    if "error" in line.lower():
                        print(f"  {line.strip()}")
                print("FAIL")

asyncio.run(main())
