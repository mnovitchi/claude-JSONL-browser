import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory fake of the Tauri fs plugin, keyed by Home-relative path.
type Entry = { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }
const dir = (name: string): Entry => ({ name, isDirectory: true, isFile: false, isSymlink: false })
const file = (name: string): Entry => ({ name, isDirectory: false, isFile: true, isSymlink: false })

const dirs: Record<string, Entry[]> = {}
const texts: Record<string, string> = {}
const stats: Record<string, { mtime: Date | null; size: number }> = {}
const unreadableDirs = new Set<string>()
const unreadableStats = new Set<string>()

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Home: 'Home' },
  readDir: vi.fn(async (path: string) => {
    if (unreadableDirs.has(path)) throw new Error(`cannot read ${path}`)
    if (!(path in dirs)) throw new Error(`no such dir ${path}`)
    return dirs[path]
  }),
  readTextFile: vi.fn(async (path: string) => {
    if (!(path in texts)) throw new Error(`no such file ${path}`)
    return texts[path]
  }),
  stat: vi.fn(async (path: string) => {
    if (unreadableStats.has(path)) throw new Error(`cannot stat ${path}`)
    return stats[path] ?? { mtime: null, size: 0 }
  }),
}))

import { listClaudeProjects, readProjectFiles } from '../claudeProjects'

beforeEach(() => {
  for (const key of Object.keys(dirs)) delete dirs[key]
  for (const key of Object.keys(texts)) delete texts[key]
  for (const key of Object.keys(stats)) delete stats[key]
  unreadableDirs.clear()
  unreadableStats.clear()
})

describe('listClaudeProjects', () => {
  it('lists project subfolders sorted by name with .jsonl session counts, ignoring non-dirs and unreadable projects', async () => {
    // Insertion order deliberately not sorted, and a stray file at the top level.
    dirs['.claude/projects'] = [dir('projB'), file('loose.jsonl'), dir('projA'), dir('projBad')]
    dirs['.claude/projects/projB'] = [file('s1.jsonl'), file('s2.jsonl'), file('readme.md')]
    dirs['.claude/projects/projA'] = [file('s1.jsonl'), dir('tool-results')]
    unreadableDirs.add('.claude/projects/projBad')

    const projects = await listClaudeProjects()

    expect(projects).toEqual([
      { name: 'projA', sessionCount: 1 },
      { name: 'projB', sessionCount: 2 },
      { name: 'projBad', sessionCount: 0 },
    ])
  })
})

describe('readProjectFiles', () => {
  it('recursively reads .jsonl/.json (incl. tool-results sidecars) with project-relative paths and stat metadata', async () => {
    dirs['.claude/projects/projA'] = [file('s1.jsonl'), file('notes.md'), dir('tool-results')]
    dirs['.claude/projects/projA/tool-results'] = [file('toolu_1.json')]
    texts['.claude/projects/projA/s1.jsonl'] = '{"type":"user"}'
    texts['.claude/projects/projA/tool-results/toolu_1.json'] = '{"result":"ok"}'
    stats['.claude/projects/projA/s1.jsonl'] = { mtime: new Date('2026-04-01T00:00:00Z'), size: 123 }
    // Force the sidecar's stat to fail so we exercise the fallback path.
    unreadableStats.add('.claude/projects/projA/tool-results/toolu_1.json')

    const files = await readProjectFiles('projA')
    const byName = Object.fromEntries(files.map((f) => [f.name, f]))

    // notes.md is excluded; the two JSON-family files are included.
    expect(files.map((f) => f.name).sort()).toEqual(['s1.jsonl', 'toolu_1.json'])

    expect(byName['s1.jsonl']).toMatchObject({
      path: 'projA/s1.jsonl',
      text: '{"type":"user"}',
      size: 123,
      lastModified: new Date('2026-04-01T00:00:00Z').getTime(),
    })

    // Sidecar keeps the /tool-results/ path segment the UI relies on; stat failed → fallback.
    expect(byName['toolu_1.json']).toMatchObject({
      path: 'projA/tool-results/toolu_1.json',
      text: '{"result":"ok"}',
      size: '{"result":"ok"}'.length,
      lastModified: 0,
    })
  })
})
