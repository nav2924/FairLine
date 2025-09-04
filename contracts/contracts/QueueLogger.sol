// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title QueueLogger - emits immutable public events for queue transparency.
/// @dev evType: 1=join, 2=admit, 3=timeout, 4=leave
contract QueueLogger {
    address public owner;
    event QueueEvent(bytes32 indexed userHash, uint8 indexed evType, uint64 position, uint256 timestamp);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address _owner) {
        owner = _owner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function log(bytes32 userHash, uint8 evType, uint64 position) external onlyOwner {
        emit QueueEvent(userHash, evType, position, block.timestamp);
    }
}
