import "server-only";

import type { PublicClient } from "viem";
import { VAULT_READ_ABI } from "./vault";

export async function hireValue0(
  client: PublicClient,
  vault: string,
  id: bigint,
): Promise<bigint | null> {
  try {
    return (await client.readContract({
      address: vault as `0x${string}`,
      abi: VAULT_READ_ABI,
      functionName: "valueInToken0",
      args: [id],
    })) as bigint;
  } catch {
    return null;
  }
}
