// one assistant turn for any door: read the conversation, ask the brain, keep both sides

import "server-only";
import { askAssistant, type ModelEndpoint } from "./brain";
import { appendHistory, loadHistory } from "./history";

const MCP_URL = process.env.ASSISTANT_MCP_URL ?? "https://api.agentsouk.xyz/api/mcp";

// the larger groq model first, the smaller one on the same key when the larger is at its
// minute limit, then gemini, whose free tier is small and only a last resort
export function assistantEndpoints(env: NodeJS.ProcessEnv = process.env): ModelEndpoint[] {
  // the assistant's own settings come first, so the builder keeps whatever model it is given
  const groqBase = env.ASSISTANT_LLM_BASE_URL ?? env.BUILDER_LLM_BASE_URL ?? "";
  const groqKey = env.ASSISTANT_LLM_API_KEY ?? env.BUILDER_LLM_API_KEY ?? "";
  const geminiBase = env.LLM_EVAL_BASE_URL ?? "";
  const geminiKey = env.LLM_EVAL_API_KEY ?? "";
  return [
    { base: groqBase, key: groqKey, model: env.ASSISTANT_MODEL ?? "openai/gpt-oss-120b" },
    { base: groqBase, key: groqKey, model: env.ASSISTANT_FALLBACK_MODEL ?? "openai/gpt-oss-20b" },
    { base: geminiBase, key: geminiKey, model: env.LLM_EVAL_FALLBACK_MODEL ?? "" },
  ].filter((e) => e.base && e.key && e.model);
}

export async function assistantTurn(conversation: string, message: string, wallet: string | null): Promise<string> {
  const history = await loadHistory(conversation);
  const user = { role: "user" as const, content: message.slice(0, 1500) };
  let text: string;
  try {
    const reply = await askAssistant({ history: [...history, user], endpoints: assistantEndpoints(), mcpUrl: MCP_URL, wallet });
    text = reply.text;
  } catch {
    text = "I could not answer just now; the assistant is busy. Please try again in a minute.";
  }
  await appendHistory(conversation, [user, { role: "assistant", content: text }]).catch(() => {});
  return text;
}
