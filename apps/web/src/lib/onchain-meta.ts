// registry metadata values arrive as the raw bytes the owner wrote, hex encoded;
// most are UTF-8 text, so show the text and keep the hex only when it is not

export function decodeMetaValue(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value)
  if (!/^0x([0-9a-fA-F]{2})+$/.test(value)) return value
  // a 20-byte value is an address, which reads better as hex than as garbled text
  if (value.length === 42) return value
  const bytes = new Uint8Array((value.length - 2) / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(2 + i * 2, 4 + i * 2), 16)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return /^[\x20-\x7e -￿\n\t]+$/.test(text) ? text : value
  } catch {
    return value
  }
}

// BUILT_WITH names the toolkit as a repository link with the version as its fragment
export function builtWithFrom(
  onchain: { key: string; value: unknown }[],
): { label: string; href: string | null } | null {
  const entry = onchain.find((m) => /^built_?with$/i.test(m.key))
  if (!entry) return null
  const text = decodeMetaValue(entry.value)
  const m = /^https?:\/\/github\.com\/[^/]+\/([^/#?]+)(?:#(.+))?$/.exec(text)
  if (m) return { label: m[2] ? `${m[1]} ${m[2]}` : m[1], href: text.split('#')[0] }
  return { label: text, href: /^https?:\/\//.test(text) ? text : null }
}
