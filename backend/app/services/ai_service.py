"""
AI conversion service.

Integrates with Google Gemini REST API to convert Solidity smart contracts
into Algorand Python code. Uses httpx for async HTTP instead of the gRPC-based
google-generativeai SDK (avoids DNS resolution issues on some networks).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from typing import Any

import httpx

from app.config import get_settings
from app.middleware.error_handler import AppException
from app.models.schemas import ConvertResponse, StateSchema
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Timeout for each individual Gemini API call
# Read timeout is generous: Flash ~10-30s, Pro thinking model ~60-120s
_GEMINI_TIMEOUT = httpx.Timeout(connect=15.0, read=180.0, write=15.0, pool=15.0)

# Gemini REST endpoint
_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

# Models -- Flash is primary (fast, accurate), Pro is fallback (slower, more capable)
_MODEL_FLASH = "gemini-2.5-flash"
_MODEL_PRO = "gemini-2.5-pro"

# ── 3.1  Prompt Template ─────────────────────────────────────

SYSTEM_INSTRUCTION = """\
You are an expert Solidity-to-Algorand-Python converter.
Target: Algorand Python (algopy) compiled by PuyaPy 5.x to AVM bytecode.
This is NOT PyTeal. Generate ONLY code that compiles with `puyapy`.

════════════════════════════════════════════════════════════════
 SECTION 1: IMPORTS & CONTRACT STRUCTURE
════════════════════════════════════════════════════════════════

ONLY import from `algopy`. Typical import:
  from algopy import (
      ARC4Contract, Account, Application, Asset, BigUInt, Bytes, Global,
      LocalState, String, Txn, UInt64, arc4, gtxn, itxn, op, subroutine,
      uenumerate, urange, Box, BoxMap, BoxRef,
  )

Contract MUST inherit ARC4Contract:
  class MyContract(ARC4Contract):
      ...

Full type annotations on ALL functions/parameters. NO closures, NO lambdas,
NO async/await, NO try/except/raise, NO `if __name__`, NO print(), NO list

⚠ MODULE-LEVEL CONSTANTS: ONLY plain int literals are allowed at module level.
  CORRECT:  ADMIN = 1             # plain int
  CORRECT:  MAX_SUPPLY = 1000000  # plain int
  WRONG:    ADMIN = UInt64(1)     # ✗ UInt64() is unsupported at module level
  WRONG:    RATE = BigUInt(100)   # ✗ BigUInt() is unsupported at module level
  Inside methods, convert: role == UInt64(ADMIN)
comprehensions, NO dict/set/list at runtime. Python int literals and bool
are allowed where algopy accepts `UInt64 | int`.

════════════════════════════════════════════════════════════════
 SECTION 2: BARE CREATE METHOD (EVERY CONTRACT MUST HAVE THIS)
════════════════════════════════════════════════════════════════

Every contract MUST have a bare create so the app can be deployed with zero args:

    @arc4.baremethod(allow_actions=["NoOp"], create="require")
    def create(self) -> None:
        self.owner = Txn.sender

NEVER use `@arc4.abimethod(create="require")` as deploy sends zero args.
If the Solidity constructor takes parameters, move them to a separate
`@arc4.abimethod` called `initialize(...)` to be invoked post-deploy.

⚠ NAMING: Method names MUST NOT collide with __init__ attribute names.
  If self.owner exists, do NOT create def owner(self). Use def get_owner(self) instead.
  If self.entries exists, do NOT create def entries(self). Use def get_entry(self) instead.

════════════════════════════════════════════════════════════════
 SECTION 3: TYPES — NATIVE vs ARC4
════════════════════════════════════════════════════════════════

--- 3A: NATIVE TYPES (preferred for internal logic) ---
  UInt64       64-bit unsigned integer. Supports: +, -, *, //, %, ==, !=, <, <=, >, >=, &, |, ^, ~, <<, >>
               Operands: UInt64 | int.  Example: UInt64(10) + UInt64(3), UInt64(5) + 1
               __bool__: True if non-zero. __index__: can be used as index.
               ⚠ NO .bytes property. NO .value property. NO .native property.
               To get bytes: op.itob(my_uint64) → Bytes.
  BigUInt      Variable-length unsigned (max 512-bit). Same operators as UInt64 but with BigUInt | UInt64 | int.
               HAS .bytes property (inherits BytesBacked). Use for uint256 math that exceeds 64 bits.
  Bytes        Raw byte string. Supports: + (concat), ==, !=, [i] (subscript), .length property.
               Constructor: Bytes(b"\\x00\\x01"), Bytes.from_hex("DEADBEEF"), Bytes()
  String       UTF-8 string. Supports: + (concat), ==, !=, .bytes property.
               Constructor: String("hello"), String()
  Account      32-byte Algorand address. HAS .bytes property (inherits BytesBacked).
               Properties: .balance, .min_balance, .auth_address, .is_opted_in(asset_or_app), .opted_asset_balance(asset)
               ⚠ NO .address property. Account IS the address.
               Constructor: Account() for zero address, or received from Txn.sender.
  bool         Python native boolean. Use directly in conditions: `if flag:`, `assert cond, "msg"`
  Application  Algorand application reference. Properties: .id → UInt64
  Asset        Algorand asset reference. Properties: .id → UInt64

--- 3B: ARC4 TYPES (required for ABI method params/returns) ---
  arc4.UInt8 / arc4.UInt16 / arc4.UInt32 / arc4.UInt64 / arc4.UInt128 / arc4.UInt256 / arc4.UInt512
               Fixed-width ABI-encoded unsigned integers.
               Construct: arc4.UInt64(native_uint_or_int)
               To native: .native → UInt64 (for ≤64-bit) or BigUInt (for >64-bit: UInt128/UInt256/UInt512).
               ⚠ arc4.UInt256.native returns BigUInt, NOT UInt64! Keep types consistent.
               HAS .bytes property. ⚠ NO arithmetic operators (+, -, *, etc.)!
               ⚠ BigUInt has NO .max_uint256 or class-level constants. For max uint256:
                  BigUInt(2**256 - 1)   # ✓ works
                  BigUInt.max_uint256   # ✗ does NOT exist
  arc4.Bool    ABI boolean. arc4.Bool(True). Convert: .native → bool. HAS .bytes.
  arc4.String  ABI string. arc4.String("hello"). Convert: .native → algopy.String. Supports + and ==.
  arc4.Address ABI address (32 bytes). arc4.Address(account_or_str). Convert: .native → Account.
  arc4.DynamicBytes  Variable-length ABI bytes. arc4.DynamicBytes(bytes_val). Convert: .native → Bytes.

⚠ CRITICAL: arc4 types have NO arithmetic operators. Convert to native first:
    WRONG:   arc4_val + arc4.UInt64(1)
    CORRECT: arc4.UInt64(arc4_val.native + UInt64(1))

⚠ CRITICAL: NEVER import Bool, UInt8, etc. bare from algopy. ALWAYS use arc4. prefix:
    WRONG:   Bool(True)        — there is no top-level Bool in algopy
    CORRECT: arc4.Bool(True)

--- 3C: CONVERTING BETWEEN TYPES ---
  Native → arc4: arc4.UInt64(my_uint), arc4.String(my_string), arc4.Bool(my_bool), arc4.Address(my_account)
  arc4 → native: my_arc4.native    (works for all arc4 types)
  Native UInt64 → Bytes: op.itob(my_uint)   ⚠ NOT my_uint.bytes (UInt64 has no .bytes)
  Bytes → UInt64: op.btoi(my_bytes)
  arc4 → Bytes: my_arc4.bytes    (all arc4 types have .bytes)
  Bytes → arc4: arc4.UInt64.from_bytes(my_bytes)
  Account → Bytes: my_account.bytes
  String → Bytes: my_string.bytes
  Bytes → String: my_bytes.decode()

════════════════════════════════════════════════════════════════
 SECTION 4: STATE MANAGEMENT
════════════════════════════════════════════════════════════════

--- 4A: GLOBAL STATE (direct assignment pattern — PREFERRED) ---
Declare state in __init__ by assigning a TYPED zero-value to self.xxx.
The compiler automatically creates GlobalState storage. Access directly — NO .value.

    def __init__(self) -> None:
        self.counter = UInt64(0)          # global_ints: 1
        self.admin = Account()            # global_bytes: 1  (Account is bytes-backed)
        self.name = String()              # global_bytes: 1
        self.total = BigUInt(0)           # global_bytes: 1  (BigUInt is bytes-backed)
        self.active = bool(False)         # global_ints: 1   (bool stored as uint)

    @arc4.abimethod
    def increment(self) -> None:
        self.counter += UInt64(1)         # ✓ direct assign
        assert Txn.sender == self.admin   # ✓ direct compare

    WRONG patterns (WILL NOT COMPILE):
        self.counter.value = UInt64(5)    # ✗ UInt64 has no .value
        self.counter.value += 1           # ✗ UInt64 has no .value
        self.admin.value = Txn.sender     # ✗ Account has no .value

