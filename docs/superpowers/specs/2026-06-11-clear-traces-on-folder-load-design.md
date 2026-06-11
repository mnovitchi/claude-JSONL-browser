# Clear previous traces on folder load — design

**Date:** 2026-06-11
**Status:** Approved (pending spec review)

## Problem

Loading conversations from a folder always *appends* to whatever is already
loaded. Both folder paths funnel into `ingestFiles`, which does
`setFiles(prev => [...prev, ...newFiles])`. When a user opens a new project
folder, the previous project's sessions linger in the sidebar, mixed with the
new ones. There is no way to start fresh short of manually clearing first.

We want folder loads to offer to clear (unload) the currently loaded traces,
defaulting to "yes, clear".

## Scope

Only the two **folder** entry points prompt:

1. **Projects import modal** — `openImportModal` / `importProject`, picking a
   project from `~/.claude/projects` (desktop app).
2. **OS folder picker** — the "Project Folder" button
   (`folderInputRef`, a `webkitdirectory` input).

Individual file loads keep appending silently, unchanged:

- "Add Files" button (`fileInputRef`)
- drag-and-drop (`handleDrop` → `handleFilesUpload`)

## Design

### 1. Pure ingest helper (extracted + unit-tested)

`ingestFiles` currently mixes pure computation (filtering records into
log/sidecar buckets, building `FileData`, deciding the notice/error message)
with React `setState` calls. Extract the pure part into a new module so the
new replace-vs-append branch can be unit-tested without React.

**New file `lib/jsonl/ingest.ts`:**

Move these from `JsonlConverter.tsx` into the module and export them:

- `FileData` interface
- `isConversationLog(file: ImportedFile): boolean`
- `isSidecarFile(file: ImportedFile): boolean`
- `displayName(file: ImportedFile): string`

New pure function:

```ts
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

export function computeIngest(
  prevFiles: FileData[],
  prevSidecars: Record<string, string>,
  selectedFileId: string | null,
  records: ImportedFile[],
  makeId: () => string,
  options: IngestOptions = {},
): IngestResult
```

- `makeId` is injected (the component passes `generateFileId`; tests pass a
  deterministic counter) so the helper stays pure and testable.
- **Append mode (`replace` falsy)** — current behavior:
  - `sidecars` = `{ ...prevSidecars, ...newSidecars }`.
  - When new sidecars arrive, already-`converted` files in `prevFiles` get
    their conversion reset (`converted:false`, `markdown/fullMarkdown/
    parseResult/preview` → `null`) so they re-convert with the new outputs.
  - `files` = `[...prevFiles, ...newFiles]`.
  - `selectedFileId` = existing `selectedFileId` if set, else `newFiles[0].id`.
- **Replace mode (`replace` true)**:
  - `sidecars` = `newSidecars` only (previous discarded).
  - `files` = `newFiles` only.
  - `selectedFileId` = `newFiles[0]?.id ?? null`.
  - The converted-reset step is irrelevant (no previous files survive).
- Notice/error strings: same rules as today (no JSONL found → error; sidecars
  only → notice; files + sidecars → count notice).
- `records.length === 0` → return an unchanged-but-valid result the caller can
  treat as a no-op (matches today's early `return`).

**In `JsonlConverter.tsx`**, `ingestFiles` becomes a thin wrapper that calls
`computeIngest` with current state and applies the result via `setState`,
accepting `{ replace }`:

```ts
const ingestFiles = (records: ImportedFile[], { replace = false } = {}) => {
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

Computing against the captured `files`/`sidecarFiles`/`selectedFileId` (rather
than functional updaters) is safe here because the values are read together in
one render and written together — and it sidesteps the stale-closure bug that
calling `clearAllFiles()` then `ingestFiles()` would cause (`clearAllFiles`
nulls `selectedFileId`, but the closure in a separate `ingestFiles` call would
still see the old value and skip selecting the new first file).

### 2. Import modal — "Clear loaded sessions" checkbox (default on)

- New state: `const [clearOnImport, setClearOnImport] = useState(true)`.
- Add a footer row in the import modal (below the scrollable project list,
  always visible) with a checkbox: **"Clear loaded sessions before importing"**,
  checked by default, Everforest-styled.
- `importProject` passes the flag:
  `ingestFiles(records, { replace: clearOnImport })`.
- Harmless no-op when nothing is loaded.

### 3. OS folder picker — three-way confirm dialog (only when non-empty)

- `handleFilesUpload(uploadedFiles, { fromFolder = false } = {})`.
  - The folder input (`folderInputRef`, line 634) passes `{ fromFolder: true }`.
  - The file input (line 626) and `handleDrop` pass nothing → append as today.
- After reading `records`, if `fromFolder && files.length > 0`:
  - Stash records: `setPendingFolderRecords(records)` (new state,
    `ImportedFile[] | null`).
  - Render a confirm dialog (reuse the import-modal overlay/box styling) when
    `pendingFolderRecords` is non-null:

    ```
    Loading a new project folder.
    {files.length} session(s) are already loaded.

      [ Clear & load ]   (default-focused)
      [ Keep & add ]
      [ Cancel ]
    ```

    - **Clear & load** → `ingestFiles(pending, { replace: true })`, then clear pending.
    - **Keep & add** → `ingestFiles(pending)`, then clear pending.
    - **Cancel** / Esc / backdrop click → just clear pending (discard).
- If `!fromFolder` or `files.length === 0`, call `ingestFiles(records, ...)`
  directly with no dialog. (Empty + folder → replace is moot, so plain
  `ingestFiles(records)` is fine.)

## Data flow

```
folder picker onChange ─┐
                        ├─ handleFilesUpload(files, {fromFolder})
drag-drop / Add Files ──┘        │
                                 ├─ fromFolder && files.length>0 ─→ pendingFolderRecords ─→ confirm dialog ─→ ingestFiles(pending, {replace?})
                                 └─ else ─────────────────────────────────────────────────────────────────→ ingestFiles(records)

import modal: importProject ─→ ingestFiles(records, {replace: clearOnImport})

ingestFiles ─→ computeIngest(state, records, makeId, {replace}) ─→ setState(files/sidecars/selected) + notice/error
```

## Error handling

- Import / read failures: unchanged (`importProject`'s try/catch, the existing
  `importError` surface).
- `computeIngest` never throws; "no JSONL found" stays a soft error string
  surfaced via `showError`.
- Cancelling the folder dialog leaves state untouched.

## Testing

`npm run lint` is broken (pre-existing ESLint config issue) — verify with the
type-checking build (`npm run build`) plus `vitest`.

New unit tests in `lib/jsonl/__tests__/ingest.test.ts` for `computeIngest`,
using a deterministic `makeId`:

1. Append mode adds new files to existing, preserves current selection.
2. Append mode selects the first new file when nothing was selected.
3. Append mode merges sidecars and resets `converted` flags on prior files.
4. **Replace mode** drops prior files/sidecars, keeps only new ones, selects
   the new first file (regression guard for the stale-selection bug).
5. Replace mode with prior selection still selects the new first file.
6. No JSONL in records → error string; sidecars-only → notice string.
7. Empty records → no-op result.

Manual check (desktop app): load a project, import another with the checkbox
on (replaces) and off (appends); use the folder picker with sessions loaded and
exercise all three dialog buttons; folder picker on an empty browser loads with
no dialog.

## Out of scope

- Changing append behavior for individual file uploads / drag-drop.
- Persisting the checkbox preference across sessions.
- Any change to conversion, search, sort, or export.
