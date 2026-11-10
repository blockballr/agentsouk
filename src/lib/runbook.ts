// The live runbook: the plan for one intent, built from the same tool surface
// and the same state the server serves. It is not a document that can drift; the
// tool names come from MCP_TOOLS and the agent section comes from the registry.

import { MCP_TOOLS } from "@/lib/mcp-tools";
import type { RunbookIntent } from "@/lib/runbook-intents";

export const RUNBOOK_VERSION = "2026-11-10.2";

export interface RunbookAvailability {
  phase?: string;
  shelf?: boolean;
  hireable?: boolean;
  quotable?: boolean;
  reason?: string | null;
  [key: string]: unknown;
}

// What the detail route serves. Only the fields the plan needs are read.
export interface RunbookDetail {
  token_id: string;
  name?: string;
  chain_id?: number;
  owner_address?: string;
  agent_wallet?: string | null;
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  agent_url?: string | null;
  x402_supported?: boolean;
  availability?: RunbookAvailability | null;
  skills?: { id?: string; name?: string }[] | null;
  vault?: { policy?: string; executor?: string } | null;
}

export interface RunbookAgent {
  chainId: number;
  tokenId: string;
  name: string;
  availability: RunbookAvailability | null;
  rails: string[];
  endpoint: string | null;
  wallet: string | null;
  executor: "soukdio" | "agent" | null;
  policy: string | null;
}

export interface RunbookStep {
  step: number;
  do: string;
  tool?: string;
  command?: string;
  note?: string;
}

export interface Runbook {
  intent: RunbookIntent;
  version: string;
  chainId: number;
  agent?: RunbookAgent;
  steps: RunbookStep[];
  refusals: string[];
  docs: string;
  markdown: string;
}

export interface RunbookInput {
  intent: RunbookIntent;
  chainId: number;
  detail?: RunbookDetail | null;
  firstParty?: { policy: string; tokenId: string } | null;
}

const TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));

function skillIds(detail: RunbookDetail): string[] {
  return (detail.skills ?? [])
    .map((skill) => String(skill?.id ?? skill?.name ?? "").trim().toLowerCase())
    .filter(Boolean);
}

export function railsFor(detail: RunbookDetail): string[] {
  const ids = skillIds(detail);
  const vault = Boolean(detail.vault) || ids.some((id) => /^vault[-_]execution$/.test(id));
  const jobs = ids.includes("negotiate") && ids.includes("notify_funded");
  const callable = Boolean(detail.mcp_server || detail.a2a_endpoint || detail.agent_url);
  const direct = callable && !vault && !jobs;
  const rails: string[] = [];
  if (jobs) rails.push("jobs");
  if (vault) rails.push("vault");
  if (direct) rails.push("direct");
  if (detail.x402_supported) rails.push("x402");
  return rails.length > 0 ? rails : ["none"];
}

function agentFor(input: RunbookInput): RunbookAgent | undefined {
  const detail = input.detail;
  if (!detail) return undefined;
  const declared = detail.vault;
  const firstParty = input.firstParty;
  return {
    chainId: input.chainId,
    tokenId: String(detail.token_id),
    name: detail.name ?? String(detail.token_id),
    availability: detail.availability ?? null,
    rails: railsFor(detail),
    endpoint: detail.mcp_server ?? detail.a2a_endpoint ?? detail.agent_url ?? null,
    wallet: detail.agent_wallet ?? detail.owner_address ?? null,
    executor: firstParty ? "soukdio" : declared?.executor === "agent" ? "agent" : null,
    policy: firstParty?.policy ?? declared?.policy ?? null,
  };
}

function ref(agent: RunbookAgent | undefined): string {
  return agent ? `${agent.chainId}/${agent.tokenId}` : "<chain>/<tokenId>";
}

function availabilityLines(agent: RunbookAgent | undefined): string[] {
  if (!agent?.availability) return [];
  const a = agent.availability;
  const lines = [
    `availability: phase=${a.phase ?? "-"} shelf=${a.shelf ?? "-"} hireable=${a.hireable ?? "-"} quotable=${a.quotable ?? "-"}`,
  ];
  if (a.reason) lines.push(`reason: ${a.reason}`);
  return lines;
}

