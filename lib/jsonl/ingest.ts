import type { ImportedFile } from '@/lib/tauri/claudeProjects'
import type { ParseResult, PreviewModel } from '@/lib/jsonl/types'

export interface FileData {
  id: string
  name: string
  content: string
  markdown: string | null
  fullMarkdown: string | null
  parseResult: ParseResult | null
  preview: PreviewModel | null
  lastModified: number
  size: number
  converted: boolean
  error?: string
}

export function isConversationLog(file: ImportedFile): boolean {
  const normalized = file.path.replace(/\\/g, '/')
  if (normalized.includes('/tool-results/')) return false
  return file.name.endsWith('.jsonl') || file.name.endsWith('.json')
}

export function isSidecarFile(file: ImportedFile): boolean {
  const normalized = file.path.replace(/\\/g, '/')
  return file.name.endsWith('.json') && (normalized.includes('/tool-results/') || file.name.startsWith('toolu_'))
}

export function displayName(file: ImportedFile): string {
  return file.path
}

export interface IngestOptions {
  replace?: boolean
}

export interface IngestResult {
  files: FileData[]
  sidecars: Record<string, string>
  selectedFileId: string | null
  notice: string
  error: string
}

/**
 * Pure computation behind the component's `ingestFiles`. Splits incoming
 * records into conversation logs and tool-result sidecars, then either appends
 * to or replaces the current state. `makeId` is injected so the function stays
 * pure (the component passes `generateFileId`; tests pass a counter).
 */
export function computeIngest(
  prevFiles: FileData[],
  prevSidecars: Record<string, string>,
  selectedFileId: string | null,
  records: ImportedFile[],
  makeId: () => string,
  options: IngestOptions = {},
): IngestResult {
  if (records.length === 0) {
    return { files: prevFiles, sidecars: prevSidecars, selectedFileId, notice: '', error: '' }
  }

  const replace = options.replace ?? false

  const sidecarCandidates = records.filter(isSidecarFile)
  const logCandidates = records.filter((file) => !isSidecarFile(file) && isConversationLog(file))

  const newSidecars: Record<string, string> = {}
  sidecarCandidates.forEach((file) => {
    newSidecars[file.path] = file.text
    newSidecars[file.name] = file.text
  })
  const hasNewSidecars = Object.keys(newSidecars).length > 0

  const newFiles: FileData[] = logCandidates.map((file) => ({
    id: makeId(),
    name: displayName(file),
    content: file.text,
    markdown: null,
    fullMarkdown: null,
    parseResult: null,
    preview: null,
    lastModified: file.lastModified,
    size: file.size,
    converted: false,
  }))

  let files: FileData[]
  let sidecars: Record<string, string>
  let resultSelectedId: string | null

  if (replace) {
    sidecars = newSidecars
    files = newFiles
    resultSelectedId = newFiles[0]?.id ?? null
  } else {
    sidecars = { ...prevSidecars, ...newSidecars }
    // When new sidecars arrive, prior converted files must re-convert to pick them up.
    const rebasedPrev = hasNewSidecars
      ? prevFiles.map((file) =>
          file.converted
            ? { ...file, converted: false, markdown: null, fullMarkdown: null, parseResult: null, preview: null }
            : file,
        )
      : prevFiles
    files = [...rebasedPrev, ...newFiles]
    resultSelectedId = selectedFileId ?? newFiles[0]?.id ?? null
  }

  let notice = ''
  let error = ''
  if (newFiles.length === 0 && hasNewSidecars) {
    notice = 'Loaded sidecar files. Convert the JSONL files again to include full tool outputs.'
  } else if (newFiles.length === 0) {
    error = 'No JSONL files found.'
  } else if (hasNewSidecars) {
    notice = `Loaded ${newFiles.length} conversation file${newFiles.length === 1 ? '' : 's'} and sidecar outputs.`
  }

  return { files, sidecars, selectedFileId: resultSelectedId, notice, error }
}
