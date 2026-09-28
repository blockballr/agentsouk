// The in-page WebMCP surface: the browser-side counterpart to the MCP server at
// /api/mcp. Tool names, titles, descriptions and JSON schemas mirror
// src/lib/mcp-tools.ts, the server's single source of truth. That module cannot be
// imported here: it resolves through the Next.js "@/lib" alias and reads server
// config, while this file ships in the Vite bundle. tests/test-webmcp.ts pins the
// mirror against MCP_TOOLS so the two surfaces cannot drift apart.
//
// This page is not the server and holds no key. Read-only tools call the same
// public routes the UI calls. start_hire can only relay a payment that the buyer's
// own wallet already signed: it never signs for the visitor and never moves funds.

import { CATEGORIES, CATEGORY_KEYS } from '@agora/core'
import {
  deliverTask,
  getAgentDetail,
  getAgents,
  getHireRequirements,
  getTask,
  settleHire,
} from './api'
import type { DeliverBody, SettleBody } from './api'
import { settlementAssetFor } from './contracts'
import { getTargetChain } from './wallet'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface WebMcpToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export type WebMcpToolHandler = (args: Record<string, unknown>) => Promise<WebMcpToolResult>

export interface WebMcpToolDescriptor {
  name: string
  title: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties: false
  }
  annotations?: {
    readOnlyHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export interface WebMcpTool extends WebMcpToolDescriptor {
  execute: WebMcpToolHandler
}

// The subset of document.modelContext this module uses. The API is early and only
// some browsers expose it; registerTool is the one member the spec fixes today.
export interface WebMcpModelContextLike {
  registerTool: (tool: WebMcpTool) => unknown
}

const CATEGORY_VALUES = ['all', ...CATEGORY_KEYS, 'general']
const SORTS = ['score', 'newest', 'feedback', 'health', 'reachability']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asSort(value: unknown): 'score' | 'newest' | 'feedback' | 'health' | 'reachability' | undefined {
  const sort = asString(value)
  return sort && SORTS.includes(sort) ? (sort as 'score' | 'newest' | 'feedback' | 'health' | 'reachability') : undefined
}

function textResult(text: string): WebMcpToolResult {
  return { content: [{ type: 'text', text }] }
}

function jsonResult(value: unknown): WebMcpToolResult {
  return textResult(JSON.stringify(value, null, 2))
}

function errorResult(text: string): WebMcpToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function withError(handler: WebMcpToolHandler): WebMcpToolHandler {
  return async (args) => {
    try {
      return await handler(args)
    } catch (e) {
      return errorResult((e as Error)?.message || 'The tool call failed.')
    }
  }
}

function networkChainId(requirements: Record<string, unknown>): number | undefined {
  const network = asString(requirements.network)
  if (!network) return undefined
  const parsed = Number.parseInt(network.split(':')[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

// Read the signature out of an EIP-3009 authorization without trusting the caller.
// A payload with no real signature is refused before it reaches the settle route.
function readAuthorizationSignature(payment: Record<string, unknown>): string | null {
  const body = payment.payload
  if (!isRecord(body)) return null
  const authorization = body.authorization
  if (!isRecord(authorization)) return null
  return asString(authorization.signature) ?? null
}

function isSignatureHex(signature: string): boolean {
  // 64-byte (EIP-2098 compact) or 65-byte r||s||v signatures only
  return /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)
}

function defaultChainId(): number {
  return getTargetChain()
}

export const WEBMCP_TOOLS: WebMcpTool[] = [
  {
    name: 'list_categories',
    title: 'List agent categories',
    description:
      'List the four marketplace categories (rebalancing, grid-trading, yield, health-factor) with their labels and the live number of listed agents in each. Use the key to filter list_agents. Agents that fit none of the four are listed under category general.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: withError(async () => {
      const result = await getAgents({ limit: 1 })
      return jsonResult({
        chainId: result.chainId ?? defaultChainId(),
        categories: CATEGORIES.map((category) => ({
          key: category.key,
          label: category.label,
          short: category.short,
          description: category.description,
          blurb: category.blurb,
          agentCount: result.counts[category.key] ?? 0,
        })),
        note: 'Pass a key as the category filter to list_agents. Agents that fit none of the four appear under category general.',
      })
    }),
  },
  {
    name: 'list_agents',
    title: 'List agents',
    description:
      'List marketplace agents, optionally filtered by category and text, with their verification status, score and callable endpoints. Returns up to limit agents per page (default 24, maximum 60) plus category counts.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: CATEGORY_VALUES,
          description: 'Category key to filter by. Defaults to all.',
        },
        q: {
          type: 'string',
          description: 'Free text search over name and description.',
        },
        sort: {
          type: 'string',
          enum: ['score', 'newest', 'feedback', 'health', 'reachability'],
          description: 'Ranking. Defaults to score.',
        },
        page: {
          type: 'integer',
          minimum: 1,
          description: '1-based page number. Defaults to 1.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 60,
          description: 'Agents per page. Defaults to 24.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: withError(async (args) => {
      const result = await getAgents({
        category: asString(args.category),
        q: asString(args.q),
        sort: asSort(args.sort),
        page: asNumber(args.page),
        limit: asNumber(args.limit),
      })
      return jsonResult(result)
    }),
  },
  {
    name: 'get_agent',
    title: 'Get one agent',
    description:
      "Get one agent's full registry detail, including its verification status (delivered, gated, stale or unreachable), score, owner, agent wallet, and its MCP or A2A endpoint if it has one. Call this before hiring to learn how the agent is invoked.",
    inputSchema: {
      type: 'object',
      properties: {
        tokenId: {
          type: 'string',
          description: 'The ERC-8004 token id of the agent.',
        },
        chainId: {
          type: 'integer',
          description: 'Chain id. Defaults to the chain this deployment serves.',
        },
      },
      required: ['tokenId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: withError(async (args) => {
      const tokenId = asString(args.tokenId)
      if (!tokenId) return errorResult('tokenId is required.')
      const chainId = asNumber(args.chainId) ?? defaultChainId()
      const detail = await getAgentDetail(String(chainId), tokenId)
      if (!detail) return errorResult(`No agent ${tokenId} on chain ${chainId}.`)
      return jsonResult({ data: detail })
    }),
  },
  {
    name: 'get_hire_requirements',
    title: 'Prepare a hire',
    description:
      'Prepare a paid session with one agent. Returns the x402 paymentRequirements (asset, amount, payTo and EIP-712 domain) and a paymentId. The caller must already have a wallet funded with that settlement token. Sign the requirements as an EIP-3009 transferWithAuthorization with that wallet, then call start_hire with the signed payload. The marketplace never signs and never holds the funds.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenId: {
          type: 'string',
          description: 'The ERC-8004 token id of the agent to hire.',
        },
        chainId: {
          type: 'integer',
          description: 'Chain id. Defaults to the chain this deployment serves.',
        },
        amountUsd: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Session price in USD. Defaults to the marketplace price.',
        },
        client: {
          type: 'string',
          description: 'The buyer wallet address that will sign the authorization.',
        },
      },
      required: ['tokenId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    execute: withError(async (args) => {
      const tokenId = asString(args.tokenId)
      if (!tokenId) return errorResult('tokenId is required.')
      // The page wrapper takes chain, token and client; it has no amountUsd, so a
      // custom price is refused here rather than silently dropped.
      if (asNumber(args.amountUsd) !== undefined) {
        return errorResult(
          'This page prepares a hire at the marketplace price. A custom amountUsd is only available through the server MCP endpoint at /api/mcp.',
        )
      }
      const chainId = asNumber(args.chainId) ?? defaultChainId()
      const client = asString(args.client)
      const data = await getHireRequirements(String(chainId), tokenId, client)
      const requirements = data.paymentRequirements
      return jsonResult({
        paymentId: data.preview.paymentId ?? null,
        paymentRequirements: requirements,
        agent: data.agent,
        sign: {
          schema: 'eip3009 transferWithAuthorization',
          domain: {
            name: requirements.extra?.name ?? null,
            version: requirements.extra?.version ?? null,
            chainId: networkChainId(requirements as unknown as Record<string, unknown>) ?? null,
            verifyingContract: requirements.asset ?? null,
          },
          fields: {
            from: client ?? 'the buyer wallet that signs',
            to: requirements.payTo ?? null,
            value: requirements.amount ?? null,
            validAfter: 'unix seconds, for example now minus 60',
            validBefore: 'unix seconds, for example now plus maxTimeoutSeconds',
            nonce: 'random 32 bytes as 0x hex',
          },
        },
        next: 'Sign locally with the buyer wallet, then call start_hire with paymentRequirements and the signed paymentPayload.',
      })
    }),
  },
  {
    name: 'start_hire',
    title: 'Start a hire',
    description:
      "Start a hire by submitting an already signed EIP-3009 transferWithAuthorization, exactly as the browser does. Supply the paymentRequirements returned by get_hire_requirements and a paymentPayload signed by the buyer's own wallet. The marketplace verifies and relays the authorization; it cannot move buyer funds and does not accept a private key. On success a settled session and a hire task are opened. Call deliver_task next to run the task.",
    inputSchema: {
      type: 'object',
      properties: {
        tokenId: {
          type: 'string',
          description: 'The ERC-8004 token id of the agent being hired.',
        },
        paymentRequirements: {
          type: 'object',
          description:
            'The exact paymentRequirements object returned by get_hire_requirements.',
        },
        paymentPayload: {
          type: 'object',
          description:
            'The buyer-signed EIP-3009 payload. payload.authorization carries from, to, value, validAfter, validBefore, nonce and signature, plus resource and accepted.',
        },
        paymentId: {
          type: 'string',
          description: 'The paymentId returned by get_hire_requirements, echoed into the receipt.',
        },
        chainId: {
          type: 'integer',
          description: 'Chain id. Defaults to the network in paymentRequirements.',
        },
        amountUsd: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Session price in USD, matching the signed value.',
        },
      },
      required: ['tokenId', 'paymentRequirements', 'paymentPayload'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    execute: withError(async (args) => {
      const tokenId = asString(args.tokenId)
      const requirements = isRecord(args.paymentRequirements) ? args.paymentRequirements : null
      const payment = isRecord(args.paymentPayload) ? args.paymentPayload : null
      if (!tokenId) return errorResult('tokenId is required.')
      if (!requirements) {
        return errorResult(
          'paymentRequirements is required and must be the object returned by get_hire_requirements.',
        )
      }
      if (!payment) {
        return errorResult(
          "paymentPayload is required and must be signed by the buyer's own wallet. This page cannot sign for the visitor and cannot spend their funds, so there is nothing it can settle on its own.",
        )
      }
      // The page is a relay, not a signer. A payload without a real signature is
      // refused here, with the next step, rather than passed to the settle route.
      const signature = readAuthorizationSignature(payment)
      if (!signature || !isSignatureHex(signature)) {
        return errorResult(
          "This page cannot sign a payment for the visitor. start_hire needs a paymentPayload already signed by the buyer's own wallet with EIP-3009 transferWithAuthorization. Ask the visitor to sign it locally, then retry, or use the server MCP endpoint at /api/mcp.",
        )
      }
      const chainId = asNumber(args.chainId) ?? networkChainId(requirements) ?? defaultChainId()
      const detail = await getAgentDetail(String(chainId), tokenId)
      const name = detail?.name ?? 'Agent'
      const symbol = settlementAssetFor(chainId)?.symbol ?? 'U'
      const settled = (await settleHire({
        paymentId: asString(args.paymentId) ?? '',
        paymentRequirements: requirements as unknown as SettleBody['paymentRequirements'],
        paymentPayload: payment as unknown as SettleBody['paymentPayload'],
        agent: { chainId, tokenId, name, symbol },
      })) as unknown as {
        success: boolean
        paymentId?: string
        txHash?: string
        error?: string
        details?: unknown
        taskId?: string
        jobId?: string
        jobStatus?: string
      }
      if (!settled.success) return errorResult(settled.error ?? 'Settlement failed.')
      return jsonResult({
        settled: true,
        paymentId: settled.paymentId ?? null,
        txHash: settled.txHash ?? null,
        taskId: settled.taskId ?? null,
        jobId: settled.jobId ?? null,
        jobStatus: settled.jobStatus ?? null,
        details: settled.details ?? null,
        next: 'The session is settled and a hire task is open. Call deliver_task with paymentId to run it, then get_task to read the deliverable.',
      })
    }),
  },
  {
    name: 'deliver_task',
    title: 'Run a settled hire',
    description:
      "Run a hire whose session is already settled and return the agent's deliverable. For an MCP agent, call with only paymentId first to list the agent's tools, then call again with tool and args. For an A2A agent, pass task text. Pass input when the agent requires a structured input object, which is what agents reading a data part expect. A task cannot run before its session is settled.",
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: {
          type: 'string',
          description: 'The settled payment id from start_hire.',
        },
        tool: {
          type: 'string',
          description: 'For an MCP agent, the tool name to call.',
        },
        args: {
          type: 'object',
          description: 'For an MCP agent, the arguments for that tool.',
        },
        task: {
          type: 'string',
          description: 'For an A2A agent, the task text to send.',
        },
        input: {
          type: 'object',
          description:
            'Structured input for agents that require it. Must be a plain JSON object.',
        },
      },
      required: ['paymentId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    execute: withError(async (args) => {
      const paymentId = asString(args.paymentId)
      if (!paymentId) {
        return errorResult('paymentId is required. Settle a session with start_hire first.')
      }
      const body: DeliverBody = { paymentId }
      const tool = asString(args.tool)
      if (tool) body.tool = tool
      if (isRecord(args.args)) body.args = args.args
      const task = asString(args.task)
      if (task) body.task = task
      if (isRecord(args.input)) body.input = args.input
      const data = await deliverTask(body)
      return jsonResult({ ...data, next: 'Read the stored task and deliverable with get_task.' })
    }),
  },
  {
    name: 'get_task',
    title: 'Read a task and its deliverable',
    description:
      'Read one hire task by id: its status, protocol, error and the deliverable text in result. Use it after deliver_task, to poll a running task, or to check whether a retry is allowed.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The task id returned by start_hire or deliver_task.',
        },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: withError(async (args) => {
      const taskId = asString(args.taskId)
      if (!taskId) return errorResult('taskId is required.')
      const bundle = await getTask(taskId)
      if (!bundle) return errorResult(`No task ${taskId}.`)
      return jsonResult(bundle)
    }),
  },
  {
    name: 'list_hires',
    title: "List a wallet's hires",
    description:
      'List the settled sessions for one wallet address, newest first, with the agent, category, spend cap, expiry and transaction hash. Only sessions that were actually settled and activated are returned.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: {
          type: 'string',
          description: 'The buyer wallet address, 0x followed by 40 hex characters.',
        },
      },
      required: ['wallet'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: withError(async (args) => {
      const wallet = asString(args.wallet)
      if (!wallet) return errorResult('wallet is required.')
      // No api.ts wrapper reads hires by wallet, so this is the one route called
      // directly; it is the same public endpoint the server MCP tool calls.
      const res = await fetch(`${BASE}/hires/by-wallet?wallet=${encodeURIComponent(wallet)}`)
      const raw = await res.text().catch(() => '')
      let parsed: unknown = null
      if (raw) {
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = null
        }
      }
      if (!res.ok) {
        const message =
          isRecord(parsed) && typeof parsed.error === 'string'
            ? parsed.error
            : `hires returned ${res.status}`
        return errorResult(message)
      }
      if (parsed === null) return errorResult('hires returned no readable answer')
      return jsonResult(parsed)
    }),
  },
]

