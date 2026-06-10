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
