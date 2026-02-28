"""
Batch test: 50 Solidity contracts → Algorand Python → PuyaPy compilation.
Tests the full conversion pipeline to find prompt engineering issues.

Usage:
    cd backend && source ../.venv/bin/activate
    python tests/test_50_contracts.py
"""
import asyncio
import json
import os
import re
import sys
import tempfile
import subprocess
import time

# Add parent dir to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CONTRACTS = [
    # ── BASIC (1-15): Simple state, math, owner patterns ──
    ("01_counter", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Counter {
    uint256 public count;
    address public owner;
    constructor() { owner = msg.sender; count = 0; }
    function increment() public { count += 1; }
    function decrement() public { require(count > 0, "underflow"); count -= 1; }
    function getCount() public view returns (uint256) { return count; }
}
"""),
    ("02_simple_storage", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract SimpleStorage {
    uint256 private storedData;
    address public owner;
    constructor() { owner = msg.sender; }
    function set(uint256 x) public { require(msg.sender == owner, "not owner"); storedData = x; }
    function get() public view returns (uint256) { return storedData; }
}
"""),
    ("03_greeting", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Greeting {
    string public greeting;
    address public owner;
    constructor() { owner = msg.sender; greeting = "Hello"; }
    function setGreeting(string memory _g) public { require(msg.sender == owner, "not owner"); greeting = _g; }
    function getGreeting() public view returns (string memory) { return greeting; }
}
"""),
    ("04_ownership", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Ownable {
    address public owner;
    bool public paused;
    constructor() { owner = msg.sender; paused = false; }
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    function transferOwnership(address newOwner) public onlyOwner { require(newOwner != address(0), "zero addr"); owner = newOwner; }
    function pause() public onlyOwner { paused = true; }
    function unpause() public onlyOwner { paused = false; }
}
"""),
    ("05_whitelist", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Whitelist {
    address public owner;
    mapping(address => bool) public whitelisted;
    uint256 public count;
    constructor() { owner = msg.sender; count = 0; }
    function addToWhitelist(address _addr) public { require(msg.sender == owner, "not owner"); whitelisted[_addr] = true; count += 1; }
    function removeFromWhitelist(address _addr) public { require(msg.sender == owner, "not owner"); whitelisted[_addr] = false; count -= 1; }
    function isWhitelisted(address _addr) public view returns (bool) { return whitelisted[_addr]; }
}
"""),
    ("06_math_ops", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract MathOps {
    address public owner;
    constructor() { owner = msg.sender; }
    function add(uint256 a, uint256 b) public pure returns (uint256) { return a + b; }
    function subtract(uint256 a, uint256 b) public pure returns (uint256) { require(a >= b, "underflow"); return a - b; }
    function multiply(uint256 a, uint256 b) public pure returns (uint256) { return a * b; }
    function divide(uint256 a, uint256 b) public pure returns (uint256) { require(b > 0, "div by zero"); return a / b; }
}
"""),
    ("07_toggle", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Toggle {
    bool public state;
    address public owner;
    constructor() { owner = msg.sender; state = false; }
    function toggle() public { require(msg.sender == owner, "not owner"); state = !state; }
    function getState() public view returns (bool) { return state; }
}
"""),
    ("08_max_min", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract MaxMin {
    uint256 public maxVal;
    uint256 public minVal;
    address public owner;
    constructor() { owner = msg.sender; maxVal = 0; minVal = type(uint256).max; }
    function update(uint256 val) public { if (val > maxVal) maxVal = val; if (val < minVal) minVal = val; }
}
"""),
    ("09_multi_state", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract MultiState {
    uint256 public number;
    string public text;
    bool public flag;
    address public admin;
    constructor() { admin = msg.sender; number = 0; text = ""; flag = false; }
    function setNumber(uint256 _n) public { require(msg.sender == admin, "not admin"); number = _n; }
    function setText(string memory _t) public { require(msg.sender == admin, "not admin"); text = _t; }
    function setFlag(bool _f) public { require(msg.sender == admin, "not admin"); flag = _f; }
}
"""),
    ("10_deadlin", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Deadline {
    uint256 public deadline;
    address public owner;
    bool public finalized;
    constructor() { owner = msg.sender; finalized = false; deadline = 0; }
    function setDeadline(uint256 _d) public { require(msg.sender == owner, "not owner"); deadline = block.timestamp + _d; }
    function isExpired() public view returns (bool) { return block.timestamp > deadline; }
    function finalize() public { require(msg.sender == owner, "not owner"); require(block.timestamp > deadline, "not yet"); finalized = true; }
}
"""),
    ("11_accumulator", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Accumulator {
    uint256 public total;
    address public owner;
    constructor() { owner = msg.sender; total = 0; }
    function add(uint256 amount) public { total += amount; }
    function reset() public { require(msg.sender == owner, "not owner"); total = 0; }
}
"""),
    ("12_two_party", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract TwoParty {
    address public partyA;
    address public partyB;
    bool public partyAConfirmed;
    bool public partyBConfirmed;
    constructor() { partyA = msg.sender; partyAConfirmed = false; partyBConfirmed = false; }
    function setPartyB(address _b) public { require(msg.sender == partyA, "not A"); partyB = _b; }
    function confirmA() public { require(msg.sender == partyA, "not A"); partyAConfirmed = true; }
    function confirmB() public { require(msg.sender == partyB, "not B"); partyBConfirmed = true; }
    function bothConfirmed() public view returns (bool) { return partyAConfirmed && partyBConfirmed; }
}
"""),
    ("13_role_based", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract RoleBased {
    address public owner;
    mapping(address => bool) public admins;
    constructor() { owner = msg.sender; admins[msg.sender] = true; }
    function addAdmin(address _a) public { require(msg.sender == owner, "not owner"); admins[_a] = true; }
    function removeAdmin(address _a) public { require(msg.sender == owner, "not owner"); admins[_a] = false; }
    function isAdmin(address _a) public view returns (bool) { return admins[_a]; }
}
"""),
    ("14_time_lock", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract TimeLock {
    address public owner;
    uint256 public unlockTime;
    uint256 public amount;
    constructor() { owner = msg.sender; unlockTime = 0; amount = 0; }
    function lock(uint256 _duration, uint256 _amount) public {
        require(msg.sender == owner, "not owner");
        unlockTime = block.timestamp + _duration;
        amount = _amount;
    }
    function isLocked() public view returns (bool) { return block.timestamp < unlockTime; }
}
"""),
    ("15_string_registry", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract StringRegistry {
    address public owner;
    mapping(uint256 => string) public entries;
    uint256 public entryCount;
    constructor() { owner = msg.sender; entryCount = 0; }
    function addEntry(string memory _val) public { require(msg.sender == owner, "not owner"); entries[entryCount] = _val; entryCount += 1; }
}
"""),

    # ── MODERATE (16-35): Mappings, structs, events, modifiers ──
    ("16_token_balance", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract TokenBalance {
    address public owner;
    mapping(address => uint256) public balances;
    uint256 public totalSupply;
    constructor() { owner = msg.sender; totalSupply = 0; }
    function mint(address to, uint256 amount) public {
        require(msg.sender == owner, "not owner");
        balances[to] += amount;
        totalSupply += amount;
    }
    function transfer(address to, uint256 amount) public {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
    function balanceOf(address account) public view returns (uint256) { return balances[account]; }
}
"""),
    ("17_voting", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract SimpleVoting {
    address public owner;
    mapping(uint256 => uint256) public votes;
    mapping(address => bool) public hasVoted;
    uint256 public proposalCount;
    constructor() { owner = msg.sender; proposalCount = 0; }
    function createProposal() public { require(msg.sender == owner, "not owner"); proposalCount += 1; votes[proposalCount] = 0; }
    function vote(uint256 proposalId) public {
        require(hasVoted[msg.sender] == false, "already voted");
        require(proposalId <= proposalCount, "invalid");
        hasVoted[msg.sender] = true;
        votes[proposalId] += 1;
    }
}
"""),
    ("18_allowance", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Allowance {
    address public owner;
    mapping(address => uint256) public allowances;
    constructor() { owner = msg.sender; }
    function setAllowance(address spender, uint256 amount) public {
        require(msg.sender == owner, "not owner");
        allowances[spender] = amount;
    }
    function spend(uint256 amount) public {
        require(allowances[msg.sender] >= amount, "over limit");
        allowances[msg.sender] -= amount;
    }
    function getAllowance(address spender) public view returns (uint256) { return allowances[spender]; }
}
"""),
    ("19_membership", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Membership {
    address public owner;
    mapping(address => bool) public members;
    mapping(address => uint256) public memberSince;
    uint256 public memberCount;
    constructor() { owner = msg.sender; memberCount = 0; }
    function addMember(address _m) public {
        require(msg.sender == owner, "not owner");
        require(members[_m] == false, "already member");
        members[_m] = true;
        memberSince[_m] = block.timestamp;
        memberCount += 1;
    }
    function removeMember(address _m) public {
        require(msg.sender == owner, "not owner");
        members[_m] = false;
        memberCount -= 1;
    }
    function isMember(address _m) public view returns (bool) { return members[_m]; }
}
"""),
    ("20_escrow", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Escrow {
    address public buyer;
    address public seller;
    address public arbiter;
    uint256 public amount;
    bool public released;
    bool public refunded;
    constructor() { arbiter = msg.sender; released = false; refunded = false; amount = 0; }
    function setup(address _buyer, address _seller, uint256 _amount) public {
        require(msg.sender == arbiter, "not arbiter");
        buyer = _buyer;
        seller = _seller;
        amount = _amount;
    }
    function release() public { require(msg.sender == arbiter, "not arbiter"); released = true; }
    function refund() public { require(msg.sender == arbiter, "not arbiter"); refunded = true; }
}
"""),
    ("21_multi_sig_simple", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract MultiSigSimple {
    address public owner1;
    address public owner2;
    bool public owner1Approved;
    bool public owner2Approved;
    bool public executed;
    uint256 public value;
    constructor() { owner1 = msg.sender; owner1Approved = false; owner2Approved = false; executed = false; value = 0; }
    function setOwner2(address _o) public { require(msg.sender == owner1, "not o1"); owner2 = _o; }
    function setValue(uint256 _v) public { require(msg.sender == owner1, "not o1"); value = _v; owner1Approved = false; owner2Approved = false; executed = false; }
    function approve1() public { require(msg.sender == owner1, "not o1"); owner1Approved = true; }
    function approve2() public { require(msg.sender == owner2, "not o2"); owner2Approved = true; }
    function execute() public { require(owner1Approved && owner2Approved, "need both"); require(executed == false, "done"); executed = true; }
}
"""),
    ("22_tip_jar", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract TipJar {
    address public owner;
    mapping(address => uint256) public tips;
    uint256 public totalTips;
    constructor() { owner = msg.sender; totalTips = 0; }
    function tip(uint256 amount) public {
        tips[msg.sender] += amount;
        totalTips += amount;
    }
    function getTips(address tipper) public view returns (uint256) { return tips[tipper]; }
    function getTotalTips() public view returns (uint256) { return totalTips; }
}
"""),
    ("23_registry", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract NameRegistry {
    address public owner;
    mapping(address => string) public names;
    mapping(string => address) public addresses;
    constructor() { owner = msg.sender; }
    function register(string memory name) public {
        names[msg.sender] = name;
    }
}
"""),
    ("24_staking_simple", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract SimpleStaking {
    address public owner;
    mapping(address => uint256) public stakes;
    mapping(address => uint256) public stakeTime;
    uint256 public totalStaked;
    constructor() { owner = msg.sender; totalStaked = 0; }
    function stake(uint256 amount) public {
        stakes[msg.sender] += amount;
        stakeTime[msg.sender] = block.timestamp;
        totalStaked += amount;
    }
    function unstake(uint256 amount) public {
        require(stakes[msg.sender] >= amount, "insufficient");
        stakes[msg.sender] -= amount;
        totalStaked -= amount;
    }
    function getStake(address user) public view returns (uint256) { return stakes[user]; }
}
"""),
    ("25_config_manager", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract ConfigManager {
    address public admin;
    mapping(uint256 => uint256) public configs;
    constructor() { admin = msg.sender; }
    function setConfig(uint256 key, uint256 value) public {
        require(msg.sender == admin, "not admin");
        configs[key] = value;
    }
    function getConfig(uint256 key) public view returns (uint256) { return configs[key]; }
}
"""),
    ("26_task_manager", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract TaskManager {
    address public owner;
    mapping(uint256 => bool) public taskCompleted;
    uint256 public taskCount;
    constructor() { owner = msg.sender; taskCount = 0; }
    function createTask() public { require(msg.sender == owner, "not owner"); taskCount += 1; taskCompleted[taskCount] = false; }
    function completeTask(uint256 taskId) public { require(msg.sender == owner, "not owner"); require(taskId <= taskCount, "no task"); taskCompleted[taskId] = true; }
    function isComplete(uint256 taskId) public view returns (bool) { return taskCompleted[taskId]; }
}
"""),
    ("27_batch_transfer", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract BatchLedger {
    address public owner;
    mapping(address => uint256) public balances;
    uint256 public totalSupply;
    constructor() { owner = msg.sender; totalSupply = 1000000; balances[msg.sender] = totalSupply; }
    function transfer(address to, uint256 amount) public {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
    function balanceOf(address account) public view returns (uint256) { return balances[account]; }
}
"""),
    ("28_reward_tracker", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract RewardTracker {
    address public owner;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public claimed;
    constructor() { owner = msg.sender; }
    function addReward(address user, uint256 amount) public { require(msg.sender == owner, "not owner"); rewards[user] += amount; }
    function claimReward() public {
        uint256 claimable = rewards[msg.sender] - claimed[msg.sender];
        require(claimable > 0, "nothing to claim");
        claimed[msg.sender] += claimable;
    }
    function getClaimable(address user) public view returns (uint256) { return rewards[user] - claimed[user]; }
}
"""),
    ("29_access_control", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract AccessControl {
    address public owner;
    mapping(address => uint256) public roles;
    uint256 constant ADMIN = 1;
    uint256 constant MODERATOR = 2;
    constructor() { owner = msg.sender; roles[msg.sender] = ADMIN; }
    function setRole(address user, uint256 role) public {
        require(msg.sender == owner, "not owner");
        roles[user] = role;
    }
    function getRole(address user) public view returns (uint256) { return roles[user]; }
    function hasRole(address user, uint256 role) public view returns (bool) { return roles[user] == role; }
}
"""),
    ("30_poll", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Poll {
    address public owner;
    uint256 public optionAVotes;
    uint256 public optionBVotes;
    mapping(address => bool) public hasVoted;
    bool public active;
    constructor() { owner = msg.sender; optionAVotes = 0; optionBVotes = 0; active = true; }
    function voteA() public { require(active, "closed"); require(hasVoted[msg.sender] == false, "voted"); hasVoted[msg.sender] = true; optionAVotes += 1; }
    function voteB() public { require(active, "closed"); require(hasVoted[msg.sender] == false, "voted"); hasVoted[msg.sender] = true; optionBVotes += 1; }
    function closePoll() public { require(msg.sender == owner, "not owner"); active = false; }
}
"""),
    ("31_event_log", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract EventLog {
    address public owner;
    uint256 public eventCount;
    event NewEvent(address indexed sender, uint256 id, string message);
    constructor() { owner = msg.sender; eventCount = 0; }
    function logEvent(string memory message) public {
        eventCount += 1;
        emit NewEvent(msg.sender, eventCount, message);
    }
}
"""),
    ("32_deposit_tracker", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract DepositTracker {
    address public owner;
    mapping(address => uint256) public deposits;
    uint256 public totalDeposits;
    constructor() { owner = msg.sender; totalDeposits = 0; }
    function deposit(uint256 amount) public { deposits[msg.sender] += amount; totalDeposits += amount; }
    function withdraw(uint256 amount) public { require(deposits[msg.sender] >= amount, "insufficient"); deposits[msg.sender] -= amount; totalDeposits -= amount; }
    function getDeposit(address user) public view returns (uint256) { return deposits[user]; }
}
"""),
    ("33_approval_flow", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract ApprovalFlow {
    address public owner;
    mapping(uint256 => bool) public approved;
    mapping(uint256 => address) public requestor;
    uint256 public requestCount;
    constructor() { owner = msg.sender; requestCount = 0; }
    function submitRequest() public { requestCount += 1; requestor[requestCount] = msg.sender; approved[requestCount] = false; }
    function approveRequest(uint256 id) public { require(msg.sender == owner, "not owner"); require(id <= requestCount, "no req"); approved[id] = true; }
    function isApproved(uint256 id) public view returns (bool) { return approved[id]; }
}
"""),
    ("34_coupon", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Coupon {
    address public owner;
    mapping(uint256 => bool) public usedCoupons;
    mapping(uint256 => uint256) public couponValues;
    constructor() { owner = msg.sender; }
    function createCoupon(uint256 id, uint256 value) public { require(msg.sender == owner, "not owner"); couponValues[id] = value; usedCoupons[id] = false; }
    function redeemCoupon(uint256 id) public { require(usedCoupons[id] == false, "used"); require(couponValues[id] > 0, "invalid"); usedCoupons[id] = true; }
    function getCouponValue(uint256 id) public view returns (uint256) { return couponValues[id]; }
}
"""),
    ("35_score_board", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract ScoreBoard {
    address public owner;
    mapping(address => uint256) public scores;
    uint256 public highScore;
    address public leader;
    constructor() { owner = msg.sender; highScore = 0; }
    function submitScore(uint256 score) public {
        scores[msg.sender] = score;
        if (score > highScore) { highScore = score; leader = msg.sender; }
    }
    function getScore(address player) public view returns (uint256) { return scores[player]; }
    function getLeader() public view returns (address, uint256) { return (leader, highScore); }
}
"""),

    # ── MODERATE+ (36-50): Structs, events, complex logic ──
    ("36_auction", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract SimpleAuction {
    address public owner;
    address public highestBidder;
    uint256 public highestBid;
    bool public ended;
    mapping(address => uint256) public bids;
    constructor() { owner = msg.sender; ended = false; highestBid = 0; }
    function bid(uint256 amount) public {
        require(ended == false, "ended");
        require(amount > highestBid, "too low");
        bids[msg.sender] = amount;
        highestBidder = msg.sender;
        highestBid = amount;
    }
    function endAuction() public { require(msg.sender == owner, "not owner"); ended = true; }
    function getHighestBid() public view returns (address, uint256) { return (highestBidder, highestBid); }
}
"""),
    ("37_lottery", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract SimpleLottery {
    address public owner;
    mapping(address => bool) public entered;
    uint256 public entryCount;
    address public winner;
    bool public drawn;
    constructor() { owner = msg.sender; entryCount = 0; drawn = false; }
    function enter() public { require(entered[msg.sender] == false, "already in"); entered[msg.sender] = true; entryCount += 1; }
    function setWinner(address _w) public { require(msg.sender == owner, "not owner"); winner = _w; drawn = true; }
}
"""),
    ("38_todo_list", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract TodoList {
    address public owner;
    mapping(uint256 => string) public tasks;
    mapping(uint256 => bool) public completed;
    uint256 public taskCount;
    constructor() { owner = msg.sender; taskCount = 0; }
    function addTask(string memory description) public { require(msg.sender == owner, "not owner"); taskCount += 1; tasks[taskCount] = description; completed[taskCount] = false; }
    function toggleComplete(uint256 taskId) public { require(msg.sender == owner, "not owner"); require(taskId <= taskCount, "no task"); completed[taskId] = !completed[taskId]; }
}
"""),
    ("39_pledge", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Pledge {
    address public creator;
    uint256 public goal;
    uint256 public totalPledged;
    mapping(address => uint256) public pledges;
    bool public goalReached;
    constructor() { creator = msg.sender; goal = 0; totalPledged = 0; goalReached = false; }
    function setGoal(uint256 _goal) public { require(msg.sender == creator, "not creator"); goal = _goal; }
    function pledge(uint256 amount) public { pledges[msg.sender] += amount; totalPledged += amount; if (totalPledged >= goal) goalReached = true; }
    function getPledge(address user) public view returns (uint256) { return pledges[user]; }
}
"""),
    ("40_inventory", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Inventory {
    address public owner;
    mapping(uint256 => uint256) public stock;
    mapping(uint256 => uint256) public prices;
    constructor() { owner = msg.sender; }
    function addItem(uint256 itemId, uint256 qty, uint256 price) public { require(msg.sender == owner, "not owner"); stock[itemId] += qty; prices[itemId] = price; }
    function purchase(uint256 itemId, uint256 qty) public { require(stock[itemId] >= qty, "no stock"); stock[itemId] -= qty; }
    function getStock(uint256 itemId) public view returns (uint256) { return stock[itemId]; }
    function getPrice(uint256 itemId) public view returns (uint256) { return prices[itemId]; }
}
"""),
    ("41_subscription", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Subscription {
    address public owner;
    mapping(address => uint256) public expiresAt;
    uint256 public subscriptionDuration;
    constructor() { owner = msg.sender; subscriptionDuration = 2592000; }
    function subscribe() public { expiresAt[msg.sender] = block.timestamp + subscriptionDuration; }
    function isSubscribed(address user) public view returns (bool) { return expiresAt[user] > block.timestamp; }
    function setDuration(uint256 _d) public { require(msg.sender == owner, "not owner"); subscriptionDuration = _d; }
}
"""),
    ("42_rate_limited", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract RateLimited {
    address public owner;
    mapping(address => uint256) public lastAction;
    uint256 public cooldown;
    uint256 public actionCount;
    constructor() { owner = msg.sender; cooldown = 60; actionCount = 0; }
    function doAction() public {
        require(block.timestamp >= lastAction[msg.sender] + cooldown, "too soon");
        lastAction[msg.sender] = block.timestamp;
        actionCount += 1;
    }
    function setCooldown(uint256 _c) public { require(msg.sender == owner, "not owner"); cooldown = _c; }
}
"""),
    ("43_versioned", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Versioned {
    address public owner;
    uint256 public version;
    string public data;
    constructor() { owner = msg.sender; version = 0; data = ""; }
    function updateData(string memory _d) public { require(msg.sender == owner, "not owner"); data = _d; version += 1; }
    function getVersion() public view returns (uint256) { return version; }
    function getData() public view returns (string memory) { return data; }
}
"""),
    ("44_referral", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Referral {
    address public owner;
    mapping(address => address) public referrer;
    mapping(address => uint256) public referralCount;
    constructor() { owner = msg.sender; }
    function registerReferral(address _referrer) public {
        require(_referrer != msg.sender, "self ref");
        referrer[msg.sender] = _referrer;
        referralCount[_referrer] += 1;
    }
    function getReferrer(address user) public view returns (address) { return referrer[user]; }
    function getReferralCount(address user) public view returns (uint256) { return referralCount[user]; }
}
"""),
    ("45_bounty", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Bounty {
    address public creator;
    uint256 public reward;
    bool public claimed;
    address public claimant;
    string public description;
    constructor() { creator = msg.sender; claimed = false; reward = 0; }
    function setBounty(uint256 _reward, string memory _desc) public { require(msg.sender == creator, "not creator"); reward = _reward; description = _desc; claimed = false; }
    function claim() public { require(claimed == false, "claimed"); claimed = true; claimant = msg.sender; }
    function approveClaim() public { require(msg.sender == creator, "not creator"); require(claimed, "not claimed"); }
}
"""),
    ("46_fee_collector", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract FeeCollector {
    address public owner;
    uint256 public feePercent;
    uint256 public totalCollected;
    mapping(address => uint256) public deposits;
    constructor() { owner = msg.sender; feePercent = 5; totalCollected = 0; }
    function deposit(uint256 amount) public {
        uint256 fee = amount * feePercent / 100;
        uint256 net = amount - fee;
        deposits[msg.sender] += net;
        totalCollected += fee;
    }
    function setFee(uint256 _f) public { require(msg.sender == owner, "not owner"); require(_f <= 100, "too high"); feePercent = _f; }
}
"""),
    ("47_credential", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Credential {
    address public issuer;
    mapping(address => bool) public hasCredential;
    mapping(address => uint256) public issuedAt;
    uint256 public totalIssued;
    constructor() { issuer = msg.sender; totalIssued = 0; }
    function issue(address to) public { require(msg.sender == issuer, "not issuer"); require(hasCredential[to] == false, "exists"); hasCredential[to] = true; issuedAt[to] = block.timestamp; totalIssued += 1; }
    function revoke(address from) public { require(msg.sender == issuer, "not issuer"); hasCredential[from] = false; }
    function verify(address user) public view returns (bool) { return hasCredential[user]; }
}
"""),
    ("48_election", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Election {
    address public admin;
    mapping(uint256 => uint256) public voteCounts;
    mapping(address => bool) public hasVoted;
    uint256 public candidateCount;
    bool public electionOpen;
    constructor() { admin = msg.sender; candidateCount = 0; electionOpen = false; }
    function addCandidate() public { require(msg.sender == admin, "not admin"); candidateCount += 1; voteCounts[candidateCount] = 0; }
    function openElection() public { require(msg.sender == admin, "not admin"); electionOpen = true; }
    function closeElection() public { require(msg.sender == admin, "not admin"); electionOpen = false; }
    function vote(uint256 candidateId) public {
        require(electionOpen, "closed");
        require(hasVoted[msg.sender] == false, "voted");
        require(candidateId >= 1 && candidateId <= candidateCount, "invalid");
        hasVoted[msg.sender] = true;
        voteCounts[candidateId] += 1;
    }
    function getVotes(uint256 candidateId) public view returns (uint256) { return voteCounts[candidateId]; }
}
"""),
    ("49_crowdfund", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Crowdfund {
    address public creator;
    uint256 public goal;
    uint256 public deadline;
    uint256 public totalFunded;
    mapping(address => uint256) public contributions;
    bool public goalReached;
    bool public finalized;
    constructor() { creator = msg.sender; goalReached = false; finalized = false; totalFunded = 0; }
    function initialize(uint256 _goal, uint256 _duration) public {
        require(msg.sender == creator, "not creator");
        goal = _goal;
        deadline = block.timestamp + _duration;
    }
    function contribute(uint256 amount) public {
        require(block.timestamp < deadline, "ended");
        require(finalized == false, "finalized");
        contributions[msg.sender] += amount;
        totalFunded += amount;
        if (totalFunded >= goal) goalReached = true;
    }
    function finalize() public {
        require(msg.sender == creator, "not creator");
        require(block.timestamp >= deadline, "not ended");
        finalized = true;
    }
    function getContribution(address user) public view returns (uint256) { return contributions[user]; }
}
"""),
    ("50_vesting", """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Vesting {
    address public owner;
    mapping(address => uint256) public totalVested;
    mapping(address => uint256) public vestingStart;
    mapping(address => uint256) public vestingDuration;
    mapping(address => uint256) public claimed;
    constructor() { owner = msg.sender; }
    function createVesting(address beneficiary, uint256 amount, uint256 duration) public {
        require(msg.sender == owner, "not owner");
        totalVested[beneficiary] = amount;
        vestingStart[beneficiary] = block.timestamp;
        vestingDuration[beneficiary] = duration;
        claimed[beneficiary] = 0;
    }
    function claimable(address beneficiary) public view returns (uint256) {
        if (block.timestamp < vestingStart[beneficiary]) return 0;
        uint256 elapsed = block.timestamp - vestingStart[beneficiary];
        if (elapsed >= vestingDuration[beneficiary]) return totalVested[beneficiary] - claimed[beneficiary];
        uint256 vested = totalVested[beneficiary] * elapsed / vestingDuration[beneficiary];
        if (vested <= claimed[beneficiary]) return 0;
        return vested - claimed[beneficiary];
    }
    function claim() public {
        uint256 amount = claimable(msg.sender);
        require(amount > 0, "nothing to claim");
        claimed[msg.sender] += amount;
    }
}
"""),
]


async def run_tests():
    from app.services.ai_service import AIService

    svc = AIService()
    puyapy_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".venv", "bin", "puyapy"
    )
    if not os.path.exists(puyapy_path):
        # Try finding it on PATH
        result = subprocess.run(["which", "puyapy"], capture_output=True, text=True)
        puyapy_path = result.stdout.strip() if result.returncode == 0 else "puyapy"

    results = []
    passed = 0
    failed = 0
    convert_errors = 0

    for name, sol_code in CONTRACTS:
        print(f"\n{'='*60}")
        print(f"  TEST: {name}")
        print(f"{'='*60}")
        start = time.time()

        # Step 1: Convert
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
            convert_errors += 1
            continue

        # Step 2: Compile with PuyaPy
        try:
            with tempfile.TemporaryDirectory(prefix="algomint_test_") as tmpdir:
                contract_path = os.path.join(tmpdir, "contract.py")
                with open(contract_path, "w") as f:
                    f.write(algo_code)

                compile_start = time.time()
                proc = subprocess.run(
                    [puyapy_path, contract_path, "--out-dir", tmpdir],
                    capture_output=True, text=True, timeout=60
                )
                compile_time = time.time() - compile_start

                if proc.returncode == 0:
                    # Check for TEAL output
                    teal_files = [f for f in os.listdir(tmpdir) if f.endswith(".approval.teal")]
                    if teal_files:
                        teal_size = os.path.getsize(os.path.join(tmpdir, teal_files[0]))
                        print(f"  Compile: OK ({compile_time:.1f}s, TEAL={teal_size}B)")
                        results.append({"name": name, "status": "PASS", "teal_size": teal_size})
                        passed += 1
                    else:
                        print(f"  Compile: OK but no TEAL output")
                        results.append({"name": name, "status": "PASS", "teal_size": 0})
                        passed += 1
                else:
                    # Extract error lines
                    stderr = proc.stderr or proc.stdout or ""
                    error_lines = [l for l in stderr.split("\n") if "error:" in l.lower()]
                    error_summary = "\n".join(error_lines[:5]) if error_lines else stderr[:500]
                    print(f"  Compile: FAILED ({compile_time:.1f}s)")
                    for line in error_lines[:5]:
                        # Strip ANSI
                        clean = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
                        print(f"    {clean}")
                    results.append({"name": name, "status": "COMPILE_FAIL", "error": error_summary, "code": algo_code})
                    failed += 1

        except subprocess.TimeoutExpired:
            print(f"  Compile: TIMEOUT")
            results.append({"name": name, "status": "COMPILE_TIMEOUT"})
            failed += 1
        except Exception as e:
            print(f"  Compile: ERROR - {str(e)[:200]}")
            results.append({"name": name, "status": "COMPILE_ERROR", "error": str(e)[:200]})
            failed += 1

    # Summary
    total = len(CONTRACTS)
    print(f"\n{'='*60}")
    print(f"  SUMMARY: {passed}/{total} passed, {failed} compile fails, {convert_errors} convert fails")
    print(f"{'='*60}")

    if failed > 0 or convert_errors > 0:
        print("\nFAILED TESTS:")
        for r in results:
            if r["status"] != "PASS":
                print(f"  - {r['name']}: {r['status']}")
                if "error" in r:
                    # Clean ANSI and show first 3 error lines
                    clean_err = re.sub(r"\x1b\[[0-9;]*m", "", r.get("error", ""))
                    for line in clean_err.strip().split("\n")[:3]:
                        print(f"      {line.strip()}")

    # Save detailed results
    with open("/tmp/algomint_test_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nDetailed results saved to /tmp/algomint_test_results.json")

    return results


if __name__ == "__main__":
    asyncio.run(run_tests())
