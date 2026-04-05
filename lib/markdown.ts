import { marked } from 'marked'

/**
 * Shared Markdown → HTML for the WYSIWYG editor (inline while typing, blocks on paste).
 */
marked.setOptions({
  gfm: true,
  breaks: false,
})

export function markdownInlineToHtml(src: string): string {
  const s = src.trim()
  if (!s) return ''
  return marked.parseInline(s) as string
}

/** Full document / multi-line paste */
export function markdownBlockToHtml(src: string): string {
  const s = src.trim()
  if (!s) return ''
  return marked.parse(s) as string
}
