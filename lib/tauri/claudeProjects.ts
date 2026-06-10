// Native filesystem access to the default Claude Code projects folder
// (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` plus `tool-results/`
// sidecars). This only works inside the Tauri desktop build — the plugin
// imports are dynamic so the plain browser bundle never depends on them.

const PROJECTS_DIR = '.claude/projects'

export interface ImportedFile {
  path: string
  name: string
  text: string
  lastModified: number
  size: number
}

export interface ClaudeProject {
  name: string
  sessionCount: number
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * List the project subfolders under `~/.claude/projects`, each with a count of
 * the `.jsonl` session files it contains (shallow count).
 */
export async function listClaudeProjects(): Promise<ClaudeProject[]> {
  const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')

  const entries = await readDir(PROJECTS_DIR, { baseDir: BaseDirectory.Home })
  const dirs = entries.filter((entry) => entry.isDirectory)

  const projects = await Promise.all(
    dirs.map(async (dir) => {
      let sessionCount = 0
      try {
        const children = await readDir(`${PROJECTS_DIR}/${dir.name}`, { baseDir: BaseDirectory.Home })
        sessionCount = children.filter((child) => child.isFile && child.name.endsWith('.jsonl')).length
      } catch {
        // Unreadable project folder — report it with a zero count rather than failing the whole list.
        sessionCount = 0
      }
      return { name: dir.name, sessionCount }
    }),
  )

  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Recursively read every `.jsonl`/`.json` file under a project folder (including
 * `tool-results/` sidecars) into the normalized {@link ImportedFile} shape.
 * Paths are project-relative with forward slashes so the existing sidecar/log
 * classification in the UI works unchanged.
 */
export async function readProjectFiles(projectName: string): Promise<ImportedFile[]> {
  const { readDir, readTextFile, stat, BaseDirectory } = await import('@tauri-apps/plugin-fs')

  const collected: ImportedFile[] = []

  // relativeDir is relative to BaseDirectory.Home; displayDir is relative to the project root.
  const walk = async (relativeDir: string, displayDir: string): Promise<void> => {
    const entries = await readDir(relativeDir, { baseDir: BaseDirectory.Home })

    await Promise.all(
      entries.map(async (entry) => {
        const childRelative = `${relativeDir}/${entry.name}`
        const childDisplay = displayDir ? `${displayDir}/${entry.name}` : entry.name

        if (entry.isDirectory) {
          await walk(childRelative, childDisplay)
          return
        }

        if (!entry.isFile) return
        if (!entry.name.endsWith('.jsonl') && !entry.name.endsWith('.json')) return

        const text = await readTextFile(childRelative, { baseDir: BaseDirectory.Home })
        let lastModified = 0
        let size = text.length
        try {
          const info = await stat(childRelative, { baseDir: BaseDirectory.Home })
          lastModified = info.mtime ? info.mtime.getTime() : 0
          size = info.size
        } catch {
          // stat is best-effort; fall back to text length / epoch 0 for sorting.
        }

        collected.push({ path: childDisplay, name: entry.name, text, lastModified, size })
      }),
    )
  }

  await walk(`${PROJECTS_DIR}/${projectName}`, projectName)
  return collected
}
