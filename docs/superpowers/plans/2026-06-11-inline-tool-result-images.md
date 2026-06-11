# Inline Tool-Result Image Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a base64 image that is the direct result of a tool call (e.g. the Read tool reading a PNG) inline in the transcript — scaled, click-to-expand — and embed it as a data-URI in the markdown export.

**Architecture:** Parse-time, base64 image blocks found inside a `tool_result` are collected into a per-event `images: TranscriptImage[]` list (using the same side-channel mechanism as the existing `sidecars`/`warnings` arrays) and contribute an empty body. The list flows through the preview model to `TranscriptBody`, which renders the existing text body unchanged and then an images block with a click-to-expand lightbox. The body string is never rewritten or parsed — no marker protocol. Images outside tool results keep today's text placeholder.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind (Everforest theme), Vitest (node environment — no jsdom), lucide-react icons.

---

## Files

- `lib/jsonl/types.ts` — add `TranscriptImage` interface; add `images` field to `TranscriptEvent` and `PreviewItem`. (Tasks 1, 2)
- `lib/jsonl/parse.ts` — collect tool-result base64 images into a per-event `images` array; introduce a `RenderHelpers` type; empty-body fallback guard. (Task 1)
- `lib/jsonl/renderPreview.ts` — forward `event.images` to `PreviewItem`. (Task 2)
- `lib/jsonl/renderMarkdown.ts` — append data-URI image markdown per event image. (Task 3)
- `components/jsonl/TranscriptBody.tsx` — render the images block + lightbox. (Task 4)
- `components/JsonlConverter.tsx` — pass `images={item.images}` to `<TranscriptBody>`. (Task 4)
- `lib/jsonl/__tests__/parse-render.test.ts` — tests for Tasks 1–3.

All commands run from the worktree root:
`C:\repos\claude-JSONL-browser\.claude\worktrees\declarative-strolling-wreath`

---

## Task 1: Collect tool-result base64 images at parse time

**Files:**
- Modify: `lib/jsonl/types.ts`
- Modify: `lib/jsonl/parse.ts`
- Test: `lib/jsonl/__tests__/parse-render.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the `describe('Claude JSONL conversion', ...)` block in `lib/jsonl/__tests__/parse-render.test.ts` (e.g. after the existing `creates a compact preview model ...` test):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run parse-render`
Expected: FAIL — `event.images` is `undefined` (property does not exist yet), so the `toEqual([...])` / `toEqual([])` assertions fail.

- [ ] **Step 3: Add the `TranscriptImage` type and `images` field to `TranscriptEvent`**

In `lib/jsonl/types.ts`, add the interface immediately before `export interface EventDetail {` (around line 26):

```ts
export interface TranscriptImage {
  mediaType: string
  data: string
}
```

Then add an `images` field to `TranscriptEvent` (after the `details` field, around line 42):

```ts
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
```

- [ ] **Step 4: Import the type and add a `RenderHelpers` type in `parse.ts`**

In `lib/jsonl/parse.ts`, add `TranscriptImage` to the type import (the `import type { ... } from './types'` block at the top):

```ts
import type {
  EventDetail,
  ParseOptions,
  ParseResult,
  RawPreservedRecord,
  SidecarReference,
  TranscriptEvent,
  TranscriptImage,
} from './types'
```

Then add this interface right after the existing `interface ParsedLine { ... }` block (around line 16):

```ts
interface RenderHelpers {
  sidecarFiles: Record<string, string>
  sidecars: SidecarReference[]
  warnings: string[]
  images: TranscriptImage[]
}
```

- [ ] **Step 5: Replace the four inline `helpers` type annotations with `RenderHelpers`**

In `lib/jsonl/parse.ts`, update the signatures of `renderContent`, `renderBlock`, `renderToolResult`, and `renderSidecarContent` to use the new type. Each currently declares an inline object type like:

```ts
  helpers: {
    sidecarFiles: Record<string, string>
    sidecars: SidecarReference[]
    warnings: string[]
  },
```

Replace each of those four inline annotations with:

```ts
  helpers: RenderHelpers,
```

- [ ] **Step 6: Add the `extractBase64Image` helper**

In `lib/jsonl/parse.ts`, add this function just before `function redactLargeFields(` (around line 578):

```ts
function extractBase64Image(block: any): TranscriptImage | null {
  if (!block || typeof block !== 'object') return null
  if (block.type !== 'image') return null
  if (block.source?.type !== 'base64') return null

  const data = block.source?.data
  if (typeof data !== 'string' || data.length === 0) return null

  const mediaType = block.source?.media_type || block.source?.mediaType || 'image'
  return { mediaType, data }
}
```

- [ ] **Step 7: Collect images in `renderToolResult`**

