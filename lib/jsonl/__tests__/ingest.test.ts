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
