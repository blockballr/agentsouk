// The marketplace's shared notification outbox. Whatever pipeline causes an
// event for a wallet writes one row here, and the bell reads them all, so
// escrow, jobs, and later the builder share one surface instead of each
// growing its own banner. The row records what already happened; the chain
// remains the source of truth for anything about money.
import "server-only";

import { randomUUID } from "node:crypto";
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotification,
} from "./durable-store";

export type NotificationKind =
  | "escrow_released"
  | "escrow_refunded"
  | "job_funded"
  | "job_submitted"
  | "job_completed"
  | "job_rejected"
  | "job_expired"
  | "quote_ready"
  | "seller_no_ack"
  | "topup_needed"
  | "deploy_live"
  | "deploy_failed"
  | "build_minutes_low"
  | "trial_expiring"
  | "plan_changed";

export interface Notification {
  id: string;
  wallet: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** the surface to land on when the bell opens this row */
  href?: string;
  /** set by the emitters that can derive one, e.g. an escrow tx hash */
  txHash?: string;
  read?: boolean;
  createdAt: string;
}

// one emitter per event, all through here: the id is derived from the kind and
// the event's own key, so a retried sweep or a double settle writes the same
// row twice and the insert's on-conflict-nothing makes the second a no-op
export async function emitNotification(input: {
  wallet: string;
  kind: NotificationKind;
  eventKey: string;
  title: string;
  body: string;
  href?: string;
  txHash?: string;
}): Promise<Notification> {
  const id = `ntf_${input.kind}_${input.eventKey}`.slice(0, 120);
  const notification: Notification = {
    id,
    wallet: input.wallet.toLowerCase(),
    kind: input.kind,
    title: input.title,
    body: input.body,
    ...(input.href ? { href: input.href } : {}),
    ...(input.txHash ? { txHash: input.txHash } : {}),
    createdAt: new Date().toISOString(),
  };
  await saveNotification(notification);
  return notification;
}

export async function notificationsFor(wallet: string): Promise<Notification[]> {
  return loadNotifications(wallet);
}

export async function readNotification(wallet: string, id: string): Promise<void> {
  await markNotificationRead(wallet, id);
}

export async function readAllNotifications(wallet: string): Promise<void> {
  await markAllNotificationsRead(wallet);
}

export function randomNotificationId(): string {
  return randomUUID();
}