In `lib/jsonl/parse.ts`, replace the array branch in `renderToolResult` (currently lines 424–431):

```ts
  if (Array.isArray(content)) {
    const rendered = content.map((item) => renderBlock(item, 'user', helpers))
    return {
      body: cleanMarkdown(rendered.map((item) => item.body).filter(Boolean).join('\n\n')),
      chips: unique([...chips, ...rendered.flatMap((item) => item.chips)]),
      details: rendered.flatMap((item) => item.details),
    }
  }
```

with:

```ts
  if (Array.isArray(content)) {
    const rendered = content.map((item) => {
      const image = extractBase64Image(item)
      if (image) {
        helpers.images.push(image)
        return {
          body: '',
          chips: ['image'],
          details: [{ label: 'Image metadata', content: stringifySafe(redactLargeFields(item)), language: 'json' }],
        }
      }
      return renderBlock(item, 'user', helpers)
    })
    return {
      body: cleanMarkdown(rendered.map((item) => item.body).filter(Boolean).join('\n\n')),
      chips: unique([...chips, ...rendered.flatMap((item) => item.chips)]),
      details: rendered.flatMap((item) => item.details),
    }
  }
```

Then replace the bare-object branch (currently lines 433–439):

```ts
  if (content && typeof content === 'object') {
    return {
      body: '```json\n' + stringifySafe(redactLargeFields(content)) + '\n```',
      chips,
      details: [{ label: 'Tool result object', content: stringifySafe(redactLargeFields(content)), language: 'json' }],
    }
  }
```

with:

```ts
  if (content && typeof content === 'object') {
    const image = extractBase64Image(content)
    if (image) {
      helpers.images.push(image)
      return {
        body: '',
        chips: [...chips, 'image'],
        details: [{ label: 'Image metadata', content: stringifySafe(redactLargeFields(content)), language: 'json' }],
      }
    }
    return {
      body: '```json\n' + stringifySafe(redactLargeFields(content)) + '\n```',
      chips,
      details: [{ label: 'Tool result object', content: stringifySafe(redactLargeFields(content)), language: 'json' }],
    }
  }
```

- [ ] **Step 8: Add `images` to the base event and thread it through `recordToEvent`**

In `lib/jsonl/parse.ts`, add an `images` field to the `base` object inside `recordToEvent` (currently lines 119–126):

```ts
  const base = {
    id: record.uuid || `${record.type || 'record'}-${lineNumber}`,
    lineNumber,
    recordType: String(record.type || 'unknown'),
    timestamp: record.timestamp,
    sessionId: record.sessionId,
    raw: record,
    images: [] as TranscriptImage[],
  }
```

Then replace the user/assistant branch (currently lines 128–144):

```ts
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
```

with:

```ts
  if (record.type === 'user' || record.type === 'assistant') {
    const images: TranscriptImage[] = []
    const rendered = renderContent(record.message?.content, record.type, {
      sidecarFiles: options.sidecarFiles || {},
      sidecars,
      warnings,
      images,
    })
    const title = record.type === 'user' ? 'User' : 'Assistant'

    return {
      ...base,
      role: record.type,
      title,
      body: rendered.body || (images.length > 0 ? '' : emptyMessageText(record.type)),
      chips: rendered.chips,
      details: appendRawDetails(rendered.details, record.toolUseResult),
      images,
    }
  }
```

- [ ] **Step 9: Thread `images` through `progressToEvent`**

In `lib/jsonl/parse.ts`, update `progressToEvent` (currently lines 216–251). Replace the `nested`/`rendered` setup (lines 223–230):

```ts
  const nested = record.data?.message
  const rendered = nested?.message
    ? renderContent(nested.message.content, nested.type === 'user' ? 'user' : 'assistant', {
        sidecarFiles: options.sidecarFiles || {},
        sidecars,
        warnings,
      })
    : { body: progressFallback(record), chips: [] as string[], details: [] as EventDetail[] }
```

with:

```ts
  const nested = record.data?.message
  const images: TranscriptImage[] = []
  const rendered = nested?.message
    ? renderContent(nested.message.content, nested.type === 'user' ? 'user' : 'assistant', {
        sidecarFiles: options.sidecarFiles || {},
        sidecars,
        warnings,
        images,
      })
    : { body: progressFallback(record), chips: [] as string[], details: [] as EventDetail[] }
```

Then add `images,` to the returned object (currently lines 234–250), placing it next to `raw: record,`:

```ts
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
    images,
    isCollapsedByDefault: true,
  }
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test -- --run parse-render`
Expected: PASS — all tests in the file pass, including the three new ones and the existing `[Image: image/png` assertions (which cover the unchanged non-tool-result fallback).

- [ ] **Step 11: Commit**

