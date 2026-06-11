const DATA_URI_BASE64_PATTERN = /(data:[\w.+-]+\/[\w.+-]+;base64,)([A-Za-z0-9+/=]+)/g
const BASE64_RUN_PATTERN = /[A-Za-z0-9+/=_-]{128,}/g
const LONG_OPAQUE_RUN_PATTERN = /\b[A-Za-z0-9]{4000,}\b/g
const DEFAULT_BASE64_MIN_LENGTH = 128

export function renderSafeText(input: string): string {
  return input
    .replace(DATA_URI_BASE64_PATTERN, (_match, prefix, data) => `${prefix}[base64 omitted: ${data.length} chars]`)
    .replace(LONG_OPAQUE_RUN_PATTERN, (match) => `[large string omitted: ${match.length} chars]`)
    .replace(BASE64_RUN_PATTERN, (match) => {
      if (!isLikelyBase64(match, DEFAULT_BASE64_MIN_LENGTH)) return match
      return `[base64 omitted: ${match.length} chars]`
    })
}

function isLikelyBase64(value: string, minLength: number): boolean {
  if (value.length < minLength) return false
  if (/\s/.test(value)) return false

  const base64Characters = value.match(/[A-Za-z0-9+/=_-]/g)?.length || 0
  return base64Characters / value.length > 0.98
}
