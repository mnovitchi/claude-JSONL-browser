import type { ParseResult, TranscriptEvent } from './types'

export type MarkdownMode = 'readable' | 'full'

export function renderMarkdown(result: ParseResult, mode: MarkdownMode = 'readable'): string {
  const lines: string[] = ['# Chat Conversation Log', '']

  if (result.session?.sessionId) lines.push(`**Session ID:** ${result.session.sessionId}`)
  if (result.session?.gitBranch) lines.push(`**Branch:** ${result.session.gitBranch}`)
  if (result.session?.cwd) lines.push(`**Working Directory:** ${result.session.cwd}`)

  lines.push(
    '',
    `**Records:** ${result.stats.accountedRecords}/${result.stats.totalRecords} accounted for`,
    `**Hidden metadata records:** ${result.stats.hiddenMetadataRecords}`,
    `**Missing sidecar outputs:** ${result.stats.missingSidecars}`,
  )

  if (result.warnings.length > 0) {
    lines.push('', '## Warnings', '')
    result.warnings.forEach((warning) => lines.push(`- ${warning}`))
  }

  lines.push('', '---', '')

  result.events.forEach((event) => {
    lines.push(renderEvent(event, mode), '---', '')
  })

  if (mode === 'full') {
    lines.push('## Raw Preserved Records', '')

    if (result.rawRecords.length === 0) {
      lines.push('No raw-only records.')
    } else {
      result.rawRecords.forEach((record) => {
        lines.push(`### Line ${record.lineNumber}: ${record.recordType}`, '')
        lines.push(record.reason, '')
        lines.push('```json')
        lines.push(stringifySafe(record.raw))
        lines.push('```', '')
      })
    }

    if (result.sidecars.length > 0) {
      lines.push('## Sidecar Outputs', '')
      result.sidecars.forEach((sidecar) => {
        lines.push(`- ${sidecar.resolved ? 'Loaded' : 'Missing'}: ${sidecar.path}`)
      })
      lines.push('')
    }
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'
}

function renderEvent(event: TranscriptEvent, mode: MarkdownMode): string {
  const heading = `## ${event.title}${event.timestamp ? ` - ${formatTimestamp(event.timestamp)}` : ''}`
  const bodyText = event.body || (event.images.length > 0 ? '' : '_No displayable content._')
  const chunks = [heading, '', bodyText]

  event.images.forEach((image) => {
    chunks.push('', `![${image.mediaType}](data:${image.mediaType};base64,${image.data})`)
  })

  if (event.chips.length > 0) {
    chunks.push('', `_${event.chips.join(' · ')}_`)
  }

  if (mode === 'full' && event.details.length > 0) {
    chunks.push('', '<details>', `<summary>${event.details.length} detail${event.details.length === 1 ? '' : 's'}</summary>`, '')
    event.details.forEach((detail) => {
      chunks.push(`### ${detail.label}`, '')
      if (detail.language) {
        chunks.push(`\`\`\`${detail.language}`, detail.content, '```', '')
      } else {
        chunks.push(detail.content, '')
      }
    })
    chunks.push('</details>')
  }

  return chunks.join('\n').trim()
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString()
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
