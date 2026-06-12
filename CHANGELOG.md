# Changelog

_v0.2.0 · 2026-06-12 · commit 3dbb3ae_

## Transcript viewing
- **Inline tool-result images** — images returned by tools now render inline in the transcript; click one to open it full-size in a lightbox.
- **Readable JSON tool results** — tool results that are JSON objects (e.g. structured command output) now show as a formatted JSON block instead of the literal `[object Object]`.

## Exporting
- **Images in Markdown export** — exported Markdown embeds tool-result images inline (as data URIs), so they travel with the file.

## Compare view
- **Redacted image payloads** — long inline image data is replaced with a short `[base64 omitted: N chars]` placeholder, keeping the compared text readable.

## App
- **Version in the header** — the header now shows the running version, with the build's commit and date in a tooltip.

_2026-06-11 · commit c4ba475_

## File saving
- **Native file saving** — *Readable* and *Full* Markdown exports save through the native "Save As" dialog (they previously did nothing in the webview).

## Loading sessions
- **Import Claude Projects** — reads logs directly from `~/.claude/projects/<project>/<session>.jsonl` (with `tool-results/` sidecars) via a project picker, instead of manually navigating to the folder.
- **Clear-on-load option** — loading from a folder now offers to unload current traces first: a default-on "Clear loaded sessions" checkbox in the import modal, and a three-way confirm (Clear & load / Keep & add / Cancel) for the OS folder picker. *Add Files* and drag-drop still append silently.

## Transcript viewing
- **Truncate long event bodies** — bodies over ~20 lines / ~2000 chars collapse by default with a `Hidden: N lines` label, *Show more/less*, and a *Copy full body* button. Exported Markdown stays complete.
- **Click-to-collapse** — clicking an expanded body collapses it without scrolling to the bottom button; text selection still works.
- **Per-file view state** — switching files in the sidebar now remembers each file's view mode, scroll position, and open disclosures (session-only).
