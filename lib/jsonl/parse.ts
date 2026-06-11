import type {
  EventDetail,
  ParseOptions,
  ParseResult,
  RawPreservedRecord,
  SidecarReference,
  TranscriptEvent,
} from './types'

interface ParsedLine {
  lineNumber: number
  rawLine: string
  record?: any
  error?: string
}

const METADATA_ONLY_TYPES = new Set(['queue-operation', 'file-history-snapshot'])

export function parseClaudeJsonl(input: string, options: ParseOptions = {}): ParseResult {
  const parsedLines = parseLines(input)
  const events: TranscriptEvent[] = []
  const rawRecords: RawPreservedRecord[] = []
  const sidecars: SidecarReference[] = []
  const warnings: string[] = []
  let session: ParseResult['session']

  parsedLines.forEach((parsed) => {
    if (!parsed.record) {
      rawRecords.push({
        lineNumber: parsed.lineNumber,
        recordType: 'invalid-json',
        reason: parsed.error || 'Invalid JSON line',
        raw: parsed.rawLine,
      })
      return
    }

    const record = parsed.record
    session = session || extractSession(record)
    const event = recordToEvent(record, parsed.lineNumber, options, sidecars, warnings)

    if (event) {
      events.push(event)
      return
    }

    rawRecords.push({
      lineNumber: parsed.lineNumber,
      recordType: String(record.type || 'unknown'),
      reason: METADATA_ONLY_TYPES.has(record.type) ? 'Low-value metadata kept for full export' : 'Unknown record type preserved raw',
      raw: record,
    })
  })

  const missingSidecars = sidecars.filter((sidecar) => !sidecar.resolved).length
  const resolvedSidecars = sidecars.filter((sidecar) => sidecar.resolved).length

  if (missingSidecars > 0) {
    warnings.push(`${missingSidecars} full tool output${missingSidecars === 1 ? ' was' : 's were'} not selected.`)
  }

  const validRecords = parsedLines.filter((line) => line.record).length
  const totalRecords = parsedLines.length

  return {
    events,
    rawRecords,
    sidecars,
    warnings,
    stats: {
      totalRecords,
      validRecords,
      invalidRecords: totalRecords - validRecords,
      accountedRecords: events.length + rawRecords.length,
      visibleEvents: events.length,
      hiddenMetadataRecords: rawRecords.filter((record) => METADATA_ONLY_TYPES.has(record.recordType)).length,
      rawPreservedRecords: rawRecords.length,
      missingSidecars,
      resolvedSidecars,
    },
    session,
  }
}

function parseLines(input: string): ParsedLine[] {
  return input
    .split(/\r?\n/)
    .map((rawLine, index) => ({ rawLine, lineNumber: index + 1 }))
    .filter((line) => line.rawLine.trim().length > 0)
    .map((line) => {
      try {
        return { ...line, record: JSON.parse(line.rawLine) }
      } catch (error) {
        return {
          ...line,
          error: error instanceof Error ? error.message : 'Invalid JSON',
        }
      }
    })
}

function extractSession(record: any): ParseResult['session'] | undefined {
  if (!record.sessionId && !record.gitBranch && !record.cwd) return undefined

  return {
    sessionId: record.sessionId,
    gitBranch: record.gitBranch,
    cwd: record.cwd,
  }
}

