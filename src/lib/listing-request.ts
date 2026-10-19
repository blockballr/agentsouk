// validation for listing review requests. pure: no server imports, so the
// repo's node-based checks can exercise it directly.

export interface ListingRequestInput {
  tokenId: string;
  email: string;
  telegram: string;
  note: string;
}

export interface ListingRequestValidation {
  ok: boolean;
  errors: string[];
}

const MAX_NOTE_LENGTH = 500;
// deliberately plain: one at-sign, one dot after it, no spaces. The address is
// only used to reply, so a permissive check beats refusing a valid mailbox.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Telegram usernames are 5 to 32 letters, numbers or underscores, with an
// optional leading @ that the store keeps for display.
const TELEGRAM = /^@?[a-zA-Z0-9_]{5,32}$/;

export function validateListingRequest(input: ListingRequestInput): ListingRequestValidation {
  const errors: string[] = [];
  const tokenId = (input.tokenId ?? '').trim();
  const email = (input.email ?? '').trim();
  const telegram = (input.telegram ?? '').trim();
  const note = input.note ?? '';

  if (!tokenId) {
    errors.push('Token id is required.');
  } else if (!/^\d+$/.test(tokenId)) {
    errors.push('Token id must be a number.');
  }

  if (!telegram) {
    errors.push('A Telegram handle is required so we can reply.');
  } else if (!TELEGRAM.test(telegram)) {
    errors.push('A Telegram handle is 5 to 32 letters, numbers or underscores.');
  }

  if (email && !EMAIL.test(email)) {
    errors.push('That email does not look like an address we can reply to.');
  }

  if (note.length > MAX_NOTE_LENGTH) {
    errors.push(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }

  return { ok: errors.length === 0, errors };
}
