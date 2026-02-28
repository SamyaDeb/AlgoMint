"""Test the _compute_state_schema method."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services.ai_service import AIService

# Test 1: Escrow contract (ints + bytes)
escrow = (
    "from algopy import ARC4Contract, Account, UInt64, Txn, arc4\n"
    "import algopy\n\n"
    "class Escrow(ARC4Contract):\n"
    "    def __init__(self) -> None:\n"
    "        self.seller = Txn.sender\n"
    "        self.buyer = Account()\n"
    "        self.arbiter = Account()\n"
    "        self.amount = UInt64(0)\n"
    "        self.is_funded = UInt64(0)\n"
    "        self.is_complete = UInt64(0)\n"
    "        self.description = arc4.String()\n\n"
    "    @arc4.abimethod\n"
    "    def release(self) -> None:\n"
    "        pass\n"
)

s1 = AIService._compute_state_schema(escrow)
print(f"Escrow: {s1}")
assert s1["global_ints"] == 3, f"Expected 3 ints, got {s1['global_ints']}"
assert s1["global_bytes"] == 4, f"Expected 4 bytes, got {s1['global_bytes']}"
print("  OK: 3 ints, 4 bytes")

# Test 2: Counter (only ints + owner)
counter = (
    "from algopy import ARC4Contract, Account, UInt64, Txn\n\n"
    "class Counter(ARC4Contract):\n"
    "    def __init__(self) -> None:\n"
    "        self.owner = Txn.sender\n"
    "        self.count = UInt64(0)\n\n"
    "    @arc4.abimethod\n"
    "    def increment(self) -> None:\n"
    "        pass\n"
)

s2 = AIService._compute_state_schema(counter)
print(f"Counter: {s2}")
assert s2["global_ints"] == 1, f"Expected 1 int, got {s2['global_ints']}"
assert s2["global_bytes"] == 1, f"Expected 1 byte, got {s2['global_bytes']}"
print("  OK: 1 int, 1 byte")

# Test 3: BoxMap should NOT count as global state
token = (
    "from algopy import ARC4Contract, Account, UInt64, Txn, BoxMap\n\n"
    "class Token(ARC4Contract):\n"
    "    def __init__(self) -> None:\n"
    "        self.owner = Txn.sender\n"
    "        self.total_supply = UInt64(0)\n"
    "        self.balances = BoxMap(Account, UInt64)\n\n"
    "    @arc4.abimethod\n"
    "    def mint(self) -> None:\n"
    "        pass\n"
)

s3 = AIService._compute_state_schema(token)
print(f"Token: {s3}")
assert s3["global_ints"] == 1, f"Expected 1 int, got {s3['global_ints']}"
assert s3["global_bytes"] == 1, f"Expected 1 byte, got {s3['global_bytes']}"
print("  OK: BoxMap not counted")

# Test 4: bool fields
voting = (
    "from algopy import ARC4Contract, Account, UInt64, Txn, arc4\n\n"
    "class Voting(ARC4Contract):\n"
    "    def __init__(self) -> None:\n"
    "        self.owner = Txn.sender\n"
    "        self.is_active = UInt64(0)\n"
    "        self.vote_count = UInt64(0)\n"
    "        self.name = arc4.String()\n\n"
    "    @arc4.abimethod\n"
    "    def vote(self) -> None:\n"
    "        pass\n"
)

s4 = AIService._compute_state_schema(voting)
print(f"Voting: {s4}")
assert s4["global_ints"] == 2, f"Expected 2 ints, got {s4['global_ints']}"
assert s4["global_bytes"] == 2, f"Expected 2 bytes, got {s4['global_bytes']}"
print("  OK: 2 ints, 2 bytes")

print("\nAll schema computation tests passed!")
