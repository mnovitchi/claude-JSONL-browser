export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type EventRole =
  | 'user'
  | 'assistant'
  | 'summary'
  | 'system'
  | 'progress'
  | 'metadata'
  | 'unknown'

export interface SidecarFileMap {
  [pathOrName: string]: string
}

export interface ParseOptions {
  sidecarFiles?: SidecarFileMap
}

export interface TranscriptImage {
  mediaType: string
  data: string
}

export interface EventDetail {
  label: string
  content: string
  language?: string
}

export interface TranscriptEvent {
  id: string
  lineNumber: number
  recordType: string
  role: EventRole
  title: string
  timestamp?: string
  sessionId?: string
  body: string
  chips: string[]
  details: EventDetail[]
  images: TranscriptImage[]
  raw: unknown
  isCollapsedByDefault?: boolean
}

export interface RawPreservedRecord {
  lineNumber: number
  recordType: string
  reason: string
  raw: unknown
}

export interface SidecarReference {
  path: string
  lookupKey: string
  resolved: boolean
  toolUseId?: string
  preview?: string
}

export interface ParseStats {
  totalRecords: number
  validRecords: number
  invalidRecords: number
  accountedRecords: number
  visibleEvents: number
  hiddenMetadataRecords: number
  rawPreservedRecords: number
  missingSidecars: number
  resolvedSidecars: number
}

export interface ParseResult {
  events: TranscriptEvent[]
  rawRecords: RawPreservedRecord[]
  sidecars: SidecarReference[]
  warnings: string[]
  stats: ParseStats
  session?: {
    sessionId?: string
    gitBranch?: string
    cwd?: string
  }
}

export interface PreviewItem {
  id: string
  role: EventRole
  title: string
  timestamp?: string
  body: string
  chips: string[]
  details: EventDetail[]
  images: TranscriptImage[]
  hasDetails: boolean
  detailCount: number
  isCollapsedByDefault: boolean
}

export interface PreviewModel {
  summary: ParseStats
  warnings: string[]
  items: PreviewItem[]
}
