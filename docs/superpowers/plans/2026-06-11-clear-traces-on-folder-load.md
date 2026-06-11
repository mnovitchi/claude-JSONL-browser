# Clear Previous Traces on Folder Load — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When loading conversations from a folder, offer to clear the currently loaded traces first (default: clear), instead of always appending.

**Architecture:** Extract the pure file/sidecar/selection merge logic from `JsonlConverter.tsx`'s `ingestFiles` into a testable `lib/jsonl/ingest.ts` module with a new `replace` mode. The component's `ingestFiles` becomes a thin state-applying wrapper. The two folder entry points opt into clearing: the import modal via a default-on checkbox, the OS folder picker via a three-way confirm dialog shown only when traces are already loaded.

**Tech Stack:** Next.js 15 + React (client component), TypeScript strict, Tailwind (Everforest theme), Vitest. Note: `npm run lint` is broken (pre-existing ESLint config issue) — type-check with `npm run build`, unit-test with `npx vitest run`.

---

## File Structure

- **Create** `lib/jsonl/ingest.ts` — `FileData` type, the moved pure helpers (`isConversationLog`, `isSidecarFile`, `displayName`), and the new pure `computeIngest`.
- **Create** `lib/jsonl/__tests__/ingest.test.ts` — Vitest coverage for `computeIngest`.
- **Modify** `components/JsonlConverter.tsx` — import from the new module, delete the moved definitions, rewrite `ingestFiles` as a wrapper, add the import-modal checkbox and the folder-picker confirm dialog.

---

## Task 1: Pure ingest module + tests

**Files:**
- Create: `lib/jsonl/ingest.ts`
- Test: `lib/jsonl/__tests__/ingest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/jsonl/__tests__/ingest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeIngest, type FileData } from '../ingest'
import type { ImportedFile } from '@/lib/tauri/claudeProjects'

const log = (path: string, text = '{"type":"user"}'): ImportedFile => ({
  path,
  name: path.split('/').pop()!,
  text,
  lastModified: 0,
  size: text.length,
})

const sidecar = (path: string, text = '{"result":"ok"}'): ImportedFile => ({
  path,
  name: path.split('/').pop()!,
  text,
  lastModified: 0,
  size: text.length,
})

const existing = (id: string, overrides: Partial<FileData> = {}): FileData => ({
  id,
  name: id,
  content: 'x',
  markdown: null,
  fullMarkdown: null,
  parseResult: null,
  preview: null,
  lastModified: 0,
  size: 1,
  converted: false,
  ...overrides,
})

function counter() {
  let n = 0
  return () => `new${++n}`
}

describe('computeIngest', () => {
  it('append mode adds new files after existing and preserves the current selection', () => {
    const prev = [existing('a'), existing('b')]
    const r = computeIngest(prev, {}, 'a', [log('proj/s1.jsonl')], counter())
    expect(r.files.map((f) => f.id)).toEqual(['a', 'b', 'new1'])
    expect(r.selectedFileId).toBe('a')
  })

  it('append mode selects the first new file when nothing was selected', () => {
    const r = computeIngest([], {}, null, [log('proj/s1.jsonl'), log('proj/s2.jsonl')], counter())
    expect(r.files.map((f) => f.id)).toEqual(['new1', 'new2'])
    expect(r.selectedFileId).toBe('new1')
  })

  it('append mode merges sidecars and resets conversion on already-converted prior files', () => {
    const prev = [
      existing('a', {
        converted: true,
        markdown: 'md',
        fullMarkdown: 'fmd',
        parseResult: {} as never,
        preview: {} as never,
      }),
    ]
    const r = computeIngest(prev, { old: 'v' }, 'a', [sidecar('proj/tool-results/toolu_1.json')], counter())
    expect(r.files[0].converted).toBe(false)
    expect(r.files[0].markdown).toBeNull()
    expect(r.files[0].parseResult).toBeNull()
    expect(r.sidecars.old).toBe('v')
    expect(r.sidecars['proj/tool-results/toolu_1.json']).toBe('{"result":"ok"}')
    expect(r.notice).toContain('sidecar')
  })

  it('replace mode drops prior files and sidecars, keeping only the new ones', () => {
    const prev = [existing('a'), existing('b')]
    const r = computeIngest(prev, { old: 'v' }, 'a', [log('proj/s1.jsonl')], counter(), { replace: true })
    expect(r.files.map((f) => f.id)).toEqual(['new1'])
    expect(r.sidecars).toEqual({})
    expect(r.selectedFileId).toBe('new1')
  })

  it('replace mode selects the new first file even when a prior file was selected', () => {
    const prev = [existing('a'), existing('b')]
    const r = computeIngest(prev, {}, 'b', [log('proj/x.jsonl'), log('proj/y.jsonl')], counter(), { replace: true })
    expect(r.selectedFileId).toBe('new1')
    expect(r.files.map((f) => f.id)).toEqual(['new1', 'new2'])
  })

  it('reports an error when no conversation logs are found', () => {
    const r = computeIngest([], {}, null, [{ path: 'proj/readme.md', name: 'readme.md', text: 'x', lastModified: 0, size: 1 }], counter())
    expect(r.error).toBe('No JSONL files found.')
    expect(r.files).toEqual([])
  })

  it('reports a sidecar-only notice when only sidecars are present', () => {
    const r = computeIngest([], {}, null, [sidecar('proj/tool-results/toolu_1.json')], counter())
    expect(r.notice).toContain('Convert the JSONL')
    expect(r.files).toEqual([])
  })

  it('returns a no-op result for empty records', () => {
    const prev = [existing('a')]
    const r = computeIngest(prev, { old: 'v' }, 'a', [], counter())
    expect(r.files).toEqual(prev)
    expect(r.sidecars).toEqual({ old: 'v' })
    expect(r.selectedFileId).toBe('a')
    expect(r.error).toBe('')
    expect(r.notice).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/jsonl/__tests__/ingest.test.ts`
