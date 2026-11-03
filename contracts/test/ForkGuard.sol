// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface VmFork {
    function envOr(string calldata name, string calldata defaultValue) external view returns (string memory);
    function createSelectFork(string calldata urlOrAlias) external returns (uint256);
    function skip(bool skipTest) external;
}

/// @notice a fork test reads live chain state, so it needs a fork. A fork given
/// on the command line is already in place and is used as is; FORK_URL lets the
/// test create its own; with neither it is skipped instead of failing on empty
/// state. A chain 56 fork sits past block 100 million, a local chain does not.
library ForkGuard {
    address private constant VM = address(uint160(uint256(keccak256("hevm cheat code"))));
    uint256 private constant FORK_FLOOR = 100_000_000;

    function ensure() internal {
        if (block.number > FORK_FLOOR) return;

        string memory url = VmFork(VM).envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) {
            VmFork(VM).skip(true);
            return;
        }
        VmFork(VM).createSelectFork(url);
    }
}
