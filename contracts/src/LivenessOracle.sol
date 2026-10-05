// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// An on-chain record of what a probe observed about an agent, keyed to its ERC-8004 token id.
//
// Two grades, because they are different claims and collapsing them is how a listing ends up
// selling something that answers and cannot act. On 2026-10-05 three mainnet listings described
// themselves as moving capital; two serve no agent card, the third advertises no skill.
//
// Anyone may post a heartbeat for any agent, so an agent cannot certify itself and a wrong
// verdict costs the poster gas rather than the agent's reputation. Nothing here holds funds or
// reads an endpoint, so a posting cost is the only value at risk.
contract LivenessOracle {
    // graded separately so a stale capable verdict cannot hide a fresh dead one
    enum Grade {
        UNKNOWN,
        REACHABLE,
        DELIVERED,
        GATED,
        DEAD,
        UNREACHABLE
    }

    // what the probe did, so a verdict can be audited without trusting the poster
    enum Method {
        NONE,
        CARD,
        A2A,
        MCP,
        EXECUTION
    }

    struct Heartbeat {
        Grade grade;
        Method method;
        uint64 checkedAt;
        uint32 responseMs;
        bytes32 evidenceHash;
        address reporter;
        bool exists;
    }

    // the ERC-8004 identity registry on the chain this is deployed to
    address public immutable registry;

    mapping(uint256 => mapping(Grade => Heartbeat)) private _latest;

    event Live(
        uint256 indexed agentId,
        Grade indexed grade,
        Method method,
        uint64 checkedAt,
        uint32 responseMs,
        bytes32 evidenceHash,
        address indexed reporter
    );

    error UnknownAgent();
    error NotRegistry();
    error FutureTimestamp();

    constructor(address registry_) {
        if (registry_ == address(0)) revert NotRegistry();
        registry = registry_;
    }

    /**
     * Records one probe result.
     *
     * checkedAt may not be in the future: a future-dated verdict would pin a fresh record
     * forever, which turns a liveness record into a permanent claim.
     */
    function report(
        uint256 agentId,
        Grade grade,
        Method method,
        uint32 responseMs,
        bytes32 evidenceHash,
        uint64 checkedAt
    ) external {
        if (agentId == 0) revert UnknownAgent();
        if (checkedAt > block.timestamp) revert FutureTimestamp();

        Heartbeat storage slot = _latest[agentId][grade];
        slot.grade = grade;
        slot.method = method;
        slot.checkedAt = checkedAt;
        slot.responseMs = responseMs;
        slot.evidenceHash = evidenceHash;
        slot.reporter = msg.sender;
        slot.exists = true;

        emit Live(agentId, grade, method, checkedAt, responseMs, evidenceHash, msg.sender);
    }

    /// The current record for one grade, or a zeroed one if never posted.
    function heartbeat(uint256 agentId, Grade grade) external view returns (Heartbeat memory) {
        return _latest[agentId][grade];
    }

    /**
     * The verdict a buyer should act on: fresh capability first, then a fresh failure,
     * then mere reachability. A capable verdict older than the window reads as unknown, so
     * no agent coasts on a single good day.
     */
    function verdict(uint256 agentId, uint256 window) public view returns (Grade) {
        if (_pick(agentId, Grade.DELIVERED, window) == Grade.DELIVERED) return Grade.DELIVERED;
        // a recent failure is more informative than an older success
        if (isFresh(_latest[agentId][Grade.DEAD], window)) return Grade.DEAD;
        if (isFresh(_latest[agentId][Grade.UNREACHABLE], window)) return Grade.UNREACHABLE;
        if (isFresh(_latest[agentId][Grade.GATED], window)) return Grade.GATED;
        if (_pick(agentId, Grade.REACHABLE, window) == Grade.REACHABLE) return Grade.REACHABLE;
        return Grade.UNKNOWN;
    }

    /// True when the agent answered and did the work, within the window.
    function canExecute(uint256 agentId, uint256 window) external view returns (bool) {
        return _pick(agentId, Grade.DELIVERED, window) == Grade.DELIVERED;
    }

    /// True when anything answered at all, within the window.
    function isReachable(uint256 agentId, uint256 window) external view returns (bool) {
        Grade g = verdict(agentId, window);
        return g == Grade.DELIVERED || g == Grade.REACHABLE || g == Grade.GATED;
    }

    function _pick(uint256 agentId, Grade grade, uint256 window) private view returns (Grade) {
        return isFresh(_latest[agentId][grade], window) ? grade : Grade.UNKNOWN;
    }

    function isFresh(Heartbeat storage h, uint256 window) private view returns (bool) {
        if (!h.exists || window == 0) return false;
        return h.checkedAt + window >= block.timestamp;
    }
}
