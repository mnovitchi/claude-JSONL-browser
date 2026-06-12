# Inline Image Rendering — Design

**Date:** 2026-06-11
**Status:** Approved, pending implementation plan

## Problem

When a tool call returns an image (e.g. the Read tool reading a PNG), it
currently renders as a text placeholder:
`[Image: image/png, base64 omitted (105440 chars)]`. The base64 payload is
discarded from the body at parse time (`parse.ts` `renderBlock` image branch)
and survives only inside `event.raw` and a redacted `details` entry. Users
cannot see the actual image.

## Goal

Render an image that is the **direct result of a tool call** inline in the
transcript, scaled to a sensible display size, with click-to-expand for
full-size viewing. The image should also survive markdown export.

## Decisions (locked)

- **Scope:** only images that are the **direct result of a tool call** — i.e. a
  base64 image block inside a `tool_result` content array (the Read-an-image
  case). User-pasted images and images in any other context keep today's text
  placeholder and are out of scope.
- **Placement:** images render as a block beneath the tool-result's text body.
  Because a tool-result image is standalone (no interleaved prose), there is no
  need to position it inline among text — so **no marker protocol is required**.
- **Scaling:** scaled thumbnail with click-to-expand into a lightbox.
- **Export:** embed images as data-URIs in the markdown export.
- **Approach:** carry images as a plain `images: TranscriptImage[]` list on the
  event (populated via the same per-event side-channel as `sidecars`/`warnings`)
  and render them as a block. This deliberately avoids the marker-based inline
  approach and a full markdown renderer; both are larger than this feature
  needs. Inline-among-text positioning and full transcript markdown remain
  possible future projects.

## Architecture

### Data flow today

```
parseClaudeJsonl (parse.ts)
  -> recordToEvent (user records carry tool_result blocks)
     -> renderContent -> renderBlock (per content block)
        -> renderToolResult (tool_result content; arrays map through renderBlock)
  -> TranscriptEvent { body: string, chips, details, ... }
renderPreview -> PreviewItem { body, ... }
TranscriptBody renders item.body as plain text in a <pre>
renderMarkdown -> export string (also feeds Compare view via renderSafeText)
```

The design adds a structured `images` list alongside `body`, populated only on
the tool-result path, and renders it as a block. The `body` string itself is
never rewritten or parsed.

### 1. Data model — `lib/jsonl/types.ts`

```ts
export interface TranscriptImage {
  mediaType: string // e.g. "image/png"
  data: string      // raw base64, NO "data:" prefix
}
```

Add `images: TranscriptImage[]` to both `TranscriptEvent` and `PreviewItem`.
No id field is needed — images render in encounter order as a list.

### 2. Parsing — `lib/jsonl/parse.ts`

- Add a fresh **per-event** `images: TranscriptImage[]` array, created in
  `recordToEvent` (and `progressToEvent`, since agent progress can wrap a
  user/tool message), threaded through the existing `helpers` object next to
  the shared `sidecars` / `warnings` arrays. After rendering, assign
  `event.images = images`.
- In `renderToolResult`, the `Array.isArray(content)` branch: for each item, if
  it is a base64 image block (`item.type === 'image'`,
  `item.source?.type === 'base64'`, non-empty `source.data`):
  - push `{ mediaType, data: source.data }` to `helpers.images`
  - contribute an **empty body** for that item (so a pure-image tool result has
    no leftover placeholder text), keeping the `image` chip and the existing
    redacted metadata `details` entry.
  - Non-image items continue through `renderBlock` unchanged.
- Also guard the bare-object `tool_result` branch: if `content` itself is a
  single base64 image object, handle it the same way.
- The general `renderBlock` `block.type === 'image'` branch is left as-is (text
  placeholder). This keeps user-pasted / non-tool-result images out of scope.
- Empty-body fallback: in `recordToEvent`, compute
  `body: rendered.body || (images.length ? '' : emptyMessageText(record.type))`
  so a tool result that is purely an image is not labelled "no displayable
  content".

### 3. Preview pipeline — `lib/jsonl/renderPreview.ts`