function recordToEvent(
  record: any,
  lineNumber: number,
  options: ParseOptions,
  sidecars: SidecarReference[],
  warnings: string[],
): TranscriptEvent | null {
  const base = {
    id: record.uuid || `${record.type || 'record'}-${lineNumber}`,
    lineNumber,
    recordType: String(record.type || 'unknown'),
    timestamp: record.timestamp,
    sessionId: record.sessionId,
    raw: record,
  }

  if (record.type === 'user' || record.type === 'assistant') {
    const rendered = renderContent(record.message?.content, record.type, {
      sidecarFiles: options.sidecarFiles || {},
      sidecars,
      warnings,
    })
    const title = record.type === 'user' ? 'User' : 'Assistant'

    return {
      ...base,
      role: record.type,
      title,
      body: rendered.body || emptyMessageText(record.type),
      chips: rendered.chips,
      details: appendRawDetails(rendered.details, record.toolUseResult),
    }
  }

  if (record.type === 'summary') {
    return {
      ...base,
      role: 'summary',
      title: 'Summary',
      body: String(record.summary || ''),
      chips: [],
      details: [{ label: 'Raw record', content: stringifySafe(record), language: 'json' }],
    }
  }

  if (record.type === 'progress') {
    return progressToEvent(record, lineNumber, options, sidecars, warnings)
  }

  if (record.type === 'system') {
    return {
      ...base,
      role: 'system',
      title: systemTitle(record),
      body: renderSystemBody(record),
      chips: record.subtype ? [record.subtype] : [],
      details: [{ label: 'Raw record', content: stringifySafe(record), language: 'json' }],
      isCollapsedByDefault: true,
    }
  }

  if (record.type === 'custom-title') {
    return {
      ...base,
      role: 'metadata',
      title: 'Custom title',
      body: String(record.customTitle || ''),
      chips: ['metadata'],
      details: [{ label: 'Raw record', content: stringifySafe(record), language: 'json' }],
      isCollapsedByDefault: true,
    }
  }

  if (record.type === 'agent-name') {
    return {
      ...base,
      role: 'metadata',
      title: 'Agent name',
      body: String(record.agentName || ''),
      chips: ['metadata'],
      details: [{ label: 'Raw record', content: stringifySafe(record), language: 'json' }],
      isCollapsedByDefault: true,
    }
  }

  if (record.type === 'last-prompt') {
    return {
      ...base,
      role: 'metadata',
      title: 'Last prompt',
      body: `${String(record.lastPrompt || '')}\n\nNote: this record may already be shortened by Claude before the app reads it.`,
      chips: ['already stored'],
      details: [{ label: 'Raw record', content: stringifySafe(record), language: 'json' }],
      isCollapsedByDefault: true,
    }
  }

  if (METADATA_ONLY_TYPES.has(record.type)) {
    return null
  }

  return null
}

function progressToEvent(
  record: any,
  lineNumber: number,
  options: ParseOptions,
  sidecars: SidecarReference[],
  warnings: string[],
): TranscriptEvent {
  const nested = record.data?.message
  const rendered = nested?.message
    ? renderContent(nested.message.content, nested.type === 'user' ? 'user' : 'assistant', {
        sidecarFiles: options.sidecarFiles || {},
        sidecars,
        warnings,
      })
    : { body: progressFallback(record), chips: [] as string[], details: [] as EventDetail[] }

  const agentId = record.data?.agentId || record.data?.agent_id

  return {
    id: record.uuid || `progress-${lineNumber}`,
    lineNumber,
    recordType: 'progress',
    role: 'progress',
    title: 'Agent progress',
    timestamp: record.timestamp || nested?.timestamp,
    sessionId: record.sessionId,
    body: rendered.body || progressFallback(record),
    chips: [agentId, record.data?.type].filter(Boolean).map(String),
    details: [
      ...rendered.details,
      { label: 'Raw progress record', content: stringifySafe(record), language: 'json' },
    ],
    raw: record,
    isCollapsedByDefault: true,
  }
}

function renderContent(
  content: unknown,
  context: 'user' | 'assistant',
  helpers: {
    sidecarFiles: Record<string, string>
    sidecars: SidecarReference[]
    warnings: string[]
  },
): { body: string; chips: string[]; details: EventDetail[] } {
  const decoded = decodeJsonString(content)
  const chunks: string[] = []
  const chips: string[] = []
  const details: EventDetail[] = []

  if (Array.isArray(decoded)) {
    decoded.forEach((block) => {
      const rendered = renderBlock(block, context, helpers)
      if (rendered.body) chunks.push(rendered.body)
      chips.push(...rendered.chips)
      details.push(...rendered.details)
    })
  } else if (typeof decoded === 'string') {
    chunks.push(decoded)
  } else if (decoded && typeof decoded === 'object') {
    chunks.push('```json\n' + stringifySafe(decoded) + '\n```')
  }

  return {
    body: cleanMarkdown(chunks.join('\n\n')),
    chips: unique(chips),
    details,
  }
}