function stepsFor(input: RunbookInput, agent: RunbookAgent | undefined): RunbookStep[] {
  const r = ref(agent);
  switch (input.intent) {
    case "browse":
      return [
        { step: 1, do: "List the categories and the live counts", tool: "list_categories" },
        { step: 2, do: "Search the shelf by category or text", tool: "list_agents", command: `agentsouk search "<text>" --category <key>` },
        { step: 3, do: "Read one agent's full record", tool: "get_agent", note: agent ? `tokenId ${agent.tokenId}` : "pass tokenId" },
        { step: 4, do: "Read availability before choosing a rail", note: "phase, shelf, hireable, quotable and reason decide what is possible" },
      ];
    case "hire":
      return [
        { step: 1, do: "Confirm the agent can take work", tool: "get_agent", command: `agentsouk show ${r}` },
        { step: 2, do: "Read the live terms", tool: "get_hire_requirements", command: `agentsouk call ${r} --pay --task "<task>" --client <wallet>` },
        { step: 3, do: "Sign the EIP-3009 authorization with the buyer wallet", note: "domain and fields come from the requirements; anchor validity to chain time" },
        { step: 4, do: "Settle the session", tool: "start_hire", command: `agentsouk call ${r} --pay --task "<task>" --max-usd 0.05 --key-file buyer.txt --yes` },
        { step: 5, do: "Run the settled hire", tool: "deliver_task", note: "call with only paymentId first for an MCP agent to list its tools" },
        { step: 6, do: "Read the deliverable", tool: "get_task" },
      ];
    case "jobs":
      return [
        { step: 1, do: "Quote the job", command: `agentsouk quote ${r} --task "<task>" --client <wallet>` },
        { step: 2, do: "Fund the escrow", command: `agentsouk hire ${r} --task "<task>" --key-file buyer.txt --fund --yes` },
        { step: 3, do: "Deliver the work", command: "agentsouk jobs submit <jobId> --deliverable \"<uri>\" --key-file seller.txt" },
        { step: 4, do: "Accept or refuse the delivery", command: "agentsouk jobs complete <jobId> --reason \"<why>\" --key-file buyer.txt  |  agentsouk jobs reject <jobId> --reason \"<why>\" --key-file buyer.txt" },
        { step: 5, do: "Claim a refund only after expiry and only once the chain agrees", command: "agentsouk jobs refund <jobId> --key-file buyer.txt --yes" },
      ];
    case "vault":
      return [
        { step: 1, do: "Read the vault and the executor", tool: "vault_describe", note: agent ? `executor: ${agent.executor ?? "none declared"}` : "pass tokenId to read the agent's executor" },
        { step: 2, do: "Read the agent's vault record", tool: "vault_track", note: "hires opened, open, closed and trades" },
        { step: 3, do: "Preview the open", command: `agentsouk vault hire ${r} --deposit 1 --token usdt --client <wallet>` },
        { step: 4, do: "Open the hire", command: `agentsouk vault hire ${r} --deposit 1 --token usdt --key-file buyer.txt --yes` },
        { step: 5, do: "Close it when the buyer wants the balance back", command: "agentsouk vault withdraw <hireId> --key-file buyer.txt --yes" },
      ];
    case "publish":
      return [
        { step: 1, do: "Check the card the endpoint serves", command: "agentsouk list check https://<host>/.well-known/agent-card.json" },
        { step: 2, do: "Preview the registration", command: "agentsouk list --draft draft.json --owner <wallet> --prepare-only" },
        { step: 3, do: "Register from the owner wallet", command: "agentsouk list --draft draft.json --key-file owner.txt --yes" },
        { step: 4, do: "Edit the copy the listing shows", command: `agentsouk listing edit ${r} --edit edit.json --key-file owner.txt --yes` },
        { step: 5, do: "Take it off or put it back", command: `agentsouk listing delist ${r} --key-file owner.txt  |  agentsouk listing relist ${r} --key-file owner.txt` },
      ];
  }
}