Expected: FAIL — cannot resolve module `../ingest` (file does not exist yet).

- [ ] **Step 3: Create the implementation**

Create `lib/jsonl/ingest.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/jsonl/__tests__/ingest.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/jsonl/ingest.ts lib/jsonl/__tests__/ingest.test.ts
git commit -m "feat: extract pure computeIngest with append/replace modes"
```

---

## Task 2: Wire JsonlConverter to the new module

**Files:**
- Modify: `components/JsonlConverter.tsx` (imports ~line 30, `FileData` interface lines 49-61, `ingestFiles` lines 284-342, helper functions lines 1168-1181)

This task has no new test; it is verified by the type-checking build and the existing Task 1 tests (behavior is unchanged for append callers).

- [ ] **Step 1: Add the import**

After the existing `import { parseClaudeJsonl } from '@/lib/jsonl/parse'` line (around line 40), add:

```ts
import { computeIngest, type FileData } from '@/lib/jsonl/ingest'
```

- [ ] **Step 2: Delete the now-duplicated local definitions**

Delete the local `FileData` interface (lines 49-61):

```ts
interface FileData {
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
```

Delete the three moved helper functions (lines 1168-1181):

```ts
function isConversationLog(file: ImportedFile): boolean {
  const normalized = file.path.replace(/\\/g, '/')
  if (normalized.includes('/tool-results/')) return false
  return file.name.endsWith('.jsonl') || file.name.endsWith('.json')
}

function isSidecarFile(file: ImportedFile): boolean {
  const normalized = file.path.replace(/\\/g, '/')
  return file.name.endsWith('.json') && (normalized.includes('/tool-results/') || file.name.startsWith('toolu_'))
}

function displayName(file: ImportedFile): string {
  return file.path
}
```

Leave `baseName`, `downloadMarkdown`, and everything else in that trailing block untouched.

