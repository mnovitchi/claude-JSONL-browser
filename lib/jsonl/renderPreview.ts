import type { ParseResult, PreviewModel } from './types'

export function renderPreview(result: ParseResult): PreviewModel {
  return {
    summary: result.stats,
    warnings: result.warnings,
    items: result.events.map((event) => ({
      id: event.id,
      role: event.role,
      title: event.title,
      timestamp: event.timestamp,
      body: event.body,
      chips: event.chips,
      details: event.details,
      hasDetails: event.details.length > 0,
      detailCount: event.details.length,
      isCollapsedByDefault: event.isCollapsedByDefault ?? event.details.length > 0,
    })),
  }
}
