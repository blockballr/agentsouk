// validation for listing review requests. pure: no server imports, so the
// repo's node-based checks can exercise it directly.

export interface ListingRequestInput {
  tokenId: string;
  contact: string;
  note: string;
}

export interface ListingRequestValidation {
  ok: boolean;
  errors: string[];
}

const MAX_NOTE_LENGTH = 500;

export function validateListingRequest(input: ListingRequestInput): ListingRequestValidation {
  const errors: string[] = [];
  const tokenId = (input.tokenId ?? '').trim();
  const contact = (input.contact ?? '').trim();
  const note = input.note ?? '';

  if (!tokenId) {
    errors.push('Token id is required.');
  } else if (!/^\d+$/.test(tokenId)) {
    errors.push('Token id must be a number.');
  }

  if (!contact) {
    errors.push('A contact (email or handle) is required.');
  }

  if (note.length > MAX_NOTE_LENGTH) {
    errors.push(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }

  return { ok: errors.length === 0, errors };
}
