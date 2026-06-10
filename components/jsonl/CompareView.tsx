'use client'

import React from 'react'
import { ExpandableTextPane } from './ExpandableTextPane'

interface CompareViewProps {
  fileId: string
  originalText: string
  markdownText: string
  scrollRef?: React.Ref<HTMLDivElement>
  onScroll?: React.UIEventHandler<HTMLDivElement>
}

export function CompareView({ fileId, originalText, markdownText, scrollRef, onScroll }: CompareViewProps) {
  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full min-h-0 overflow-y-auto lg:overflow-hidden custom-scrollbar">
      <div className="grid min-h-full gap-3 lg:h-full lg:grid-cols-2">
        <ExpandableTextPane
          title="Original JSONL"
          description="Original structure with noisy payloads hidden"
          text={originalText}
          maxLines={80}
          maxCharacters={24000}
          resetKey={`${fileId}:original`}
          className="h-[520px] lg:h-full"
        />
        <ExpandableTextPane
          title="Readable Markdown"
          description="Converted output with noisy payloads hidden"
          text={markdownText}
          maxLines={120}
          maxCharacters={32000}
          resetKey={`${fileId}:markdown`}
          className="h-[520px] lg:h-full"
        />
      </div>
    </div>
  )
}
