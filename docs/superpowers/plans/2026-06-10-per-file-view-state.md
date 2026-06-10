# Per-File View State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember each file's scroll position, view mode, and disclosure state (session-only, keyed by file ID) so re-selecting a file in the sidebar returns the user to the same spot.

**Architecture:** A pure in-memory store (`createViewStateStore`) holds a `Record<fileId, Partial<FileViewState>>`. A thin React hook (`useFileViewState`) gives `JsonlConverter` one stable store instance. The parent captures scroll/view-mode/disclosure changes into the store and restores them when `selectedFileId` changes. View mode stops being force-reset; scroll restores via a layout effect; disclosures become initialized-from-store with write-through on toggle.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind, Vitest. Pure store logic is unit-tested; DOM scroll/disclosure restore is verified manually (no component-test harness exists and none is added).

---

## File Structure

- **Create** `lib/jsonl/viewState.ts` — types (`ViewMode`, `FileViewState`, `ViewStateStore`), the pure `createViewStateStore()` factory, the `useFileViewState()` React hook, and a `useIsomorphicLayoutEffect` helper (avoids the SSR `useLayoutEffect` warning).
- **Create** `lib/jsonl/__tests__/viewState.test.ts` — unit tests for the pure store.
- **Modify** `components/JsonlConverter.tsx` — wire view mode, scroll, disclosure persistence and store cleanup; import `ViewMode` from `viewState.ts` and drop the local duplicate.
- **Modify** `components/jsonl/CompareView.tsx` — accept scroll ref/handler and "Show more" persistence props, pass them through.
- **Modify** `components/jsonl/ExpandableTextPane.tsx` — make "Show more" initialize-from-prop and write-through on toggle.

---

## Task 1: View-state store module + tests

**Files:**
- Create: `lib/jsonl/viewState.ts`
- Test: `lib/jsonl/__tests__/viewState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/jsonl/__tests__/viewState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createViewStateStore } from '../viewState'

describe('createViewStateStore', () => {
  it('returns an empty object for an unknown id', () => {
    const store = createViewStateStore()
    expect(store.get('missing')).toEqual({})
  })

  it('stores and returns a patched partial', () => {
    const store = createViewStateStore()
    store.patch('a', { viewMode: 'compare', transcriptScrollTop: 120 })
    expect(store.get('a')).toEqual({ viewMode: 'compare', transcriptScrollTop: 120 })
  })

  it('shallow-merges successive patches, later keys winning', () => {
    const store = createViewStateStore()
    store.patch('a', { viewMode: 'compare', transcriptScrollTop: 120 })
    store.patch('a', { transcriptScrollTop: 200, compareScrollTop: 40 })
    expect(store.get('a')).toEqual({
      viewMode: 'compare',
      transcriptScrollTop: 200,
      compareScrollTop: 40,
    })
  })

  it('does not leak state between ids', () => {
    const store = createViewStateStore()
    store.patch('a', { viewMode: 'compare' })
    expect(store.get('b')).toEqual({})
  })

  it('remove() drops a single id only', () => {
    const store = createViewStateStore()
    store.patch('a', { viewMode: 'compare' })
    store.patch('b', { viewMode: 'transcript' })
    store.remove('a')
    expect(store.get('a')).toEqual({})
    expect(store.get('b')).toEqual({ viewMode: 'transcript' })
  })

  it('clear() drops everything', () => {
    const store = createViewStateStore()
    store.patch('a', { viewMode: 'compare' })
    store.patch('b', { viewMode: 'transcript' })
    store.clear()
    expect(store.get('a')).toEqual({})
    expect(store.get('b')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run viewState`
Expected: FAIL — cannot resolve `../viewState` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/jsonl/viewState.ts`:

```ts
import { useEffect, useLayoutEffect, useRef } from 'react'

export type ViewMode = 'transcript' | 'compare'

export interface FileViewState {
  viewMode: ViewMode
  transcriptScrollTop: number
  compareScrollTop: number
  openDetails: Record<string, boolean>
  expandedPanes: Record<string, boolean>
}

export interface ViewStateStore {
  get(id: string): Partial<FileViewState>
  patch(id: string, partial: Partial<FileViewState>): void
  remove(id: string): void
  clear(): void
}

