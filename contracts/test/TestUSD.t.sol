// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TestUSD} from "../src/TestUSD.sol";

// Only the cheatcodes these tests need, declared here so the suite does not
// depend on forge-std being vendored into the repository.
interface Vm {
    function warp(uint256 newTimestamp) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
}

/// @notice Proves the settlement asset behaves before it is deployed anywhere:
/// the metadata a client reads, the supply path a quest wallet needs, and the
/// EIP-3009 signed transfer that x402 settlement actually depends on.
contract TestUSDTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    uint256 private constant HOLDER_PK = 0xA11CE;
    address private constant RECIPIENT = address(0xB0B);

    TestUSD private token;
    address private holder;

    function setUp() public {
        token = new TestUSD(0);
        holder = vm.addr(HOLDER_PK);
        token.mint(holder, 100 ether);
    }

    function testMetadataIsTheAgreedToken() public view {
        require(keccak256(bytes(token.name())) == keccak256("Agent Souk Test USD"), "name");
        require(keccak256(bytes(token.symbol())) == keccak256("sUSD"), "symbol");
        require(keccak256(bytes(token.version())) == keccak256("1"), "version");
        require(token.decimals() == 18, "decimals");
    }

    /// @dev The client must be able to read the domain rather than assume it.
    function testEip712DomainIsPublished() public view {
        (
            bytes1 fields,
            string memory dname,
            string memory dversion,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = token.eip712Domain();
        require(fields == hex"0f", "field bits");
        require(
            keccak256(bytes(dname)) == keccak256("Agent Souk Test USD"), "domain name"
        );
        require(keccak256(bytes(dversion)) == keccak256("1"), "domain version");
        require(chainId == block.chainid, "domain chain");
        require(verifyingContract == address(token), "domain contract");
        require(salt == bytes32(0), "domain salt");
        require(extensions.length == 0, "domain extensions");
    }

    function testMintAndTransfer() public {
        require(token.balanceOf(holder) == 100 ether, "minted");
        vm.prank(holder);
        token.transfer(RECIPIENT, 40 ether);
        require(token.balanceOf(holder) == 60 ether, "sender debited");
        require(token.balanceOf(RECIPIENT) == 40 ether, "recipient credited");
        require(token.totalSupply() == 100 ether, "supply unchanged by transfer");
    }

    function testEip3009SettlesASignedTransfer() public {
        bytes32 nonce = keccak256("hire-1");
        uint256 value = 2 ether;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH, holder, RECIPIENT, value, uint256(0), type(uint256).max, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, digest);

        token.transferWithAuthorization(holder, RECIPIENT, value, 0, type(uint256).max, nonce, abi.encodePacked(r, s, v));

        require(token.balanceOf(RECIPIENT) == value, "settled to recipient");
        require(token.balanceOf(holder) == 100 ether - value, "settled from holder");
        require(token.authorizationState(holder, nonce), "nonce spent");
    }

    /// @dev A nonce must never settle twice, or one authorization would be
    /// spendable more than once.
    function testEip3009NonceCannotBeReplayed() public {
        bytes32 nonce = keccak256("hire-2");
        uint256 value = 2 ether;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH, holder, RECIPIENT, value, uint256(0), type(uint256).max, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        token.transferWithAuthorization(holder, RECIPIENT, value, 0, type(uint256).max, nonce, signature);

        vm.expectRevert(abi.encodeWithSelector(TestUSD.EIP3009AlreadyUsed.selector));
        token.transferWithAuthorization(holder, RECIPIENT, value, 0, type(uint256).max, nonce, signature);
    }

    /// @dev A signature from someone else must not move the holder's balance.
    /// @dev The relay in src/lib/facilitator.ts broadcasts the nine argument v,
    /// r, s shape, not the standard single bytes argument. This test pins that
    /// exact encoding, because the standard-only suite above would pass while
    /// live settlement still failed.
    function testEip3009AcceptsTheRelayNineArgumentShape() public {
        bytes32 nonce = keccak256("hire-relay-shape");
        uint256 value = 2 ether;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH, holder, RECIPIENT, value, uint256(0), type(uint256).max, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, digest);

        token.transferWithAuthorization(holder, RECIPIENT, value, 0, type(uint256).max, nonce, v, r, s);

        require(token.balanceOf(RECIPIENT) == value, "relay shape settled");
        require(token.authorizationState(holder, nonce), "relay shape spent the nonce");
    }

    /// @dev The relay shape must not become a second way to spend one nonce.
    function testEip3009RelayShapeCannotBeReplayed() public {
        bytes32 nonce = keccak256("hire-relay-replay");
        uint256 value = 2 ether;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH, holder, RECIPIENT, value, uint256(0), type(uint256).max, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, digest);

        token.transferWithAuthorization(holder, RECIPIENT, value, 0, type(uint256).max, nonce, v, r, s);

        vm.expectRevert(abi.encodeWithSelector(TestUSD.EIP3009AlreadyUsed.selector));
        token.transferWithAuthorization(holder, RECIPIENT, value, 0, type(uint256).max, nonce, v, r, s);
    }

    function testEip3009RejectsAForeignSigner() public {
        uint256 attackerPk = 0xBAD;
        address attacker = vm.addr(attackerPk);
        bytes32 nonce = keccak256("hire-3");
        uint256 value = 2 ether;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH, holder, RECIPIENT, value, uint256(0), type(uint256).max, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, digest);

        vm.expectRevert(abi.encodeWithSelector(TestUSD.EIP3009Unauthorized.selector));
        token.transferWithAuthorization(
            holder, RECIPIENT, value, 0, type(uint256).max, nonce, abi.encodePacked(r, s, v)
        );
        require(attacker != holder, "attacker is a different key");
    }

    function testEip3009RejectsAZeroAddressPayee() public {
        bytes32 nonce = keccak256("hire-4");
        uint256 value = 1 ether;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                holder,
                address(0),
                value,
                uint256(0),
                type(uint256).max,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, digest);

        vm.expectRevert(abi.encodeWithSelector(TestUSD.ERC20InvalidReceiver.selector, address(0)));
        token.transferWithAuthorization(holder, address(0), value, 0, type(uint256).max, nonce, abi.encodePacked(r, s, v));
    }

    function testEip3009RejectsAnExpiredWindow() public {
        bytes32 nonce = keccak256("hire-5");
        uint256 validAfter = 1_000;
        uint256 validBefore = 2_000;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                holder,
                RECIPIENT,
                uint256(1 ether),
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, digest);

        vm.warp(validBefore);
        vm.expectRevert(abi.encodeWithSelector(TestUSD.EIP3009Expired.selector));
        token.transferWithAuthorization(
            holder, RECIPIENT, uint256(1 ether), validAfter, validBefore, nonce, abi.encodePacked(r, s, v)
        );
    }

    function testEip3009RejectsAWindowThatHasNotOpened() public {
        bytes32 nonce = keccak256("hire-6");
        uint256 value = 1 ether;
        uint256 validAfter = 2_000;
        uint256 validBefore = 3_000;
        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                holder,
                RECIPIENT,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, digest);

        vm.warp(1_500);
        vm.expectRevert(abi.encodeWithSelector(TestUSD.EIP3009NotYetValid.selector));
        token.transferWithAuthorization(
            holder, RECIPIENT, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v)
        );
    }

    function testBurnReducesSupply() public {
        vm.prank(holder);
        token.burn(holder, 10 ether);
        require(token.balanceOf(holder) == 90 ether, "burned from holder");
        require(token.totalSupply() == 90 ether, "supply reduced");
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256(bytes(token.name())),
                keccak256(bytes(token.version())),
                block.chainid,
                address(token)
            )
        );
    }
}