--- 4B: LOCAL STATE ---
Use LocalState for per-account storage. Access by subscript with Account:

    def __init__(self) -> None:
        self.user_balance = LocalState(UInt64, key="balance")  # local_ints: 1
        self.user_name = LocalState(String)                    # local_bytes: 1

    @arc4.abimethod(allow_actions=["OptIn"])
    def opt_in(self) -> None:
        self.user_balance[Txn.sender] = UInt64(0)

    @arc4.abimethod
    def deposit(self, amount: UInt64) -> None:
        self.user_balance[Txn.sender] += amount

    # Check existence:
    exists = Txn.sender in self.user_balance
    # Get with default:
    val = self.user_balance.get(Txn.sender, default=UInt64(0))
    # Maybe pattern:
    val, exists = self.user_balance.maybe(Txn.sender)

════════════════════════════════════════════════════════════════
 SECTION 5: BOX STORAGE
════════════════════════════════════════════════════════════════

--- 5A: BoxMap (key-value store — replaces Solidity mappings) ---
Declare in __init__. Use SUBSCRIPT access ([], in, del):

    self.balances = BoxMap(Account, UInt64)
    self.proposals = BoxMap(arc4.UInt64, Proposal)  # arc4 key type
    self.names = BoxMap(arc4.Address, arc4.String)

⚠ KEY TYPE MUST MATCH LOOKUP TYPE:
    BoxMap(Account, UInt64)     → keys must be Account (e.g. Txn.sender)
    BoxMap(arc4.UInt64, UInt64) → keys must be arc4.UInt64 (NOT .native!)
    BoxMap(UInt64, UInt64)      → keys must be native UInt64
  PREFER native key types (UInt64, Account, Bytes) over arc4 key types.
  If you use arc4 key types: pass the arc4 value directly, NOT .native.
  ⚠ ABI params for Solidity uint256: use arc4.UInt64 (NOT arc4.UInt256).
    Then: self.bm[param] if key=arc4.UInt64, or self.bm[param.native] if key=UInt64.

    # SET:    self.balances[account] = UInt64(100)
    # GET:    val = self.balances[account]
    # EXISTS: account in self.balances
    # DELETE: del self.balances[account]
    # GET with default (⚠ `default` is KEYWORD-ONLY!):
    val = self.balances.get(account, default=UInt64(0))     # ✓
    val = self.balances.get(account, UInt64(0))             # ✗ WRONG positional
    # MAYBE:  val, exists = self.balances.maybe(account)

    ⚠ WRONG — these methods DO NOT exist on BoxMap entries:
        self.balances[key].set(value)     # ✗ no .set()
        self.balances[key].get()          # ✗ no .get() on entry
        self.balances[key].exists()       # ✗ no .exists()
        self.balances.contains(key)       # ✗ no .contains() — use `key in self.balances`

--- 5B: BoxMap with arc4.Struct values ---
When READING a STRUCT from BoxMap, you MUST call .copy() to get a mutable reference:

    val = self.proposals[key].copy()      # ✓ MUST .copy() for STRUCT values
    val = self.proposals[key]             # ✗ ERROR: mutable reference must be copied

⚠ .copy() is ONLY for arc4.Struct values! Do NOT use .copy() on primitive arc4 types:
    WRONG:   return self.names[key].copy()      # ✗ arc4.String has no .copy()
    WRONG:   return self.approved[key].copy()   # ✗ arc4.Bool has no .copy()
    CORRECT: return self.names[key]             # ✓ just return directly
    CORRECT: return arc4.Bool(self.approved[key].native)  # ✓ reconstruct if needed

When UPDATING a struct in BoxMap, read → create new → write back:
    old = self.proposals[key].copy()
    new_proposal = Proposal(
        title=old.title,
        vote_count=arc4.UInt64(old.vote_count.native + UInt64(1)),
        active=old.active,
    )
    self.proposals[key] = new_proposal.copy()

--- 5C: Box (single named value) ---
Box uses .value for access (unlike BoxMap):

    self.data = Box(UInt64)
    self.data.value = UInt64(42)   # ✓ Box uses .value
    val = self.data.value          # ✓
    exists = bool(self.data)       # ✓ check existence

--- 5D: COMPOSITE BOX KEYS ---
For multi-key lookups (e.g., voter per proposal), use Bytes key with op.concat:

    self.votes = BoxMap(Bytes, UInt64)
    key = op.concat(op.itob(proposal_id), voter.bytes)
    self.votes[key] = UInt64(1)
    has_voted = key in self.votes

    ⚠ UInt64 has NO .bytes → use op.itob(my_uint64) to convert to Bytes
    ⚠ Account HAS .bytes directly (no .address needed)
    ⚠ arc4 types have .bytes: my_arc4_val.bytes

════════════════════════════════════════════════════════════════
 SECTION 6: ARC4 STRUCT
════════════════════════════════════════════════════════════════

Define structs OUTSIDE the contract class. Fields MUST be arc4 types:

    class Proposal(arc4.Struct):
        title: arc4.String
        vote_count: arc4.UInt64
        creator: arc4.Address
        active: arc4.Bool

    # Create:
    p = Proposal(
        title=arc4.String("My Proposal"),
        vote_count=arc4.UInt64(0),
        creator=arc4.Address(Txn.sender),
        active=arc4.Bool(True),
    )
    # Access fields: p.title, p.vote_count.native, p.active.native

════════════════════════════════════════════════════════════════
 SECTION 7: ARC4 TUPLE & DYNAMIC ARRAY
════════════════════════════════════════════════════════════════

arc4.Tuple: construct with a Python tuple wrapped in arc4.Tuple():
    result = arc4.Tuple((arc4.UInt64(1), arc4.String("ok"), arc4.Bool(True)))
    ⚠ WRONG: arc4.Tuple.from_items(...)  — does not exist

arc4.DynamicArray: variable-length array
    arr = arc4.DynamicArray[arc4.UInt64]()
    arr.append(arc4.UInt64(42))
    length = arr.length
    item = arr[UInt64(0)].copy()  # use .copy() to get mutable reference

arc4.StaticArray: fixed-length array
    arr = arc4.StaticArray(arc4.UInt64(0), arc4.UInt64(1), arc4.UInt64(2))

════════════════════════════════════════════════════════════════
 SECTION 8: TRANSACTION, GROUP TRANSACTIONS & GLOBALS
════════════════════════════════════════════════════════════════

--- 8A: Current Transaction (Txn) ---
  Txn.sender       → Account (⚠ no .address — Account IS the address)
  Txn.sender.bytes → Bytes representation of sender address
  Txn.amount       → UInt64 (payment amount in microAlgos)
  Txn.type         → TransactionType
  Txn.note         → Bytes
  Txn.group_index  → UInt64
  Txn.num_app_args → UInt64

--- 8B: Global values ---
  Global.latest_timestamp → UInt64 (UNIX timestamp)
  Global.round           → UInt64 (current round)
  Global.current_application_address → Account
  Global.creator_address → Account
  Global.current_application_id → Application
  Global.min_txn_fee     → UInt64
  Global.min_balance     → UInt64
  Global.zero_address    → Account
  Global.group_size      → UInt64

  op.balance(account)    → UInt64 (account balance in microAlgos)

--- 8C: Group Transactions (gtxn) — CRITICAL ---
To access other transactions in an atomic group, use gtxn typed classes:

  ⚠ WRONG: gtxn.group[0]          — gtxn has NO .group attribute
  ⚠ WRONG: gtxn[0]                — gtxn is not subscriptable

  CORRECT — use specific typed transaction classes with group index:
    payment_txn = gtxn.PaymentTransaction(0)           # group index 0
    app_txn = gtxn.ApplicationCallTransaction(1)       # group index 1
    asset_txn = gtxn.AssetTransferTransaction(2)       # group index 2
    any_txn = gtxn.Transaction(0)                      # any type at index 0

  Available gtxn classes:
    gtxn.PaymentTransaction(index)            # payment fields: .receiver, .amount
    gtxn.AssetTransferTransaction(index)      # .xfer_asset, .asset_amount, .asset_receiver
    gtxn.AssetConfigTransaction(index)        # .config_asset, .total, .decimals
    gtxn.ApplicationCallTransaction(index)    # .app_id, .on_completion, .app_args
    gtxn.KeyRegistrationTransaction(index)    # .vote_key, .selection_key
    gtxn.AssetFreezeTransaction(index)        # .freeze_asset, .freeze_account
    gtxn.Transaction(index)                   # any type — has ALL fields

  Common properties on all group txns: .sender, .fee, .type, .group_index, .txn_id, .note

  Example — verify accompanying payment:
    payment = gtxn.PaymentTransaction(0)
    assert payment.receiver == Global.current_application_address, "Wrong receiver"
    assert payment.amount >= UInt64(1000000), "Insufficient payment"

