// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// the shape the settlement token carries: EIP-3009 plus plain ERC-20
interface TokenLike {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
    function transfer(address to, uint256 value) external;
}

/// EIP3009Funder holds a buyer's settled hire in escrow and releases it only
/// on the delivery lifecycle, so the escrow wording on the marketplace is the
/// money path rather than a claim.
/// The buyer signs an ordinary EIP-3009 transferWithAuthorization naming this
/// contract as `to`; the relay broadcasts it into this contract (the token
/// does the signature verification and reverts on a bad witness), and the
/// funds are escrowed here until the job's release paths run.
///
/// The lifecycle: fund -> (verified delivery, then a dispute window) ->
/// release, with a buyer refund available before release. The verifier's
/// record is the only delivery gate; no agent signature can move money.
contract EIP3009Funder {
    error NoAccess();
    error NotBuyer();
    error NotFunded();
    error NotPaid();
    error AlreadyClosed();
    error AlreadyVerified();
    error DisputeOpen();
    error BadCall();

    //// @notice one escrowed hire

struct Job {
        address buyer;
        address payTo;
        address token;
        uint256 amount;
        uint64 fundedAt;
        /// when the verified delivery was recorded; zero until then
        uint64 verifiedAt;
        /// the ReceiptLedger receipt id the delivery was attested with
        bytes32 receiptId;
        uint8 status;
    }

    /// escrow states
    uint8 internal constant FUNDED = 0;
    uint8 internal constant RELEASED = 1;
    uint8 internal constant REFUNDED = 2;

    /// how long a verified delivery waits for a buyer rejection, stated at
    /// deploy rather than per job, so reading a job's state needs nothing else
    uint64 public immutable disputeWindow;
    /// the relay, the only account that broadcasts and so the only one that
    /// funds and verifies, and which can never double-fund a job id
    address public immutable relay;

    mapping(bytes32 jobId => Job) private _jobs;

    event JobFunded(bytes32 indexed jobId, address indexed buyer, address indexed payTo, address token, uint256 amount);
    event JobVerified(bytes32 indexed jobId, bytes32 indexed receiptId, uint64 verifiedAt);
    event JobReleased(bytes32 indexed jobId, address indexed payTo, uint256 amount);
    event JobRefunded(bytes32 indexed jobId, address indexed buyer, uint256 amount);

    /// @param settlementRelay the relay's address; it broadcasts every
    /// settlement on this market, so it is trusted to fund from signatures the
    /// buyer signed toward this contract, and to record a delivery it itself
    /// gated
    constructor(address settlementRelay, uint64 disputeWindowSeconds) {
        if (settlementRelay == address(0) || disputeWindowSeconds == 0) revert BadCall();
        relay = settlementRelay;
        disputeWindow = disputeWindowSeconds;
    }

    /// @notice fund one job from a buyer's signature toward this contract.
    /// The token executes the signature, so a forged or replayed authorization
    /// reverts here and moves nothing. One job id funds once, so a relay
    /// cannot reuse a job id to trap a second payment.
    function fund(
        bytes32 jobId,
        address token,
        address buyer,
        address payTo,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (msg.sender != relay) revert NoAccess();
        if (_jobs[jobId].fundedAt != 0) revert AlreadyClosed();
        if (payTo == address(0) || buyer == address(0) || value == 0) revert BadCall();
        _jobs[jobId] = Job({
            buyer: buyer,
            payTo: payTo,
            token: token,
            amount: value,
            fundedAt: uint64(block.timestamp),
            verifiedAt: 0,
            receiptId: bytes32(0),
            status: FUNDED
        });
        // the token runs its own signature checks and reverts the whole call on
        // a bad witness, so cancelling the row first is not needed: the revert
        // unwinds the state above
        TokenLike(token).transferWithAuthorization(
            buyer, address(this), value, validAfter, validBefore, nonce, signature
        );
        emit JobFunded(jobId, buyer, payTo, token, value);
    }

    /// @notice the verifier gates a delivery before recording it, so this row
    /// is a proved delivery, and the dispute window opens
    function verify(bytes32 jobId, bytes32 receiptId) external {
        if (msg.sender != relay) revert NoAccess();
        Job storage job = _jobs[jobId];
        if (job.fundedAt == 0) revert NotFunded();
        if (job.status != FUNDED) revert AlreadyClosed();
        if (job.verifiedAt != 0) revert AlreadyVerified();
        if (receiptId == bytes32(0)) revert BadCall();
        job.verifiedAt = uint64(block.timestamp);
        job.receiptId = receiptId;
        emit JobVerified(jobId, receiptId, uint64(block.timestamp));
    }

    /// @notice the buyer's own OK releases what they funded
    function approve(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.status != FUNDED) revert AlreadyClosed();
        job.status = RELEASED;
        TokenLike(job.token).transfer(job.payTo, job.amount);
        emit JobReleased(jobId, job.payTo, job.amount);
    }

    /// @notice the buyer asks for their money back before any verified delivery
    function refund(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.status != FUNDED) revert AlreadyClosed();
        // the refund is the buyer's free exit: money out moves first, so a
        // verified delivery is the one thing that closes it
        if (job.verifiedAt != 0) revert DisputeOpen();
        job.status = REFUNDED;
        TokenLike(job.token).transfer(job.buyer, job.amount);
        emit JobRefunded(jobId, job.buyer, job.amount);
    }

    /// @notice the owned release: after the verifier recorded a delivery and the
    /// dispute window passed with no rejection, anyone can settle the row
    function release(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        if (job.status != FUNDED) revert AlreadyClosed();
        if (job.verifiedAt == 0) revert NotFunded();
        if (block.timestamp < job.verifiedAt + disputeWindow) revert DisputeOpen();
        job.status = RELEASED;
        TokenLike(job.token).transfer(job.payTo, job.amount);
        emit JobReleased(jobId, job.payTo, job.amount);
    }

    /// @notice the buyer's rejection inside the window, refunding themselves
    function reject(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.status != FUNDED) revert AlreadyClosed();
        if (job.verifiedAt == 0) revert NotFunded();
        if (block.timestamp >= job.verifiedAt + disputeWindow) revert DisputeOpen();
        job.status = REFUNDED;
        TokenLike(job.token).transfer(job.buyer, job.amount);
        emit JobRefunded(jobId, job.buyer, job.amount);
    }

    /// the full job row; unfunded reads zero filled
    function jobOf(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }
}
