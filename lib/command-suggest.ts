/** Primary word after !! for each command (matches COMMAND_MAP aliases). */
export const BANG_WORD = {
  python: 'python',
  draw: 'draw',
  ai: 'ai',
  todo: 'todo',
  calc: 'calc',
  mermaid: 'diagram',
} as const

export type SuggestCommandType = keyof typeof BANG_WORD

export const SUGGEST_ROWS: { type: SuggestCommandType; title: string }[] = [
  { type: 'python', title: 'Python' },
  { type: 'draw', title: 'Canvas' },
  { type: 'mermaid', title: 'Diagram' },
  { type: 'ai', title: 'AI chat' },
  { type: 'todo', title: 'Todo' },
  { type: 'calc', title: 'Calculator' },
]

export function filterSuggestions(filter: string): typeof SUGGEST_ROWS {
  const f = filter.toLowerCase()
  if (!f) return SUGGEST_ROWS
  return SUGGEST_ROWS.filter((row) => {
    const w = BANG_WORD[row.type]
    return w.startsWith(f) || row.title.toLowerCase().includes(f)
  })
}
