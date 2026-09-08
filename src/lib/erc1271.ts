// ERC-1271 / ERC-6492 smart wallet signature verification for the facilitator.
// Pure helper (no "server-only"): the facilitator is the trust boundary; this
// module only performs fail-closed verification and returns a verdict.
//
// Policy: every failure path returns valid=false. A verdict is true ONLY when
// the caller is a contract AND its isValidSignature(hash, sig) staticcall
// returns the ERC-1271 magic value 0x1626ba7e for OUR typed-data hash.

import {
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  http,
} from "viem";

// ERC-1271 magic value (bytes4 of keccak256("isValidSignature(bytes32,bytes)"))
export const ERC1271_MAGIC = "0x1626ba7e";

// EIP-6492 magic bytes (not re-exported by viem's public entrypoint)
const ERC6492_MAGIC_BYTES =
  "0x6492649264926492649264926492649264926492649264926492649264926492";

const IERC1271_ABI = [
  {
    name: "isValidSignature",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

export interface Erc1271VerifyArgs {
  from: `0x${string}`;
  signature: string;
  hash: `0x${string}`;
  rpcUrl: string;
}

export interface Erc1271Verdict {
  valid: boolean;
  isContract: boolean;
  reason?: string;
}

export function isErc6492Signature(signature: string): boolean {
  return signature.toLowerCase().endsWith(ERC6492_MAGIC_BYTES.slice(2));
}

// ERC-6492 layout: abi.encode(address contract, bytes initCode, bytes signature)
// followed by the 32-byte magic. Returns the underlying ERC-1271/ECDSA
// signature bytes; 0x on any parse inconsistency (fail closed upstream).
export function unwrapErc6492Signature(signature: `0x${string}`): `0x${string}` {
  if (!isErc6492Signature(signature)) return signature;
  try {
    const [, , underlying] = decodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
      signature.slice(0, signature.length - 66) as `0x${string}`,
    );
    return underlying;
  } catch {
    return "0x";
  }
}

// Validates an ERC-1271 signature against the smart account at `from` using an
// eth_call on `rpcUrl`. The account must be deployed (extcodesize > 0):
// counterfactual accounts that never deployed on this chain fail closed —
// deployless ERC-4337-style validation is intentionally out of scope.
export async function verifySmartWalletSignature(
  args: Erc1271VerifyArgs,
): Promise<Erc1271Verdict> {
  const fail = (reason: string): Erc1271Verdict => ({
    valid: false,
    isContract: false,
    reason,
  });

  try {
    const client = createPublicClient({ transport: http(args.rpcUrl) });

    const code = await client.getCode({ address: args.from });
    if (!code || code === "0x") {
      return fail("smart wallet address is not a deployed contract");
    }

    const underlying = isErc6492Signature(args.signature)
      ? unwrapErc6492Signature(args.signature as `0x${string}`)
      : (args.signature as `0x${string}`);
    if (!underlying || underlying.length <= 2) {
      return fail("ERC-6492 wrapper could not be unwrapped");
    }

    const result = await client.call({
      to: args.from,
      data: encodeFunctionData({
        abi: IERC1271_ABI,
        functionName: "isValidSignature",
        args: [args.hash, underlying],
      }),
    });
    if (!result.data || result.data.length < 66) {
      return { valid: false, isContract: true, reason: "empty isValidSignature response" };
    }
    const magic = decodeFunctionResult({
      abi: IERC1271_ABI,
      functionName: "isValidSignature",
      data: result.data,
    });
    if (magic.toLowerCase() !== ERC1271_MAGIC) {
      return {
        valid: false,
        isContract: true,
        reason: "isValidSignature did not return the ERC-1271 magic value",
      };
    }
    return { valid: true, isContract: true };
  } catch (e) {
    return fail(`isValidSignature call failed: ${(e as Error).message}`);
  }
}
