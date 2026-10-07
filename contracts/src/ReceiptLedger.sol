// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// ReceiptLedger records x402 settlements on chain and lets a consumer claim a
/// receipt exactly once.
/// The issuer is the relay that broadcast the settlement: it is the only actor
/// that knows a settlement happened and the fight between records is the
/// token's own nonce state, readable by anyone through authorizationState.
/// Consumers, a boost check or a quest scorer, claim what they are shown so an
/// issued receipt cannot pay two claims.
contract ReceiptLedger {
    error NoAccess();
    error AlreadyIssued();
    error AlreadyUsed();
    error NotIssued();
    error BadWrap();

    struct Record {
        address buyer;
        address payTo;
        address token;
        uint256 amount;
        bytes32 nonce;
        uint64 issuedAt;
        uint64 usedAt;
        address consumer;
    }

    /// the address allowed to issue: who settles the money
    address public immutable issuer;

    mapping(bytes32 receiptId => Record) private _records;

    event Issued(
        bytes32 indexed receiptId,
        address indexed buyer,
        address indexed payTo,
        address token,
        uint256 amount,
        bytes32 nonce
    );
    event Claimed(bytes32 indexed receiptId, address indexed consumer, uint64 at);

    /// @param settlementIssuer the relay's address, the only account that ever
    /// paid a settlement from the buyer to an agent and so the only one that
    /// can attest one on chain
    constructor(address settlementIssuer) {
        if (settlementIssuer == address(0)) revert BadWrap();
        issuer = settlementIssuer;
    }

    /// @notice publish one settled hire to the chain. One record per receipt id;
    /// the relay calls this after the transferWithAuthorization broadcast lands
    function issue(
        bytes32 receiptId,
        address buyer,
        address payTo,
        address token,
        uint256 amount,
        bytes32 nonce
    ) external {
        if (msg.sender != issuer) revert NoAccess();
        if (receiptId == bytes32(0)) revert BadWrap();
        if (_records[receiptId].issuedAt != 0) revert AlreadyIssued();
        if (buyer == address(0) || payTo == address(0) || token == address(0) || amount == 0) {
            revert BadWrap();
        }
        _records[receiptId] = Record({
            buyer: buyer,
            payTo: payTo,
            token: token,
            amount: amount,
            nonce: nonce,
            issuedAt: uint64(block.timestamp),
            usedAt: 0,
            consumer: address(0)
        });
        emit Issued(receiptId, buyer, payTo, token, amount, nonce);
    }

    /// @notice consume a receipt exactly once. The consumer is the route whose
    /// side effect the receipt stands behind, so the same settlement cannot
    /// fund two of them
    function claim(bytes32 receiptId) external returns (bool) {
        Record storage r = _records[receiptId];
        if (r.issuedAt == 0) revert NotIssued();
        if (r.usedAt != 0) revert AlreadyUsed();
        r.usedAt = uint64(block.timestamp);
        r.consumer = msg.sender;
        emit Claimed(receiptId, msg.sender, uint64(block.timestamp));
        return true;
    }

    /// @notice the full record, zero-filled when the id is unknown
    function receiptOf(bytes32 receiptId)
        external
        view
        returns (
            address buyer,
            address payTo,
            address token,
            uint256 amount,
            bytes32 nonce,
            uint64 issuedAt,
            uint64 usedAt,
            address consumer
        )
    {
        Record storage r = _records[receiptId];
        return (r.buyer, r.payTo, r.token, r.amount, r.nonce, r.issuedAt, r.usedAt, r.consumer);
    }

    /// @notice true when issued and not yet claimed
    function isUsable(bytes32 receiptId) external view returns (bool) {
        Record storage r = _records[receiptId];
        return r.issuedAt != 0 && r.usedAt == 0;
    }
}