export function createViewStateStore(): ViewStateStore {
  const map: Record<string, Partial<FileViewState>> = {}

  return {
    get(id) {
      return map[id] ?? {}
    },
    patch(id, partial) {
      map[id] = { ...map[id], ...partial }
    },
    remove(id) {
      delete map[id]
    },
    clear() {
      for (const key of Object.keys(map)) delete map[key]
    },
  }
}

export function useFileViewState(): ViewStateStore {
  const ref = useRef<ViewStateStore | null>(null)
  if (!ref.current) ref.current = createViewStateStore()
  return ref.current
}

// useLayoutEffect logs a warning when run during SSR; fall back to useEffect on
// the server so scroll restoration stays flicker-free on the client without noise.
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run viewState`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/jsonl/viewState.ts lib/jsonl/__tests__/viewState.test.ts
git commit -m "feat: add in-memory per-file view-state store"
```

---

## Task 2: Persist and restore view mode

Replaces the force-reset of view mode on file switch with restore-from-store, and writes view-mode changes back to the store on every explicit change.

**Files:**
- Modify: `components/JsonlConverter.tsx`

- [ ] **Step 1: Import the store hook and shared type; remove the local `ViewMode`**

In `components/JsonlConverter.tsx`, update the existing import of `react` (currently `import React, { useEffect, useMemo, useRef, useState } from 'react'`) to add `useLayoutEffect` is NOT needed here (the store module provides `useIsomorphicLayoutEffect`); leave it as is. Add a new import line after the existing `@/lib/jsonl/types` import:

```ts
import {
  createViewStateStore,
  useFileViewState,
  useIsomorphicLayoutEffect,
  type ViewMode,
} from '@/lib/jsonl/viewState'
```

(`createViewStateStore` is not used directly here but importing the named hook keeps the wiring in one place; remove `createViewStateStore` from this import if the linter flags it as unused — only `useFileViewState`, `useIsomorphicLayoutEffect`, and `ViewMode` are required.)

Delete the now-duplicate local definition:

```ts
type ViewMode = 'transcript' | 'compare'
```

- [ ] **Step 2: Instantiate the store inside the component**

Immediately after the `const [viewMode, setViewMode] = useState<ViewMode>('transcript')` line, add:

```ts
  const store = useFileViewState()
```

- [ ] **Step 3: Replace the view-mode reset effect with a restore effect**

Find this effect:

```ts
  useEffect(() => {
    setViewMode('transcript')
  }, [selectedFileId])
```

Replace it with:

```ts
  useEffect(() => {
    if (!selectedFileId) return
    setViewMode(store.get(selectedFileId).viewMode ?? 'transcript')
  }, [selectedFileId, store])
```

- [ ] **Step 4: Add a `changeViewMode` helper that writes through to the store**

Just below the restore effect from Step 3, add:

```ts
  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    if (selectedFileId) store.patch(selectedFileId, { viewMode: mode })
  }
```

- [ ] **Step 5: Route the existing markdown guard through the store**

Find the guard effect:

```ts
  useEffect(() => {
    if (viewMode === 'compare' && !currentFile?.markdown) {
      setViewMode('transcript')
    }
  }, [currentFile?.markdown, viewMode])
```

Replace its body so the forced reset is also recorded:

```ts
  useEffect(() => {
    if (viewMode === 'compare' && !currentFile?.markdown) {
      setViewMode('transcript')
      if (selectedFileId) store.patch(selectedFileId, { viewMode: 'transcript' })
    }
  }, [currentFile?.markdown, viewMode, selectedFileId, store])
```

- [ ] **Step 6: Point the view-mode buttons at `changeViewMode`**

Find the two `ViewModeButton` usages:

```tsx
                    <ViewModeButton active={viewMode === 'transcript'} onClick={() => setViewMode('transcript')}>
                      Transcript
                    </ViewModeButton>
                    <ViewModeButton active={viewMode === 'compare'} onClick={() => setViewMode('compare')}>
                      Compare
                    </ViewModeButton>
```

Replace the two `onClick` handlers:

```tsx
                    <ViewModeButton active={viewMode === 'transcript'} onClick={() => changeViewMode('transcript')}>
                      Transcript
                    </ViewModeButton>
                    <ViewModeButton active={viewMode === 'compare'} onClick={() => changeViewMode('compare')}>
                      Compare
                    </ViewModeButton>
```

- [ ] **Step 7: Verify the app type-checks and lints**