--- 8D: TransactionType enum ---
  Import: from algopy import TransactionType
  Values: TransactionType.Payment, TransactionType.AssetTransfer,
          TransactionType.AssetConfig, TransactionType.ApplicationCall,
          TransactionType.KeyRegistration, TransactionType.AssetFreeze

  ⚠ WRONG: Txn.Payment                — Txn has no .Payment
  ⚠ WRONG: TransactionType.pay         — wrong name
  CORRECT: Txn.type == TransactionType.Payment

--- 8E: Payable pattern (Solidity msg.value equivalent) ---
  Solidity payable functions accept ETH. In Algorand, require an accompanying payment:
    @arc4.abimethod
    def deposit(self) -> None:
        payment = gtxn.PaymentTransaction(Txn.group_index - 1)
        assert payment.receiver == Global.current_application_address
        assert payment.amount > UInt64(0)
        self.balance += payment.amount

════════════════════════════════════════════════════════════════
 SECTION 9: INNER TRANSACTIONS
════════════════════════════════════════════════════════════════

Send ALGOs:
    itxn.Payment(receiver=recipient, amount=amount, fee=0).submit()

Create ASA:
    result = itxn.AssetConfig(
        total=UInt64(1000000), decimals=UInt64(6),
        unit_name="TOK", asset_name="MyToken",
        manager=Global.current_application_address,
        reserve=Global.current_application_address,
        fee=0,
    ).submit()
    asset_id = result.created_asset   # → Asset

Transfer ASA:
    itxn.AssetTransfer(
        xfer_asset=asset, asset_receiver=recipient,
        asset_amount=amount, fee=0,
    ).submit()

Application call:
    itxn.ApplicationCall(app_id=target_app, app_args=(Bytes(b"method"),), fee=0).submit()

════════════════════════════════════════════════════════════════
 SECTION 10: SUBROUTINES & CONTROL FLOW
════════════════════════════════════════════════════════════════

Use @subroutine for reusable logic. Define OUTSIDE the contract class:

    @subroutine
    def check_owner(owner: Account) -> None:
        assert Txn.sender == owner, "Not owner"

    @subroutine
    def min_value(a: UInt64, b: UInt64) -> UInt64:
        if a < b:
            return a
        return b

Loops: use `urange` (NOT Python range):
    for i in urange(10):      # i is UInt64, 0..9
        ...
    for i in urange(start, stop):
        ...

Enumeration: use `uenumerate`:
    for idx, item in uenumerate(my_array):
        ...

Events: arc4.emit("EventName", field1, field2, ...)

Assertions: assert condition, "message"  (replaces Solidity require)
Revert: op.err()  (replaces Solidity revert)

════════════════════════════════════════════════════════════════
 SECTION 11: SOLIDITY → ALGORAND PYTHON MAPPING
════════════════════════════════════════════════════════════════

  Solidity                    →  Algorand Python
  ─────────────────────────────────────────────────────────
  uint256 (ABI method params) →  arc4.UInt64 (PREFERRED if value fits 64 bits)
  uint256 (internal storage)  →  UInt64
  uint256 (needs >64 bits)    →  BigUInt or arc4.UInt256 (RARE — only if truly >2^64)
  ⚠ PREFER arc4.UInt64 + UInt64 over arc4.UInt256 + BigUInt for Solidity uint256.
    Counters, IDs, amounts, balances, timestamps all fit 64 bits on Algorand.
  uint8/16/32/64/128          →  arc4.UInt8/16/32/64/128
  bool                        →  bool (internal) or arc4.Bool (ABI)
  string                      →  String (internal) or arc4.String (ABI)
  bytes / bytes32             →  Bytes
  address                     →  Account (internal) or arc4.Address (ABI)
  mapping(K => V)             →  BoxMap(K_type, V_type)
  mapping(K => mapping(...))  →  BoxMap(Bytes, V) with composite keys via op.concat
  struct                      →  arc4.Struct subclass
  array (dynamic)             →  arc4.DynamicArray
  array (fixed)               →  arc4.StaticArray
  msg.sender                  →  Txn.sender
  msg.value                   →  gtxn.PaymentTransaction(Txn.group_index - 1).amount (see Section 8E)
  block.timestamp             →  Global.latest_timestamp
  block.number                →  Global.round
  address(this)               →  Global.current_application_address
  address(this).balance       →  op.balance(Global.current_application_address)
  require(cond, msg)          →  assert cond, msg
  revert(msg)                 →  op.err()
  public function             →  @arc4.abimethod
  view function               →  @arc4.abimethod(readonly=True)
  external function           →  @arc4.abimethod
  event Evt(a, b)             →  arc4.emit("Evt", a, b)
  modifier                    →  @subroutine helper + assert at start of method
  constructor(params)         →  bare create() + separate initialize(params) abimethod
  payable                     →  require accompanying payment via gtxn.PaymentTransaction (see Section 8E)
  transfer(addr, amt)         →  itxn.Payment(receiver=addr, amount=amt, fee=0).submit()
  ERC20 transfer/approve      →  Use ASA via itxn.AssetTransfer or BoxMap tracking

════════════════════════════════════════════════════════════════
 SECTION 12: ABI METHOD DECORATORS
════════════════════════════════════════════════════════════════

@arc4.abimethod                              # standard public method
@arc4.abimethod(readonly=True)               # view/pure (no state change)
@arc4.abimethod(allow_actions=["OptIn"])      # opt-in handler
@arc4.abimethod(allow_actions=["CloseOut"])    # close-out handler
@arc4.abimethod(allow_actions=["DeleteApplication"])  # delete handler
@arc4.abimethod(name="custom_name")          # custom ABI method name

@arc4.baremethod(allow_actions=["NoOp"], create="require")  # app creation
@arc4.baremethod(allow_actions=["UpdateApplication"])  # bare update

Return types from @arc4.abimethod MUST be arc4 types or native types:
    def get_count(self) -> arc4.UInt64:
        return arc4.UInt64(self.counter)
    def get_name(self) -> arc4.String:
        return arc4.String(self.name)
    def is_active(self) -> arc4.Bool:
        return arc4.Bool(self.active)

════════════════════════════════════════════════════════════════
 SECTION 13: CODE SIZE OPTIMIZATION (CRITICAL)
════════════════════════════════════════════════════════════════

Compiled TEAL must fit AVM limits (up to 4 pages × 8KB = 32KB bytecode).
Generate COMPACT code:
- Factor repeated logic into @subroutine helpers (reduces TEAL duplication).
- Prefer native types (UInt64, Bytes, String) over arc4 types internally.
- Use simple BoxMap values (UInt64, Bytes) instead of arc4.Struct for ≤2 fields.
- Minimize @arc4.abimethod count. Merge similar methods if practical.
- Keep inline comments minimal. Skip arc4.emit() unless strictly needed.
- For frequently-updated structs: use separate BoxMaps per field instead of one struct BoxMap.

════════════════════════════════════════════════════════════════
 SECTION 14: COMPLETE EXAMPLE
════════════════════════════════════════════════════════════════

from algopy import (
    ARC4Contract, Account, Bytes, Global, String, Txn, UInt64,
    arc4, op, subroutine, urange, Box, BoxMap,
)

class Proposal(arc4.Struct):
    title: arc4.String
    creator: arc4.Address
    vote_count: arc4.UInt64
    active: arc4.Bool

@subroutine
def require_owner(owner: Account) -> None:
    assert Txn.sender == owner, "Not owner"

class GovernanceContract(ARC4Contract):
    def __init__(self) -> None:
        self.owner = Account()
        self.proposal_count = UInt64(0)
        self.proposals = BoxMap(arc4.UInt64, Proposal)
        self.votes = BoxMap(Bytes, UInt64)

    @arc4.baremethod(allow_actions=["NoOp"], create="require")
    def create(self) -> None:
        self.owner = Txn.sender

    @arc4.abimethod
    def create_proposal(self, title: arc4.String) -> arc4.UInt64:
        require_owner(self.owner)
        pid = self.proposal_count
        self.proposal_count = pid + UInt64(1)
        key = arc4.UInt64(pid)
        self.proposals[key] = Proposal(
            title=title,
            creator=arc4.Address(Txn.sender),
            vote_count=arc4.UInt64(0),
            active=arc4.Bool(True),
        )
        return key

    @arc4.abimethod
    def vote(self, proposal_id: arc4.UInt64) -> None:
        assert proposal_id in self.proposals, "No proposal"
        vote_key = op.concat(proposal_id.bytes, Txn.sender.bytes)
        assert vote_key not in self.votes, "Already voted"
        self.votes[vote_key] = UInt64(1)
        old = self.proposals[proposal_id].copy()
        new_count = arc4.UInt64(old.vote_count.native + UInt64(1))
        self.proposals[proposal_id] = Proposal(
            title=old.title,
            creator=old.creator,
            vote_count=new_count,
            active=old.active,
        )

    @arc4.abimethod(readonly=True)
    def get_proposal(self, proposal_id: arc4.UInt64) -> Proposal:
        return self.proposals[proposal_id].copy()

