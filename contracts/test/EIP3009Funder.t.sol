// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP3009Funder} from "../src/EIP3009Funder.sol";

// only the cheatcodes these tests need, so the suite does not depend on forge-std
interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function expectRevert() external;
}

// a stand-in settlement token: the same surface as TestUSD with a signature
// witness that is valid only when the caller sends the suite's fixed witness,
// so the funder's fund path exercises the real token call shape
contract TestToken {
    error EIP3009InvalidSignature();

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    bytes32 constant VALID_DIGEST = keccak256(abi.encode("funder test witness"));

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256,
        uint256,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (keccak256(signature) != VALID_DIGEST) revert EIP3009InvalidSignature();
        if (authorizationState[from][nonce]) revert EIP3009InvalidSignature();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        authorizationState[from][nonce] = true;
    }

    function transfer(address to, uint256 value) external {
        require(balanceOf[msg.sender] >= value, "balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
    }
}

contract EIP3009FunderTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    EIP3009Funder funder;
    TestToken token;

    address constant RELAY = address(0xEE11);
    address constant BUYER = address(0xB0);
    address constant AGENT = address(0xAE0);
    address constant STRANGER = address(0x5712);
    uint64 constant WINDOW = 7 days;
    uint256 constant HIRE = 2e18;
    bytes32 constant JOB = keccak256("job_1");
    bytes32 constant OTHER = keccak256("job_2");
    bytes32 constant NONCE = bytes32(uint256(0x77));
    bytes32 constant RCPT = keccak256("rcpt_1");

    // the witness the mock accepts: anything else reverts like a bad signature
    bytes constant SIG = abi.encode("funder test witness");

    constructor() {
        token = new TestToken();
        funder = new EIP3009Funder(RELAY, WINDOW);
        token.mint(BUYER, 10e18);
    }

    // the honest internal call shape, from the relay as production does it
    function _fund(bytes32 job) private {
        vm.prank(RELAY);
        funder.fund(job, address(token), BUYER, AGENT, HIRE, 0, block.timestamp + 1 days, bytes32(uint256(NONCE) + uint256(job)), SIG);
    }

    function testFundEscrowsTheHireInTheContract() public {
        _fund(JOB);
        EIP3009Funder.Job memory job = funder.jobOf(JOB);
        require(job.buyer == BUYER && job.payTo == AGENT, "parties");
        require(job.amount == HIRE && job.status == 0, "escrowed");
        require(token.balanceOf(address(funder)) == HIRE, "held");
        require(token.balanceOf(BUYER) == 8e18, "paid from the buyer");
    }

    function testOnlyTheRelayFunds() public {
        vm.prank(STRANGER);
        vm.expectRevert();
        funder.fund(JOB, address(token), BUYER, AGENT, HIRE, 0, block.timestamp + 1 days, NONCE, SIG);
        require(token.balanceOf(address(funder)) == 0, "nothing moved");
    }

    function testOneJobIdFundsOnce() public {
        _fund(JOB);
        vm.prank(RELAY);
        vm.expectRevert();
        funder.fund(JOB, address(token), BUYER, AGENT, HIRE, 0, block.timestamp + 1 days, NONCE, SIG);
        require(token.balanceOf(address(funder)) == HIRE, "no second escrow");
    }

    function testAForgedSignatureRevertsAndEscrowsNothing() public {
        vm.prank(RELAY);
        vm.expectRevert();
        funder.fund(JOB, address(token), BUYER, AGENT, HIRE, 0, block.timestamp + 1 days, NONCE, "bad");
        EIP3009Funder.Job memory job = funder.jobOf(JOB);
        require(job.fundedAt == 0, "no row can outlive the witness");
        require(token.balanceOf(address(funder)) == 0, "no money moved");
    }

    function testVerifySetsTheDeliveryRowAndOnlyTheRelayDoes() public {
        _fund(JOB);
        vm.expectRevert();
        funder.verify(JOB, RCPT);
        vm.prank(RELAY);
        funder.verify(JOB, RCPT);
        EIP3009Funder.Job memory job = funder.jobOf(JOB);
        require(job.receiptId == RCPT && job.verifiedAt != 0, "verified");
        vm.prank(RELAY);
        vm.expectRevert();
        funder.verify(JOB, RCPT);
    }

    function testApproveReleasesToTheAgent() public {
        _fund(JOB);
        vm.prank(STRANGER);
        vm.expectRevert();
        funder.approve(JOB);
        vm.prank(BUYER);
        funder.approve(JOB);
        require(funder.jobOf(JOB).status == 1, "released");
        require(token.balanceOf(AGENT) == HIRE, "agent paid");
        require(token.balanceOf(address(funder)) == 0, "empty");
    }

    function testRefundReturnsTheEscrowBeforeVerification() public {
        _fund(JOB);
        vm.prank(BUYER);
        funder.refund(JOB);
        require(token.balanceOf(BUYER) == 10e18, "money back");
        require(funder.jobOf(JOB).status == 2, "refunded");
    }

    function testARefundCannotUndoAVerifiedDelivery() public {
        _fund(JOB);
        vm.prank(RELAY);
        funder.verify(JOB, RCPT);
        vm.prank(BUYER);
        vm.expectRevert();
        funder.refund(JOB);
        require(token.balanceOf(address(funder)) == HIRE, "escrow stands");
    }

    function testReleaseBeforeVerificationRefuses() public {
        _fund(JOB);
        vm.expectRevert();
        funder.release(JOB);
    }

    function testReleaseInsideTheDisputeWindowRefuses() public {
        _fund(JOB);
        vm.prank(RELAY);
        funder.verify(JOB, RCPT);
        vm.warp(block.timestamp + WINDOW - 1);
        vm.expectRevert();
        funder.release(JOB);
    }

    function testAfterTheWindowAnyoneReleases() public {
        _fund(JOB);
        vm.prank(RELAY);
        funder.verify(JOB, RCPT);
        vm.warp(block.timestamp + WINDOW + 1);
        funder.release(JOB);
        require(token.balanceOf(AGENT) == HIRE, "agent paid");
        require(token.balanceOf(address(funder)) == 0, "empty");
    }

    function testRejectInsideTheWindowRefundsTheBuyer() public {
        _fund(JOB);
        vm.prank(RELAY);
        funder.verify(JOB, RCPT);
        vm.warp(block.timestamp + WINDOW - 2);
        vm.prank(BUYER);
        funder.reject(JOB);
        require(token.balanceOf(BUYER) == 10e18, "money back");
        require(token.balanceOf(address(funder)) == 0, "empty");
    }

    function testRejectAfterTheWindowRefuses() public {
        _fund(JOB);
        vm.prank(RELAY);
        funder.verify(JOB, RCPT);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(BUYER);
        vm.expectRevert();
        funder.reject(JOB);
    }

    function testJobsAreIndependent() public {
        _fund(JOB);
        _fund(OTHER);
        vm.prank(BUYER);
        funder.refund(JOB);
        // the other job still holds its escrow
        require(token.balanceOf(address(funder)) == HIRE, "OTHER stands");
        require(funder.jobOf(OTHER).status == 0, "funded");
    }
}