```bash
git add lib/jsonl/types.ts lib/jsonl/parse.ts lib/jsonl/__tests__/parse-render.test.ts
git commit -m "feat: collect tool-result base64 images at parse time"
```

---

## Task 2: Forward images through the preview model

**Files:**
- Modify: `lib/jsonl/types.ts`
- Modify: `lib/jsonl/renderPreview.ts`
- Test: `lib/jsonl/__tests__/parse-render.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside the `describe('Claude JSONL conversion', ...)` block in `lib/jsonl/__tests__/parse-render.test.ts`:

```ts
  it('forwards tool-result images onto the preview model', () => {
    const jsonl = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_jpeg',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aW1n' } },
            ],
          },
        ],
      },
    })

    const preview = renderPreview(parseClaudeJsonl(jsonl))

    expect(preview.items[0].images).toEqual([{ mediaType: 'image/jpeg', data: 'aW1n' }])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run parse-render`
Expected: FAIL — `preview.items[0].images` is `undefined`.

- [ ] **Step 3: Add the `images` field to `PreviewItem`**

In `lib/jsonl/types.ts`, add an `images` field to `PreviewItem` (after the `details` field, around line 93):

```ts
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
```

- [ ] **Step 4: Forward `images` in `renderPreview`**

In `lib/jsonl/renderPreview.ts`, add `images: event.images,` to the mapped object (after the `details:` line, around line 14):

```ts
    items: result.events.map((event) => ({
      id: event.id,
      role: event.role,
      title: event.title,
      timestamp: event.timestamp,
      body: event.body,
      chips: event.chips,
      details: event.details,
      images: event.images,
      hasDetails: event.details.length > 0,
      detailCount: event.details.length,
      isCollapsedByDefault: event.isCollapsedByDefault ?? event.details.length > 0,
    })),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --run parse-render`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/jsonl/types.ts lib/jsonl/renderPreview.ts lib/jsonl/__tests__/parse-render.test.ts
git commit -m "feat: forward tool-result images through the preview model"
```

---

## Task 3: Embed images as data-URIs in the markdown export

