// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Testnet-only settlement token for the Set and Earn campaign, deployed because the
// chain-97 dollar stablecoin has its authorization path disabled. Worthless by design: never a live asset.
contract TestUSD {
    string public constant name = "Agent Souk Test USD";
    string public constant symbol = "sUSD";
    string public constant version = "1";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // EIP-3009 spends a nonce exactly once, whether it is used or cancelled
    mapping(address => mapping(bytes32 => bool)) private _authorizationState;
    mapping(address => uint256) private _permitNonce;

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private constant _TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    // upper half of the secp256k1 order, so a signature cannot be flipped to a
    // second valid one
    uint256 private constant _SECP256K1_HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error EIP712InvalidSignature();
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20InvalidReceiver(address receiver);
    error ERC20InvalidSender(address sender);
    error EIP3009AlreadyUsed();
    error EIP3009Expired();
    error EIP3009NotYetValid();
    error EIP3009Unauthorized();

    constructor(uint256 initialSupply) {
        if (initialSupply != 0) {
            totalSupply = initialSupply;
            balanceOf[msg.sender] = initialSupply;
            emit Transfer(address(0), msg.sender, initialSupply);
        }
    }

    // --------------------------------------------------------------- ERC-20

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) {
                revert ERC20InsufficientAllowance(msg.sender, allowed, value);
            }
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _transfer(from, to, value);
        return true;
    }

    // ------------------------------------------------------------- EIP-3009

    /// @notice Settle a transfer from a signature the holder signed off chain.
    /// @dev Covers this contract's EIP-3009 domain on this chain, so the signature cannot be replayed to mainnet.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }

    /// @notice The same authorization with the signature split into v, r and s.
    /// @dev The mainnet $U token and the relay in src/lib/facilitator.ts use this nine-argument variant, so supporting both keeps the proven settlement path working.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _transferWithAuthorization(
            from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v)
        );
    }

    /// @notice Same as transferWithAuthorization but the destination is fixed to
    /// this contract, which is the form a marketplace uses when it is the payee.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (to != address(this)) {
            revert ERC20InvalidReceiver(to);
        }
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }

    /// @notice Burn an unused authorization before it can be used.
    function cancelAuthorization(address authorizer, bytes32 nonce) external {
        if (_authorizationState[authorizer][nonce]) {
            revert EIP3009AlreadyUsed();
        }
        _authorizationState[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    /// @notice True once the nonce has been used or cancelled.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationState[authorizer][nonce];
    }

    // ----------------------------------------------------------- EIP-2612

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (owner == address(0)) revert ERC20InvalidSender(address(0));
        if (block.timestamp > deadline) revert EIP3009Expired();
        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner, spender, value, _permitNonce[owner]++, deadline)
        );
        address signer =
            _recoverSigner(keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash)), v, r, s);
        if (signer != owner) revert EIP712InvalidSignature();
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function nonces(address owner) external view returns (uint256) {
        return _permitNonce[owner];
    }

    // ----------------------------------------------------------- EIP-5267

    /// @notice Publishes the signing domain so clients never have to guess it.
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory dname,
            string memory dversion,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (hex"0f", name, version, block.chainid, address(this), bytes32(0), new uint256[](0));
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    // ------------------------------------------------------------- testnet

    /// @notice Anyone may mint: this is a worthless testnet asset with no supply cap and no owner.
    /// @dev Do not deploy this on a chain where tokens have value.
    function mint(address to, uint256 value) external {
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }

    function burn(address from, uint256 value) external {
        uint256 balance = balanceOf[from];
        if (balance < value) revert ERC20InsufficientBalance(from, balance, value);
        unchecked {
            balanceOf[from] = balance - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    // ------------------------------------------------------------ internals

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    /// @dev Returns the zero address for any signature that is not a valid,
    /// non malleable secp256k1 signer, so callers only compare the result.
    function _recoverSigner(bytes32 digest, uint8 v, bytes32 r, bytes32 s)
        private
        pure
        returns (address signer)
    {
        if (uint256(s) > _SECP256K1_HALF_ORDER) return address(0);
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(digest, v, r, s);
    }

    function _transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) private {
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));
        if (block.timestamp <= validAfter) revert EIP3009NotYetValid();
        if (block.timestamp >= validBefore) revert EIP3009Expired();
        if (_authorizationState[from][nonce]) revert EIP3009AlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = _split(signature);
        if (_recoverSigner(digest, v, r, s) != from) revert EIP3009Unauthorized();

        _authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        uint256 balance = balanceOf[from];
        if (balance < value) revert ERC20InsufficientBalance(from, balance, value);
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _split(bytes memory signature) private pure returns (uint8 v, bytes32 r, bytes32 s) {
        if (signature.length != 65) revert EIP712InvalidSignature();
        assembly {
            // bytes memory keeps length at 0x00 and data from 0x20
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
    }

    function _transfer(address from, address to, uint256 value) private {
        if (from == address(0)) revert ERC20InvalidSender(address(0));
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));
        uint256 balance = balanceOf[from];
        if (balance < value) revert ERC20InsufficientBalance(from, balance, value);
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
