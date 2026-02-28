"""Re-run only the 3 failed tests: 25_config_manager, 38_todo_list, 50_vesting"""
import asyncio, json, os, re, sys, tempfile, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILED_CONTRACTS = [
    ("25_config_manager", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract ConfigManager {\n    address public admin;\n    mapping(uint256 => uint256) public configs;\n    constructor() { admin = msg.sender; }\n    function setConfig(uint256 key, uint256 value) public {\n        require(msg.sender == admin, \"not admin\");\n        configs[key] = value;\n    }\n    function getConfig(uint256 key) public view returns (uint256) { return configs[key]; }\n}"),
    ("38_todo_list", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract TodoList {\n    address public owner;\n    mapping(uint256 => string) public tasks;\n    mapping(uint256 => bool) public completed;\n    uint256 public taskCount;\n    constructor() { owner = msg.sender; taskCount = 0; }\n    function addTask(string memory description) public { require(msg.sender == owner, \"not owner\"); taskCount += 1; tasks[taskCount] = description; completed[taskCount] = false; }\n    function toggleComplete(uint256 taskId) public { require(msg.sender == owner, \"not owner\"); require(taskId <= taskCount, \"no task\"); completed[taskId] = !completed[taskId]; }\n}"),
    ("50_vesting", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Vesting {\n    address public owner;\n    mapping(address => uint256) public totalVested;\n    mapping(address => uint256) public vestingStart;\n    mapping(address => uint256) public vestingDuration;\n    mapping(address => uint256) public claimed;\n    constructor() { owner = msg.sender; }\n    function createVesting(address beneficiary, uint256 amount, uint256 duration) public {\n        require(msg.sender == owner, \"not owner\");\n        totalVested[beneficiary] = amount;\n        vestingStart[beneficiary] = block.timestamp;\n        vestingDuration[beneficiary] = duration;\n        claimed[beneficiary] = 0;\n    }\n    function claimable(address beneficiary) public view returns (uint256) {\n        if (block.timestamp < vestingStart[beneficiary]) return 0;\n        uint256 elapsed = block.timestamp - vestingStart[beneficiary];\n        if (elapsed >= vestingDuration[beneficiary]) return totalVested[beneficiary] - claimed[beneficiary];\n        uint256 vested = totalVested[beneficiary] * elapsed / vestingDuration[beneficiary];\n        if (vested <= claimed[beneficiary]) return 0;\n        return vested - claimed[beneficiary];\n    }\n    function claim() public {\n        uint256 amount = claimable(msg.sender);\n        require(amount > 0, \"nothing to claim\");\n        claimed[msg.sender] += amount;\n    }\n}"),
]

async def run_failed():
    from app.services.ai_service import AIService
    svc = AIService()
    result = subprocess.run(["which", "puyapy"], capture_output=True, text=True)
    puyapy = result.stdout.strip() if result.returncode == 0 else "puyapy"

    passed = 0
    failed_list = []

    for name, sol in FAILED_CONTRACTS:
        print(f"\n{'='*60}")
        print(f"  TEST: {name}")
        print(f"{'='*60}")
        start = time.time()

        try:
            conv = await svc.convert_solidity_to_algorand_python(sol)
            algo_code = conv.algorand_python_code
            print(f"  Convert: OK ({time.time()-start:.1f}s, {len(algo_code)} chars)")
        except Exception as e:
            print(f"  Convert: FAILED - {str(e)[:200]}")
            failed_list.append({"name": name, "status": "CONVERT_FAIL", "error": str(e)[:200]})
            continue

        try:
            with tempfile.TemporaryDirectory(prefix="algomint_") as tmpdir:
                path = os.path.join(tmpdir, "contract.py")
                with open(path, "w") as f:
                    f.write(algo_code)
                proc = subprocess.run([puyapy, path, "--out-dir", tmpdir], capture_output=True, text=True, timeout=60)
                ct = time.time() - start
                if proc.returncode == 0:
                    teal = [f for f in os.listdir(tmpdir) if f.endswith(".approval.teal")]
                    sz = os.path.getsize(os.path.join(tmpdir, teal[0])) if teal else 0
                    print(f"  Compile: OK ({ct:.1f}s, TEAL={sz}B)")
                    passed += 1
                else:
                    stderr = proc.stderr or proc.stdout or ""
                    error_lines = [l for l in stderr.split("\n") if "error:" in l.lower()]
                    for l in error_lines[:8]:
                        clean = re.sub(r"\x1b\[[0-9;]*m", "", l).strip()
                        print(f"    {clean}")
                    failed_list.append({"name": name, "status": "COMPILE_FAIL", "error": "\n".join(error_lines[:8]), "code": algo_code})
                    print(f"  Compile: FAILED ({ct:.1f}s)")
        except Exception as e:
            print(f"  Compile: ERROR - {str(e)[:200]}")
            failed_list.append({"name": name, "status": "ERROR", "error": str(e)[:200]})

    print(f"\n{'='*60}")
    print(f"  RESULT: {passed}/3 passed, {len(failed_list)} failed")
    print(f"{'='*60}")

    if failed_list:
        with open("/tmp/algomint_failed3.json", "w") as f:
            json.dump(failed_list, f, indent=2, default=str)
        print("Failed details saved to /tmp/algomint_failed3.json")

if __name__ == "__main__":
    asyncio.run(run_failed())
