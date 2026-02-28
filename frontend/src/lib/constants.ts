// App-wide constants

export const ALGORAND_TESTNET_URL = "https://testnet-api.algonode.cloud";
export const ALGORAND_MAINNET_URL = "https://mainnet-api.algonode.cloud";

export const EXPLORER_TESTNET_BASE = "https://testnet.explorer.perawallet.app/tx";
export const EXPLORER_MAINNET_BASE = "https://explorer.perawallet.app/tx";

export const MAX_SOLIDITY_INPUT_LENGTH = 50000;

export const SAMPLE_SOLIDITY_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 private storedValue;

    function set(uint256 value) public {
        storedValue = value;
    }

    function get() public view returns (uint256) {
        return storedValue;
    }
}`;
