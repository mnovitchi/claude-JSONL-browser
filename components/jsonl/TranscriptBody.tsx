'use client'

import React, { useMemo, useState } from 'react'
import { CheckCircle, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { createTextPreview, formatHiddenAmount } from '@/lib/jsonl/textPreview'
import { cn } from '@/lib/utils'

const BODY_MAX_LINES = 20
const BODY_MAX_CHARACTERS = 2000

interface TranscriptBodyProps {
  body: string
  className?: string
}

export function TranscriptBody({ body, className }: TranscriptBodyProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const preview = useMemo(
    () => createTextPreview(body, { expanded, maxLines: BODY_MAX_LINES, maxCharacters: BODY_MAX_CHARACTERS }),
    [body, expanded],
  )

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

  return (
    <div className={className}>
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-everforest-fg">{preview.text}</pre>

      {showControls && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {preview.isTruncated && (
            <span className="text-everforest-grey1">
              Hidden: {formatHiddenAmount(preview.hiddenLineCount, preview.hiddenCharacterCount)}
            </span>
          )}

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
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
    </div>
  )
}