Run: `npm run lint`
Expected: PASS (no errors). If `createViewStateStore` is reported unused, remove it from the Step 1 import.

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 8: Commit**

```bash
git add components/JsonlConverter.tsx
git commit -m "feat: remember view mode per file"
```

---

## Task 3: Persist and restore scroll position

Captures scroll for the Transcript preview container and the Compare container, restoring per `(file, viewMode)` after layout.

**Files:**
- Modify: `components/JsonlConverter.tsx`
- Modify: `components/jsonl/CompareView.tsx`

- [ ] **Step 1: Add scroll refs and handlers in `JsonlConverter`**

Below the `changeViewMode` helper (Task 2, Step 4), add:

```ts
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const compareScrollRef = useRef<HTMLDivElement>(null)

  const handleTranscriptScroll = () => {
    if (selectedFileId && transcriptScrollRef.current) {
      store.patch(selectedFileId, { transcriptScrollTop: transcriptScrollRef.current.scrollTop })
    }
  }

  const handleCompareScroll = () => {
    if (selectedFileId && compareScrollRef.current) {
      store.patch(selectedFileId, { compareScrollTop: compareScrollRef.current.scrollTop })
    }
  }
```

- [ ] **Step 2: Add scroll-restore layout effects**

Immediately after the handlers from Step 1, add:

```ts
  useIsomorphicLayoutEffect(() => {
    if (viewMode !== 'transcript' || !selectedFileId) return
    const el = transcriptScrollRef.current
    if (el) el.scrollTop = store.get(selectedFileId).transcriptScrollTop ?? 0
  }, [selectedFileId, viewMode, store, currentFile?.preview])

  useIsomorphicLayoutEffect(() => {
    if (viewMode !== 'compare' || !selectedFileId) return
    const el = compareScrollRef.current
    if (el) el.scrollTop = store.get(selectedFileId).compareScrollTop ?? 0
  }, [selectedFileId, viewMode, store])
```

- [ ] **Step 3: Attach the ref + handler to the Transcript container**

Find the transcript/preview container (the `else` branch of the `viewMode === 'compare'` ternary):

```tsx
                <div className="w-full flex-1 min-h-[220px] bg-everforest-bg2 border border-everforest-bg4 rounded-lg overflow-auto custom-scrollbar">
                  {currentFile.preview ? (
```

Add the ref and scroll handler:

```tsx
                <div
                  ref={transcriptScrollRef}
                  onScroll={handleTranscriptScroll}
                  className="w-full flex-1 min-h-[220px] bg-everforest-bg2 border border-everforest-bg4 rounded-lg overflow-auto custom-scrollbar"
                >
                  {currentFile.preview ? (
```

- [ ] **Step 4: Pass scroll ref + handler into `CompareView`**

Find the Compare usage:

```tsx
                <div className="w-full flex-1 min-h-[260px] overflow-hidden">
                  <CompareView fileId={currentFile.id} originalText={safeOriginal} markdownText={safeMarkdown} />
                </div>
```

Replace with:

```tsx
                <div className="w-full flex-1 min-h-[260px] overflow-hidden">
                  <CompareView
                    fileId={currentFile.id}
                    originalText={safeOriginal}
                    markdownText={safeMarkdown}
                    scrollRef={compareScrollRef}
                    onScroll={handleCompareScroll}
                  />
                </div>
```

- [ ] **Step 5: Accept the new props in `CompareView`**

In `components/jsonl/CompareView.tsx`, replace the props interface and the wrapping `<div>`. Current:

```tsx
interface CompareViewProps {
  fileId: string
  originalText: string
  markdownText: string
}

export function CompareView({ fileId, originalText, markdownText }: CompareViewProps) {
  return (
    <div className="h-full min-h-0 overflow-y-auto lg:overflow-hidden custom-scrollbar">
```

Replace with:

```tsx
interface CompareViewProps {
  fileId: string
  originalText: string
  markdownText: string
  scrollRef?: React.Ref<HTMLDivElement>
  onScroll?: React.UIEventHandler<HTMLDivElement>
}

export function CompareView({ fileId, originalText, markdownText, scrollRef, onScroll }: CompareViewProps) {
  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full min-h-0 overflow-y-auto lg:overflow-hidden custom-scrollbar">
```

