import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, getAddress, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { vaultFor } from "@/lib/vault";
import { setHirePolicy } from "@/lib/policy-registry";
import { policyForWallet } from "@/lib/agent-policy";
import { readVaultService } from "@/lib/vault-service";
import { fetchAgentDetail } from "@/lib/scanner";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";

export const dynamic = "force-dynamic";

const HIRE_ABI = [
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: Array(10).fill({ type: "uint256" }) },
] as const;

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { txHash?: unknown; chainId?: unknown; tokenId?: unknown } | null;
  const txHash = typeof body?.txHash === "string" ? body.txHash : "";
  const tokenId = typeof body?.tokenId === "string" || typeof body?.tokenId === "number" ? String(body.tokenId) : "";
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
  // A third-party agent runs its own executor, because the vault lets only the
  // named agent trade. Its card says which policy it runs, and the tag records
  // it so PnL and quests can classify the hire, while `swept: false` tells the
  // caller this marketplace will not place a trade for it.
  let tag: { policy: string; tokenId: string; executor: "soukdio" | "agent" } | null = match
    ? { ...match, executor: "soukdio" }
    : null;
  if (!tag && /^\d+$/.test(tokenId)) {
    const detail = await fetchAgentDetail(chainId, tokenId).catch(() => null);
    const declared = readVaultService(detail?.services ?? null);
    const detailWallet = detail?.agent_wallet ?? detail?.owner_address ?? "";
    if (declared && detailWallet.toLowerCase() === agent.toLowerCase()) {
      tag = { policy: declared.policy, tokenId, executor: "agent" };
    }
  }
  if (!tag) {
    return json(
      { success: false, error: "the agent does not declare a vault service, or its token id was not sent" },
      403,
    );
  }

  const hire = await client.readContract({ address: vault as `0x${string}`, abi: HIRE_ABI, functionName: "hire", args: [BigInt(hireId)] });
  const onchainAgent = getAddress(`0x${BigInt(hire[1] as bigint).toString(16).padStart(40, "0")}`);
  if (onchainAgent.toLowerCase() !== agent.toLowerCase()) {
    return json({ success: false, error: "the event and the stored hire disagree" }, 409);
  }
  // a closed hire still counts for the quest, so the tag records it either way
  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  const openedAt = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;
  await setHirePolicy(chainId, hireId, tag.policy, { txHash, openedAt, executor: tag.executor });
  return json({
    success: true,
    ok: true,
    chainId,
    hireId,
    policy: tag.policy,
    tokenId: tag.tokenId,
    agent,
    executor: tag.executor,
    swept: tag.executor === "soukdio",
  });
}