- [ ] **Step 3: Rewrite `ingestFiles` as a wrapper**

Replace the entire `ingestFiles` function (lines 284-342) with:

```ts
  const ingestFiles = (records: ImportedFile[], { replace = false }: { replace?: boolean } = {}) => {
    if (records.length === 0) return

    setError('')
    setNotice('')

    const result = computeIngest(files, sidecarFiles, selectedFileId, records, generateFileId, { replace })

    setSidecarFiles(result.sidecars)
    setFiles(result.files)
    setSelectedFileId(result.selectedFileId)

    if (result.error) showError(result.error)
    else if (result.notice) setNotice(result.notice)
  }
```

Note: `showError` is defined later in the component (line ~485) but is in scope as a `const` arrow inside the same function component closure; it is already referenced elsewhere, so no reordering is needed.

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (If `ParseResult`/`PreviewModel` become unused imports after deleting the local `FileData`, the build will flag them — they are still used elsewhere in the component via `FileData` fields and `parseClaudeJsonl`, so leave the `import type { ParseResult, PreviewModel, EventRole }` line as-is.)

- [ ] **Step 5: Run the full unit test suite**

Run: `npx vitest run`
Expected: PASS — all suites green, including the new `ingest` tests.

- [ ] **Step 6: Commit**

```bash
git add components/JsonlConverter.tsx
git commit -m "refactor: route ingestFiles through computeIngest"
```

---

## Task 3: Import-modal "Clear loaded sessions" checkbox (default on)

**Files:**
- Modify: `components/JsonlConverter.tsx` (state ~line 116, `importProject` line 513, import modal markup ~lines 933-958)

Verified by build + manual check (no automated UI test in this codebase).

- [ ] **Step 1: Add the checkbox state**

Immediately after the `const [importModalOpen, setImportModalOpen] = useState(false)` line (~line 116), add:

```ts
  const [clearOnImport, setClearOnImport] = useState(true)
```

- [ ] **Step 2: Pass the flag from `importProject`**

In `importProject` (line ~513), change:

```ts
      ingestFiles(records)
```

to:

```ts
      ingestFiles(records, { replace: clearOnImport })
```

- [ ] **Step 3: Add the footer checkbox to the import modal**

In the import modal, the scrollable list `<div className="flex-1 overflow-y-auto p-2 custom-scrollbar">…</div>` closes around line 957, just before the modal box's closing `</div>` (line 958). Insert this footer block between them:

```tsx
            <div className="px-4 py-3 border-t border-everforest-bg4">
              <label className="flex items-center gap-2 text-xs text-everforest-fg cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={clearOnImport}
                  onChange={(event) => setClearOnImport(event.target.checked)}
                  className="accent-everforest-purple"
                />
                Clear loaded sessions before importing
              </label>
            </div>
```

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add components/JsonlConverter.tsx
git commit -m "feat: add clear-loaded-sessions checkbox to import modal"
```

---

## Task 4: Folder-picker three-way confirm dialog

**Files:**
- Modify: `components/JsonlConverter.tsx` (state ~line 116, `handleFilesUpload` lines 344-359, folder `<input>` onChange line 634, new dialog markup after the import modal ~line 960)

Verified by build + manual check.

- [ ] **Step 1: Add pending-records state**

After the `clearOnImport` state added in Task 3, add:

```ts
  const [pendingFolderRecords, setPendingFolderRecords] = useState<ImportedFile[] | null>(null)
```

- [ ] **Step 2: Teach `handleFilesUpload` about folder loads**

Replace `handleFilesUpload` (lines 344-359) with:

```ts
  const handleFilesUpload = async (uploadedFiles: FileList | File[], { fromFolder = false }: { fromFolder?: boolean } = {}) => {
    const incoming = Array.from(uploadedFiles) as UploadedFile[]
    if (incoming.length === 0) return

    const records: ImportedFile[] = await Promise.all(
      incoming.map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        name: file.name,
        text: await file.text(),
        lastModified: file.lastModified,
        size: file.size,
      })),
    )

    if (fromFolder && files.length > 0) {
      setPendingFolderRecords(records)
      return
    }

    ingestFiles(records)
  }
