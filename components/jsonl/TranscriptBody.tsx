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

  const preview = useMemo(
    () => createTextPreview(body, { expanded, maxLines: BODY_MAX_LINES, maxCharacters: BODY_MAX_CHARACTERS }),
    [body, expanded],
  )

  useEffect(() => {
    if (!lightboxSrc) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxSrc(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxSrc])

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const showControls = preview.isTruncated || expanded

  const collapseOnBodyClick = () => {
    if (!expanded) return
    // Ignore the click when the user was selecting text to copy it.
    const selection = window.getSelection()?.toString() ?? ''
    if (selection.trim().length > 0) return
    setExpanded(false)
  }

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
                key={`${image.mediaType}-${index}`}
                src={src}
                alt="Tool result image"
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
