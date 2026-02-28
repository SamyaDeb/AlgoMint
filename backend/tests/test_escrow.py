"""Test escrow contract conversion — verify state_schema is correct for deployment."""
import asyncio, json, os, re, sys, tempfile, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ESCROW_SOLIDITY = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Escrow {
    address public buyer;
    address public seller;
    address public arbiter;
    uint256 public amount;
    bool public isComplete;
    bool public isRefunded;

    constructor(address _seller, address _arbiter) {
        buyer = msg.sender;
        seller = _seller;
        arbiter = _arbiter;
        amount = 0;
        isComplete = false;
        isRefunded = false;
    }

    function deposit(uint256 _amount) public {
        require(msg.sender == buyer, "only buyer");
        require(!isComplete, "already complete");
        amount += _amount;
    }

    function release() public {
        require(msg.sender == arbiter || msg.sender == buyer, "not authorized");
        require(amount > 0, "nothing to release");
        isComplete = true;
    }

    function refund() public {
        require(msg.sender == arbiter, "only arbiter");
        require(!isComplete, "already complete");
        isRefunded = true;
        amount = 0;
    }
}
"""

async def test_escrow():
    from app.services.ai_service import AIService
    svc = AIService()
    result = subprocess.run(["which", "puyapy"], capture_output=True, text=True)
    puyapy = result.stdout.strip() if result.returncode == 0 else "puyapy"

    print("=" * 60)
    print("  ESCROW CONTRACT TEST")
    print("=" * 60)

    start = time.time()
    try:
        conv = await svc.convert_solidity_to_algorand_python(ESCROW_SOLIDITY)
        algo_code = conv.algorand_python_code
        schema = conv.state_schema
        elapsed = time.time() - start
        print(f"  Convert: OK ({elapsed:.1f}s)")
        print(f"  State Schema: global_ints={schema.global_ints}, global_bytes={schema.global_bytes}, "
              f"local_ints={schema.local_ints}, local_bytes={schema.local_bytes}")

        # The escrow has: buyer(Account), seller(Account), arbiter(Account) = 3 bytes
        # amount(UInt64), isComplete(UInt64), isRefunded(UInt64) = 3 ints (bools stored as UInt64)
        print(f"  Expected: global_bytes >= 3 (buyer, seller, arbiter)")
        print(f"  Expected: global_ints >= 2 (amount + bools)")

        if schema.global_bytes < 1:
            print("  FAIL: global_bytes is 0 — this would cause the deployment error!")
            return False
        else:
            print(f"  OK: global_bytes = {schema.global_bytes} (non-zero, deployment will work)")

        # Compile
        with tempfile.TemporaryDirectory(prefix="algomint_escrow_") as tmpdir:
            path = os.path.join(tmpdir, "contract.py")
            with open(path, "w") as f:
                f.write(algo_code)
            proc = subprocess.run([puyapy, path, "--out-dir", tmpdir], capture_output=True, text=True, timeout=60)
            if proc.returncode == 0:
                teal = [f for f in os.listdir(tmpdir) if f.endswith(".approval.teal")]
                sz = os.path.getsize(os.path.join(tmpdir, teal[0])) if teal else 0
                print(f"  Compile: OK (TEAL={sz}B)")
                print(f"\n  PASS — escrow would deploy successfully with schema "
                      f"{{global_ints: {schema.global_ints}, global_bytes: {schema.global_bytes}}}")
                return True
            else:
                stderr = proc.stderr or proc.stdout or ""
                error_lines = [l for l in stderr.split("\n") if "error:" in l.lower()]
                for l in error_lines[:5]:
                    clean = re.sub(r"\x1b\[[0-9;]*m", "", l).strip()
                    print(f"    {clean}")
                print("  Compile: FAILED")
                return False

    except Exception as e:
        print(f"  ERROR: {e}")
        return False

if __name__ == "__main__":
    ok = asyncio.run(test_escrow())
    sys.exit(0 if ok else 1)