```

- [ ] **Step 3: Mark the folder input as a folder load**

Change the folder input's onChange (line 634) from:

```tsx
              onChange={(event) => event.target.files && void handleFilesUpload(event.target.files)}
```

to:

```tsx
              onChange={(event) => event.target.files && void handleFilesUpload(event.target.files, { fromFolder: true })}
```

Leave the file input (line 626) and `handleDrop` unchanged — they keep appending.

- [ ] **Step 4: Add the confirm dialog markup**

Immediately after the import-modal block's closing `)}` (line ~960), and before the component's final `</div>` (line 961), insert:

```tsx
      {pendingFolderRecords && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-everforest-bg-dim/80 p-4"
          onClick={() => setPendingFolderRecords(null)}
        >
          <div
            className="w-full max-w-sm flex flex-col bg-everforest-bg1 border border-everforest-bg4 rounded-lg shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-everforest-bg4">
              <h3 className="text-sm text-everforest-fg flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-everforest-aqua" />
                Loading a new project folder
              </h3>
            </div>
            <div className="px-4 py-4 text-xs text-everforest-grey1">
              {files.length} session{files.length === 1 ? '' : 's'} already loaded. Clear them before loading?
            </div>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  if (!pendingFolderRecords) return
                  ingestFiles(pendingFolderRecords, { replace: true })
                  setPendingFolderRecords(null)
                }}
                className="px-3 py-2 rounded-md text-xs bg-everforest-aqua/15 text-everforest-aqua border border-everforest-aqua/40 hover:bg-everforest-aqua/25 transition-colors"
              >
                Clear &amp; load
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!pendingFolderRecords) return
                  ingestFiles(pendingFolderRecords)
                  setPendingFolderRecords(null)
                }}
                className="px-3 py-2 rounded-md text-xs bg-everforest-bg2 text-everforest-fg border border-everforest-bg4 hover:bg-everforest-bg3 transition-colors"
              >
                Keep &amp; add
              </button>
              <button
                type="button"
                onClick={() => setPendingFolderRecords(null)}
                className="px-3 py-2 rounded-md text-xs text-everforest-grey1 hover:text-everforest-fg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
```

`FolderOpen` is already imported (used in the sidebar header), so no new icon import is needed.

- [ ] **Step 5: Verify the build type-checks**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Run the full unit test suite**

Run: `npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add components/JsonlConverter.tsx
git commit -m "feat: confirm clearing loaded traces on folder-picker load"
```

---

## Manual verification (desktop app)

After all tasks, run `npm run dev` (or the Tauri desktop build) and confirm:

1. **Folder picker, empty browser:** click "Project Folder", pick a project — loads with no dialog.
2. **Folder picker, with sessions loaded:** pick another folder — dialog appears. "Clear & load" replaces; "Keep & add" appends; "Cancel" (and Esc/backdrop) leaves state untouched.
3. **Import modal, checkbox on (default):** import a project — replaces the loaded sessions.
4. **Import modal, checkbox off:** import a project — appends to the loaded sessions.
5. **Add Files / drag-drop:** still append, never prompt.
6. **Selection:** after a "Clear & load" or checkbox-on import, the first session of the newly loaded set is selected (no blank main panel).

---

## Notes for the implementer

- The whole component is a single client component (`'use client'`); all the new state lives alongside the existing `useState` hooks.
- Do not call `clearAllFiles()` before `ingestFiles()` to clear — that path has a stale-closure bug (`clearAllFiles` nulls `selectedFileId`, but a following `ingestFiles` call reads the pre-clear closure value and skips selecting the new first file). `computeIngest`'s `replace` mode is the correct mechanism.
- `npm run lint` is known-broken in this repo; rely on `npm run build` for type-checking.