**Files:**
- Modify: `lib/jsonl/renderMarkdown.ts`
- Test: `lib/jsonl/__tests__/parse-render.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside the `describe('Claude JSONL conversion', ...)` block in `lib/jsonl/__tests__/parse-render.test.ts`:

```ts
  it('embeds tool-result images as data URIs in the markdown export', () => {
    const jsonl = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_export',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
            ],
          },
        ],
      },
    })

    const markdown = renderMarkdown(parseClaudeJsonl(jsonl), 'readable')

    expect(markdown).toContain('![image/png](data:image/png;base64,QUJD)')
    expect(markdown).not.toContain('_No displayable content._')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run parse-render`
Expected: FAIL — the export contains neither the data-URI nor (because the body is empty) anything but the `_No displayable content._` fallback.

- [ ] **Step 3: Append images in `renderEvent`**

In `lib/jsonl/renderMarkdown.ts`, replace the start of `renderEvent` (currently lines 57–63):

```ts
function renderEvent(event: TranscriptEvent, mode: MarkdownMode): string {
  const heading = `## ${event.title}${event.timestamp ? ` - ${formatTimestamp(event.timestamp)}` : ''}`
  const chunks = [heading, '', event.body || '_No displayable content._']

  if (event.chips.length > 0) {
    chunks.push('', `_${event.chips.join(' · ')}_`)
  }
```

with:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run parse-render`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — the existing sidecar/markdown test that asserts `[Image: image/png` (a non-tool-result image) still passes, and no data-URI leaks into it.

- [ ] **Step 6: Commit**

```bash
git add lib/jsonl/renderMarkdown.ts lib/jsonl/__tests__/parse-render.test.ts
git commit -m "feat: embed tool-result images as data URIs in markdown export"
```

---

## Task 4: Render the images block and lightbox in the UI

**Files:**
- Modify: `components/jsonl/TranscriptBody.tsx`
- Modify: `components/JsonlConverter.tsx`

No unit test: the project has no jsdom/testing-library, so component behavior is verified by a type-check, lint, and a manual run.

- [ ] **Step 1: Update `TranscriptBody.tsx` — imports and props**

In `components/jsonl/TranscriptBody.tsx`, replace the import block, the component signature, and the first state hooks (currently lines 1–20, down to and including `const [copied, setCopied] = useState(false)`) with:

```tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { createTextPreview, formatHiddenAmount } from '@/lib/jsonl/textPreview'
import type { TranscriptImage } from '@/lib/jsonl/types'
import { cn } from '@/lib/utils'

const BODY_MAX_LINES = 20
const BODY_MAX_CHARACTERS = 2000

interface TranscriptBodyProps {
  body: string
  images?: TranscriptImage[]
  className?: string
  initialExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function TranscriptBody({ body, images = [], className, initialExpanded = false, onExpandedChange }: TranscriptBodyProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const [copied, setCopied] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
```

- [ ] **Step 2: Add the Esc-to-close effect**

In `components/jsonl/TranscriptBody.tsx`, immediately after the `preview` `useMemo` (currently lines 22–25), add:

```tsx
  useEffect(() => {
    if (!lightboxSrc) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxSrc(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxSrc])
```

- [ ] **Step 3: Gate the text `<pre>` on non-empty body and render the images block + lightbox**

In `components/jsonl/TranscriptBody.tsx`, replace the returned JSX (currently lines 47–92, from `return (` down to the closing `</div>` and `)`) with:

```tsx
  return (
    <div className={className}>
      {preview.text.length > 0 && (
        <pre
          onClick={collapseOnBodyClick}
          title={expanded ? 'Click to collapse' : undefined}
          className={cn(
            'whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-everforest-fg',
            expanded && 'cursor-pointer',
          )}
        >
          {preview.text}
        </pre>
      )}

      {showControls && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {preview.isTruncated && (
            <span className="text-everforest-grey1">
              Hidden: {formatHiddenAmount(preview.hiddenLineCount, preview.hiddenCharacterCount)}
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              const next = !expanded
              setExpanded(next)
              onExpandedChange?.(next)
            }}
            className="min-h-9 px-1 text-everforest-aqua hover:text-everforest-fg transition-colors flex items-center gap-1"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{expanded ? 'Show less' : 'Show more'}</span>
          </button>

          <button
            type="button"
            onClick={() => void copyText()}
            className="min-h-9 px-1 text-everforest-blue hover:text-everforest-fg transition-colors flex items-center gap-1"
          >
            {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((image, index) => {
            const src = `data:${image.mediaType};base64,${image.data}`
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={index}
                src={src}
                alt={image.mediaType}
                loading="lazy"
                onClick={() => setLightboxSrc(src)}
                className="max-h-80 max-w-full cursor-zoom-in rounded-md border border-everforest-bg4"
              />
            )
          })}
        </div>
      )}

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxSrc}
            alt="Expanded image"
            onClick={(event) => event.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] rounded-md"
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Pass `images` from `JsonlConverter.tsx`**

In `components/JsonlConverter.tsx`, update the `<TranscriptBody>` usage (currently lines 1226–1230) to pass the images:

```tsx
              <TranscriptBody
                body={item.body}
                images={item.images}
                initialExpanded={expandedBodies[item.id] ?? false}
                onExpandedChange={(expanded) => onToggleBody(item.id, expanded)}
              />
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS — no type errors; lint reports no new errors (the `no-img-element` warnings are suppressed by the inline disables).

- [ ] **Step 6: Manual verification in the app**

Run: `npm run dev`
Then, in the browser at http://localhost:3000:
1. Load a JSONL transcript that contains a tool result with a base64 image (e.g. a Read of a PNG). If one is not handy, create a one-line `.jsonl` file with a `user` record containing a `tool_result` whose `content` is `[{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "<small base64 PNG>" } }]` and load it.
2. Confirm the image renders inline, scaled to at most ~320px tall, with no `[Image: ... base64 omitted]` text for that tool result.
3. Click the image and confirm the lightbox opens at full size over a dark backdrop; click the backdrop and press Esc to confirm both close it.
4. Confirm a normal text-only event still renders unchanged.

Expected: all four behaviors hold.

- [ ] **Step 7: Commit**

```bash
git add components/jsonl/TranscriptBody.tsx components/JsonlConverter.tsx
git commit -m "feat: render inline tool-result images with click-to-expand lightbox"
```

---

## Notes for the implementer

- **Why no marker:** a tool-result image is standalone, so there is no surrounding prose to position it against. The `images` list rendered as a block below the (usually empty) body is sufficient. The body string is never parsed or rewritten.
- **Scope guard:** only `renderToolResult` collects images. The general `renderBlock` image branch (lines ~340–349) is intentionally left untouched, so user-pasted and other non-tool-result images keep the `[Image: ...]` placeholder. Do not move image collection into `renderBlock`.
- **Empty body is expected** for a pure-image tool result; the gated `<pre>` (Task 4 Step 3) and the `emptyMessageText`/export fallbacks (Tasks 1 & 3) all account for it.
- **Compare view needs no change:** its "Readable Markdown" pane runs the export through `renderSafeText`, whose `BASE64_RUN_PATTERN` redacts the long data-URI base64 to `[base64 omitted: N chars]`. Only the downloaded `.md` carries the full payload.
```
