import { createPublicClient, createWalletClient, http, type Hex, type TransactionReceipt } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { CliError } from "../core/errors";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";

// ERC-721 Transfer(from, to, tokenId). The registry mints one identity per
// registration, so the token id the registry sends to the owner is the agent id.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function agentIdFromReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  registry: string,
  owner: string,
): string | null {
  const wantedOwner = owner.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics.length !== 4) continue;
    const to = `0x${String(log.topics[2]).slice(26)}`.toLowerCase();
    if (to !== wantedOwner) continue;
    return BigInt(log.topics[3] as string).toString();
  }
  return null;
}

function chainFor(chainId: number) {
  return chainId === 97 ? bscTestnet : bsc;
}

function publicClient(config: CliConfig) {
  return createPublicClient({ chain: chainFor(config.chainId), transport: http(config.rpcUrl, { timeout: 20_000 }) });
}

export interface RegisterPreview {
  gas: bigint;
  registry: string;
  calldata: Hex;
}

export async function previewRegister(
  config: CliConfig,
  owner: `0x${string}`,
  registry: `0x${string}`,
  calldata: Hex,
): Promise<RegisterPreview> {
  const gas = await publicClient(config).estimateGas({ account: owner, to: registry, data: calldata });
  return { gas, registry, calldata };
}

export interface RegisterSent {
  txHash: Hex;
  agentId: string;
}

export async function sendRegister(
  config: CliConfig,
  signer: LoadedSigner,
  registry: `0x${string}`,
  calldata: Hex,
): Promise<RegisterSent> {
  const client = publicClient(config);
  const wallet = createWalletClient({
    account: signer.account,
    chain: chainFor(config.chainId),
    transport: http(config.rpcUrl, { timeout: 20_000 }),
  });
  const hash = await wallet.sendTransaction({ to: registry, data: calldata });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new CliError(`the registration ${hash} reverted`, "tx_reverted");
  const agentId = agentIdFromReceipt(receipt, registry, signer.address);
  if (!agentId) throw new CliError(`the registration ${hash} minted no identity to ${signer.address}`, "no_agent_id");
  return { txHash: hash, agentId };
}
