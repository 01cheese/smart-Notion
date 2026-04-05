'use client'

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import type { Session, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import { UISettings, Theme, FontFamily, AIAction } from '@/types'
import AuthScreen from './AuthScreen'
import SettingsPanel from './SettingsPanel'
import SelectionPopup from './SelectionPopup'

const DEFAULT_SETTINGS: UISettings = {
  font: 'serif',
  theme: 'midnight',
  font_size: 18,
  width: 680,
  gemini_key: '',
  gemini_model: 'gemini-3.1-flash-lite-preview',
}

const FONT_MAP: Record<FontFamily, string> = {
  serif: "'EB Garamond', Georgia, serif",
  sans:  "'DM Sans', system-ui, sans-serif",
  mono:  "'JetBrains Mono', monospace",
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export default function VoidApp() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [settings, setSettings] = useState<UISettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'connected' | 'error'>('idle')

  const [selPopupVisible, setSelPopupVisible] = useState(false)
  const [selPopupPos, setSelPopupPos] = useState({ top: 0, left: 0 })
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  const editorRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionTextRef = useRef('')
  const selectionRangeRef = useRef<Range | null>(null)
  const touchingPopupRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  // Флаг: это устройство сейчас активно пишет — не принимаем чужие изменения
  const isLocalEditRef = useRef(false)
  const localEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Уникальный ID вкладки — не применяем свои же broadcast-сообщения
  const tabIdRef = useRef(`tab_${Math.random().toString(36).slice(2)}`)

  // ── Init Supabase ────────────────────────────────────────────────────────
  useEffect(() => {
    const sb = createClient()
    setSupabase(sb)

    sb.auth.getSession().then(({ data: { session: s } }) => setSession(s))

    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // ── On sign-in: load + setup realtime ────────────────────────────────────
  useEffect(() => {
    if (!session || !supabase) return
    loadLocalSettings()
    loadDBSettings()
    loadNote()
    setupRealtimeSync(supabase, session)

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // ── Realtime Broadcast setup ──────────────────────────────────────────────
  function setupRealtimeSync(sb: SupabaseClient, sess: Session) {
    // Канал привязан к user_id — только свои устройства слышат друг друга
    const channelName = `note_sync:${sess.user.id}`

    const channel = sb.channel(channelName, {
      config: { broadcast: { self: false } },
    })

    channel
        .on('broadcast', { event: 'content_update' }, ({ payload }) => {
          // Игнорируем своё же сообщение (на случай если self:false не сработал)
          if (payload.tab_id === tabIdRef.current) return
          // Если сейчас сами пишем — не перебиваем
          if (isLocalEditRef.current) return

          const editor = editorRef.current
          if (!editor || editor.innerHTML === payload.html) return

          // Применяем контент, не трогая курсор (телефон — читает, не фокусирован)
          const isActive = document.activeElement === editor
          editor.innerHTML = payload.html

          // Если телефон каким-то образом имеет фокус — ставим курсор в конец
          if (isActive) {
            const sel = window.getSelection()
            if (sel) {
              const range = document.createRange()
              range.selectNodeContents(editor)
              range.collapse(false)
              sel.removeAllRanges()
              sel.addRange(range)
            }
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setSyncStatus('connected')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('error')
        })

    channelRef.current = channel
  }

  // Дебаунсированный broadcast — не чаще 150ms
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const broadcastContent = useCallback(
      debounce((html: string) => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'content_update',
          payload: { html, tab_id: tabIdRef.current },
        })
      }, 150),
      []
  )

  // ── CSS variables ────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-body', FONT_MAP[settings.font] || FONT_MAP.serif)
    root.style.setProperty('--font-size', `${settings.font_size}px`)
    root.style.setProperty('--max-width', `${settings.width}px`)
    root.setAttribute('data-theme', settings.theme)
  }, [settings])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault(); e.stopPropagation()
        setSettingsOpen((v) => !v)
        return
      }
      if (e.key === 'Escape') { setSettingsOpen(false); setSelPopupVisible(false) }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [])

  // ── 3-finger long press → settings (mobile) ─────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) timer = setTimeout(() => setSettingsOpen((v) => !v), 200)
    }
    const onEnd = () => { if (timer) { clearTimeout(timer); timer = null } }
    document.addEventListener('touchstart', onStart)
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchmove', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchmove', onEnd)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // ── Save on page close ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (!session) return
      navigator.sendBeacon('/api/note/beacon', JSON.stringify({
        content: editorRef.current?.innerHTML ?? '',
        token: session.access_token,
      }))
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [session])

  // ── Selection popup ───────────────────────────────────────────────────────
  const showPopupForSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      if (!touchingPopupRef.current) setSelPopupVisible(false)
      return
    }
    if (!editorRef.current?.contains(sel.anchorNode)) {
      if (!touchingPopupRef.current) setSelPopupVisible(false)
      return
    }
    selectionTextRef.current = sel.toString().trim()
    try { selectionRangeRef.current = sel.getRangeAt(0).cloneRange() } catch { return }

    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const popupWidth = 320
    let left = rect.left + rect.width / 2 - popupWidth / 2
    left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8))
    setSelPopupPos({ top: Math.max(8, rect.top - 52 + window.scrollY), left })
    setSelPopupVisible(true)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (document.querySelector('.sel-popup')?.contains(e.target as Node)) return
      setTimeout(showPopupForSelection, 10)
    }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [showPopupForSelection])

  useEffect(() => {
    const handler = () => {
      if (touchingPopupRef.current) return
      setTimeout(showPopupForSelection, 50)
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [showPopupForSelection])

  // ── Supabase auth header ──────────────────────────────────────────────────
  function authHeaders() {
    return { Authorization: `Bearer ${session!.access_token}` }
  }

  // ── Load / Save note ──────────────────────────────────────────────────────
  async function loadNote() {
    try {
      const res = await fetch('/api/note', { headers: authHeaders() })
      if (!res.ok) return
      const data = await res.json()
      if (editorRef.current && data.content_text)
        editorRef.current.innerHTML = data.content_text
    } catch (err) { console.error('[loadNote]', err) }
  }

  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(saveNote, 1200)
  }

  async function saveNote() {
    if (!session) return
    try {
      await fetch('/api/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: editorRef.current?.innerHTML ?? '' }),
      })
      flashSaved()
    } catch (err) { console.error('[saveNote]', err) }
  }

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 1400)
  }

  // ── Settings helpers ──────────────────────────────────────────────────────
  function loadLocalSettings() {
    try {
      const raw = localStorage.getItem('void_ui_settings')
      if (raw) setSettings((prev) => ({ ...prev, ...JSON.parse(raw) }))
    } catch {}
  }

  function saveLocalSettings(next: UISettings) {
    try {
      localStorage.setItem('void_ui_settings', JSON.stringify({
        font: next.font, theme: next.theme, font_size: next.font_size, width: next.width,
      }))
    } catch {}
  }

  async function loadDBSettings() {
    try {
      const res = await fetch('/api/settings', { headers: authHeaders() })
      if (!res.ok) return
      const data = await res.json()
      setSettings((prev) => ({
        ...prev,
        gemini_key: data.gemini_key || prev.gemini_key,
        gemini_model: data.gemini_model || prev.gemini_model,
      }))
    } catch (err) { console.error('[loadDBSettings]', err) }
  }

  async function saveAISettingsToDB(key: string, model: string) {
    if (!session) return
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ gemini_key: key, gemini_model: model }),
      })
    } catch (err) { console.error('[saveAISettings]', err) }
  }

  const handleThemeChange = useCallback((theme: Theme) => {
    setSettings((prev) => { const next = { ...prev, theme }; saveLocalSettings(next); return next })
  }, [])

  const handleFontChange = useCallback((font: FontFamily) => {
    setSettings((prev) => { const next = { ...prev, font }; saveLocalSettings(next); return next })
  }, [])

  const handleFontSizeChange = useCallback((delta: number) => {
    setSettings((prev) => {
      const next = { ...prev, font_size: Math.max(12, Math.min(32, prev.font_size + delta)) }
      saveLocalSettings(next); return next
    })
  }, [])

  const handleWidthChange = useCallback((width: number) => {
    setSettings((prev) => { const next = { ...prev, width }; saveLocalSettings(next); return next })
  }, [])

  const handleGeminiKeyChange = useCallback((gemini_key: string) => {
    setSettings((prev) => {
      const next = { ...prev, gemini_key }
      if (keyTimerRef.current) clearTimeout(keyTimerRef.current)
      keyTimerRef.current = setTimeout(() => saveAISettingsToDB(gemini_key, next.gemini_model), 800)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // ── Sign in / out ─────────────────────────────────────────────────────────
  function signInWithGoogle() {
    const sb = supabase ?? createClient()
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }

  async function signOut() {
    if (!supabase) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await saveNote()
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
    await supabase.auth.signOut()
    setSettingsOpen(false)
    setSyncStatus('idle')
    if (editorRef.current) editorRef.current.innerHTML = ''
  }

  // ── Editor: keyboard shortcuts ────────────────────────────────────────────
  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold'); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic'); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') { e.preventDefault(); document.execCommand('underline'); return }
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;'); return }
    handleMarkdownShortcuts(e)
  }

  function handleMarkdownShortcuts(e: React.KeyboardEvent) {
    if (e.key !== ' ') return
    const sel = window.getSelection()
    if (!sel?.rangeCount) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return
    const text = node.textContent?.substring(0, range.startOffset).trimStart() ?? ''

    const headings: Record<string, string> = { '#': 'h1', '##': 'h2', '###': 'h3' }
    if (headings[text]) {
      e.preventDefault()
      const newEl = document.createElement(headings[text])
      newEl.innerHTML = '&#8203;'
      ;(node.parentElement?.closest('div,p') ?? node.parentElement as HTMLElement)?.replaceWith(newEl)
      const r = document.createRange()
      r.setStart(newEl.childNodes[0], 1); r.collapse(true)
      sel.removeAllRanges(); sel.addRange(r)
      return
    }
    if (text === '>') {
      e.preventDefault()
      document.execCommand('formatBlock', false, 'blockquote')
      const r = window.getSelection()?.getRangeAt(0)
      if (r?.startContainer.nodeType === Node.TEXT_NODE)
        (r.startContainer as Text).textContent = (r.startContainer as Text).textContent?.replace(/^>\s*/, '') ?? ''
      return
    }
    if (text === '-' || text === '*') {
      e.preventDefault()
      document.execCommand('insertUnorderedList')
      const r = window.getSelection()?.getRangeAt(0)
      if (r?.startContainer.nodeType === Node.TEXT_NODE)
        (r.startContainer as Text).textContent = (r.startContainer as Text).textContent?.replace(/^[-*]\s*/, '') ?? ''
      return
    }
    if (/^\d+\.$/.test(text)) {
      e.preventDefault()
      document.execCommand('insertOrderedList')
      const r = window.getSelection()?.getRangeAt(0)
      if (r?.startContainer.nodeType === Node.TEXT_NODE)
        (r.startContainer as Text).textContent = (r.startContainer as Text).textContent?.replace(/^\d+\.\s*/, '') ?? ''
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
  }

  // ── Editor input: broadcast + save ───────────────────────────────────────
  function handleEditorInput() {
    // Помечаем локальное редактирование на 500ms — не принимаем чужие изменения в этот момент
    isLocalEditRef.current = true
    if (localEditTimerRef.current) clearTimeout(localEditTimerRef.current)
    localEditTimerRef.current = setTimeout(() => { isLocalEditRef.current = false }, 500)

    broadcastContent(editorRef.current?.innerHTML ?? '')
    scheduleSave()
  }

  // ── AI actions ────────────────────────────────────────────────────────────
  async function handleSelAction(action: string) {
    if (action === 'copy') {
      navigator.clipboard.writeText(selectionTextRef.current).catch(() => document.execCommand('copy'))
      setSelPopupVisible(false)
      return
    }
    if (!settings.gemini_key) {
      alert('Add your Gemini API key in Settings (Ctrl+K).')
      setSelPopupVisible(false)
      return
    }
    setLoadingAction(action)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          action,
          selected_text: selectionTextRef.current,
          context: editorRef.current?.textContent?.substring(0, 2000) ?? '',
          gemini_api_key: settings.gemini_key,
          gemini_model: settings.gemini_model,
        }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'AI error') }
      const { result } = await res.json()
      applyAIResult(action as AIAction, result)
    } catch (err: unknown) {
      alert('AI error: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoadingAction(null)
      setSelPopupVisible(false)
    }
  }

  function applyAIResult(action: AIAction, result: string) {
    const savedRange = selectionRangeRef.current
    if (!savedRange) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(savedRange)

    if (action === 'explain') {
      const range = savedRange.cloneRange()
      range.collapse(false)
      const el = document.createElement('div')
      el.style.cssText = 'margin:12px 0;padding:12px 16px;border-left:2px solid var(--fg-dim);color:var(--fg-dim);font-size:0.9em;font-style:italic;border-radius:0 6px 6px 0;background:var(--border);'
      el.textContent = result
      sel.removeAllRanges(); sel.addRange(range)
      sel.getRangeAt(0).insertNode(el)
    } else if (action === 'continue') {
      const range = savedRange.cloneRange()
      range.collapse(false)
      sel.removeAllRanges(); sel.addRange(range)
      document.execCommand('insertText', false, ' ' + result)
    } else if (action === 'replace') {
      document.execCommand('insertText', false, result)
    }

    broadcastContent(editorRef.current?.innerHTML ?? '')
    scheduleSave()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isSignedIn = !!session

  return (
      <>
        <AuthScreen visible={!isSignedIn} onSignIn={signInWithGoogle} />

        {isSignedIn && (
            <div className="app">
              <div className="editor-wrap">
                <div
                    ref={editorRef}
                    className="editor"
                    contentEditable
                    suppressContentEditableWarning
                    data-placeholder="start writing…"
                    spellCheck
                    onInput={handleEditorInput}
                    onKeyDown={handleEditorKeyDown}
                    onPaste={handlePaste}
                />
              </div>
            </div>
        )}

        <SelectionPopup
            visible={selPopupVisible && isSignedIn}
            position={selPopupPos}
            loadingAction={loadingAction}
            onAction={handleSelAction}
            onTouchStart={() => { touchingPopupRef.current = true }}
            onTouchEnd={() => { touchingPopupRef.current = false }}
        />

        {isSignedIn && (
            <SettingsPanel
                open={settingsOpen}
                settings={settings}
                userEmail={session.user.email ?? ''}
                userAvatar={session.user.user_metadata?.avatar_url ?? ''}
                onClose={() => setSettingsOpen(false)}
                onThemeChange={handleThemeChange}
                onFontChange={handleFontChange}
                onFontSizeChange={handleFontSizeChange}
                onWidthChange={handleWidthChange}
                onGeminiKeyChange={handleGeminiKeyChange}
                onSignOut={signOut}
            />
        )}

        {/* Маленькая точка — индикатор realtime-соединения */}
        {isSignedIn && (
            <div
                title={
                  syncStatus === 'connected' ? 'Live sync active' :
                      syncStatus === 'error' ? 'Sync error — check connection' : ''
                }
                style={{
                  position: 'fixed', bottom: 28, right: 60,
                  width: 6, height: 6, borderRadius: '50%',
                  background:
                      syncStatus === 'connected' ? '#4caf50' :
                          syncStatus === 'error' ? '#f44336' : 'transparent',
                  transition: 'background 0.4s',
                  pointerEvents: 'none',
                }}
            />
        )}

        <div className={`save-indicator${showSaved ? ' visible' : ''}`}>saved</div>
      </>
  )
}
