export interface TextPreviewOptions {
  expanded: boolean
  maxLines: number
  maxCharacters: number
}

export interface TextPreview {
  text: string
  isTruncated: boolean
  hiddenLineCount: number
  hiddenCharacterCount: number
}

export function createTextPreview(input: string, options: TextPreviewOptions): TextPreview {
  if (options.expanded) {
    return {
      text: input,
      isTruncated: false,
      hiddenLineCount: 0,
      hiddenCharacterCount: 0,
    }
  }

  const lines = input.split(/\r?\n/)
  const lineLimited = lines.length > options.maxLines
  const visibleLines = lineLimited ? lines.slice(0, options.maxLines) : lines
  let visibleText = visibleLines.join('\n')
  const characterLimited = visibleText.length > options.maxCharacters

  if (characterLimited) {
    visibleText = visibleText.slice(0, options.maxCharacters).trimEnd()
  }

  const isTruncated = lineLimited || characterLimited
  const hiddenLineCount = lineLimited ? lines.length - visibleLines.length : 0
  const hiddenCharacterCount = Math.max(0, input.length - visibleText.length)

  return {
    text: visibleText,
    isTruncated,
    hiddenLineCount,
    hiddenCharacterCount: isTruncated ? hiddenCharacterCount : 0,
  }
}
