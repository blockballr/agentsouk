// The job branch's authority is the card, so prepare asks it one question: does it declare the
// ERC-8183 job protocol? One bounded fetch, answered as itself: verified, unverified, or
// unreachable. A timeout fails closed into unverified rather than hanging the registration path,
// and verified stays what it is: one fetch at one moment, not a promise about the next.

import { takesJobs } from "@agora/core";
import { privateEndpointReason } from "./endpoint";

export type JobCardState = "verified" | "unverified" | "unreachable";

export interface JobCardCheck {
  state: JobCardState;
  detail: string;
}

const FETCH_TIMEOUT_MS = 4000;

interface CardSkill {
  id?: string;
  name?: string;
  description?: string;
}

// timeoutMs is a parameter only so a test can prove the bound without waiting on it
export async function jobCardCheck(
  endpoint: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<JobCardCheck> {
  const refused = privateEndpointReason(endpoint);
  if (refused) {
    return {
      state: "unreachable",
      detail: `Unreachable: ${refused}, so the card was never fetched.`,
    };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: ctl.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        state: "unverified",
        detail: `Unverified: the endpoint answered with HTTP ${res.status} instead of an agent card, so the job protocol could not be confirmed. Nothing was sent.`,
      };
    }
    const card = (await res.json().catch(() => null)) as { skills?: CardSkill[] } | null;
    if (!card || !Array.isArray(card.skills) || card.skills.length === 0) {
      return {
        state: "unverified",
        detail:
          "Unverified: the reply is not an agent card with skills to read, so the job protocol is not declared. Nothing was sent.",
      };
    }
    if (!takesJobs(card.skills)) {
      return {
        state: "unverified",
        detail:
          "Unverified: the card declares skills but no ERC-8183 job protocol (no notify_funded step, and no negotiate step naming 8183), so this agent does not sell by job. Register by call instead, or add the protocol to the card first. Nothing was sent.",
      };
    }
    return {
      state: "verified",
      detail:
        "Fetched at prepare: the card declares the ERC-8183 job protocol. One check at this moment; the shelf re-reads the card on every visit.",
    };
  } catch {
    if (ctl.signal.aborted) {
      const seconds = Math.max(1, Math.round(timeoutMs / 1000));
      return {
        state: "unverified",
        detail: `Unverified: no answer within ${seconds} second${
          seconds === 1 ? "" : "s"
        }, so the job protocol could not be confirmed. Nothing was sent; try again when the endpoint answers.`,
      };
    }
    return {
      state: "unreachable",
      detail:
        "Unreachable: the server could not reach the endpoint (a network failure), so the job protocol could not be confirmed. Nothing was sent; try again later.",
    };
  } finally {
    clearTimeout(timer);
  }
}
