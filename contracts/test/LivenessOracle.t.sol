// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LivenessOracle} from "../src/LivenessOracle.sol";

// Only the cheatcodes these tests need, declared here so the suite does not
// depend on forge-std being vendored into the repository.
interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
}

/// @notice Proves the oracle records a verdict, keeps the grades apart, and expires them.
/// @dev The catalogue case that shaped this: on 2026-10-05 tokens 2173, 2175 and 1865 all
/// described themselves as moving capital, and 2173 and 2175 serve no agent card at all.
/// Reachable and capable therefore have to be different records.
contract LivenessOracleTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant AGENT = 2175;
    uint256 private constant WINDOW = 1 hours;

    LivenessOracle private oracle;
    address private registry;
    address private reporterA;
    address private reporterB;

    function setUp() public {
        registry = address(0xC0FFEE);
        oracle = new LivenessOracle(registry);
        reporterA = address(0xA11CE);
        reporterB = address(0xB0B);
    }

    function testConstructorStoresRegistry() public view {
        require(oracle.registry() == registry, "registry");
    }

    function testConstructorRejectsZeroRegistry() public {
        vm.expectRevert(LivenessOracle.NotRegistry.selector);
        new LivenessOracle(address(0));
    }

    function testUnreportedAgentIsUnknown() public view {
        require(oracle.verdict(AGENT, WINDOW) == LivenessOracle.Grade.UNKNOWN, "verdict");
        require(!oracle.canExecute(AGENT, WINDOW), "canExecute");
        require(!oracle.isReachable(AGENT, WINDOW), "isReachable");
        require(!oracle.heartbeat(AGENT, LivenessOracle.Grade.REACHABLE).exists, "exists");
    }

    function testReportStoresTheWholeRecord() public {
        vm.prank(reporterA);
        oracle.report(AGENT, LivenessOracle.Grade.DELIVERED, LivenessOracle.Method.EXECUTION, 431, keccak256("fill receipt"), uint64(block.timestamp));

        LivenessOracle.Heartbeat memory h = oracle.heartbeat(AGENT, LivenessOracle.Grade.DELIVERED);
        require(h.exists, "exists");
        require(h.grade == LivenessOracle.Grade.DELIVERED, "grade");
        require(h.method == LivenessOracle.Method.EXECUTION, "method");
        require(h.responseMs == 431, "responseMs");
        require(h.evidenceHash == keccak256("fill receipt"), "evidenceHash");
        require(h.reporter == reporterA, "reporter");
        require(h.checkedAt == block.timestamp, "checkedAt");
    }

    function testDeliveredWinsOverReachable() public {
        _post(LivenessOracle.Grade.REACHABLE, LivenessOracle.Method.CARD, reporterA);
        _post(LivenessOracle.Grade.DELIVERED, LivenessOracle.Method.EXECUTION, reporterA);

        require(oracle.verdict(AGENT, WINDOW) == LivenessOracle.Grade.DELIVERED, "verdict");
        require(oracle.canExecute(AGENT, WINDOW), "canExecute");
        require(oracle.isReachable(AGENT, WINDOW), "isReachable");
    }

    function testReachableWithoutDeliveryCannotExecute() public {
        _post(LivenessOracle.Grade.REACHABLE, LivenessOracle.Method.CARD, reporterA);

        require(oracle.verdict(AGENT, WINDOW) == LivenessOracle.Grade.REACHABLE, "verdict");
        require(!oracle.canExecute(AGENT, WINDOW), "canExecute");
        require(oracle.isReachable(AGENT, WINDOW), "isReachable");
    }

    // A fresh failure outranks an older success, so an agent cannot sit on one good probe.
    function testFreshDeadOutranksOlderDelivery() public {
        _post(LivenessOracle.Grade.DELIVERED, LivenessOracle.Method.EXECUTION, reporterA);
        vm.warp(block.timestamp + 2 hours);
        _post(LivenessOracle.Grade.DEAD, LivenessOracle.Method.A2A, reporterB);

        require(oracle.verdict(AGENT, WINDOW) == LivenessOracle.Grade.DEAD, "verdict");
        require(!oracle.canExecute(AGENT, WINDOW), "canExecute");
        require(!oracle.isReachable(AGENT, WINDOW), "isReachable");
    }

    function testDeliveryOlderThanWindowReadsUnknown() public {
        _post(LivenessOracle.Grade.DELIVERED, LivenessOracle.Method.EXECUTION, reporterA);
        vm.warp(block.timestamp + WINDOW + 1);

        require(oracle.verdict(AGENT, WINDOW) == LivenessOracle.Grade.UNKNOWN, "verdict");
        require(!oracle.canExecute(AGENT, WINDOW), "canExecute");
    }

    function testDeliveryExactlyOnTheWindowEdgeIsFresh() public {
        _post(LivenessOracle.Grade.DELIVERED, LivenessOracle.Method.EXECUTION, reporterA);
        vm.warp(block.timestamp + WINDOW);

        require(oracle.canExecute(AGENT, WINDOW), "canExecute");
    }

    function testZeroWindowDisablesEveryGrade() public {
        _post(LivenessOracle.Grade.DELIVERED, LivenessOracle.Method.EXECUTION, reporterA);

        require(oracle.verdict(AGENT, 0) == LivenessOracle.Grade.UNKNOWN, "verdict");
        require(!oracle.canExecute(AGENT, 0), "canExecute");
    }

    // Grades are separate slots, so posting one must not clear or overwrite another.
    function testGradesAreIndependentSlots() public {
        _post(LivenessOracle.Grade.DEAD, LivenessOracle.Method.A2A, reporterA);
        _post(LivenessOracle.Grade.REACHABLE, LivenessOracle.Method.CARD, reporterB);

        LivenessOracle.Heartbeat memory dead = oracle.heartbeat(AGENT, LivenessOracle.Grade.DEAD);
        LivenessOracle.Heartbeat memory live = oracle.heartbeat(AGENT, LivenessOracle.Grade.REACHABLE);
        require(dead.exists && dead.reporter == reporterA, "dead kept");
        require(live.exists && live.reporter == reporterB, "reachable kept");
        require(oracle.verdict(AGENT, WINDOW) == LivenessOracle.Grade.DEAD, "verdict prefers dead");
    }

    // The later report wins in the same slot, and the record names who posted it.
    function testRepostSupersedesInTheSameSlot() public {
        _post(LivenessOracle.Grade.REACHABLE, LivenessOracle.Method.CARD, reporterA);
        vm.warp(block.timestamp + 1);
        _post(LivenessOracle.Grade.REACHABLE, LivenessOracle.Method.MCP, reporterB);

        LivenessOracle.Heartbeat memory h = oracle.heartbeat(AGENT, LivenessOracle.Grade.REACHABLE);
        require(h.method == LivenessOracle.Method.MCP, "method updated");
        require(h.reporter == reporterB, "reporter updated");
        require(h.checkedAt == block.timestamp, "checkedAt updated");
    }

    function testGatedIsReachableButNotExecuting() public {
        _post(LivenessOracle.Grade.GATED, LivenessOracle.Method.MCP, reporterA);

        require(oracle.verdict(AGENT, WINDOW) == LivenessOracle.Grade.GATED, "verdict");
        require(oracle.isReachable(AGENT, WINDOW), "isReachable");
        require(!oracle.canExecute(AGENT, WINDOW), "canExecute");
    }

    function testRejectsUnknownAgent() public {
        vm.expectRevert(LivenessOracle.UnknownAgent.selector);
        oracle.report(0, LivenessOracle.Grade.DEAD, LivenessOracle.Method.A2A, 0, bytes32(0), uint64(block.timestamp));
    }

    // A future-dated verdict would pin a fresh record forever, so it is refused.
    function testRejectsFutureTimestamp() public {
        vm.expectRevert(LivenessOracle.FutureTimestamp.selector);
        oracle.report(
            AGENT,
            LivenessOracle.Grade.DEAD,
            LivenessOracle.Method.A2A,
            0,
            bytes32(0),
            uint64(block.timestamp + 1)
        );
    }

    function testAcceptsCurrentTimestamp() public {
        oracle.report(AGENT, LivenessOracle.Grade.REACHABLE, LivenessOracle.Method.CARD, 0, bytes32(0), uint64(block.timestamp));
        require(oracle.heartbeat(AGENT, LivenessOracle.Grade.REACHABLE).exists, "recorded");
    }

    function _post(LivenessOracle.Grade grade, LivenessOracle.Method method, address who) private {
        vm.prank(who);
        oracle.report(AGENT, grade, method, 120, keccak256("evidence"), uint64(block.timestamp));
    }
}
