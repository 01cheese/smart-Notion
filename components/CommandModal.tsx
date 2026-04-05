'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ── Command registry ────────────────────────────────────────────────────────

export type CommandType = 'python' | 'draw' | 'ai' | 'todo' | 'calc' | 'mermaid'

export const COMMAND_MAP: Record<string, CommandType> = {
  python: 'python', py: 'python', питон: 'python', пайтон: 'python',
  draw: 'draw', рисовалка: 'draw', canvas: 'draw', холст: 'draw', paint: 'draw', рисунок: 'draw',
  ai: 'ai', ии: 'ai', chat: 'ai', чат: 'ai', gemini: 'ai', гемини: 'ai', ask: 'ai', спроси: 'ai',
  todo: 'todo', список: 'todo', задачи: 'todo', tasks: 'todo', чеклист: 'todo',
  calc: 'calc', калькулятор: 'calc', math: 'calc', мат: 'calc', формула: 'calc',
  mermaid: 'mermaid', diagram: 'mermaid', graph: 'mermaid', flow: 'mermaid', chart: 'mermaid',
}

// ── Types ───────────────────────────────────────────────────────────────────

interface CommandModalProps {
  command: CommandType | null
  onClose: () => void
  onInsert: (text: string) => void
  /** For diagram / rich inserts (SVG from Mermaid). */
  onInsertHtml?: (html: string) => void
  geminiKey: string
  geminiModel: string
}

// ── Root modal ───────────────────────────────────────────────────────────────

const CMD_LABELS: Record<CommandType, string> = {
  python: '⌥ Python',
  draw: '⌥ Canvas',
  ai: '⌥ AI Chat',
  todo: '⌥ Todo',
  calc: '⌥ Calculator',
  mermaid: '⌥ Diagram',
}