function renderBlock(
  block: any,
  context: 'user' | 'assistant',
  helpers: {
    sidecarFiles: Record<string, string>
    sidecars: SidecarReference[]
    warnings: string[]
  },
): { body: string; chips: string[]; details: EventDetail[] } {
  if (typeof block === 'string') {
    return { body: decodeJsonString(block) as string, chips: [], details: [] }
  }

  if (!block || typeof block !== 'object') {
    return { body: String(block ?? ''), chips: [], details: [] }
  }

  if (block.type === 'text') {
    return { body: String(decodeJsonString(block.text || '')), chips: [], details: [] }
  }

  if (block.type === 'thinking') {
    return {
      body: 'Thinking block recorded. Hidden from the clean transcript.',
      chips: ['thinking'],
      details: [{ label: 'Thinking', content: String(decodeJsonString(block.thinking || '')) }],
    }
  }

  if (block.type === 'tool_use') {
    const inputJson = stringifySafe(block.input ?? {})
    return {
      body: [`Tool use: ${block.name || '(unknown tool)'}`, '```json', inputJson, '```'].join('\n'),
      chips: [block.name || 'tool_use'],
      details: [
        ...(block.id ? [{ label: 'Tool ID', content: String(block.id) }] : []),
        { label: 'Tool input', content: inputJson, language: 'json' },
      ],
    }
  }

  if (block.type === 'tool_result' || block.tool_use_id) {
    return renderToolResult(block, helpers)
  }

  if (block.type === 'tool_reference') {
    return {
      body: `Tool reference: ${block.tool_name || '(unknown tool)'}`,
      chips: [block.tool_name || 'tool_reference'],
      details: [{ label: 'Tool reference', content: stringifySafe(block), language: 'json' }],
    }
  }

  if (block.type === 'image') {
    const mediaType = block.source?.media_type || block.source?.mediaType || 'image'
    const length = typeof block.source?.data === 'string' ? block.source.data.length : 0

    return {
      body: `[Image: ${mediaType}${length > 0 ? `, base64 omitted (${length} chars)` : ''}]`,
      chips: ['image'],
      details: [{ label: 'Image metadata', content: stringifySafe(redactLargeFields(block)), language: 'json' }],
    }
  }

  const label = block.type || `${context} object`
  return {
    body: '```json\n' + stringifySafe(redactLargeFields(block)) + '\n```',
    chips: [String(label)],
    details: [{ label: 'Unknown content block', content: stringifySafe(redactLargeFields(block)), language: 'json' }],
  }
}