// One registration per model context. The spec rejects a duplicate name, so a
// remount (or React strict mode) must not try again; a WeakSet keyed on the
// context keeps that state without leaking and without a module-level reset.
const registeredContexts = new WeakSet<object>()

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(value) && typeof (value as { catch?: unknown }).catch === 'function'
}

// document.modelContext is canonical. navigator.modelContext is a deprecated alias
// some earlier implementations still expose, so it is honoured as a fallback.
function detectModelContext(): WebMcpModelContextLike | null {
  if (typeof document !== 'undefined') {
    const ctx = (document as Document & { modelContext?: WebMcpModelContextLike }).modelContext
    if (ctx && typeof ctx.registerTool === 'function') return ctx
  }
  if (typeof navigator !== 'undefined') {
    const ctx = (navigator as Navigator & { modelContext?: WebMcpModelContextLike }).modelContext
    if (ctx && typeof ctx.registerTool === 'function') return ctx
  }
  return null
}

/**
 * Registers the marketplace tool surface with the browser's model context, if the
 * browser has one. Returns true when this call performed the registration and
 * false when there was no WebMCP API or it was already registered. A browser
 * without modelContext gets no work, no error and no log.
 */
export function registerWebMcpTools(context?: WebMcpModelContextLike | null): boolean {
  const modelContext = context ?? detectModelContext()
  if (!modelContext || typeof modelContext.registerTool !== 'function') return false
  if (registeredContexts.has(modelContext)) return false
  registeredContexts.add(modelContext)
  for (const tool of WEBMCP_TOOLS) {
    try {
      const result = modelContext.registerTool(tool)
      if (isPromiseLike(result)) result.catch(() => {})
    } catch {
      // a duplicate name or an implementation that rejects synchronously must never break the page
    }
  }
  return true
}
