// session console B, proven on BSC testnet: a grant that only ever sees the session key's public half,
// then the server using the session with the real key, a call outside the scope refused, and a revoke
import { readFileSync } from "node:fs";
import { BNB_TESTNET, createClient, deserializeSession, serializeSession, signerFromPrivateKey } from "@altananetwork/sdk";
import { generatePrivateKey } from "viem/accounts";
import { encodeFunctionData, erc20Abi, parseEther } from "viem";

const WALLET = "0xE3c5acFb2560ee8Dfe4bF6FAD74520738F7C8e9B";
const SUSD = "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53"; // our testnet token, the one allowed target
const VAULT = "0xe1cd584d0bf2dbba90f84d5ac991984cae8f9d74"; // testnet vault, outside this session's scope
const CHAIN_ID = 97;

const raw = JSON.parse(readFileSync("data/altana-sessions.json", "utf8"));
const rows: any[] = Array.isArray(raw) ? raw : Object.values(raw.sessions ?? raw);
const row = rows.find((r) => String(r.walletAddress ?? r.wallet ?? r.serialized?.walletAddress).toLowerCase() === WALLET.toLowerCase());
if (!row) throw new Error("wallet not found in the session file");
const adminKey = row.adminKey ?? row.admin_key;
const admin = signerFromPrivateKey(adminKey);
const client = createClient({ chains: [BNB_TESTNET] });
const wallet = { address: WALLET as `0x${string}` };

// the server's session key; only its public half goes to the grant
const real = signerFromPrivateKey(generatePrivateKey());
let signAttempts = 0;
const publicOnly: any = {};
for (const [k, v] of Object.entries(real)) {
  publicOnly[k] = typeof v === "function"
    ? (..._a: unknown[]) => {
        signAttempts += 1;
        throw new Error(`the grant tried to use the session key's private half (${k})`);
      }
    : v;
}

const expiry = Math.floor(Date.now() / 1000) + 3600;
console.log("1. granting a one hour session with a public-key-only session signer...");
const granted = await client.grantSession({
  wallet,
  signer: admin,
  chainId: CHAIN_ID,
  // the relay takes its fee in BNB from the session, so the session carries a small BNB allowance
  permissions: { calls: [{ to: SUSD as `0x${string}` }], spend: [{ limit: parseEther("0.005"), period: "hour" }] },
  expiry,
  sessionSigner: publicOnly,
  register: false,
} as any);
console.log("   granted:", granted.transactionHash ?? "(relay gave no hash)", "| signing attempts on the session key:", signAttempts);

// what the server stores and later loads: the serialized session plus its own private key
const session = deserializeSession(serializeSession(granted as any), real);

console.log("2. the server uses the session with the real key, inside its scope...");
const ok = await client.execute({
  session,
  chainId: CHAIN_ID,
  calls: [{ to: SUSD as `0x${string}`, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }) }],
} as any);
console.log("   executed:", (ok as any).transactionHash ?? JSON.stringify(ok).slice(0, 160));

console.log("3. a call outside the scope must be refused...");
try {
  await client.execute({ session, chainId: CHAIN_ID, calls: [{ to: VAULT as `0x${string}`, data: "0x" }] } as any);
  console.log("   NOT refused: the session reached outside its scope");
} catch (e) {
  console.log("   refused as expected:", String((e as Error).message).slice(0, 160));
}

console.log("4. revoking the test session...");
const revoked = await client.revokeSession({ wallet, signer: admin, session, chainId: CHAIN_ID } as any);
console.log("   revoked:", (revoked as any).transactionHash ?? JSON.stringify(revoked).slice(0, 160));
console.log("result:", signAttempts === 0 ? "the grant never needed the session's private key" : "the grant DID try to sign with the session key");