Forward `images: event.images` onto each `PreviewItem`.

### 4. Rendering — `components/jsonl/TranscriptBody.tsx`

- New prop: `images: TranscriptImage[]` (default `[]`).
- Body rendering is unchanged: the existing `<pre>` with `preview.text`, the
  truncation controls, and the copy button all stay exactly as they are. (When
  the body is empty and images exist, the `<pre>` simply renders nothing — no
  special handling needed beyond not showing truncation controls, which already
  depends on `preview.isTruncated`.)
- After the body, render an images block (only when `images.length > 0`): each
  image as an `<img>`:
  - `src={`data:${mediaType};base64,${data}`}`
  - scaled: `max-h-80 max-w-full`, rounded border, `loading="lazy"`,
    `cursor-zoom-in`, `alt={mediaType}`
  - `onClick` opens the lightbox for this image's data-URI.
- **Lightbox:** local `const [lightboxSrc, setLightboxSrc] = useState<string|null>(null)`.
  When non-null, render a `fixed inset-0 z-50` overlay: dark backdrop
  (`bg-black/80`), image centered and fit to viewport
  (`max-h-[90vh] max-w-[90vw]`, aspect preserved). Clicking the backdrop closes
  it (`setLightboxSrc(null)`); clicking the image itself calls
  `stopPropagation`. An Esc `keydown` listener is added while open and removed
  on close (mirrors the folder-dialog Esc pattern in `JsonlConverter.tsx`).

### 5. Wiring — `components/JsonlConverter.tsx`

- Pass `images={item.images}` to `<TranscriptBody>` (~line 1226).
- Search index (~line 201): no change needed — the body contains no markers.

### 6. Export — `lib/jsonl/renderMarkdown.ts`

- In `renderEvent`, after the existing body chunk, append one markdown image per
  `event.images` entry: `![${mediaType}](data:${mediaType};base64,${data})`.
- No change for the Compare view: its "Readable Markdown" pane runs the export
  string through `renderSafeText`, whose `BASE64_RUN_PATTERN` already redacts the
  long base64 run to `[base64 omitted: N chars]`. So the compare pane shows a
  clean placeholder; only the downloaded `.md` carries the full data-URI.

## Error handling / edge cases

- **Non-base64 image (URL source) or empty data, even inside a tool_result:**
  keep today's `[Image: ...]` text placeholder, push no image.
- **Tool result with both text and image(s):** text renders in the body, images
  render as the block beneath it.
- **Multiple images in one tool result:** all render in the images block, in
  encounter order.
- **Very large images:** displayed scaled; `loading="lazy"` defers offscreen
  decode. No size cap beyond the CSS max dimensions.
- **Images outside tool results** (user-pasted, sidecar-embedded, etc.):
  unchanged text placeholder — intentionally out of scope.

## Testing

Test infrastructure is vitest in a node environment — no jsdom /
testing-library — so tests are scoped to the pure `lib/` functions. Component
behavior (the rendered `<img>` block and the lightbox) is verified by running
the app.

- `lib/jsonl/__tests__/parse-render.test.ts`:
  - Update the existing assertion expecting `[Image: image/png` for a base64
    image inside a tool_result: it should now produce an `event.images` entry
    carrying the original base64 + media type, and no placeholder text in the
    body.
  - Add: a base64 image as a direct tool_result content array entry produces an
    `event.images` entry.
  - Add: a URL-source / empty-data image inside a tool_result still falls back
    to the `[Image: ...]` text placeholder with no image entry.
  - Add: a base64 image in a non-tool-result context (e.g. plain user content)
    keeps the text placeholder and produces no `event.images` entry.
- `renderMarkdown`: a tool-result base64 image is appended to the event as a
  `![...](data:...;base64,...)` data-URI in the export string.

## Out of scope

- Inline-among-text image positioning (the dropped marker approach).
- Rendering user-pasted or sidecar-embedded images.
- Full markdown rendering of transcript bodies.
- Lightbox zoom/pan, image carousel / prev-next navigation.
- Any per-image size cap or downscaling of the embedded data.
