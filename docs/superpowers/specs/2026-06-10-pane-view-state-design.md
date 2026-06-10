# Remember per-file view state when switching between files

**Date:** 2026-06-10
**Status:** Approved (design)

## Problem

After loading a project folder, the user navigates between files ("views") via the
left-side pane. Each time a file is re-selected, its on-screen state resets:

- **View mode is actively reset.** `JsonlConverter.tsx:135-137` runs
  `setViewMode('transcript')` on every `selectedFileId` change, so a file left in
  Compare always snaps back to Transcript.
- **Scroll position is not preserved.** The Transcript/preview scroll container
  (`JsonlConverter.tsx:810`) and the Compare container (`CompareView.tsx:14`) are
  reused across files; scroll is neither captured nor restored per file.
- **Disclosure state is lost.** The preview "Details" disclosures
  (`JsonlConverter.tsx:983`) and the "Show more" expansion in
  `ExpandableTextPane` (`ExpandableTextPane.tsx:27-33`, explicitly cleared via
  `resetKey`) reset on every switch.

The user wants re-selecting a file to return them to the same spot.

## Scope

Remembered **per file**, keyed by the existing in-memory file ID, for the lifetime
of the session (cleared on reload — consistent with files and conversions, which
do not persist across reload either):

1. **Scroll position** of the main content surface, tracked separately per view
   mode (Transcript vs Compare).
2. **View mode** (`transcript` | `compare`).
3. **Disclosure state** — preview "Details" open/closed, and `ExpandableTextPane`
   "Show more" expanded/collapsed.

### Explicitly out of scope (YAGNI)

- **Search term stays global.** The search box (`JsonlConverter.tsx:489`) filters
  the sidebar file list and counts matches across all files. It is a cross-file
  filter, not per-file view state, and is left untouched.
- **No cross-reload persistence.** No `localStorage`. Files/conversions are not
  persisted across reload, so persisting view state across reload would be
  inconsistent and require path-based keying + re-conversion handling.
- **Inner `ExpandableTextPane` `<pre>` scrollbars are not persisted.** Only the
  main scroll surface per view mode is remembered. The inner code panes reset to
  top, which matches the fact that toggling "Show more" re-renders their content.
- **No new component-test harness.** The repo has no component/DOM test setup;
  this change will not add one.

## Approach

**Centralized per-file view-state store in the parent**, extracted into a small
module to keep `JsonlConverter` focused.

Rejected alternatives:

- *Keep every file's pane mounted and hide non-selected with CSS* — the DOM would
  preserve state for free, but a project folder can hold dozens–hundreds of large
  transcripts; mounting all of them is a memory/performance problem.
- *Persist to `localStorage` keyed by file path* — survives reloads, but
  inconsistent with the rest of the app (files don't survive reload) and more
  complex. Rejected per scope decision above.

## Data model

```ts
// lib/jsonl/viewState.ts
type ViewMode = 'transcript' | 'compare'

interface FileViewState {
  viewMode: ViewMode
  transcriptScrollTop: number
  compareScrollTop: number
  openDetails: Record<string, boolean>   // preview item id -> open? (sparse: only deviations stored)
  expandedPanes: Record<string, boolean> // ExpandableTextPane resetKey -> "Show more" expanded?
}
```

A `useFileViewState()` hook wraps a `useRef<Record<string, Partial<FileViewState>>>`
and exposes:

- `get(id): Partial<FileViewState>` — returns the stored partial (or `{}`).
- `patch(id, partial): void` — shallow-merges a partial into the stored entry.
- `remove(id): void` — deletes a file's entry (used by delete/clear).

The store is a ref, so scroll write-throughs don't trigger re-renders.

## Wiring

### View mode

Replace the unconditional reset effect (`JsonlConverter.tsx:135-137`) with:

- On `selectedFileId` change, set `viewMode` from
  `store.get(id).viewMode ?? 'transcript'`.
- A separate effect writes `viewMode` into the store whenever it changes.
- The existing guard (`JsonlConverter.tsx:219-223`) that forces Transcript when a
  file has no markdown stays — restore can never land on Compare for an
  unconverted file.

### Scroll position

- Attach a ref + `onScroll` to the Transcript preview container
  (`JsonlConverter.tsx:810`) and the Compare container (`CompareView.tsx:14`).
- `onScroll` write-throughs `transcriptScrollTop` / `compareScrollTop` into the
  store (plain ref write — no re-render).
- A `useLayoutEffect` keyed on `[selectedFileId, viewMode]` restores `scrollTop`
  after paint, defaulting to 0 when nothing is stored.

`CompareView` gains an optional scroll-ref / scroll-handler prop (or a small
wrapper) so the parent can observe and restore its scroll without `CompareView`
owning the persistence.

### Disclosures

- **Preview "Details"** (`JsonlConverter.tsx:983`): currently uncontrolled
  `<details open={!isCollapsedByDefault}>`. Add `onToggle` to write
  `openDetails[item.id]` into the store; compute `open` from
  `store.get(id).openDetails[item.id] ?? !item.isCollapsedByDefault`. Threaded
  via a prop on `PreviewPane`.
- **Compare "Show more"** (`ExpandableTextPane.tsx:27-33`): initialize `expanded`
  from `store.get(...).expandedPanes[resetKey] ?? false` and write-through on
  toggle, keyed by the existing `resetKey`. The `resetKey` effect that clears
  `copied` stays.

### Cleanup

`deleteFile` and `clearAllFiles` call `store.remove(id)` (clear removes all) so
the map cannot retain entries for files no longer loaded.

## Testing

- **Unit:** the store/hook logic (`get` / `patch` / `remove`, and the
  default-vs-stored resolution helpers) is pure and unit-tested alongside the
  existing `lib/jsonl/__tests__/`.
- **Manual:** scroll-restore, view-mode restore, and disclosure restore are
  DOM/integration behaviors verified by hand in the running app (`npm run dev`):
  scroll + expand + switch to Compare on file A, switch to file B, return to A,
  confirm everything is restored; delete a file and confirm no stale state leaks.
