// The message a visitor signs to have the marketplace mint test tokens, from one shared builder.

export const MINT_REQUEST_DOMAIN = 'Agent Souk test tokens'

export interface MintRequestFields {
  address: string
  amount: string
  nonce: string
  expires: number
}

/** Canonical text to sign: field order and separators are part of the signature. */
export function mintRequestMessage(f: MintRequestFields): string {
  return [
    `${MINT_REQUEST_DOMAIN}`,
    `address: ${f.address.toLowerCase()}`,
    `amount: ${f.amount}`,
    `nonce: ${f.nonce}`,
    `expires: ${f.expires}`,
  ].join('\n')
}

export function isMintRequestExpired(f: MintRequestFields, nowSeconds: number): boolean {
  return !Number.isFinite(f.expires) || f.expires <= nowSeconds
}

/** Why a request is malformed, or null when it is shaped correctly. */
export function validateMintRequest(body: unknown): {
  error: string
  fields?: MintRequestFields
} {
  const b = (body ?? {}) as Record<string, unknown>
  const address = typeof b.address === 'string' ? b.address : ''
  const amount = typeof b.amount === 'string' ? b.amount : ''
  const nonce = typeof b.nonce === 'string' ? b.nonce : ''
  const expires = Number(b.expires)
  const signature = typeof b.signature === 'string' ? b.signature : ''

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { error: 'address must be a 20 byte hex address' }
  if (!/^[0-9]+$/.test(amount) || amount === '0') return { error: 'amount must be a positive integer in the token base unit' }
  // opaque but bounded: it is echoed into a signed message, so no newlines
  if (!/^[A-Za-z0-9._:-]{8,64}$/.test(nonce)) {
    return { error: 'nonce must be 8 to 64 characters of letters, digits, dot, colon, dash or underscore' };
  }
  if (!Number.isFinite(expires)) return { error: 'expires must be a unix timestamp in seconds' }
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return { error: 'signature must be hex' }

  return { error: '', fields: { address, amount, nonce, expires } }
}
