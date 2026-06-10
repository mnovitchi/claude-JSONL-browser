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