> Note: on `lg` screens the outer container is `lg:overflow-hidden`, so its scroll restore is a no-op there (the inner panes scroll independently and are intentionally out of scope). Compare scroll restore is therefore effective on narrow/mobile widths. This matches the approved YAGNI exclusion of inner-pane scrollbars.

- [ ] **Step 6: Verify type-check and lint**

Run: `npm run lint`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/JsonlConverter.tsx components/jsonl/CompareView.tsx
git commit -m "feat: remember scroll position per file and view mode"
```

---

## Task 4: Persist and restore preview "Details" disclosures

Makes each preview item's `<details>` initialize from the store and write its open/closed state back on toggle.

**Files:**
- Modify: `components/JsonlConverter.tsx`

- [ ] **Step 1: Extend `PreviewPane` props**

In `components/JsonlConverter.tsx`, find the `PreviewPane` definition:

```tsx
function PreviewPane({ preview }: { preview: PreviewModel }) {
  return (
    <div className="p-4 space-y-3">
```

Replace the signature with:

```tsx
function PreviewPane({
  preview,
  openDetails,
  onToggleDetail,
}: {
  preview: PreviewModel
  openDetails: Record<string, boolean>
  onToggleDetail: (id: string, open: boolean) => void
}) {
  return (
    <div className="p-4 space-y-3">
```

- [ ] **Step 2: Drive the `<details>` from props**

Within `PreviewPane`, find:

```tsx
                <details className="mt-3 text-sm text-everforest-grey2" open={!item.isCollapsedByDefault}>
```

Replace with:

```tsx
                <details
                  className="mt-3 text-sm text-everforest-grey2"
                  open={openDetails[item.id] ?? !item.isCollapsedByDefault}
                  onToggle={(event) => onToggleDetail(item.id, (event.currentTarget as HTMLDetailsElement).open)}
                >
```

- [ ] **Step 3: Pass disclosure props from the render site**

Find the `PreviewPane` usage:

```tsx
                  {currentFile.preview ? (
                    <PreviewPane preview={currentFile.preview} />
                  ) : (
```

Replace with:

```tsx
                  {currentFile.preview ? (
                    <PreviewPane
                      preview={currentFile.preview}
                      openDetails={selectedFileId ? store.get(selectedFileId).openDetails ?? {} : {}}
                      onToggleDetail={(id, open) => {
                        if (!selectedFileId) return
                        store.patch(selectedFileId, {
                          openDetails: { ...store.get(selectedFileId).openDetails, [id]: open },
                        })
                      }}
                    />
                  ) : (
```

- [ ] **Step 4: Verify type-check and lint**

Run: `npm run lint`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/JsonlConverter.tsx
git commit -m "feat: remember expanded Details per file in preview"
```

---

## Task 5: Persist and restore Compare "Show more" expansion

Makes `ExpandableTextPane` initialize its expanded state from a prop and report changes, with `CompareView` mapping each pane to the store by its `resetKey`.

**Files:**
- Modify: `components/jsonl/ExpandableTextPane.tsx`
- Modify: `components/jsonl/CompareView.tsx`
- Modify: `components/JsonlConverter.tsx`

- [ ] **Step 1: Add `initialExpanded` / `onExpandedChange` props to `ExpandableTextPane`**

In `components/jsonl/ExpandableTextPane.tsx`, update the props interface:

```tsx
interface ExpandableTextPaneProps {
  title: string
  description: string
  text: string
  maxLines: number
  maxCharacters: number
  resetKey: string
  className?: string
}
```

to:

```tsx
interface ExpandableTextPaneProps {
  title: string
  description: string
  text: string
  maxLines: number
  maxCharacters: number
  resetKey: string
  className?: string
  initialExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}
```

And update the destructured params (add the two new props):

```tsx
export function ExpandableTextPane({
  title,
  description,
  text,
  maxLines,
  maxCharacters,
  resetKey,
  className,
  initialExpanded = false,
  onExpandedChange,
}: ExpandableTextPaneProps) {
```

- [ ] **Step 2: Initialize and reset `expanded` from the prop**

Find:

```tsx
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setExpanded(false)
    setCopied(false)
  }, [resetKey])
```

Replace with:

```tsx
  const [expanded, setExpanded] = useState(initialExpanded)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setExpanded(initialExpanded)
    setCopied(false)
  }, [resetKey])
```

> `initialExpanded` is intentionally omitted from the dependency array: it is read only when `resetKey` changes (i.e. when the pane is reused for a different file). The parent always supplies the value matching the new `resetKey` in the same render, so reading the latest prop inside the effect is correct.

- [ ] **Step 3: Add a toggle helper that reports changes**

Find the "Show more" button:

```tsx
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="min-h-9 px-3 py-1.5 rounded-md border border-everforest-bg4 bg-everforest-bg2 text-everforest-aqua text-xs flex items-center justify-center gap-1 hover:bg-everforest-bg3 transition-colors"
          >
```

Replace the `onClick`:

```tsx
          <button
            type="button"
            onClick={() => {
              const next = !expanded
              setExpanded(next)
              onExpandedChange?.(next)
            }}
            className="min-h-9 px-3 py-1.5 rounded-md border border-everforest-bg4 bg-everforest-bg2 text-everforest-aqua text-xs flex items-center justify-center gap-1 hover:bg-everforest-bg3 transition-colors"
          >
```

- [ ] **Step 4: Thread expansion state through `CompareView`**

In `components/jsonl/CompareView.tsx`, extend the props (building on Task 3, Step 5):

```tsx
interface CompareViewProps {
  fileId: string
  originalText: string
  markdownText: string
  scrollRef?: React.Ref<HTMLDivElement>
  onScroll?: React.UIEventHandler<HTMLDivElement>
  expandedPanes?: Record<string, boolean>
  onPaneExpandedChange?: (resetKey: string, expanded: boolean) => void
}

export function CompareView({
  fileId,
  originalText,
  markdownText,
  scrollRef,
  onScroll,
  expandedPanes = {},
  onPaneExpandedChange,
}: CompareViewProps) {
```

Then update the two `ExpandableTextPane` elements to pass the per-key state. Current:

```tsx
        <ExpandableTextPane
          title="Original JSONL"
          description="Original structure with noisy payloads hidden"
          text={originalText}
          maxLines={80}
          maxCharacters={24000}
          resetKey={`${fileId}:original`}
          className="h-[520px] lg:h-full"
        />
        <ExpandableTextPane
          title="Readable Markdown"
          description="Converted output with noisy payloads hidden"
          text={markdownText}
          maxLines={120}
          maxCharacters={32000}
          resetKey={`${fileId}:markdown`}
          className="h-[520px] lg:h-full"
        />
```

Replace with:

```tsx
        <ExpandableTextPane
          title="Original JSONL"
          description="Original structure with noisy payloads hidden"
          text={originalText}
          maxLines={80}
          maxCharacters={24000}
          resetKey={`${fileId}:original`}
          className="h-[520px] lg:h-full"
          initialExpanded={expandedPanes[`${fileId}:original`] ?? false}
          onExpandedChange={(expanded) => onPaneExpandedChange?.(`${fileId}:original`, expanded)}
        />
        <ExpandableTextPane
          title="Readable Markdown"
          description="Converted output with noisy payloads hidden"
          text={markdownText}
          maxLines={120}
          maxCharacters={32000}
          resetKey={`${fileId}:markdown`}
          className="h-[520px] lg:h-full"
          initialExpanded={expandedPanes[`${fileId}:markdown`] ?? false}
          onExpandedChange={(expanded) => onPaneExpandedChange?.(`${fileId}:markdown`, expanded)}
        />
```

- [ ] **Step 5: Supply expansion state from `JsonlConverter`**

In `components/JsonlConverter.tsx`, update the `CompareView` usage (from Task 3, Step 4) to add the two new props:

```tsx
                  <CompareView
                    fileId={currentFile.id}
                    originalText={safeOriginal}
                    markdownText={safeMarkdown}
                    scrollRef={compareScrollRef}
                    onScroll={handleCompareScroll}
                    expandedPanes={selectedFileId ? store.get(selectedFileId).expandedPanes ?? {} : {}}
                    onPaneExpandedChange={(key, expanded) => {
                      if (!selectedFileId) return
                      store.patch(selectedFileId, {
                        expandedPanes: { ...store.get(selectedFileId).expandedPanes, [key]: expanded },
                      })
                    }}
                  />
```

- [ ] **Step 6: Verify type-check and lint**

Run: `npm run lint`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/jsonl/ExpandableTextPane.tsx components/jsonl/CompareView.tsx components/JsonlConverter.tsx
git commit -m "feat: remember Compare Show-more expansion per file"
```

---

## Task 6: Prune store entries on delete / clear

Prevents the store from retaining state for files that are no longer loaded.

**Files:**
- Modify: `components/JsonlConverter.tsx`

- [ ] **Step 1: Remove the entry in `deleteFile`**

Find:

```ts
  const deleteFile = (fileId: string) => {
    setFiles((previous) => previous.filter((file) => file.id !== fileId))
    if (selectedFileId === fileId) {
      const remaining = files.filter((file) => file.id !== fileId)
      setSelectedFileId(remaining[0]?.id || null)
    }
  }
```

Replace with:

```ts
  const deleteFile = (fileId: string) => {
    setFiles((previous) => previous.filter((file) => file.id !== fileId))
    store.remove(fileId)
    if (selectedFileId === fileId) {
      const remaining = files.filter((file) => file.id !== fileId)
      setSelectedFileId(remaining[0]?.id || null)
    }
  }
```

- [ ] **Step 2: Clear the store in `clearAllFiles`**

Find:

```ts
  const clearAllFiles = () => {
    setFiles([])
    setSidecarFiles({})
    setSelectedFileId(null)
    setSearchResults({})
    setNotice('')
    setError('')
  }
```

Replace with:

```ts
  const clearAllFiles = () => {
    setFiles([])
    setSidecarFiles({})
    setSelectedFileId(null)
    setSearchResults({})
    setNotice('')
    setError('')
    store.clear()
  }
```

- [ ] **Step 3: Verify type-check and lint**

Run: `npm run lint`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/JsonlConverter.tsx
git commit -m "feat: prune view state when files are removed"
```

---

## Task 7: Full verification

Confirms the whole feature in the running app and that the suite stays green.

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — existing `parse-render` tests plus the new `viewState` tests.

- [ ] **Step 2: Lint and type-check the whole project**

Run: `npm run lint`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke test in the running app**

Run: `npm run dev` and open http://localhost:3000.

Load a project folder with at least two `.jsonl` files, then verify:

1. Select file A, click **Convert**, scroll the transcript partway down, and expand a **Details** disclosure.
2. Switch to **Compare**, click **Show more** in one pane, scroll (on a narrow window so the outer Compare container scrolls).
3. Select file B in the sidebar, then re-select file A. Expected: file A returns in **Compare**, with the same scroll position, the same **Details** expanded, and **Show more** still expanded.
4. Select file B (fresh file). Expected: it opens in **Transcript** at the top with nothing pre-expanded (independent state).
5. Delete file A, re-add it via **Add Files**. Expected: it comes back with default state (no leaked scroll/expansion), confirming `store.remove` pruned it.
6. Click **Clear**, reload the folder. Expected: all files start at defaults, confirming `store.clear` and session-only scope.

- [ ] **Step 4: Final confirmation**

If all checks pass, the feature is complete. Report the manual-test results explicitly (which checks passed). If any check fails, use superpowers:systematic-debugging before claiming completion.

---

## Self-Review

**Spec coverage:**
- Scroll position (per view mode) → Task 3. ✓
- View mode persistence + removal of force-reset (`:135`) → Task 2. ✓
- Disclosure state: preview Details → Task 4; Compare "Show more" → Task 5. ✓
- Search stays global → no task touches search (correct; out of scope). ✓
- Session-only, keyed by file ID, ref-backed store → Task 1. ✓
- Cleanup on delete/clear → Task 6. ✓
- Existing markdown guard (`:219-223`) preserved and routed through store → Task 2, Step 5. ✓
- Inner `ExpandableTextPane` `<pre>` scrollbars excluded → noted in Task 3, Step 5. ✓
- Unit tests for pure store; manual DOM verification; no new component-test harness → Task 1 + Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output. ✓

**Type consistency:** `ViewMode`, `FileViewState`, `ViewStateStore` defined in Task 1 and used consistently. Store methods `get`/`patch`/`remove`/`clear` match their call sites (Tasks 2–6). `initialExpanded`/`onExpandedChange` (Task 5) and `scrollRef`/`onScroll` (Task 3) prop names match between `CompareView`, `ExpandableTextPane`, and `JsonlConverter`. `openDetails`/`onToggleDetail` match between `PreviewPane` and its render site (Task 4). ✓
