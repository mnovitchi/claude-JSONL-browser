import { renderSafeText } from './renderSafeText'

const DEFAULT_BASE64_MIN_LENGTH = 128
const DEFAULT_LONG_STRING_MIN_LENGTH = 4000
const OPAQUE_DATA_KEYS = new Set(['data', 'base64', 'image_data', 'imageData'])

interface SafeOriginalOptions {
  base64MinLength?: number
  longStringMinLength?: number
}

interface RedactionResult {
  value: unknown
  changed: boolean
}

export function renderSafeOriginal(input: string, options: SafeOriginalOptions = {}): string {
  const base64MinLength = options.base64MinLength ?? DEFAULT_BASE64_MIN_LENGTH
  const longStringMinLength = options.longStringMinLength ?? DEFAULT_LONG_STRING_MIN_LENGTH

  return input
    .split(/\r?\n/)
    .map((line) => renderSafeLine(line, { base64MinLength, longStringMinLength }))
    .join('\n')
}

function renderSafeLine(
  line: string,
  options: {
    base64MinLength: number
    longStringMinLength: number
  },
): string {
  if (!line.trim()) return line

  try {
    const parsed = JSON.parse(line)
    const redacted = redactValue(parsed, undefined, options)
    return redacted.changed ? JSON.stringify(redacted.value) : line
  } catch {
    return redactBase64Runs(line, options.base64MinLength)
  }
}

function redactValue(
  value: unknown,
  key: string | undefined,
  options: {
    base64MinLength: number
    longStringMinLength: number
  },
): RedactionResult {
  if (typeof value === 'string') {
    if (shouldRedactBase64(value, key, options.base64MinLength)) {
      return {
        value: `[base64 omitted: ${value.length} chars]`,
        changed: true,
      }
    }

    if (isLargeOpaqueString(value, options.longStringMinLength)) {
      return {
        value: `[large string omitted: ${value.length} chars]`,
        changed: true,
      }
    }

    return { value, changed: false }
  }

  if (Array.isArray(value)) {
    let changed = false
    const redacted = value.map((item) => {
      const result = redactValue(item, undefined, options)
      changed ||= result.changed
      return result.value
    })

    return { value: redacted, changed }
  }

  if (!value || typeof value !== 'object') {
    return { value, changed: false }
  }

  let changed = false
  const redacted = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => {
      const result = redactValue(childValue, childKey, options)
      changed ||= result.changed
      return [childKey, result.value]
    }),
  )

  return { value: redacted, changed }
}

function shouldRedactBase64(value: string, key: string | undefined, minLength: number): boolean {
  if (!OPAQUE_DATA_KEYS.has(key || '')) return false
  return isLikelyBase64(value, minLength)
}

function isLikelyBase64(value: string, minLength: number): boolean {
  if (value.length < minLength) return false
  if (/\s/.test(value)) return false

  const base64Characters = value.match(/[A-Za-z0-9+/=_-]/g)?.length || 0
  return base64Characters / value.length > 0.98
}

function isLargeOpaqueString(value: string, minLength: number): boolean {
  if (value.length < minLength) return false
  if (/\s/.test(value)) return false
  if (value.includes('```')) return false

  const alphaNumericCharacters = value.match(/[A-Za-z0-9]/g)?.length || 0
  return alphaNumericCharacters / value.length > 0.9
}

function redactBase64Runs(line: string, minLength: number): string {
  if (minLength !== DEFAULT_BASE64_MIN_LENGTH) {
    return line.replace(/[A-Za-z0-9+/=_-]{128,}/g, (match) => {
      if (!isLikelyBase64(match, minLength)) return match
      return `[base64 omitted: ${match.length} chars]`
    })
  }

  return renderSafeText(line)
}
