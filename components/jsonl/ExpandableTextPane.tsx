'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { createTextPreview, formatHiddenAmount } from '@/lib/jsonl/textPreview'
import { cn } from '@/lib/utils'

interface ExpandableTextPaneProps {
  title: string
  description: string
  text: string
  maxLines: number
  maxCharacters: number
  resetKey: string
  className?: string
  initialExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function ExpandableTextPane({
  title,
  description,
  text,
  maxLines,
  maxCharacters,
  resetKey,
  className,
  initialExpanded = false,
  onExpandedChange,
}: ExpandableTextPaneProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setExpanded(initialExpanded)
    setCopied(false)
  }, [resetKey])

  const preview = useMemo(
    () => createTextPreview(text, { expanded, maxLines, maxCharacters }),
    [expanded, maxCharacters, maxLines, text],
  )

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className={cn('min-h-0 rounded-lg border border-everforest-bg4 bg-everforest-bg1 flex flex-col overflow-hidden', className)}>
      <div className="px-3 py-2 border-b border-everforest-bg4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-everforest-fg truncate">{title}</h3>
          <p className="text-xs text-everforest-grey1 truncate">{description}</p>
        </div>

        <button
          type="button"
          onClick={() => void copyText()}
          className="min-h-9 px-2 text-everforest-blue hover:bg-everforest-bg2 rounded-md transition-colors flex items-center gap-1 text-xs"
        >
          {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <pre className="flex-1 min-h-[240px] overflow-auto custom-scrollbar p-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-everforest-fg">
        {preview.text || 'No displayable content.'}
      </pre>

      <div className="px-3 py-2 border-t border-everforest-bg4 bg-everforest-bg0/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-everforest-grey1">
          {preview.isTruncated
            ? `Preview hidden: ${formatHiddenAmount(preview.hiddenLineCount, preview.hiddenCharacterCount)}`
            : 'Showing full safe text'}
        </p>

        {preview.isTruncated || expanded ? (
          <button
            type="button"
            onClick={() => {
              const next = !expanded
              setExpanded(next)
              onExpandedChange?.(next)
            }}
            className="min-h-9 px-3 py-1.5 rounded-md border border-everforest-bg4 bg-everforest-bg2 text-everforest-aqua text-xs flex items-center justify-center gap-1 hover:bg-everforest-bg3 transition-colors"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