════════════════════════════════════════════════════════════════
 SECTION 15: COMMON COMPILATION ERRORS TO AVOID
════════════════════════════════════════════════════════════════

ERROR: "X has no attribute 'value'"
  → When using direct assignment (self.x = UInt64(0)), self.x IS the value. No .value needed.

ERROR: "X has no attribute 'bytes'"
  → UInt64 has no .bytes. Use op.itob(my_uint64). BigUInt, Account, String ALL have .bytes.

ERROR: "X has no attribute 'address'"
  → Account has no .address. It IS the address. Use .bytes for raw bytes.

ERROR: "Unsupported operand type for +"
  → arc4 types don't support arithmetic. Convert: arc4.UInt64(val.native + UInt64(1))

ERROR: "mutable reference to ARC-4-encoded value must be copied"
  → Add .copy() when reading arc4 structs from BoxMap: val = self.box[key].copy()

ERROR: "NameError: Bool" or "cannot import Bool from algopy"
  → Use arc4.Bool(True), never bare Bool.

ERROR: "incompatible type int; expected UInt64"
  → Wrap int literals: UInt64(0), UInt64(1). Python int can be used in some contexts (+ - * etc.) but not assignment.

ERROR: "X has no attribute 'set' / 'get' / 'exists'"
  → BoxMap uses subscript: self.bm[k] = v, val = self.bm[k], k in self.bm. No .set/.get/.exists on entries.

ERROR: "Module has no attribute 'group'" on gtxn
  → gtxn has NO .group attribute. Use: gtxn.PaymentTransaction(0), gtxn.Transaction(0), etc.

ERROR: "type[Txn] has no attribute 'Payment'"
  → Use TransactionType.Payment, NOT Txn.Payment. Import TransactionType from algopy.

ERROR: "type[Txn] has no attribute 'type_enum'"
  → The property is .type, NOT .type_enum: Txn.type == TransactionType.Payment

ERROR: "Too many positional arguments for 'get' of 'BoxMap'"
  → BoxMap.get() `default` is KEYWORD-ONLY: self.bm.get(key, default=UInt64(0)) NOT self.bm.get(key, UInt64(0))

ERROR: "type[BigUInt] has no attribute 'max_uint256'"
  → BigUInt has NO class constants. Use BigUInt(2**256 - 1) for max uint256.

ERROR: "unsupported statement type at module level"
  → Module-level code can ONLY be: import statements, class definitions, @subroutine functions, plain int/str constants.
  → WRONG: ADMIN = UInt64(1) at module level. CORRECT: ADMIN = 1 (plain int constant).

ERROR: "assignment target type differs from expression value type"
  → Type mismatch. arc4.UInt256.native returns BigUInt, not UInt64.
  → If BoxMap stores UInt64, assign UInt64 values. If source is arc4.UInt256, store BigUInt.

ERROR: "X has no attribute 'copy'" on arc4.String/Bool/Address/UInt*/DynamicBytes
  → .copy() is ONLY for arc4.Struct from BoxMap. Non-struct arc4 values: just return directly.

ERROR: "Cannot assign to a method" / "Incompatible types in assignment"
  → Method name collides with __init__ attribute name. If self.owner exists, the method
    MUST NOT be named def owner(). Use def get_owner() instead.
  → Rule: NEVER define a method with the same name as any self.xxx attribute.

ERROR: "Invalid index type 'UIntN[Literal[64]]' for BoxMap[UInt64, ...]" or "unexpected argument type"
  → arc4.UInt64 is NOT the same as native UInt64. BoxMap(UInt64, ...) requires native UInt64 keys.
  → FIX: Convert arc4 params to native before BoxMap access: self.bm[param.native]
  → Or use param.native as key variable: key = param.native; self.bm[key]

ERROR: "Returning Any from function declared to return 'UInt64'"
  → BoxMap.get() may return Any in some contexts. Assign to a typed variable first:
    val: UInt64 = self.bm.get(key, default=UInt64(0))
    return val

════════════════════════════════════════════════════════════════
 SECTION 16: FEW-SHOT EXAMPLES (COMMON PATTERNS)
════════════════════════════════════════════════════════════════

--- 16A: Simple Token (mapping + transfer + mint) ---
Solidity:
  mapping(address => uint256) balances; uint256 totalSupply;
  function mint(address to, uint256 amount) external onlyOwner { balances[to] += amount; totalSupply += amount; }
  function transfer(address to, uint256 amount) external { require(balances[msg.sender] >= amount); balances[msg.sender] -= amount; balances[to] += amount; }

Algorand Python:
  class Token(ARC4Contract):
      def __init__(self) -> None:
          self.owner = Account()
          self.balances = BoxMap(Account, UInt64)
          self.total_supply = UInt64(0)
      @arc4.baremethod(allow_actions=["NoOp"], create="require")
      def create(self) -> None:
          self.owner = Txn.sender
      @arc4.abimethod
      def mint(self, to: arc4.Address, amount: arc4.UInt64) -> None:
          assert Txn.sender == self.owner, "not owner"
          to_acct = to.native
          amt = amount.native
          current = self.balances.get(to_acct, default=UInt64(0))
          self.balances[to_acct] = current + amt
          self.total_supply += amt
      @arc4.abimethod
      def transfer(self, to: arc4.Address, amount: arc4.UInt64) -> None:
          sender = Txn.sender
          amt = amount.native
          sender_bal = self.balances.get(sender, default=UInt64(0))
          assert sender_bal >= amt, "insufficient"
          self.balances[sender] = sender_bal - amt
          to_acct = to.native
          to_bal = self.balances.get(to_acct, default=UInt64(0))
          self.balances[to_acct] = to_bal + amt

--- 16B: Enum Pattern ---
Solidity:
  enum Status { Pending, Active, Closed }
  Status public status;

Algorand Python:
  # Module-level plain int constants (NOT UInt64!)
  PENDING = 0
  ACTIVE = 1
  CLOSED = 2
  class MyContract(ARC4Contract):
      def __init__(self) -> None:
          self.status = UInt64(PENDING)
      @arc4.abimethod
      def activate(self) -> None:
          self.status = UInt64(ACTIVE)

--- 16C: Modifier + Event Pattern ---
Solidity:
  modifier onlyOwner() { require(msg.sender == owner); _; }
  event Transfer(address indexed from, address indexed to, uint256 value);

Algorand Python:
  @subroutine
  def require_owner(owner: Account) -> None:
      assert Txn.sender == owner, "not owner"
  # Events emitted as: arc4.emit("Transfer", from_addr, to_addr, value)

--- 16D: Nested Mapping (allowance pattern) ---
Solidity:
  mapping(address => mapping(address => uint256)) allowances;
  allowances[owner][spender] = amount;

Algorand Python:
  self.allowances = BoxMap(Bytes, UInt64)  # composite key
  # Key construction:
  key = op.concat(owner_account.bytes, spender_account.bytes)
  self.allowances[key] = amount

════════════════════════════════════════════════════════════════
 OUTPUT FORMAT
════════════════════════════════════════════════════════════════

Respond with a JSON object (no markdown fences) containing EXACTLY:
{
  "algorand_python_code": "...full source code...",
  "state_schema": {"global_ints": N, "global_bytes": N, "local_ints": N, "local_bytes": N},
  "unsupported_features": ["feature1", ...]
}

state_schema counting:
  global_ints: count self.xxx = UInt64/bool fields
  global_bytes: count self.xxx = Account/String/Bytes/BigUInt fields
  local_ints: count LocalState(UInt64) / LocalState(bool) fields
  local_bytes: count LocalState(String) / LocalState(Bytes) / LocalState(Account) fields
"""

USER_PROMPT_TEMPLATE = "Convert this Solidity contract to Algorand Python. Respond with the JSON object only.\n\n{solidity_code}"

AST_ENRICHED_PROMPT_TEMPLATE = """Convert this Solidity contract to Algorand Python using the AST analysis below.
Add `# Converted from Solidity using AST analysis` at top.
For each WARNING, add an inline comment. Use TODO for unconvertible parts.
Respond with the JSON object only.

