// post-hire task store: one open task per settled payment, updated by delivery
// memory is the hot cache; postgres write-through when RECEIPTS_STORE=postgres

import "server-only";
import { randomUUID } from "node:crypto";
import { MAX_DELIVERY_ATTEMPTS, shouldRetry, retryDelayMs } from "./retry";
import { scoreDelivery, type QualityResult } from "./quality";
import { recordDeliveryMetric } from "./metrics";
import {
  insertHireTaskIfAbsent,
  loadHireTask,
  loadHireTaskByPayment,
  loadHireTasks,
  saveHireTask,
} from "./durable-store";

export type TaskStatus = "ready" | "running" | "delivered" | "failed" | "gated";

export interface TaskEvent {
  at: string;
  status: TaskStatus;
  note?: string;
}

export interface HireTask {
  id: string;
  paymentId: string;
  chainId: number;
  tokenId: string;
  agentName: string;
  status: TaskStatus;
  tool?: string;
  args?: Record<string, unknown>;
  taskText?: string;
  result?: string;
  error?: string;
  protocol?: "mcp" | "a2a";
  quality?: QualityResult;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  history: TaskEvent[];
}

const tasks = new Map<string, HireTask>();
const byPayment = new Map<string, string>();

function now(): string {
  return new Date().toISOString();
}

function pushEvent(task: HireTask, status: TaskStatus, note?: string): void {
  task.status = status;
  task.updatedAt = now();
  task.history.push({ at: task.updatedAt, status, note });
}

function cache(task: HireTask): HireTask {
  tasks.set(task.id, task);
  byPayment.set(task.paymentId, task.id);
  void saveHireTask(task);
  return task;
}

export interface TaskSeed {
  paymentId: string;
  chainId: number;
  tokenId: string;
  agentName: string;
}

function buildHireTask(input: TaskSeed): HireTask {
  return {
    id: randomUUID(),
    paymentId: input.paymentId,
    chainId: input.chainId,
    tokenId: input.tokenId,
    agentName: input.agentName,
    status: "ready",
    attempts: 0,
    maxAttempts: MAX_DELIVERY_ATTEMPTS,
    createdAt: now(),
    updatedAt: now(),
    history: [{ at: now(), status: "ready", note: "session settled" }],
  };
}

export function createHireTask(input: TaskSeed): HireTask {
  const existingId = byPayment.get(input.paymentId);
  if (existingId) {
    const existing = tasks.get(existingId);
    if (existing) return existing;
  }
  return cache(buildHireTask(input));
}

export async function getTaskAsync(taskId: string): Promise<HireTask | undefined> {
  const local = tasks.get(taskId);
  if (local) return local;
  const stored = await loadHireTask(taskId);
  if (stored) return cache(stored);
  return undefined;
}

export function getTask(taskId: string): HireTask | undefined {
  return tasks.get(taskId);
}

export async function getTaskByPaymentAsync(
  paymentId: string,
): Promise<HireTask | undefined> {
  const id = byPayment.get(paymentId);
  const local = id ? tasks.get(id) : undefined;
  if (local) return local;
  const stored = await loadHireTaskByPayment(paymentId);
  if (stored) return cache(stored);
  return undefined;
}

export function getTaskByPayment(paymentId: string): HireTask | undefined {
  const id = byPayment.get(paymentId);
  return id ? tasks.get(id) : undefined;
}

export function listTasksByPayment(paymentId: string): HireTask[] {
  const t = getTaskByPayment(paymentId);
  return t ? [t] : [];
}

export async function listTasks(limit = 50): Promise<HireTask[]> {
  const fromDb = await loadHireTasks(limit * 2);
  for (const t of fromDb) {
    if (!tasks.has(t.id)) cache(t);
  }
  return [...tasks.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function markTaskRunning(taskId: string, input: {
  tool?: string;
  args?: Record<string, unknown>;
  taskText?: string;
}): HireTask | undefined {
  const task = tasks.get(taskId);
  if (!task) return undefined;
  if (input.tool !== undefined) task.tool = input.tool;
  if (input.args !== undefined) task.args = input.args;
  if (input.taskText !== undefined) task.taskText = input.taskText;
  task.attempts += 1;
  pushEvent(task, "running");
  void saveHireTask(task);
  return task;
}

export function markTaskDelivered(taskId: string, input: {
  result: string;
  protocol?: "mcp" | "a2a";
  tool?: string;
  args?: Record<string, unknown>;
  taskText?: string;
}): HireTask | undefined {
  const task = tasks.get(taskId);
  if (!task) return undefined;
  if (input.tool !== undefined) task.tool = input.tool;
  if (input.args !== undefined) task.args = input.args;
  if (input.taskText !== undefined) task.taskText = input.taskText;
  task.result = input.result;
  task.protocol = input.protocol;
  task.error = undefined;
  task.quality = scoreDelivery(input.result);
  pushEvent(task, "delivered");
  recordDeliveryMetric(task.tokenId, "delivered", task.quality.score);
  void saveHireTask(task);
  return task;
}

export function markTaskFailed(taskId: string, error: string, extra?: {
  protocol?: "mcp" | "a2a";
  gated?: boolean;
}): HireTask | undefined {
  const task = tasks.get(taskId);
  if (!task) return undefined;
  task.error = error;
  task.protocol = extra?.protocol ?? task.protocol;
  const status: TaskStatus = extra?.gated ? "gated" : "failed";
  pushEvent(task, status, error);
  recordDeliveryMetric(task.tokenId, status === "gated" ? "gated" : "failed");
  void saveHireTask(task);
  return task;
}

export function canRetry(task: HireTask): boolean {
  return task.status === "failed" && shouldRetry(task.attempts, task.maxAttempts);
}

export function nextRetryDelayMs(task: HireTask): number {
  return retryDelayMs(task.attempts);
}

// ensure a task exists for a payment (settle creates it; deliver can recover).
// The durable store is consulted before creating so a second instance adopts
// the existing row, and the conditional insert closes the create/create race
// when a unique index on payment_id is in place.
export async function ensureTaskForPayment(input: TaskSeed): Promise<HireTask> {
  const local = getTaskByPayment(input.paymentId);
  if (local) return local;

  const stored = await loadHireTaskByPayment(input.paymentId);
  if (stored) return cache(stored);

  const candidate = buildHireTask(input);
  const inserted = await insertHireTaskIfAbsent(candidate);
  if (inserted) return cache(inserted);

  // either another instance won the race, or the unique index is not in place
  // yet because the pre-existing duplicates have not been cleaned up
  const winner = await loadHireTaskByPayment(input.paymentId);
  if (winner) return cache(winner);
  return cache(candidate);
}
