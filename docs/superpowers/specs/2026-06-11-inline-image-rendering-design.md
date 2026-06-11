# Inline Image Rendering — Design

**Date:** 2026-06-11
**Status:** Approved, pending implementation plan

## Problem

Image tool results (and user-pasted images) currently render as a text
placeholder: `[Image: image/png, base64 omitted (105440 chars)]`. The base64
payload is discarded from the body at parse time (`parse.ts` `renderBlock`
image branch) and survives only inside `event.raw` and a redacted `details`
entry. Users cannot see the actual image.

## Goal

Render image blocks inline, at their exact position among the surrounding
text, scaled to a sensible display size, with click-to-expand for full-size
viewing. Images should also survive markdown export.

## Decisions (locked)

- **Placement:** inline at the exact position within the message/tool-result
  (not a gallery below the text).
- **Scope:** all image blocks — tool-result images *and* user-pasted images
  (the same `renderBlock` code path handles both).
- **Scaling:** scaled thumbnail with click-to-expand into a lightbox.
- **Export:** embed images as data-URIs in the markdown export.
- **Approach:** a Private-Use-Area marker spliced into the plain-text body plus
  a structured image list — *not* a full markdown renderer. Rationale: the
  marker approach is surgical (no new dependency, leaves the plain-text reading
  model and the line/char truncation in `TranscriptBody` untouched, tiny
  security surface). A full markdown renderer was rejected for this task because
  it implies a transcript-wide visual redesign, a new dependency
  (`react-markdown` + `remark-gfm` + sanitizer), a truncation rewrite, and a
  data-URI sanitization story — far more than the feature requires. It remains
  a reasonable future project if formatted-markdown-everywhere is desired.

## Architecture

### Data flow today

```
parseClaudeJsonl (parse.ts)
  -> recordToEvent / progressToEvent
     -> renderContent -> renderBlock (per content block)
        -> renderToolResult (tool_result content; arrays recurse into renderBlock)
  -> TranscriptEvent { body: string, chips, details, ... }
renderPreview -> PreviewItem { body, ... }
TranscriptBody renders item.body as plain text in a <pre>
renderMarkdown -> export string (also feeds Compare view via renderSafeText)
```

`body` is a flat plain-text string everywhere. The design carries image
payloads as **structured data alongside the body**, and embeds **short markers
in the body text** to record each image's position.

### 1. Data model — `lib/jsonl/types.ts`

```ts
export interface TranscriptImage {
  id: string        // unique within its event, e.g. "img-0"
  mediaType: string // e.g. "image/png"
  data: string      // raw base64, NO "data:" prefix
}
```

Add `images: TranscriptImage[]` to both `TranscriptEvent` and `PreviewItem`.

### 2. Marker protocol — `lib/jsonl/parse.ts`

- The marker wraps the image id in two Private Use Area code points,
  U+E000 (lead) and U+E001 (trail). PUA characters do not occur in normal
  transcript text, so they will not collide with content and render invisibly
  if ever left unmatched. Written with escapes, the marker for id `img-0` is the
  string `"\uE000img-0\uE001"`.
- Export shared constants/helpers from `parse.ts` so other modules reuse them:
  - `imageMarker(id)` returns `` `\uE000${id}\uE001` ``
  - `IMAGE_MARKER_PATTERN` is the global, id-capturing regex
    `/\uE000(img-\d+)\uE001/g`

### 3. Parsing — `lib/jsonl/parse.ts`

- Thread a fresh **per-event** `images: TranscriptImage[]` array through the
  existing `helpers` object (same mechanism as the shared `sidecars` /
  `warnings` arrays, but created new per event). Create it in `recordToEvent`
  (user/assistant branch) and in `progressToEvent`, and assign it to
  `event.images` after rendering.
- In `renderBlock`'s `block.type === 'image'` branch:
  - When `block.source?.type === 'base64'` and `source.data` is a non-empty
    string:
    - `const id = 'img-' + helpers.images.length`
    - push `{ id, mediaType, data: source.data }` to `helpers.images`
    - return body = `imageMarker(id)`, keep `chips: ['image']` and the existing
      redacted `details` entry (raw metadata stays inspectable).
  - Otherwise (URL source, missing/empty data): keep today's
    `[Image: ${mediaType}...]` text fallback and push no image.
- Tool-result images need no special handling: `renderToolResult` already
  passes `helpers` into `renderBlock` for array content, so nested images land
  in the same per-event `images` array automatically.

