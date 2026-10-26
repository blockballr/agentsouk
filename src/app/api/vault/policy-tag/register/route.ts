import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, getAddress, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { vaultFor } from "@/lib/vault";
import { setHirePolicy } from "@/lib/policy-registry";
import { policyForWallet } from "@/lib/agent-policy";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";

export const dynamic = "force-dynamic";

const HIRE_ABI = [
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: Array(10).fill({ type: "uint256" }) },
] as const;

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { txHash?: unknown; chainId?: unknown } | null;
  const txHash = typeof body?.txHash === "string" ? body.txHash : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return json({ success: false, error: "txHash required" }, 400);

  const chainId = Number(body?.chainId) || targetChainId();
  const vault = vaultFor(chainId);
  if (!vault) return json({ success: false, error: `no vault on chain ${chainId}` }, 400);

  const client = createPublicClient({
    chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
    transport: rpcTransport(chainId),
  });

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    return json({ success: false, error: "transaction not found" }, 404);
  }
  if (receipt.status !== "success") return json({ success: false, error: "transaction reverted" }, 400);

  const log = receipt.logs.find(
    (l) => l.address.toLowerCase() === vault.toLowerCase() && l.topics.length === 4,
  );
  if (!log || !log.topics[1] || !log.topics[3]) {
    return json({ success: false, error: "no Opened event from this vault" }, 422);
  }

  const hireId = BigInt(log.topics[1]).toString();
  const agent = getAddress(`0x${log.topics[3].slice(26)}`);

  const match = policyForWallet(chainId, agent);
  if (!match) return json({ success: false, error: "the hire does not name a configured agent wallet" }, 403);

  const hire = await client.readContract({ address: vault as `0x${string}`, abi: HIRE_ABI, functionName: "hire", args: [BigInt(hireId)] });
  const onchainAgent = getAddress(`0x${BigInt(hire[1] as bigint).toString(16).padStart(40, "0")}`);
  if (onchainAgent.toLowerCase() !== agent.toLowerCase()) {
    return json({ success: false, error: "the event and the stored hire disagree" }, 409);
  }
  if (BigInt(hire[4] as bigint) !== 1n) return json({ success: false, error: "the hire is not open" }, 409);

  await setHirePolicy(chainId, hireId, match.policy);
  return json({ success: true, ok: true, chainId, hireId, policy: match.policy, tokenId: match.tokenId, agent });
}