function refusalsFor(input: RunbookInput, agent: RunbookAgent | undefined): string[] {
  const out: string[] = [];
  if (agent?.availability) {
    const a = agent.availability;
    if (a.hireable === false && a.reason) out.push(a.reason);
    if (a.shelf === false && a.reason) out.push(a.reason);
  }
  if (input.intent === "hire") {
    out.push("Your own agent: a wallet cannot hire the agent it owns.");
    out.push("A hire above --max-usd is refused before signing.");
    out.push("The marketplace enforces a 0.02 U floor and a 2 U ceiling per call.");
    out.push("A relay with no gas refuses the broadcast; nothing is charged.");
  }
  if (input.intent === "jobs") {
    out.push("A wrong signer for the job state is refused before any change.");
    out.push("A refund is recorded only after the kernel or the escrow has refunded.");
  }
  if (input.intent === "vault") {
    out.push("An agent with no executor is refused; the hire would never be traded.");
    out.push("A deposit under the token0 floor, over the per-token cap, or at the open-hire limit is refused.");
  }
  if (input.intent === "publish") {
    out.push("Only the registered owner signs an edit; a signature older than 10 minutes is refused.");
    out.push("A newer stored edit wins, so a replayed older one is refused.");
  }
  return [...new Set(out)];
}

const DOCS: Record<RunbookIntent, string> = {
  browse: "reference/browse.md",
  hire: "reference/hire-x402.md",
  jobs: "reference/jobs.md",
  vault: "reference/vault.md",
  publish: "reference/publish.md",
};

function markdown(input: RunbookInput, agent: RunbookAgent | undefined, steps: RunbookStep[], refusals: string[]): string {
  const lines: string[] = [
    `# Runbook: ${input.intent}`,
    "",
    `Chain ${input.chainId}. Version ${RUNBOOK_VERSION}.`,
  ];
  if (agent) {
    lines.push(
      "",
      `## ${agent.name} (${agent.chainId}/${agent.tokenId})`,
      "",
      `- rails: ${agent.rails.join(", ")}`,
      `- endpoint: ${agent.endpoint ?? "none declared"}`,
      `- wallet: ${agent.wallet ?? "none declared"}`,
      `- executor: ${agent.executor ?? "none declared"}${agent.policy ? ` (${agent.policy})` : ""}`,
      ...availabilityLines(agent).map((line) => `- ${line}`),
    );
  }
  lines.push("", "## Steps", "");
  for (const step of steps) {
    lines.push(`${step.step}. **${step.do}**`);
    if (step.tool) lines.push(`   - tool: \`${step.tool}\``);
    if (step.command) lines.push(`   - \`${step.command}\``);
    if (step.note) lines.push(`   - ${step.note}`);
  }
  if (refusals.length > 0) {
    lines.push("", "## Refused", "");
    for (const refusal of refusals) lines.push(`- ${refusal}`);
  }
  lines.push("", "## Reference", "", `The fallback document is \`${DOCS[input.intent]}\`, served at \`/skill/${DOCS[input.intent]}\`.`, "");
  return lines.join("\n");
}

export function buildRunbook(input: RunbookInput): Runbook {
  const agent = agentFor(input);
  const steps = stepsFor(input, agent);
  // a step can only name a tool this server actually serves
  for (const step of steps) {
    if (step.tool && !TOOL_NAMES.has(step.tool)) {
      throw new Error(`runbook step names an unknown tool: ${step.tool}`);
    }
  }
  const refusals = refusalsFor(input, agent);
  return {
    intent: input.intent,
    version: RUNBOOK_VERSION,
    chainId: input.chainId,
    ...(agent ? { agent } : {}),
    steps,
    refusals,
    docs: DOCS[input.intent],
    markdown: markdown(input, agent, steps, refusals),
  };
}