### 4. Preview pipeline — `lib/jsonl/renderPreview.ts`

Forward `images: event.images` onto each `PreviewItem`.

### 5. Rendering — `components/jsonl/TranscriptBody.tsx`

- New prop: `images: TranscriptImage[]`.
- Build a lookup `Map<id, TranscriptImage>` from the prop.
- Replace the single `<pre>{preview.text}</pre>` with an interleaved render:
  split `preview.text` on `IMAGE_MARKER_PATTERN`; text segments are rendered
  with the existing `<pre>` styling (`whitespace-pre-wrap break-words font-mono
  text-sm`), and each captured id becomes an `<img>`:
  - `src={`data:${mediaType};base64,${data}`}`
  - scaled: `max-h-80 max-w-full`, rounded border, `loading="lazy"`,
    `cursor-zoom-in`, `alt={mediaType}`
  - `onClick` sets lightbox state to this image's data-URI
  - if an id has no matching image (shouldn't happen), render the raw matched
    text unchanged.
- **Lightbox:** local `const [lightboxSrc, setLightboxSrc] = useState<string|null>(null)`.
  When non-null render a `fixed inset-0 z-50` overlay: dark backdrop
  (`bg-black/80`), image centered and fit to viewport
  (`max-h-[90vh] max-w-[90vw]`, aspect preserved). Clicking the backdrop closes
  (`setLightboxSrc(null)`); clicking the image itself calls `stopPropagation`.
  An Esc `keydown` listener is added while open and removed on close (mirrors
  the folder-dialog Esc pattern in `JsonlConverter.tsx`).
- **Copy button:** strip markers from the copied text, substituting
  `[Image: ${mediaType}]` (looked up by id) so the clipboard stays readable
  instead of containing invisible PUA characters.
- **Truncation interaction:** unchanged. `createTextPreview` still operates on
  the marker-bearing string; markers are 3 code points each, so line/char
  counts are effectively unaffected. A marker located in the truncated-away
  region simply does not render until the body is expanded — acceptable.

### 6. Wiring — `components/JsonlConverter.tsx`

- Pass `images={item.images}` to `<TranscriptBody>` (~line 1226).
- Search index (~line 201) builds a string from `item.body`; strip markers
  there with `IMAGE_MARKER_PATTERN` so invisible PUA characters never end up in
  the search corpus.

### 7. Export — `lib/jsonl/renderMarkdown.ts`

- In `renderEvent`, after assembling `event.body`, replace each marker with
  `![${mediaType}](data:${mediaType};base64,${data})` using `event.images`
  (lookup by captured id). Unmatched id → replace with `[Image]`.
- No change needed for the Compare view: its "Readable Markdown" pane runs the
  export string through `renderSafeText`, whose `BASE64_RUN_PATTERN` already
  redacts the long base64 run to `[base64 omitted: N chars]`. So the compare
  pane shows a clean placeholder; only the downloaded `.md` carries the full
  data-URI.

## Error handling / edge cases

- **Non-base64 image source (URL) or empty data:** text-placeholder fallback,
  no marker, no image entry.
- **Marker present but image missing at render/export:** render the raw text /
  `[Image]` respectively; never crash.
- **Very large images:** displayed scaled; `loading="lazy"` defers offscreen
  decode. No size cap beyond the CSS max dimensions (matches user decision to
  render all images).
- **Multiple images in one event:** ids are sequential (`img-0`, `img-1`, …)
  within the event; markers and lookups stay unambiguous.

## Testing

Test infrastructure is vitest in a node environment — no jsdom /
testing-library — so tests are scoped to the pure `lib/` functions. Component
behavior (inline `<img>`, lightbox, copy-strip) is verified by running the app.

- `lib/jsonl/__tests__/parse-render.test.ts`:
  - Update the existing assertion expecting `[Image: image/png` for a base64
    image: it should now produce a marker in the body and one `event.images`
    entry carrying the original base64 + media type.
  - Add: a base64 image nested inside a `tool_result` content array produces an
    `event.images` entry and a marker.
  - Add: a URL-source / empty-data image still falls back to the
    `[Image: ...]` text placeholder with no image entry.
- `renderMarkdown`: a base64 image renders as a `![...](data:...;base64,...)`
  data-URI in the export string.

## Out of scope

- Full markdown rendering of transcript bodies (separate future project).
- Lightbox zoom/pan, image carousel / prev-next navigation.
- Any per-image size cap or downscaling of the embedded data.
- Sidecar-resolved images beyond what already flows through `renderBlock`.