export default function CommandModal({
  command,
  onClose,
  onInsert,
  onInsertHtml,
  geminiKey,
  geminiModel,
}: CommandModalProps) {
  const insertHtml = onInsertHtml ?? (() => {})
  // Close on Escape
  useEffect(() => {
    if (!command) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [command, onClose])

  if (!command) return null

  return (
    <div
      className="cmd-overlay print-hide"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="cmd-panel" onPointerDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cmd-header">
          <span className="cmd-title">{CMD_LABELS[command]}</span>
          <div className="cmd-header-actions">
            <span className="cmd-hint">Esc to close</span>
            <button className="cmd-close-btn" onPointerDown={onClose}>×</button>
          </div>
        </div>

        {/* Body */}
        <div className="cmd-body">
          {command === 'python' && (
            <PythonPanel onInsert={onInsert} geminiKey={geminiKey} geminiModel={geminiModel} />
          )}
          {command === 'draw' && (
            <DrawPanel onInsert={onInsert} />
          )}
          {command === 'ai' && (
            <AIChatPanel onInsert={onInsert} geminiKey={geminiKey} geminiModel={geminiModel} />
          )}
          {command === 'todo' && (
            <TodoPanel onInsert={onInsert} />
          )}
          {command === 'calc' && (
            <CalcPanel onInsert={onInsert} geminiKey={geminiKey} geminiModel={geminiModel} />
          )}
          {command === 'mermaid' && (
            <MermaidPanel onInsertHtml={insertHtml} />
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Python panel (Pyodide)
// ══════════════════════════════════════════════════════════════════════════════

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInstance>
  }
}

interface PyodideInstance {
  runPythonAsync: (code: string) => Promise<unknown>
  setStdout: (opts: { batched: (s: string) => void }) => void
  setStderr: (opts: { batched: (s: string) => void }) => void
}

type PythonStatus = 'idle' | 'loading' | 'ready' | 'running'

function PythonPanel({
  onInsert,
  geminiKey,
  geminiModel,
}: {
  onInsert: (t: string) => void
  geminiKey: string
  geminiModel: string
}) {
  const [code, setCode] = useState(
    '# Write Python — runs in your browser via Pyodide\nprint("Hello from void!")\n\nresult = sum(range(1, 101))\nprint(f"Sum 1..100 = {result}")'
  )
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<PythonStatus>('idle')
  const [aiLoading, setAiLoading] = useState(false)
  const pyRef = useRef<PyodideInstance | null>(null)
  const loadingRef = useRef(false)

  async function ensurePyodide(): Promise<PyodideInstance | null> {
    if (pyRef.current) return pyRef.current
    if (loadingRef.current) return null
    loadingRef.current = true
    setStatus('loading')

    try {
      if (!window.loadPyodide) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js'
          s.onload = () => resolve()
          s.onerror = () => reject(new Error('Failed to load Pyodide script'))
          document.head.appendChild(s)
        })
      }
      const py = await window.loadPyodide!({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
      })
      pyRef.current = py
      setStatus('ready')
      return py
    } catch (e) {
      setOutput('Error loading Python runtime: ' + String(e))
      setStatus('idle')
      return null
    } finally {
      loadingRef.current = false
    }
  }

  async function runCode() {
    const py = await ensurePyodide()
    if (!py) return
    setStatus('running')
    setOutput('')

    let out = ''
    py.setStdout({ batched: (s: string) => { out += s + '\n' } })
    py.setStderr({ batched: (s: string) => { out += '⚠ ' + s + '\n' } })

    try {
      const result = await py.runPythonAsync(code)
      const resultStr = result !== undefined && result !== null ? `→ ${result}` : ''
      const combined = (out + resultStr).trim()
      setOutput(combined || '(no output)')
    } catch (e: unknown) {
      setOutput('Error:\n' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setStatus('ready')
    }
  }

  async function explainWithAI() {
    if (!geminiKey) { alert('Add your Gemini API key in Settings (Ctrl+K)'); return }
    setAiLoading(true)
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Explain what this Python code does, clearly and concisely:\n\n\`\`\`python\n${code}\n\`\`\`` }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
          }),
        }
      )
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response'
      setOutput((prev) => prev ? prev + '\n\n— AI Explanation —\n' + text : '— AI Explanation —\n' + text)
    } catch (e) {
      setOutput('AI error: ' + String(e))
    } finally {
      setAiLoading(false)
    }
  }

  function handleTab(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = el.value.slice(0, start) + '    ' + el.value.slice(end)
    setCode(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 4
    })
  }

  const runLabel =
    status === 'loading' ? 'Loading Python…' :
    status === 'running' ? 'Running…' :
    status === 'idle'    ? '▶ Run (loads ~10MB)' :
                           '▶ Run'

  return (
    <div className="cmd-python">
      <textarea
        className="cmd-code-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        rows={10}
        onKeyDown={handleTab}
      />

      <div className="cmd-toolbar">
        <button
          className="cmd-btn cmd-btn--primary"
          onPointerDown={runCode}
          disabled={status === 'loading' || status === 'running'}
        >
          {runLabel}
        </button>
        <button
          className="cmd-btn"
          onPointerDown={explainWithAI}
          disabled={aiLoading || !geminiKey}
        >
          {aiLoading ? 'Explaining…' : '✦ Explain'}
        </button>
        {output && (
          <>
            <button
              className="cmd-btn"
              onPointerDown={() => navigator.clipboard.writeText(output)}
            >
              Copy output
            </button>
            <button
              className="cmd-btn"
              onPointerDown={() => onInsert('```\n' + output + '\n```')}
            >
              Insert into note
            </button>
          </>
        )}
      </div>

      {output && (
        <pre className="cmd-output">{output}</pre>
      )}

      {status === 'loading' && (
        <div className="cmd-loading-bar">
          <span>Loading Python runtime…</span>
          <span className="ai-thinking"><span /><span /><span /></span>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Drawing canvas panel
// ══════════════════════════════════════════════════════════════════════════════

type DrawTool = 'pen' | 'eraser' | 'line' | 'fill'

function DrawPanel({ onInsert }: { onInsert: (t: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#e8e8e2')
  const [bgColor] = useState('#1a1a18')
  const [brushSize, setBrushSize] = useState(3)
  const [tool, setTool] = useState<DrawTool>('pen')
  const drawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const lineStart = useRef({ x: 0, y: 0 })
  const snapshotRef = useRef<ImageData | null>(null)

  // Init canvas background
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [bgColor])

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const scaleX = e.currentTarget.width / r.width
    const scaleY = e.currentTarget.height / r.height
    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top) * scaleY,
    }
  }

  function hexToRgb(hex: string) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return { r, g, b }
  }

  function floodFill(canvas: HTMLCanvasElement, x: number, y: number, fillColor: string) {
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    const px = Math.floor(x)
    const py = Math.floor(y)
    const idx = (py * canvas.width + px) * 4
    const targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2]

    const { r: fr, g: fg, b: fb } = hexToRgb(fillColor)
    if (targetR === fr && targetG === fg && targetB === fb) return

    const stack = [[px, py]]
    while (stack.length) {
      const [cx, cy] = stack.pop()!
      const i = (cy * canvas.width + cx) * 4
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue
      if (data[i] !== targetR || data[i + 1] !== targetG || data[i + 2] !== targetB) continue
      data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
    ctx.putImageData(imageData, 0, 0)
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const pos = getPos(e)
    drawing.current = true
    lastPos.current = pos
    lineStart.current = pos

    if (tool === 'fill') {
      floodFill(canvasRef.current!, pos.x, pos.y, color)
      drawing.current = false
      return
    }

    if (tool === 'line') {
      const ctx = canvasRef.current!.getContext('2d')!
      snapshotRef.current = ctx.getImageData(0, 0, canvasRef.current!.width, canvasRef.current!.height)
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const pos = getPos(e)

    if (tool === 'line') {
      ctx.putImageData(snapshotRef.current!, 0, 0)
      ctx.beginPath()
      ctx.moveTo(lineStart.current.x, lineStart.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.strokeStyle = color
      ctx.lineWidth = brushSize
      ctx.lineCap = 'round'
      ctx.stroke()
      return
    }

    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = tool === 'eraser' ? bgColor : color
    ctx.lineWidth = tool === 'eraser' ? brushSize * 5 : brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
  }

  function onPointerUp() { drawing.current = false }

  function clearCanvas() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  async function copyImage() {
    const canvas = canvasRef.current!
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  const TOOLS: { id: DrawTool; label: string }[] = [
    { id: 'pen',    label: '✏ Pen' },
    { id: 'eraser', label: '◻ Eraser' },
    { id: 'line',   label: '/ Line' },
    { id: 'fill',   label: '▣ Fill' },
  ]

  return (
    <div className="cmd-draw">
      <div className="cmd-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`cmd-btn${tool === t.id ? ' cmd-btn--active' : ''}`}
            onPointerDown={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div className="cmd-draw-divider" />
        <label className="cmd-color-wrap" title="Color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="cmd-color-input"
          />
          <span className="cmd-color-swatch" style={{ background: color }} />
        </label>
        <input
          type="range"
          min={1}
          max={24}
          value={brushSize}
          onChange={(e) => setBrushSize(+e.target.value)}
          className="cmd-size-slider"
          title={`Size: ${brushSize}`}
        />
        <span className="cmd-size-label">{brushSize}px</span>
        <div className="cmd-draw-divider" />
        <button className="cmd-btn" onPointerDown={clearCanvas}>Clear</button>
        <button className="cmd-btn" onPointerDown={copyImage}>Copy image</button>
      </div>
      <div className="cmd-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={800}
          height={420}
          className="cmd-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ cursor: tool === 'eraser' ? 'cell' : tool === 'fill' ? 'crosshair' : 'crosshair' }}
        />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AI Chat panel
// ══════════════════════════════════════════════════════════════════════════════

interface ChatMessage {
  role: 'user' | 'ai'
  text: string
}

function AIChatPanel({
  onInsert,
  geminiKey,
  geminiModel,
}: {
  onInsert: (t: string) => void
  geminiKey: string
  geminiModel: string
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading || !geminiKey) return
    setInput('')
    const next: ChatMessage[] = [...messages, { role: 'user', text }]
    setMessages(next)
    setLoading(true)

    try {
      const contents = next.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      }))
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
          }),
        }
      )
      const data = await res.json()
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response.'
      setMessages((m) => [...m, { role: 'ai', text: reply }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'ai', text: 'Error: ' + String(e) }])
    } finally {
      setLoading(false)
    }
  }

  function clearChat() { setMessages([]) }

  return (
    <div className="cmd-chat">
      <div className="cmd-chat-messages">
        {messages.length === 0 && (
          <div className="cmd-chat-empty">
            {geminiKey
              ? 'Ask Gemini anything. Press Enter to send, Shift+Enter for new line.'
              : 'Add your Gemini API key in Settings (Ctrl+K) to use AI chat.'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`cmd-chat-bubble cmd-chat-bubble--${m.role}`}>
            <div className="cmd-chat-text">{m.text}</div>
            {m.role === 'ai' && (
              <div className="cmd-chat-bubble-actions">
                <button
                  className="cmd-btn cmd-btn--tiny"
                  onPointerDown={() => navigator.clipboard.writeText(m.text)}
                >Copy</button>
                <button
                  className="cmd-btn cmd-btn--tiny"
                  onPointerDown={() => onInsert(m.text)}
                >Insert</button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="cmd-chat-bubble cmd-chat-bubble--ai">
            <span className="ai-thinking"><span /><span /><span /></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="cmd-chat-footer">
        {messages.length > 0 && (
          <button className="cmd-btn cmd-btn--ghost" onPointerDown={clearChat}>Clear</button>
        )}
        <textarea
          className="cmd-chat-input"
          value={input}
          placeholder={geminiKey ? 'Message… (Enter to send)' : 'Gemini key required'}
          disabled={!geminiKey}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
        />
        <button
          className="cmd-btn cmd-btn--primary"
          onPointerDown={send}
          disabled={loading || !geminiKey || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Todo panel
// ══════════════════════════════════════════════════════════════════════════════

interface TodoItem {
  id: number
  text: string
  done: boolean
}

function TodoPanel({ onInsert }: { onInsert: (t: string) => void }) {
  const [items, setItems] = useState<TodoItem[]>([])
  const [input, setInput] = useState('')
  const nextId = useRef(1)

  function add() {
    const text = input.trim()
    if (!text) return
    setItems((p) => [...p, { id: nextId.current++, text, done: false }])
    setInput('')
  }

  function toggle(id: number) {
    setItems((p) => p.map((i) => i.id === id ? { ...i, done: !i.done } : i))
  }

  function remove(id: number) {
    setItems((p) => p.filter((i) => i.id !== id))
  }

  function exportToNote() {
    if (!items.length) return
    const lines = items.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n')
    onInsert(lines)
  }

  const done = items.filter((i) => i.done).length

  return (
    <div className="cmd-todo">
      <div className="cmd-todo-input-row">
        <input
          className="cmd-todo-input"
          placeholder="Add a task…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="cmd-btn cmd-btn--primary" onPointerDown={add}>Add</button>
      </div>

      {items.length > 0 && (
        <>
          <div className="cmd-todo-progress">
            <div className="cmd-todo-progress-bar">
              <div
                className="cmd-todo-progress-fill"
                style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
              />
            </div>
            <span className="cmd-todo-count">{done}/{items.length}</span>
          </div>

          <div className="cmd-todo-list">
            {items.map((item) => (
              <div key={item.id} className={`cmd-todo-item${item.done ? ' cmd-todo-item--done' : ''}`}>
                <button
                  className="cmd-todo-check"
                  onPointerDown={() => toggle(item.id)}
                >
                  {item.done ? '☑' : '☐'}
                </button>
                <span className="cmd-todo-text">{item.text}</span>
                <button className="cmd-todo-del" onPointerDown={() => remove(item.id)}>×</button>
              </div>
            ))}
          </div>

          <div className="cmd-toolbar" style={{ marginTop: 8 }}>
            <button className="cmd-btn" onPointerDown={exportToNote}>Insert into note</button>
            <button
              className="cmd-btn"
              onPointerDown={() => setItems((p) => p.filter((i) => !i.done))}
            >
              Clear done
            </button>
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="cmd-empty-hint">Type a task and press Enter</div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Calculator panel (AI-powered)
// ══════════════════════════════════════════════════════════════════════════════

function CalcPanel({
  onInsert,
  geminiKey,
  geminiModel,
}: {
  onInsert: (t: string) => void
  geminiKey: string
  geminiModel: string
}) {
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<{ q: string; a: string }[]>([])

  async function calculate() {
    const q = expr.trim()
    if (!q) return
    setLoading(true)
    setResult('')

    // Try plain JS eval for simple expressions first
    try {
      // Safe eval: only allow math chars
      if (/^[0-9+\-*/().,% ]+$/.test(q)) {
        // eslint-disable-next-line no-new-func
        const val = new Function(`"use strict"; return (${q})`)()
        const ans = String(val)
        setResult(ans)
        setHistory((h) => [{ q, a: ans }, ...h.slice(0, 9)])
        setLoading(false)
        return
      }
    } catch {}

    // Fall back to Gemini for complex / natural language math
    if (!geminiKey) {
      setResult('Add Gemini API key in Settings for natural-language math.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Solve this math expression or problem. Return ONLY the final numeric answer or a very short result — no explanation, no units unless asked, no markdown.\n\n${q}`,
              }],
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 128 },
          }),
        }
      )
      const data = await res.json()
      const ans = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '?'
      setResult(ans)
      setHistory((h) => [{ q, a: ans }, ...h.slice(0, 9)])
    } catch (e) {
      setResult('Error: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cmd-calc">
      <div className="cmd-calc-display">
        <input
          className="cmd-calc-input"
          placeholder="2 + 2  or  area of circle with r=5  or  15% of 240"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') calculate() }}
          autoFocus
        />
        <button
          className="cmd-btn cmd-btn--primary"
          onPointerDown={calculate}
          disabled={loading || !expr.trim()}
        >
          {loading ? '…' : '='}
        </button>
      </div>

      {result && (
        <div className="cmd-calc-result">
          <span className="cmd-calc-result-val">{result}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="cmd-btn cmd-btn--tiny" onPointerDown={() => navigator.clipboard.writeText(result)}>Copy</button>
            <button className="cmd-btn cmd-btn--tiny" onPointerDown={() => onInsert(`${expr} = ${result}`)}>Insert</button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="cmd-calc-history">
          {history.map((h, i) => (
            <div key={i} className="cmd-calc-history-row" onPointerDown={() => { setExpr(h.q); setResult(h.a) }}>
              <span className="cmd-calc-history-q">{h.q}</span>
              <span className="cmd-calc-history-a">= {h.a}</span>
            </div>
          ))}
        </div>
      )}

      {history.length === 0 && !result && (
        <div className="cmd-empty-hint">
          Works with plain math <code>2^10</code> or natural language — <em>square root of 144</em>
          {!geminiKey && <span style={{ display: 'block', marginTop: 4 }}>Add Gemini key for natural language math</span>}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Mermaid — flowcharts, sequence, Gantt (browser-rendered SVG)
// ══════════════════════════════════════════════════════════════════════════════

function MermaidPanel({ onInsertHtml }: { onInsertHtml: (html: string) => void }) {
  const [code, setCode] = useState(
    'flowchart LR\n  A[Start] --> B{Choice}\n  B -->|Yes| C[Done]\n  B -->|No| A'
  )
  const previewRef = useRef<HTMLDivElement>(null)
  const lastSvgRef = useRef('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const m = (await import('mermaid')).default
      const th = document.documentElement.getAttribute('data-theme')
      const theme = th === 'light' || th === 'sepia' ? 'neutral' : 'dark'
      m.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme,
        suppressErrorRendering: true,
      })

      if (previewRef.current) previewRef.current.innerHTML = ''
      lastSvgRef.current = ''

      const trimmed = code.trim()
      if (!trimmed) {
        if (!cancelled) setErr(null)
        return
      }

      const ok = await m.parse(trimmed, { suppressErrors: true })
      if (cancelled) return

      if (!ok) {
        let msg = 'Invalid diagram. Start with a declaration such as flowchart LR, graph TD, or sequenceDiagram.'
        try {
          await m.parse(trimmed)
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e)
        }
        setErr(msg)
        return
      }

      try {
        const id = `mmd-${Math.random().toString(36).slice(2)}`
        const { svg } = await m.render(id, trimmed)
        if (cancelled) return
        lastSvgRef.current = svg
        if (previewRef.current) previewRef.current.innerHTML = svg
        setErr(null)
      } catch (e) {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
        lastSvgRef.current = ''
        if (previewRef.current) previewRef.current.innerHTML = ''
      }
    }
    void run()
    return () => { cancelled = true }
  }, [code])

  return (
    <div className="cmd-mermaid">
      <textarea
        className="cmd-code-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        rows={9}
        placeholder="flowchart, sequenceDiagram, gantt, classDiagram…"
      />
      {err && (
        <div className="cmd-mermaid-err">{err}</div>
      )}
      <div ref={previewRef} className="cmd-mermaid-preview" />
      <div className="cmd-toolbar">
        <button
          type="button"
          className="cmd-btn cmd-btn--primary"
          onPointerDown={() => {
            if (lastSvgRef.current)
              onInsertHtml(`<figure class="mermaid-embed">${lastSvgRef.current}</figure>`)
          }}
          disabled={!lastSvgRef.current}
        >
          Insert into note
        </button>
      </div>
    </div>
  )
}