{ast_analysis}

--- SOLIDITY SOURCE ---
{solidity_code}"""

FIX_PROMPT_TEMPLATE = """Fix this Algorand Python code that FAILED PuyaPy compilation.
Apply ONLY the minimum changes needed. Keep the contract logic the same.

═══ ERROR PATTERN DICTIONARY (match error message → apply fix) ═══

1. "X has no attribute 'value'" on self.xxx fields
   WHY: When you declare self.counter = UInt64(0) in __init__, the compiler creates GlobalState
        behind the scenes. self.counter IS the UInt64 directly — no .value wrapper.
   FIX: self.counter += UInt64(1)  NOT self.counter.value += 1
        self.admin = Txn.sender   NOT self.admin.value = Txn.sender
   EXCEPTION: Box (single box) DOES use .value: self.data.value = UInt64(42)

2. "X has no attribute 'bytes'"
   WHY: Native UInt64 does NOT have .bytes. Only BytesBacked types do.
   FIX: op.itob(my_uint64)  NOT my_uint64.bytes
   NOTE: BigUInt, Account, String, Bytes, and ALL arc4 types DO have .bytes

3. "X has no attribute 'address'"
   WHY: Account IS the address already. There is no .address property.
   FIX: Txn.sender.bytes  NOT Txn.sender.address  NOT Txn.sender.address.bytes

4. "Unsupported operand type" / "has no __add__" on arc4 types
   WHY: arc4.UInt64, arc4.UInt256 etc. have NO arithmetic operators.
   FIX: Convert to native, do math, convert back:
        arc4.UInt64(val.native + UInt64(1))  NOT val + arc4.UInt64(1)

5. "mutable reference to ARC-4-encoded value must be copied using .copy()"
   WHY: Reading a struct from BoxMap gives a reference to box storage. Must .copy().
   FIX: old = self.proposals[key].copy()  NOT old = self.proposals[key]

6. "NameError" or "cannot import" Bool / UInt8 / etc.
   WHY: These are arc4 types, not top-level algopy exports.
   FIX: arc4.Bool(True), arc4.UInt8(0)  NOT Bool(True), UInt8(0)
        Remove "Bool" from "from algopy import ..." line

7. "X has no attribute 'set'" / "'get'" / "'exists'" on BoxMap entry
   WHY: BoxMap entries use subscript access, not methods.
   FIX: self.bm[k] = v  (set), val = self.bm[k]  (get), k in self.bm  (exists)
        del self.bm[k]  (delete), self.bm.get(k, default=UInt64(0))  (get with default)

8. "has no attribute 'encode'"
   WHY: arc4 types use .bytes, not .encode().
   FIX: my_arc4_val.bytes  NOT my_arc4_val.encode()

9. "has no attribute 'from_items'" on arc4.Tuple
   WHY: arc4.Tuple is constructed with a Python tuple in the constructor.
   FIX: arc4.Tuple((item1, item2))  NOT arc4.Tuple.from_items(item1, item2)

10. "incompatible type int; expected UInt64" or similar type mismatch
    FIX: Wrap int literals in UInt64(): self.counter = UInt64(0)  NOT self.counter = 0

11. "exceeds maximum program size" / TEAL too large
    FIX: Factor repeated logic into @subroutine functions OUTSIDE the class.
         Remove arc4.emit() calls (events add large TEAL).
         Replace arc4.Struct with separate BoxMaps if struct has ≤2 fields.
         Merge similar @arc4.abimethod functions.
         Remove verbose comments.

12. "has no attribute 'contains'" on BoxMap
    FIX: Use `key in self.boxmap`  NOT `self.boxmap.contains(key)`

13. "Module has no attribute 'group'" on gtxn
    WHY: gtxn has NO .group attribute. It exposes typed transaction classes.
    FIX: gtxn.PaymentTransaction(0)  NOT gtxn.group[0]
         gtxn.Transaction(0)  for any type at group index 0

14. "type[Txn] has no attribute 'Payment'" or "'type_enum'"
    WHY: Transaction type constants are on TransactionType, not Txn.
    FIX: from algopy import TransactionType
         Txn.type == TransactionType.Payment  NOT Txn.type_enum == Txn.Payment

15. "Too many positional arguments for 'get' of 'BoxMap'"
    WHY: BoxMap.get() signature is get(key, *, default=val) — default is KEYWORD-ONLY.
    FIX: self.bm.get(key, default=UInt64(0))  NOT self.bm.get(key, UInt64(0))

16. "type[BigUInt] has no attribute 'max_uint256'"
    WHY: BigUInt has no class-level constants or static attributes.
    FIX: BigUInt(2**256 - 1)  NOT BigUInt.max_uint256

17. "unsupported statement type at module level"
    WHY: PuyaPy only allows imports, class defs, @subroutine decorated funcs, and plain int/str
         literals at module level. UInt64(), BigUInt() etc. are NOT allowed at module level.
    FIX: ADMIN = 1  NOT ADMIN = UInt64(1). Use UInt64(ADMIN) inside methods.

18. "assignment target type differs from expression value type"
    WHY: Type mismatch — e.g. assigning BigUInt to a BoxMap(K, UInt64).
         arc4.UInt256.native returns BigUInt, NOT UInt64!
    FIX: If BoxMap value type is UInt64, use arc4.UInt64 params (not UInt256).
         Or change BoxMap value type to BigUInt to match arc4.UInt256.native.

19. "X has no attribute 'copy'" on arc4.String/Bool/Address/UInt*/DynamicBytes
    WHY: .copy() is ONLY for arc4.Struct values from BoxMap. Other arc4 types don't have it.
    FIX: return self.names[key]  NOT return self.names[key].copy()
         For arc4.Bool: return arc4.Bool(self.approved[key].native)

20. "Cannot assign to a method" / "Incompatible types in assignment"
    WHY: Method name (def owner) collides with __init__ attribute (self.owner).
    FIX: Rename the method to get_owner, get_entries, get_balance, etc.
         NEVER define def xxx() when self.xxx exists.

21. "Invalid index type 'UIntN[Literal[64]]' for BoxMap[UInt64, ...]" or similar
    WHY: arc4.UInt64 ≠ UInt64. BoxMap(UInt64, ...) requires native UInt64 keys.
    FIX: Convert arc4 params before BoxMap access: self.bm[param.native] NOT self.bm[param]
         For arc4.UInt256: use param.native (gives BigUInt) only if BoxMap key is BigUInt.

22. "Returning Any from function declared to return 'UInt64'"
    WHY: BoxMap.get() return type isn't always inferred.
    FIX: Assign to typed variable: result: UInt64 = self.bm.get(key, default=UInt64(0)); return result

Keep the @arc4.baremethod(allow_actions=["NoOp"], create="require") for the create method.
Respond with the FULL corrected code in JSON format (same schema as conversion).

--- ORIGINAL SOLIDITY ---
{solidity_code}

--- BROKEN CODE ---
{algorand_python_code}

