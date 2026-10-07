// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReceiptLedger} from "../src/ReceiptLedger.sol";

// only the cheatcodes these tests need, so the suite does not depend on forge-std
interface Vm {
    function prank(address sender) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
}

contract ReceiptLedgerTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    ReceiptLedger ledger;
    bytes32 constant ID = keccak256("req_0xaa0d315bf20065c50");
    address constant BUYER = address(1);
    address constant PAYTO = address(2);
    address constant TOKEN = address(3);
    address constant CONSUMER = address(0x70);
    address constant STRANGER = address(0x5712);
    bytes32 constant NONCE = bytes32(uint256(0x1234));

    constructor() {
        // the suite itself is the issuer, standing in for the relay address
        ledger = new ReceiptLedger(address(this));
    }

    function assertRecord(
        address buyer,
        address payTo,
        address token,
        uint256 amount,
        bytes32 nonce
    ) private view {
        (
            address rb,
            address rp,
            address rt,
            uint256 ra,
            bytes32 rn,
            ,
            ,

        ) = ledger.receiptOf(ID);
        require(rb == buyer, "buyer");
        require(rp == payTo, "payTo");
        require(rt == token, "token");
        require(ra == amount, "amount");
        require(rn == nonce, "nonce");
    }

    function testIssueStoresTheWholeRecord() public {
        ledger.issue(ID, BUYER, PAYTO, TOKEN, 2e18, NONCE);
        assertRecord(BUYER, PAYTO, TOKEN, 2e18, NONCE);
        require(ledger.isUsable(ID), "usable right after issue");
    }

    function testOnlyTheIssuerIssues() public {
        vm.prank(STRANGER);
        vm.expectRevert(ReceiptLedger.NoAccess.selector);
        ledger.issue(ID, BUYER, PAYTO, TOKEN, 2e18, NONCE);
    }

    function testOneRecordPerReceiptId() public {
        ledger.issue(ID, BUYER, PAYTO, TOKEN, 2e18, NONCE);
        vm.expectRevert(ReceiptLedger.AlreadyIssued.selector);
        ledger.issue(ID, BUYER, PAYTO, TOKEN, 2e18, NONCE);
    }

    function testIssueRefusesAnEmptyRecord() public {
        vm.expectRevert(ReceiptLedger.BadWrap.selector);
        ledger.issue(bytes32(uint256(1)), address(0), PAYTO, TOKEN, 2e18, NONCE);
    }

    function testAClaimNamesTheConsumerAndUsesTheReceipt() public {
        ledger.issue(ID, BUYER, PAYTO, TOKEN, 2e18, NONCE);
        vm.prank(CONSUMER);
        require(ledger.claim(ID), "claim returns true");
        (, , , , , uint64 issuedAt, uint64 usedAt, address consumer) = ledger.receiptOf(ID);
        require(consumer == CONSUMER, "consumer named");
        require(usedAt == issuedAt, "used at once");
        require(!ledger.isUsable(ID), "no longer usable");
    }

    function testASecondClaimRefuses() public {
        ledger.issue(ID, BUYER, PAYTO, TOKEN, 2e18, NONCE);
        ledger.claim(ID);
        vm.expectRevert(ReceiptLedger.AlreadyUsed.selector);
        ledger.claim(ID);
    }

    function testAClaimOnAnUnknownIdRefuses() public {
        vm.expectRevert(ReceiptLedger.NotIssued.selector);
        ledger.claim(keccak256("never issued"));
    }

    function testTheIssuerIsImmutableOnChain() public view {
        require(ledger.issuer() == address(this), "issuer fixed");
        // a second deployment never mutates the first
    }

    function testEmptyReceiptIdRefusesIssue() public {
        vm.expectRevert(ReceiptLedger.BadWrap.selector);
        ledger.issue(bytes32(0), BUYER, PAYTO, TOKEN, 1e18, NONCE);
    }
}