function renderToolResult(
  block: any,
  helpers: {
    sidecarFiles: Record<string, string>
    sidecars: SidecarReference[]
    warnings: string[]
  },
): { body: string; chips: string[]; details: EventDetail[] } {
  const content = block.content
  const sidecarPath = typeof content === 'string' ? extractSidecarPath(content) : undefined
  const chips = ['tool_result']
  const details: EventDetail[] = []

  if (sidecarPath) {
    const sidecar = resolveSidecar(sidecarPath, helpers.sidecarFiles)
    const reference: SidecarReference = {
      path: sidecarPath,
      lookupKey: sidecar.lookupKey,
      resolved: sidecar.resolved,
      toolUseId: block.tool_use_id,
      preview: extractPersistedPreview(content),
    }
    helpers.sidecars.push(reference)
    details.push({ label: 'Persisted output path', content: sidecarPath })

    if (sidecar.resolved && sidecar.content) {
      const renderedSidecar = renderSidecarContent(sidecar.content, helpers)
      return {
        body: renderedSidecar || extractPersistedPreview(content) || 'Persisted tool output loaded.',
        chips: [...chips, 'sidecar loaded'],
        details,
      }
    }

    return {
      body: [
        'Persisted tool output was not selected.',
        extractPersistedPreview(content),
        `Full output path: ${sidecarPath}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      chips: [...chips, 'missing sidecar'],
      details,
    }
  }

  if (typeof content === 'string') {
    const decoded = decodeJsonString(content)

    if (typeof decoded !== 'string') {
      return {
        body: '```json\n' + stringifySafe(redactLargeFields(decoded)) + '\n```',
        chips,
        details: block.toolUseResult ? [{ label: 'Tool result metadata', content: stringifySafe(block.toolUseResult), language: 'json' }] : [],
      }
    }

    return {
      body: decoded,
      chips,
      details: block.toolUseResult ? [{ label: 'Tool result metadata', content: stringifySafe(block.toolUseResult), language: 'json' }] : [],
    }
  }

  if (Array.isArray(content)) {
    const rendered = content.map((item) => renderBlock(item, 'user', helpers))
    return {
      body: cleanMarkdown(rendered.map((item) => item.body).filter(Boolean).join('\n\n')),
      chips: unique([...chips, ...rendered.flatMap((item) => item.chips)]),
      details: rendered.flatMap((item) => item.details),
    }
  }

  if (content && typeof content === 'object') {
    return {
      body: '```json\n' + stringifySafe(redactLargeFields(content)) + '\n```',
      chips,
      details: [{ label: 'Tool result object', content: stringifySafe(redactLargeFields(content)), language: 'json' }],
    }
  }

  return { body: '', chips, details }
}

function renderSidecarContent(
  content: string,
  helpers: {
    sidecarFiles: Record<string, string>
    sidecars: SidecarReference[]
    warnings: string[]
  },
): string {
  try {
    const parsed = JSON.parse(content)
    return renderContent(parsed, 'user', helpers).body
  } catch {
    return content
  }
}

function resolveSidecar(path: string, sidecarFiles: Record<string, string>): { resolved: boolean; lookupKey: string; content?: string } {
  const normalizedPath = normalizePath(path)
  const basename = normalizedPath.split('/').pop() || normalizedPath
  const suffix = normalizedPath.includes('/tool-results/')
    ? normalizedPath.slice(normalizedPath.indexOf('/tool-results/') + 1)
    : normalizedPath

  const exactKeys = [path, normalizedPath, basename, suffix]
  for (const key of exactKeys) {
    if (sidecarFiles[key]) return { resolved: true, lookupKey: key, content: sidecarFiles[key] }
  }

  const matchingKey = Object.keys(sidecarFiles).find((key) => {
    const normalizedKey = normalizePath(key)
    return normalizedKey.endsWith(`/${basename}`) || normalizedKey === basename || normalizedPath.endsWith(normalizedKey)
  })

  if (matchingKey) {
    return { resolved: true, lookupKey: matchingKey, content: sidecarFiles[matchingKey] }
  }

  return { resolved: false, lookupKey: basename }
}

function appendRawDetails(details: EventDetail[], toolUseResult: unknown): EventDetail[] {
  if (!toolUseResult) return details

  return [
    ...details,
    {
      label: 'Top-level tool result',
      content: stringifySafe(redactLargeFields(toolUseResult)),
      language: 'json',
    },
  ]
}

function systemTitle(record: any): string {
  if (record.subtype === 'local_command') return 'Local command'
  if (record.subtype === 'turn_duration') return 'Turn duration'
  if (record.subtype === 'stop_hook_summary') return 'Stop hook'
  return 'System'
}

function renderSystemBody(record: any): string {
  if (record.subtype === 'turn_duration') {
    const seconds = typeof record.durationMs === 'number' ? (record.durationMs / 1000).toFixed(1) : undefined
    return `Turn duration${seconds ? `: ${seconds}s` : ''}${record.messageCount ? `\nMessages: ${record.messageCount}` : ''}`
  }

  if (record.subtype === 'stop_hook_summary') {
    return `Stop hook ran ${record.hookCount ?? 0} hook${record.hookCount === 1 ? '' : 's'}.`
  }

  if (typeof record.content === 'string') {
    const command = tagValue(record.content, 'command-name')
    const message = tagValue(record.content, 'command-message')
    const stdout = tagValue(record.content, 'local-command-stdout')

    return [
      command ? `Command: \`${command}\`` : '',
      message || '',
      stdout ? `Output:\n\`\`\`\n${stdout}\n\`\`\`` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  return '```json\n' + stringifySafe(record) + '\n```'
}

function tagValue(input: string, tag: string): string {
  const match = input.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return match?.[1]?.trim() || ''
}

function extractSidecarPath(content: string): string | undefined {
  return content.match(/Full output saved to:\s*([^\n]+)/)?.[1]?.trim()
}

function extractPersistedPreview(content: string): string {
  const match = content.match(/Preview[^\n]*:\n([\s\S]*)$/)
  return match?.[1]?.trim() || ''
}

function progressFallback(record: any): string {
  if (record.data?.prompt) return String(record.data.prompt)
  if (record.data?.type) return `Progress event: ${record.data.type}`
  return 'Progress event recorded.'
}

function emptyMessageText(type: string): string {
  return `${type} message with no displayable content. Raw details are preserved.`
}

function decodeJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (!/\\[nrt"\\]/.test(value)) return value

  try {
    const decoded = JSON.parse(`"${value.replace(/"/g, '\\"')}"`)
    if (typeof decoded === 'string' && /\\[nrt"\\]/.test(decoded)) {
      try {
        return JSON.parse(`"${decoded.replace(/"/g, '\\"')}"`)
      } catch {
        return decoded
      }
    }
    return decoded
  } catch {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
}

function redactLargeFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLargeFields)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if (key === 'data' && typeof child === 'string' && child.length > 80) {
        return [key, `[base64 omitted: ${child.length} chars]`]
      }
      return [key, redactLargeFields(child)]
    }),
  )
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function cleanMarkdown(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}