--- COMPILATION ERRORS ---
{error_message}"""

# ── 3.4  Dangerous patterns for input validation ─────────────

_DANGEROUS_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bimport\s+os\b", re.IGNORECASE),
    re.compile(r"\bimport\s+sys\b", re.IGNORECASE),
    re.compile(r"\bimport\s+subprocess\b", re.IGNORECASE),
    re.compile(r"\b__import__\b"),
    re.compile(r"\beval\s*\("),
    re.compile(r"\bexec\s*\("),
    re.compile(r"\bos\.system\b"),
    re.compile(r"\bsubprocess\.\b"),
    re.compile(r"\bopen\s*\(.+\)"),
]


# ── 3.2 / 3.3 / 3.4  AIService class ─────────────────────────

class AIService:
    """Wraps Google Gemini REST API to convert Solidity -> Algorand Python."""

    def __init__(self) -> None:
        settings = get_settings()
        self._api_key = settings.GEMINI_API_KEY
        self._max_retries = settings.AI_MAX_RETRIES
        self._max_input_size = settings.MAX_INPUT_SIZE_BYTES
        self._client = httpx.AsyncClient(timeout=_GEMINI_TIMEOUT)
        logger.info("AIService initialised  models=%s/%s  transport=REST", _MODEL_FLASH, _MODEL_PRO)

    async def _call_gemini(self, user_prompt: str, *, use_pro: bool = False) -> str:
        """Make a REST call to Gemini and return the text response."""
        model = _MODEL_PRO if use_pro else _MODEL_FLASH
        url = f"{_GEMINI_BASE}/models/{model}:generateContent?key={self._api_key}"

        body: dict[str, Any] = {
            "system_instruction": {
                "parts": [{"text": SYSTEM_INSTRUCTION}]
            },
            "contents": [
                {"parts": [{"text": user_prompt}]}
            ],
            "generationConfig": {
                "temperature": 0.15,
                "topP": 0.8,
                "maxOutputTokens": 65536,
                "responseMimeType": "application/json",
            },
            "safetySettings": [
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            ],
        }

        logger.debug("Calling Gemini  model=%s  prompt_len=%d", model, len(user_prompt))
        response = await self._client.post(url, json=body)

        if response.status_code != 200:
            error_detail = response.text[:500]
            logger.error("Gemini API error %d [%s]: %s", response.status_code, model, error_detail)
            if response.status_code in (429, 500, 503):
                raise RuntimeError(
                    f"Gemini API transient error HTTP {response.status_code}: {error_detail}"
                )
            raise AppException(
                status_code=502,
                error_code="AI_SERVICE_UNAVAILABLE",
                message=f"Gemini API returned HTTP {response.status_code}.",
                details={"response": error_detail},
            )

        data = response.json()

        # Check for truncation via finishReason
        try:
            candidates = data["candidates"]
            finish_reason = candidates[0].get("finishReason", "STOP")
            if finish_reason == "MAX_TOKENS":
                logger.warning("Gemini response truncated (MAX_TOKENS) model=%s", model)
                # Still try to extract + repair the partial JSON
            text = candidates[0]["content"]["parts"][0]["text"]
            return text
        except (KeyError, IndexError) as exc:
            logger.error("Unexpected Gemini response structure: %s", str(exc))
            raise AppException(
                status_code=502,
                error_code="AI_PARSE_ERROR",
                message="Unexpected response structure from Gemini API.",
                details={"raw_preview": json.dumps(data)[:500]},
            )

    # ── 3.4  Input validation ────────────────────────────────

    def _validate_input(self, solidity_code: str) -> None:
        """Raise AppException if the input is invalid or suspicious."""
        if not solidity_code or not solidity_code.strip():
            raise AppException(
                status_code=400,
                error_code="EMPTY_INPUT",
                message="Solidity code must not be empty.",
            )

        if len(solidity_code.encode("utf-8")) > self._max_input_size:
            raise AppException(
                status_code=400,
                error_code="INPUT_TOO_LARGE",
                message=f"Input exceeds maximum allowed size of {self._max_input_size} bytes.",
            )

        for pattern in _DANGEROUS_PATTERNS:
            if pattern.search(solidity_code):
                raise AppException(
                    status_code=400,
                    error_code="DANGEROUS_INPUT",
                    message="Input contains potentially dangerous patterns.",
                )

        if "contract " not in solidity_code and "contract\t" not in solidity_code:
            raise AppException(
                status_code=400,
                error_code="INVALID_SOLIDITY",
                message="Input does not appear to be a Solidity contract (missing 'contract' keyword).",
            )

    # ── 3.3  Conversion ──────────────────────────────────────

    async def convert_solidity_to_algorand_python(
        self, solidity_code: str, ast_analysis: str | None = None
    ) -> ConvertResponse:
        """Validate input, call Gemini, parse response -> ConvertResponse."""
        self._validate_input(solidity_code)

        code_hash = hashlib.sha256(solidity_code.encode()).hexdigest()[:12]
        has_ast = ast_analysis is not None and len(ast_analysis.strip()) > 0
        logger.info(
            "Conversion requested  hash=%s  size=%d  ast_enriched=%s",
            code_hash,
            len(solidity_code),
            has_ast,
        )

        if has_ast:
            user_prompt = AST_ENRICHED_PROMPT_TEMPLATE.format(
                solidity_code=solidity_code,
                ast_analysis=ast_analysis,
            )
        else:
            user_prompt = USER_PROMPT_TEMPLATE.format(solidity_code=solidity_code)

        last_error: Exception | None = None

        # Try Flash first (fast), then fall back to Pro on parse errors
        for attempt in range(1, self._max_retries + 1):
            # Use Pro model on later retries if Flash keeps failing
            use_pro = attempt > 2
            try:
                logger.debug("Gemini call  attempt=%d/%d  pro=%s", attempt, self._max_retries, use_pro)
                raw_text = await self._call_gemini(user_prompt, use_pro=use_pro)
                parsed = self._parse_response(raw_text)

                cleaned_code = self._clean_algorand_python_code(parsed["algorand_python_code"])

                # Compute state schema from code (override AI's often-wrong counts)
                computed_schema = self._compute_state_schema(cleaned_code)
                ai_schema = parsed.get("state_schema", {})
                # Use the MAX of AI and computed to be safe
                merged_schema = {
                    k: max(computed_schema.get(k, 0), ai_schema.get(k, 0) if isinstance(ai_schema.get(k), int) else 0)
                    for k in ("global_ints", "global_bytes", "local_ints", "local_bytes")
                }
                logger.debug("State schema  ai=%s  computed=%s  merged=%s", ai_schema, computed_schema, merged_schema)

                result = ConvertResponse(
                    algorand_python_code=cleaned_code,
                    state_schema=StateSchema(**merged_schema),
                    unsupported_features=parsed.get("unsupported_features", []),
                )
                logger.info("Conversion succeeded  hash=%s  attempt=%d  pro=%s", code_hash, attempt, use_pro)
                return result

            except AppException as exc:
                # Retry parse errors (may be transient / truncation) but not input validation
                if exc.error_code in ("AI_PARSE_ERROR",):
                    last_error = exc
                    logger.warning(
                        "Parse error on attempt=%d  error=%s -- will retry",
                        attempt, exc.message[:200],
                    )
                    if attempt < self._max_retries:
                        backoff = min(2 * attempt, 10)
                        await asyncio.sleep(backoff)
                    continue
                raise  # Input validation errors etc. -- don't retry

            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Gemini call failed  attempt=%d  error=%s",
                    attempt,
                    str(exc)[:200],
                )
                if attempt < self._max_retries:
                    backoff = min(3 * (2 ** (attempt - 1)), 30)
                    logger.info("Retrying in %ds...", backoff)
                    await asyncio.sleep(backoff)

        raise AppException(
            status_code=502,
            error_code="AI_SERVICE_UNAVAILABLE",
            message="AI conversion failed after all retries. Please try again.",
            details={"last_error": str(last_error)[:500] if last_error else None},
        )

    # ── 14.1  Fix broken Algorand Python ──────────────────────

    @staticmethod
    def _strip_ansi(text: str) -> str:
        """Remove ANSI escape sequences from text (PuyaPy outputs colored errors)."""
        return re.sub(r"\x1b\[[0-9;]*m", "", text)

    async def fix_algorand_python(
        self,
        solidity_code: str,
        algorand_python_code: str,
        error_message: str,
    ) -> ConvertResponse:
        """Send broken Algorand Python + error back to Gemini for a targeted fix."""
        # Strip ANSI color codes from PuyaPy error output
        clean_error = self._strip_ansi(error_message)
        # Deduplicate repeated error blocks (frontend sometimes sends duplicated errors)
        if clean_error.count("info: using puyapy") > 1:
            parts = clean_error.split("info: using puyapy")
            clean_error = "info: using puyapy" + parts[1]  # keep only first block

        logger.info(
            "Fix requested  code_size=%d  error_preview=%s",
            len(algorand_python_code),
            clean_error[:120],
        )

        fix_prompt = FIX_PROMPT_TEMPLATE.format(
            solidity_code=solidity_code,
            algorand_python_code=algorand_python_code,
            error_message=clean_error,
        )

        last_error: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            use_pro = attempt > 2
            try:
                logger.debug("Gemini fix call  attempt=%d/%d  pro=%s", attempt, self._max_retries, use_pro)
                raw_text = await self._call_gemini(fix_prompt, use_pro=use_pro)
                parsed = self._parse_response(raw_text)

                cleaned_code = self._clean_algorand_python_code(parsed["algorand_python_code"])

                # Compute state schema from code (override AI's often-wrong counts)
                computed_schema = self._compute_state_schema(cleaned_code)
                ai_schema = parsed.get("state_schema", {})
                merged_schema = {
                    k: max(computed_schema.get(k, 0), ai_schema.get(k, 0) if isinstance(ai_schema.get(k), int) else 0)
                    for k in ("global_ints", "global_bytes", "local_ints", "local_bytes")
                }

                result = ConvertResponse(
                    algorand_python_code=cleaned_code,
                    state_schema=StateSchema(**merged_schema),
                    unsupported_features=parsed.get("unsupported_features", []),
                )
                logger.info("Fix succeeded  attempt=%d  pro=%s", attempt, use_pro)
                return result

            except AppException as exc:
                if exc.error_code == "AI_PARSE_ERROR":
                    last_error = exc
                    logger.warning("Parse error on fix attempt=%d -- will retry", attempt)
                    if attempt < self._max_retries:
                        await asyncio.sleep(min(2 * attempt, 10))
                    continue
                raise

            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Gemini fix call failed  attempt=%d  error=%s",
                    attempt,
                    str(exc)[:200],
                )
                if attempt < self._max_retries:
                    backoff = min(3 * (2 ** (attempt - 1)), 30)
                    logger.info("Retrying fix in %ds...", backoff)
                    await asyncio.sleep(backoff)

        raise AppException(
            status_code=502,
            error_code="AI_SERVICE_UNAVAILABLE",
            message="AI fix failed after all retries. Please try again.",
            details={"last_error": str(last_error)[:500] if last_error else None},
        )

    # ── State schema computation ──────────────────────────────

    @staticmethod
    def _compute_state_schema(code: str) -> dict[str, int]:
        """Parse generated Algorand Python code and compute the correct state schema.

        Counts GlobalState / self.xxx assignments in __init__ to determine
        how many uint64 vs byte-slice slots the app actually needs.
        This overrides the often-incorrect AI-generated state_schema.
        """
        global_ints = 0
        global_bytes = 0
        local_ints = 0
        local_bytes = 0

        # Types that are stored as uint64 on-chain
        int_types = {
            "UInt64", "bool", "Bool", "True", "False",
        }
        # Types that are stored as byte-slices on-chain
        bytes_types = {
            "Account", "String", "Bytes", "BigUInt",
            "arc4.Address", "arc4.String", "arc4.UInt8", "arc4.UInt16",
            "arc4.UInt32", "arc4.UInt64", "arc4.UInt128", "arc4.UInt256",
            "arc4.Bool", "arc4.DynamicBytes", "arc4.DynamicArray",
            "arc4.StaticArray", "arc4.Tuple",
        }

        in_init = False
        brace_depth = 0

        for line in code.split("\n"):
            stripped = line.strip()

            # Detect __init__ method
            if "def __init__" in stripped:
                in_init = True
                continue

            # Detect leaving __init__ (next method at same indent)
            if in_init and stripped.startswith("def ") and "def __init__" not in stripped:
                in_init = False

            if not in_init:
                continue

            # Skip comments
            if stripped.startswith("#"):
                continue

            # Match self.xxx = SomeType(...) patterns
            # e.g. self.owner = Account()
            # e.g. self.count = UInt64(0)
            # e.g. self.name = arc4.String()
            m = re.match(
                r"self\.(\w+)\s*=\s*"
                r"(GlobalState|LocalState)?\(?\s*"
                r"(arc4\.\w+|UInt64|Account|String|Bytes|BigUInt|Bool|bool|True|False|Txn\.\w+|op\.\w+)",
                stripped,
            )
            if m:
                _attr_name = m.group(1)
                wrapper = m.group(2)  # GlobalState / LocalState / None
                type_hint = m.group(3)

                is_local = wrapper == "LocalState"

                # Determine int vs bytes
                is_int = False
                is_bytes = False

                if type_hint in int_types:
                    is_int = True
                elif type_hint in bytes_types:
                    is_bytes = True
                elif type_hint.startswith("Txn."):
                    # Txn.sender → Account (bytes)
                    is_bytes = True
                elif type_hint.startswith("arc4."):
                    # Any arc4 type is bytes on-chain
                    is_bytes = True
                else:
                    # Default: assume int for unknown
                    is_int = True

                if is_local:
                    if is_int:
                        local_ints += 1
                    else:
                        local_bytes += 1
                else:
                    if is_int:
                        global_ints += 1
                    else:
                        global_bytes += 1
                continue

            # Also match patterns like: self.xxx = UInt64(0)  (no GlobalState wrapper)
            # Already handled above. But also catch: self.balances = BoxMap(...)
            if re.match(r"self\.\w+\s*=\s*BoxMap\(", stripped):
                # BoxMap uses box storage, NOT global state — don't count
                continue

            # Catch: self.xxx = GlobalState(UInt64) — type as arg
            m2 = re.match(
                r"self\.(\w+)\s*=\s*GlobalState\(\s*(UInt64|Account|String|Bytes|BigUInt|bool)\s*\)",
                stripped,
            )
            if m2:
                type_arg = m2.group(2)
                if type_arg in int_types:
                    global_ints += 1
                else:
                    global_bytes += 1

        return {
            "global_ints": global_ints,
            "global_bytes": global_bytes,
            "local_ints": local_ints,
            "local_bytes": local_bytes,
        }

    # ── Code cleaning ─────────────────────────────────────────

    @staticmethod
    def _clean_algorand_python_code(code: str) -> str:
        """Remove dangerous imports, __main__ blocks, and fix common AI mistakes."""
        lines = code.split("\n")
        cleaned: list[str] = []
        skip_main_block = False

        for line in lines:
            stripped = line.strip()

            # Skip if __name__ blocks
            if stripped.startswith("if __name__"):
                skip_main_block = True
                continue
            if skip_main_block:
                if stripped == "" or line[0:1] in (" ", "\t"):
                    continue
                else:
                    skip_main_block = False

            # Skip dangerous imports (os, sys, subprocess, etc.)
            if stripped.startswith("import os") or stripped.startswith("import sys"):
                continue
            if stripped.startswith("import subprocess"):
                continue
            if stripped.startswith("from os ") or stripped.startswith("from sys "):
                continue

            # Fix: remove bare "Bool" from algopy imports (should be arc4.Bool)
            if stripped.startswith("from algopy import") and "Bool" in line:
                # Remove "Bool" and ", Bool" / "Bool, " from the import list
                line = re.sub(r",\s*Bool\b", "", line)
                line = re.sub(r"\bBool\s*,\s*", "", line)
                # Edge case: Bool is the only remaining import (unlikely)
                line = re.sub(r"\bBool\b", "", line)
                # Clean up any double commas or trailing commas before )
                line = re.sub(r",\s*,", ",", line)
                line = re.sub(r",\s*$", "", line)
                stripped = line.strip()

            cleaned.append(line)

        result = "\n".join(cleaned).strip()

        # Fix bare Bool( references -> arc4.Bool(
        # Only replace standalone Bool( not preceded by arc4. or a word char
        result = re.sub(r"(?<!\w)(?<!arc4\.)Bool\(", "arc4.Bool(", result)

        # ── Auto-fix: .encode() → .bytes on arc4-like patterns ──
        # AI sometimes generates my_val.encode() instead of my_val.bytes
        result = re.sub(r"\.encode\(\)", ".bytes", result)

        # ── Auto-fix: Txn.sender.address → Txn.sender ──
        # Account has no .address attribute
        result = re.sub(r"Txn\.sender\.address\.bytes", "Txn.sender.bytes", result)
        result = re.sub(r"Txn\.sender\.address(?!\.)", "Txn.sender", result)

        # ── Auto-fix: arc4.Tuple.from_items(...) → arc4.Tuple((...)) ──
        result = re.sub(
            r"arc4\.Tuple\.from_items\(([^)]+)\)",
            r"arc4.Tuple((\1))",
            result,
        )

        # ── Auto-fix: GlobalState import removal ──
        # If AI imports GlobalState but uses direct assignment pattern, remove it
        # (GlobalState is only needed for explicit proxy pattern which we don't use)
        if "GlobalState" in result and "GlobalState(" not in result:
            result = re.sub(r",\s*GlobalState\b", "", result)
            result = re.sub(r"\bGlobalState\s*,\s*", "", result)
            result = re.sub(r"\bGlobalState\b", "", result)
            # Clean up double commas
            result = re.sub(r",\s*,", ",", result)

        # ── Auto-fix: .contains(key) → key in self.xxx ──
        # BoxMap has no .contains() method; use `in` operator
        result = re.sub(
            r"self\.(\w+)\.contains\(([^)]+)\)",
            r"\2 in self.\1",
            result,
        )

        # ── Auto-fix: gtxn.group[N] → gtxn.Transaction(N) ──
        result = re.sub(r"gtxn\.group\[(\d+)\]", r"gtxn.Transaction(\1)", result)
        result = re.sub(r"gtxn\.group\[([^\]]+)\]", r"gtxn.Transaction(\1)", result)

        # ── Auto-fix: Txn.Payment → TransactionType.Payment (and similar) ──
        for tx_type in ("Payment", "AssetTransfer", "AssetConfig", "ApplicationCall",
                        "KeyRegistration", "AssetFreeze"):
            result = re.sub(rf"Txn\.{tx_type}\b", f"TransactionType.{tx_type}", result)

        # ── Auto-fix: .type_enum → .type ──
        result = re.sub(r"\.type_enum\b", ".type", result)

        # ── Ensure TransactionType is imported if used ──
        if "TransactionType" in result and "TransactionType" not in result.split("\n")[0:10].__repr__():
            # Check if it's in the import block
            if "TransactionType" not in re.findall(r"from algopy import[^)]+\)", result, re.DOTALL).__repr__():
                # Add TransactionType to the import
                result = re.sub(
                    r"(from algopy import\s*\([^)]*)(,?\s*\))",
                    r"\1, TransactionType\2",
                    result,
                )

        # ── Auto-fix: BoxMap.get(key, val) → BoxMap.get(key, default=val) ──
        # `default` is keyword-only in BoxMap.get()
        # NOTE: lookahead includes \s* to prevent backtracking from \s* after comma
        result = re.sub(
            r"\.get\(([^,]+),(?!\s*default\s*=)\s*",
            r".get(\1, default=",
            result,
        )

        # ── Auto-fix: BigUInt.max_uint256 → BigUInt(2**256 - 1) ──
        result = re.sub(r"BigUInt\.max_uint256", "BigUInt(2**256 - 1)", result)

        # ── Auto-fix: Module-level UInt64(N) / BigUInt(N) → plain int N ──
        # Only fix module-level constants (before class definition)
        lines = result.split("\n")
        fixed_lines = []
        in_class = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("class ") and ":" in stripped:
                in_class = True
            if not in_class and re.match(r"^[A-Z_][A-Z0-9_]*\s*=\s*UInt64\(\s*(\d+)\s*\)\s*$", stripped):
                # Module-level: CONST = UInt64(123) → CONST = 123
                line = re.sub(r"UInt64\(\s*(\d+)\s*\)", r"\1", line)
            if not in_class and re.match(r"^[A-Z_][A-Z0-9_]*\s*=\s*BigUInt\(\s*(\d+)\s*\)\s*$", stripped):
                line = re.sub(r"BigUInt\(\s*(\d+)\s*\)", r"\1", line)
            fixed_lines.append(line)
        result = "\n".join(fixed_lines)

        # ── Auto-fix: Remove .copy() on non-struct BoxMap reads ──
        # Find BoxMap attrs that store struct types (these SHOULD have .copy())
        struct_names_for_copy = set(re.findall(r"class\s+(\w+)\s*\(\s*arc4\.Struct\s*\)", result))
        struct_boxmap_attrs: set[str] = set()
        if struct_names_for_copy:
            sp = "|".join(re.escape(s) for s in struct_names_for_copy)
            for m in re.finditer(rf"self\.(\w+)\s*=\s*BoxMap\([^,]+,\s*(?:{sp})\s*\)", result):
                struct_boxmap_attrs.add(m.group(1))

        # Find ALL BoxMap attributes
        all_boxmap_attrs = set(re.findall(r"self\.(\w+)\s*=\s*BoxMap\(", result))
        # Non-struct BoxMap attrs should NOT have .copy() on reads
        non_struct_boxmap_attrs = all_boxmap_attrs - struct_boxmap_attrs
        if non_struct_boxmap_attrs:
            ns_pattern = "|".join(re.escape(a) for a in non_struct_boxmap_attrs)
            # Remove .copy() from: self.attr[key].copy()
            result = re.sub(
                rf"(self\.(?:{ns_pattern})\[[^\]]+\])\.copy\(\)",
                r"\1",
                result,
            )

        # ── Auto-fix: add .copy() for BoxMap reads that return arc4.Struct ──
        # Detect arc4.Struct class names defined in the code
        struct_names = set(re.findall(r"class\s+(\w+)\s*\(\s*arc4\.Struct\s*\)", result))
        if struct_names:
            # Find BoxMap attributes that use these struct types as values
            # Pattern: self.xxx = BoxMap(KeyType, StructName)
            boxmap_attrs: set[str] = set()
            struct_pattern = "|".join(re.escape(s) for s in struct_names)
            for m in re.finditer(
                rf"self\.(\w+)\s*=\s*BoxMap\([^,]+,\s*(?:{struct_pattern})\s*\)",
                result,
            ):
                boxmap_attrs.add(m.group(1))

            if boxmap_attrs:
                # Add .copy() to reads like: var = self.proposals[key]
                # that don't already have .copy()
                attr_pattern = "|".join(re.escape(a) for a in boxmap_attrs)
                result = re.sub(
                    rf"(=\s*self\.(?:{attr_pattern})\[[^\]]+\])(?!\.copy\(\))",
                    r"\1.copy()",
                    result,
                )

        # ── Auto-fix: Rename methods that collide with __init__ attributes ──
        # If self.xxx is defined in __init__ AND def xxx(self) exists, rename method to get_xxx
        init_attrs: set[str] = set()
        for m in re.finditer(r"self\.(\w+)\s*=", result):
            init_attrs.add(m.group(1))
        # Find method definitions that collide (exclude __init__, create, and dunder methods)
        for attr in init_attrs:
            if attr.startswith("_"):
                continue
            # Match `def attr(self` and rename to `def get_attr(self`
            pattern = rf"(\s+)def {re.escape(attr)}\(self([^)]*)\)(\s*->\s*[^:]+)?:"
            if re.search(pattern, result):
                result = re.sub(
                    pattern,
                    rf"\1def get_{attr}(self\2)\3:",
                    result,
                )

        return result

    # ── Response parsing ──────────────────────────────────────

    @staticmethod
    def _extract_json(raw_text: str) -> str:
        """Extract the JSON string from raw Gemini output, handling fences and truncation."""
        text = raw_text.strip()

        # 1. Strip outer markdown fences -- use GREEDY match to handle nested fences
        outer_fence = re.match(r"^```(?:json)?\s*\n(.*?)\n?```\s*$", text, re.DOTALL)
        if outer_fence:
            text = outer_fence.group(1).strip()

        # 2. If it doesn't look like JSON, try to find the JSON object
        if not text.startswith("{"):
            # Find the first { and extract everything from there
            idx = text.find("{")
            if idx >= 0:
                text = text[idx:]
            else:
                return text  # let json.loads fail with a clear error

        # 3. Try to repair truncated JSON (missing closing braces/brackets)
        try:
            json.loads(text)
            return text
        except json.JSONDecodeError:
            pass

        # Attempt repair: close open strings, arrays, objects
        repaired = text
        # If truncated mid-string, close the string
        # Count unescaped quotes
        in_string = False
        i = 0
        while i < len(repaired):
            c = repaired[i]
            if c == "\\" and in_string:
                i += 2
                continue
            if c == '"':
                in_string = not in_string
            i += 1
        if in_string:
            repaired += '"'

        # Close open brackets/braces
        open_stack: list[str] = []
        in_str = False
        j = 0
        while j < len(repaired):
            c = repaired[j]
            if c == "\\" and in_str:
                j += 2
                continue
            if c == '"':
                in_str = not in_str
            elif not in_str:
                if c in ("{", "["):
                    open_stack.append(c)
                elif c == "}" and open_stack and open_stack[-1] == "{":
                    open_stack.pop()
                elif c == "]" and open_stack and open_stack[-1] == "[":
                    open_stack.pop()
            j += 1

        closers = {"{": "}", "[": "]"}
        for bracket in reversed(open_stack):
            repaired += closers.get(bracket, "")

        try:
            json.loads(repaired)
            logger.info("Repaired truncated JSON (added %d closers)", len(open_stack))
            return repaired
        except json.JSONDecodeError:
            pass

        # Return original text -- let caller handle the error
        return text

    @staticmethod
    def _parse_response(raw_text: str) -> dict[str, Any]:
        """Extract and validate the JSON object from Gemini's response."""
        text = AIService._extract_json(raw_text)

        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AppException(
                status_code=502,
                error_code="AI_PARSE_ERROR",
                message="Failed to parse AI response as JSON.",
                details={"raw_preview": raw_text[:500], "json_error": str(exc)},
            )

        # Validate required fields
        if not isinstance(data.get("algorand_python_code"), str) or not data["algorand_python_code"].strip():
            raise AppException(
                status_code=502,
                error_code="AI_PARSE_ERROR",
                message="AI response missing or empty 'algorand_python_code' field.",
            )

        schema = data.get("state_schema")
        if not isinstance(schema, dict):
            # Try to provide a reasonable default rather than failing
            logger.warning("state_schema missing from AI response, using defaults")
            data["state_schema"] = {
                "global_ints": 0, "global_bytes": 0,
                "local_ints": 0, "local_bytes": 0,
            }
            schema = data["state_schema"]

        for key in ("global_ints", "global_bytes", "local_ints", "local_bytes"):
            val = schema.get(key)
            if isinstance(val, str) and val.isdigit():
                schema[key] = int(val)
            elif not isinstance(val, int):
                schema[key] = 0  # Default to 0 rather than crashing

        if not isinstance(data.get("unsupported_features"), list):
            data["unsupported_features"] = []

        return data
