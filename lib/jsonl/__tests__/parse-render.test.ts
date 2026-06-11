import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseClaudeJsonl } from '../parse'
import { renderMarkdown } from '../renderMarkdown'
import { renderPreview } from '../renderPreview'
import { renderSafeOriginal } from '../renderSafeOriginal'
import { renderSafeText } from '../renderSafeText'
import { createTextPreview } from '../textPreview'

const line = (value: unknown) => JSON.stringify(value)

describe('Claude JSONL conversion', () => {
  it('accounts for every record and preserves tool results, tool references, and progress messages', () => {
    const jsonl = [
      line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-04-01T07:33:17.422Z', sessionId: 'session-a' }),
      line({
        type: 'user',
        timestamp: '2026-04-01T07:33:18.000Z',
        sessionId: 'session-a',
        gitBranch: 'main',
        cwd: '/project',
        message: { role: 'user', content: 'Please inspect this project' },
      }),
      line({
        type: 'assistant',
        timestamp: '2026-04-01T07:33:19.000Z',
        sessionId: 'session-a',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I should inspect the files first.', signature: 'signature-that-should-not-render' },
            { type: 'tool_use', id: 'toolu_search', name: 'ToolSearch', input: { query: 'select:TodoWrite', max_results: 1 } },
          ],
        },
      }),
      line({
        type: 'user',
        timestamp: '2026-04-01T07:33:20.000Z',
        sessionId: 'session-a',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_search', content: 'ToolSearch found one deferred tool.' }] },
        toolUseResult: { matches: ['TodoWrite'], query: 'select:TodoWrite', total_deferred_tools: 34 },
      }),
      line({
        type: 'user',
        timestamp: '2026-04-01T07:33:21.000Z',
        sessionId: 'session-a',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_reference',
              content: [{ type: 'tool_reference', tool_name: 'TodoWrite' }],
            },
          ],
        },
      }),
      line({
        type: 'progress',
        timestamp: '2026-04-01T07:33:22.000Z',
        sessionId: 'session-a',
        data: {
          type: 'agent_progress',
          agentId: 'agent-1',
          message: {
            type: 'assistant',
            timestamp: '2026-04-01T07:33:22.000Z',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Nested agent found the slow loader.' }] },
          },
        },
      }),
      line({ type: 'system', subtype: 'local_command', timestamp: '2026-04-01T07:33:23.000Z', sessionId: 'session-a', content: '<command-name>/skills</command-name>\n<command-message>skills</command-message>\n<local-command-stdout>skill output</local-command-stdout>' }),
      line({ type: 'custom-title', customTitle: 'fix-truncation', sessionId: 'session-a' }),
      line({ type: 'agent-name', agentName: 'jsonl-browser', sessionId: 'session-a' }),
      line({ type: 'last-prompt', lastPrompt: 'This value was already truncated…', sessionId: 'session-a' }),
      line({ type: 'file-history-snapshot', messageId: 'snapshot-1', snapshot: { trackedFileBackups: {} }, isSnapshotUpdate: false }),
      line({ type: 'future-record', payload: { must: 'be preserved' }, sessionId: 'session-a' }),
    ].join('\n')

    const result = parseClaudeJsonl(jsonl)
    const readable = renderMarkdown(result, 'readable')
    const full = renderMarkdown(result, 'full')

    expect(result.stats.totalRecords).toBe(12)
    expect(result.stats.accountedRecords).toBe(12)
    expect(result.stats.hiddenMetadataRecords).toBeGreaterThan(0)
    expect(result.rawRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordType: 'future-record' }),
        expect.objectContaining({ recordType: 'file-history-snapshot' }),
      ]),
    )
    expect(readable).toContain('ToolSearch found one deferred tool.')
    expect(readable).toContain('TodoWrite')
    expect(readable).toContain('Agent progress')
    expect(readable).toContain('Nested agent found the slow loader.')
    expect(readable).toContain('max_results')
    expect(readable).toContain('This value was already truncated')
    expect(readable).not.toContain('signature-that-should-not-render')
    expect(full).toContain('Raw Preserved Records')
    expect(full).toContain('"future-record"')
  })

  it('renders tool results whose content is a JSON object string instead of [object Object]', () => {
    const toolResultContent = JSON.stringify(
      { Result: 'Success', Code: 'ToolResult', Data: { success: true, projectDirectory: 'C:\\repos\\Demo' } },
      null,
      2,
    )

    const jsonl = [
      line({
        type: 'user',
        timestamp: '2026-04-01T07:33:20.000Z',
        sessionId: 'session-obj',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: toolResultContent }],
        },
        toolUseResult: { stdout: toolResultContent, stderr: '', interrupted: false },
      }),
    ].join('\n')

    const result = parseClaudeJsonl(jsonl)
    const readable = renderMarkdown(result, 'readable')

    expect(readable).not.toContain('[object Object]')
    expect(readable).toContain('"Result": "Success"')
    expect(readable).toContain('projectDirectory')
  })

  it('tracks persisted sidecar results and prevents image base64 from flooding readable output', () => {
    const sidecarPath = '/Users/linda/.claude/projects/demo/session/tool-results/toolu_big.json'
    const jsonl = [
      line({
        type: 'assistant',
        timestamp: '2026-04-01T07:33:19.000Z',
        sessionId: 'session-b',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_image',
              name: 'View',
              input: { file_path: '/tmp/screenshot.png' },
            },
          ],
        },
      }),
      line({
        type: 'user',
        timestamp: '2026-04-01T07:33:20.000Z',
        sessionId: 'session-b',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_big',
              content: `<persisted-output>\nOutput too large. Full output saved to: ${sidecarPath}\n\nPreview (first 2KB):\npartial preview`,
            },
          ],
        },
      }),
      line({
        type: 'user',
        timestamp: '2026-04-01T07:33:21.000Z',
        sessionId: 'session-b',
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'abc123base64payload' },
            },
          ],
        },
      }),
    ].join('\n')

    const missing = parseClaudeJsonl(jsonl)
    expect(missing.stats.missingSidecars).toBe(1)
    expect(missing.warnings.join('\n')).toContain('1 full tool output was not selected')

    const resolved = parseClaudeJsonl(jsonl, {
      sidecarFiles: {
        'toolu_big.json': line([{ type: 'text', text: 'FULL SIDECAR CONTENT' }]),
      },
    })
    const readable = renderMarkdown(resolved, 'readable')
    const full = renderMarkdown(resolved, 'full')

    expect(resolved.stats.missingSidecars).toBe(0)
    expect(resolved.stats.resolvedSidecars).toBe(1)
    expect(readable).toContain('FULL SIDECAR CONTENT')
    expect(readable).toContain('[Image: image/png')
    expect(readable).not.toContain('abc123base64payload')
    expect(full).toContain(sidecarPath)
  })

  it('creates a compact preview model with summary stats and collapsed details', () => {
    const result = parseClaudeJsonl(
      [
        line({ type: 'user', timestamp: '2026-04-01T07:33:18.000Z', sessionId: 'session-c', message: { role: 'user', content: 'Hello' } }),
        line({ type: 'assistant', timestamp: '2026-04-01T07:33:19.000Z', sessionId: 'session-c', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.md', limit: 20 } }] } }),
        line({ type: 'progress', timestamp: '2026-04-01T07:33:20.000Z', sessionId: 'session-c', data: { type: 'agent_progress', agentId: 'agent-2', message: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' }] } } } }),
      ].join('\n'),
    )

    const preview = renderPreview(result)

    expect(preview.summary.totalRecords).toBe(3)
    expect(preview.summary.accountedRecords).toBe(3)
    expect(preview.items).toHaveLength(3)
    expect(preview.items[1]).toMatchObject({
      role: 'assistant',
      title: 'Assistant',
      chips: expect.arrayContaining(['Read']),
      hasDetails: true,
    })
    expect(preview.items[2]).toMatchObject({
      role: 'progress',
      title: 'Agent progress',
      isCollapsedByDefault: true,
    })
  })

  it('renders original JSONL safely without exposing base64 or opaque payloads', () => {
    const base64Payload = 'iVBORw0KGgoAAAANSUhEUgAA'.repeat(20)
    const opaquePayload = 'a'.repeat(4200)
    const normalCode = 'function greet(name) {\\n  return `hello ${name}`\\n}'
    const normalText = 'Please keep this normal user text visible.'

    const jsonl = [
      line({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: normalText },
            { type: 'text', text: normalCode },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Payload } },
          ],
        },
      }),
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: opaquePayload }] } }),
    ].join('\n')

    const safeOriginal = renderSafeOriginal(jsonl)

    expect(safeOriginal).toContain(normalText)
    expect(safeOriginal).toContain('function greet(name)')
    expect(safeOriginal).toContain('return `hello ${name}`')
    expect(safeOriginal).toContain('[base64 omitted:')
    expect(safeOriginal).toContain('[large string omitted:')
    expect(safeOriginal).not.toContain(base64Payload)
    expect(safeOriginal).not.toContain(opaquePayload)
  })

  it('redacts obvious base64 from invalid JSON lines', () => {
    const base64Payload = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='.repeat(12)
    const safeOriginal = renderSafeOriginal(`not-json ${base64Payload} still-readable`)

    expect(safeOriginal).toContain('not-json')
    expect(safeOriginal).toContain('still-readable')
    expect(safeOriginal).toContain('[base64 omitted:')
    expect(safeOriginal).not.toContain(base64Payload)
  })

  it('redacts opaque payloads from plain display text', () => {
    const base64Payload = 'SGVsbG9Xb3JsZA=='.repeat(30)
    const opaquePayload = 'z'.repeat(4200)
    const markdown = `# Export\n\nKeep this sentence.\n\n${base64Payload}\n\n${opaquePayload}`

    const safeText = renderSafeText(markdown)

    expect(safeText).toContain('Keep this sentence.')
    expect(safeText).toContain('[base64 omitted:')
    expect(safeText).toContain('[large string omitted:')
    expect(safeText).not.toContain(base64Payload)
    expect(safeText).not.toContain(opaquePayload)
  })

  it('extracts a base64 image that is the direct result of a tool call', () => {
    const jsonl = line({
      type: 'user',
      timestamp: '2026-04-01T08:00:00.000Z',
      sessionId: 'session-img',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_read_png',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8taW1hZ2U=' } },
            ],
          },
        ],
      },
    })

    const event = parseClaudeJsonl(jsonl).events[0]

    expect(event.images).toEqual([{ mediaType: 'image/png', data: 'aGVsbG8taW1hZ2U=' }])
    expect(event.body).toBe('')
    expect(event.body).not.toContain('aGVsbG8taW1hZ2U=')
  })

  it('keeps the text placeholder for images that are not tool-call results', () => {
    const jsonl = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cGFzdGVkLWltYWdl' } },
        ],
      },
    })

    const event = parseClaudeJsonl(jsonl).events[0]

    expect(event.body).toContain('[Image: image/png')
    expect(event.images).toEqual([])
  })

  it('does not extract a non-base64 image inside a tool result', () => {
    const jsonl = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_url',
            content: [
              { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
            ],
          },
        ],
      },
    })

    const event = parseClaudeJsonl(jsonl).events[0]

    expect(event.images).toEqual([])
    expect(event.body).toContain('[Image:')
  })

  it('creates collapsed previews that can expand back to the full safe text', () => {
    const text = Array.from({ length: 6 }, (_, index) => `line ${index + 1}`).join('\n')

    const collapsed = createTextPreview(text, { expanded: false, maxLines: 3, maxCharacters: 200 })
    const expanded = createTextPreview(text, { expanded: true, maxLines: 3, maxCharacters: 200 })

    expect(collapsed.isTruncated).toBe(true)
    expect(collapsed.text).toBe('line 1\nline 2\nline 3')
    expect(expanded.isTruncated).toBe(false)
    expect(expanded.text).toBe(text)
  })

  const finishTraxSampleRoot = '/Users/linda/.claude/projects/-Users-linda-Documents-DEV-FinishTraxiOS'
  const runFinishTraxSample = existsSync(finishTraxSampleRoot)

  it.skipIf(!runFinishTraxSample)('accounts for every record in the local FinishTraxiOS sample logs', () => {
    const sidecarFiles: Record<string, string> = {}

    readdirSync(finishTraxSampleRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((sessionDir) => {
        const toolResultsDir = join(finishTraxSampleRoot, sessionDir.name, 'tool-results')
        if (!existsSync(toolResultsDir)) return

        readdirSync(toolResultsDir)
          .filter((fileName) => fileName.endsWith('.json'))
          .forEach((fileName) => {
            const filePath = join(toolResultsDir, fileName)
            const text = readFileSync(filePath, 'utf8')
            sidecarFiles[filePath] = text
            sidecarFiles[basename(filePath)] = text
          })
      })

    const jsonlFiles = readdirSync(finishTraxSampleRoot)
      .filter((fileName) => fileName.endsWith('.jsonl'))
      .map((fileName) => join(finishTraxSampleRoot, fileName))

    let totalRecords = 0
    let accountedRecords = 0
    let progressEvents = 0
    let missingSidecars = 0
    let readableMarkdown = ''

    jsonlFiles.forEach((filePath) => {
      const result = parseClaudeJsonl(readFileSync(filePath, 'utf8'), { sidecarFiles })
      totalRecords += result.stats.totalRecords
      accountedRecords += result.stats.accountedRecords
      progressEvents += result.events.filter((event) => event.role === 'progress').length
      missingSidecars += result.stats.missingSidecars
      readableMarkdown += renderMarkdown(result, 'readable')
    })

    expect(totalRecords).toBeGreaterThan(1000)
    expect(accountedRecords).toBe(totalRecords)
    expect(progressEvents).toBeGreaterThan(0)
    expect(missingSidecars).toBe(0)
    expect(readableMarkdown).toContain('Agent progress')
    expect(readableMarkdown).toContain('Tool reference')
    expect(readableMarkdown).not.toContain('iVBORw0KGgoAAAANSUhEUgAA')
  })
})
