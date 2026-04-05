'use client'

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import type { Session, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import { UISettings, Theme, FontFamily, AIAction, VoiceLanguage } from '@/types'
import { BANG_WORD, filterSuggestions } from '@/lib/command-suggest'
import AuthScreen from './AuthScreen'
import SettingsPanel from './SettingsPanel'
import SelectionPopup from './SelectionPopup'
import CommandModal, { COMMAND_MAP, CommandType } from './CommandModal'
import { markdownInlineToHtml, markdownBlockToHtml } from '@/lib/markdown'

// ── Types ────────────────────────────────────────────────────────────────────

interface Page {
  id: string
  title: string
  /** When true, title is not overwritten from body text. */
  titleManual?: boolean
  content: string  // HTML
  createdAt: number
  updatedAt: number
}

interface Notebook {
  pages: Page[]
  currentPageId: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: UISettings = {
  font: 'serif',
  theme: 'midnight',
  font_size: 18,
  width: 680,
  gemini_key: '',
  gemini_model: 'gemini-3.1-flash-lite-preview',
  command_suggestions: true,
  keyboard_hints: true,
  voice_input_enabled: true,
  voice_language: 'en-US',
}

const FONT_MAP: Record<FontFamily, string> = {
  serif:    "'EB Garamond', Georgia, serif",
  sans:     "'DM Sans', system-ui, sans-serif",
  mono:     "'JetBrains Mono', monospace",
  display:  "'Playfair Display', Georgia, serif",
  news:     "'Newsreader', Georgia, serif",
  literata: "'Literata', Georgia, serif",
  source:   "'Source Serif 4', Georgia, serif",
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function createPage(title = 'Untitled'): Page {
  const now = Date.now()
  return { id: generateId(), title, content: '', createdAt: now, updatedAt: now }
}

// Extract plain text excerpt for table of contents
function getExcerpt(html: string, maxLen = 80): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const text = div.textContent || ''
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed
}

// Extract title from first heading or first line
function extractTitle(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const heading = div.querySelector('h1, h2, h3')
  if (heading?.textContent?.trim()) return heading.textContent.trim()
  const text = (div.textContent || '').trim().split('\n')[0].trim()
  return text.length > 50 ? text.slice(0, 50) + '…' : text || 'Untitled'
}

// Build table of contents HTML
function buildTOCContent(pages: Page[]): string {
  if (pages.length === 0) return ''
  const items = pages.map((p, i) =>
      `<div class="toc-item" data-page-id="${p.id}"><span class="toc-num">${i + 1}</span><span class="toc-title">${p.title || 'Untitled'}</span></div>`
  ).join('')
  return `<h1>Contents</h1><div class="toc-list">${items}</div>`
}

// ── Component ────────────────────────────────────────────────────────────────

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

  const [activeCommand, setActiveCommand] = useState<CommandType | null>(null)

  // ── Notebook state ───────────────────────────────────────────────────────
  const [notebook, setNotebook] = useState<Notebook>(() => {
    const firstPage = createPage('My first page')
    return { pages: [firstPage], currentPageId: firstPage.id }
  })
  const [showTOC, setShowTOC] = useState(false) // false = showing a regular page, true = TOC
  const [pageNavOpen, setPageNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pageSwitcherAnimDir, setPageSwitcherAnimDir] = useState<'left' | 'right'>('right')
  const [isPageTransitioning, setIsPageTransitioning] = useState(false)
  const [chromeIdleHidden, setChromeIdleHidden] = useState(false)
  const [cmdSuggestFilter, setCmdSuggestFilter] = useState<string | null>(null)
  const [voiceListening, setVoiceListening] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settings)
  const voiceRecRef = useRef<SpeechRecognition | null>(null)
  const syncCommandSuggestRef = useRef<() => void>(() => {})
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionTextRef = useRef('')
  const selectionRangeRef = useRef<Range | null>(null)
  const touchingPopupRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const isLocalEditRef = useRef(false)
  const localEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabIdRef = useRef(`tab_${Math.random().toString(36).slice(2)}`)
  const notebookRef = useRef(notebook)
  const showTOCRef = useRef(showTOC)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  syncCommandSuggestRef.current = () => {
    if (!settingsRef.current.command_suggestions || showTOCRef.current) {
      setCmdSuggestFilter(null)
      return
    }
    const editor = editorRef.current
    const sel = window.getSelection()
    if (!sel?.rangeCount || !editor?.contains(sel.anchorNode)) {
      setCmdSuggestFilter(null)
      return
    }
    const node = sel.focusNode
    if (node?.nodeType !== Node.TEXT_NODE) {
      setCmdSuggestFilter(null)
      return
    }
    const text = (node as Text).textContent ?? ''
    const off = sel.focusOffset
    const before = text.slice(0, off)
    const m = before.match(/!!(\w*)$/)
    if (!m) {
      setCmdSuggestFilter(null)
      return
    }
    setCmdSuggestFilter(m[1].toLowerCase())
  }

  const IDLE_HIDE_MS = 4500

  const bumpChromeActivity = useCallback(() => {
    setChromeIdleHidden(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setChromeIdleHidden(true), IDLE_HIDE_MS)
  }, [])

  // Keep refs in sync
  useEffect(() => { notebookRef.current = notebook }, [notebook])
  useEffect(() => { showTOCRef.current = showTOC }, [showTOC])
  useEffect(() => { settingsRef.current = settings }, [settings])

  // ── Current page ──────────────────────────────────────────────────────────
  const currentPage = notebook.pages.find(p => p.id === notebook.currentPageId) ?? notebook.pages[0]
  const currentPageIndex = notebook.pages.findIndex(p => p.id === notebook.currentPageId)

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
    loadNotebook()
    setupRealtimeSync(supabase, session)
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // ── Load notebook from DB ─────────────────────────────────────────────────
  async function loadNotebook() {
    if (!supabase || !session) return
    try {
      const { data, error } = await supabase
          .from('notes')
          .select('id, content_json, content_text')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(1)

      if (error) {
        console.error('loadNotebook error:', error.message, error.code, error.details)
        return
      }
      const row = data?.[0]
      if (!row) return  // no row yet — keep default empty notebook

      noteRowIdRef.current = row.id  // cache for future saves

      // 1. Try content_json first (new format)
      if (row.content_json) {
        try {
          const parsed = JSON.parse(row.content_json)
          if (parsed?.pages && Array.isArray(parsed.pages)) {
            setNotebook(parsed)
            return
          }
        } catch {}
      }

      // 2. Fall back to content_text (legacy plain HTML)
      if (row.content_text) {
        const html = row.content_text
        const page = createPage(extractTitle(html) || 'Page 1')
        page.content = html
        setNotebook({ pages: [page], currentPageId: page.id })
      }
    } catch (e) { console.error('loadNotebook exception:', e) }
  }

  // ── note row id cache (avoid extra selects on every save) ─────────────────
  const noteRowIdRef = useRef<string | null>(null)

  // ── Save notebook to DB ───────────────────────────────────────────────────
  async function saveNotebook(nb: Notebook) {
    if (!supabase || !session) return
    const payload = JSON.stringify(nb)

    // If we already know the row id — just update it
    if (noteRowIdRef.current) {
      const { error } = await supabase
          .from('notes')
          .update({ content_json: payload })
          .eq('id', noteRowIdRef.current)
      if (error) {
        console.error('saveNotebook update error:', error.message, error.code, error.details)
        noteRowIdRef.current = null  // reset so next save retries with select
        return
      }
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 1200)
      return
    }

    // Otherwise: check if row exists for this user
    const { data: existing } = await supabase
        .from('notes')
        .select('id')
        .eq('user_id', session.user.id)
        .limit(1)

    if (existing && existing.length > 0) {
      // Row exists — update by id
      noteRowIdRef.current = existing[0].id
      const { error } = await supabase
          .from('notes')
          .update({ content_json: payload })
          .eq('id', existing[0].id)
      if (error) {
        console.error('saveNotebook update error:', error.message, error.code, error.details)
        noteRowIdRef.current = null
        return
      }
    } else {
      // No row — insert
      const { data: inserted, error } = await supabase
          .from('notes')
          .insert({ user_id: session.user.id, content_json: payload })
          .select('id')
          .single()
      if (error) {
        console.error('saveNotebook insert error:', error.message, error.code, error.details)
        return
      }
      noteRowIdRef.current = inserted.id
    }

    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 1200)
  }

  function scheduleSave(nb?: Notebook) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveNotebook(nb ?? notebookRef.current), 800)
  }

  // ── Realtime Broadcast setup ──────────────────────────────────────────────
  function setupRealtimeSync(sb: SupabaseClient, sess: Session) {
    const channelName = `note_sync:${sess.user.id}`
    const channel = sb.channel(channelName, { config: { broadcast: { self: false } } })
    channel
        .on('broadcast', { event: 'content_update' }, ({ payload }) => {
          if (payload.tab_id === tabIdRef.current) return
          if (isLocalEditRef.current) return
          if (payload.notebook) {
            setNotebook(payload.notebook)
            return
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setSyncStatus('connected')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('error')
        })
    channelRef.current = channel
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const broadcastContent = useCallback(
      debounce((nb: Notebook) => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'content_update',
          payload: { notebook: nb, tab_id: tabIdRef.current },
        })
      }, 150),
      []
  )

  // ── Load/save editor content when page changes ────────────────────────────
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (showTOC) {
      // render TOC (read-only view)
      editor.innerHTML = buildTOCContent(notebook.pages)
      editor.contentEditable = 'false'
    } else {
      editor.contentEditable = 'true'
      editor.innerHTML = currentPage?.content ?? ''
    }
    // Move cursor to end
    const sel = window.getSelection()
    if (sel && !showTOC) {
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }, [notebook.currentPageId, showTOC]) // eslint-disable-line

  // ── CSS variables ────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-body', FONT_MAP[settings.font] || FONT_MAP.serif)
    root.style.setProperty('--font-size', `${settings.font_size}px`)
    root.style.setProperty('--max-width', `${settings.width}px`)
    root.setAttribute('data-theme', settings.theme)
  }, [settings])

  const chromeBlocked =
      settingsOpen || searchOpen || pageNavOpen || activeCommand !== null || selPopupVisible

  useEffect(() => {
    if (chromeBlocked) {
      setChromeIdleHidden(false)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      return
    }
    bumpChromeActivity()
  }, [chromeBlocked, bumpChromeActivity])

  useEffect(() => {
    if (!session) return
    const onAct = () => bumpChromeActivity()
    const cap = true
    window.addEventListener('pointerdown', onAct, cap)
    window.addEventListener('keydown', onAct, cap)
    window.addEventListener('wheel', onAct, cap)
    window.addEventListener('scroll', onAct, cap)
    bumpChromeActivity()
    return () => {
      window.removeEventListener('pointerdown', onAct, cap)
      window.removeEventListener('keydown', onAct, cap)
      window.removeEventListener('wheel', onAct, cap)
      window.removeEventListener('scroll', onAct, cap)
    }
  }, [session, bumpChromeActivity])

  useEffect(() => {
    if (!session) return
    const onSel = () => queueMicrotask(() => syncCommandSuggestRef.current())
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [session])

  useEffect(() => {
    if (!session || !currentPage) {
      document.title = 'void'
      return
    }
    const t = (currentPage.title || 'Untitled').trim()
    document.title = t === 'Untitled' ? 'void' : `${t} · void`
  }, [session, currentPage?.id, currentPage?.title])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'k') {
        e.preventDefault(); e.stopPropagation()
        setSettingsOpen(v => !v)
        return
      }
      if (mod && e.key === 'j') {
        e.preventDefault(); e.stopPropagation()
        setSearchOpen(v => {
          if (!v) setTimeout(() => searchInputRef.current?.focus(), 50)
          return !v
        })
        return
      }
      if (e.key === 'Escape') {
        setSettingsOpen(false)
        setSelPopupVisible(false)
        setActiveCommand(null)
        setSearchOpen(false)
        setPageNavOpen(false)
      }
      // Arrow navigation when page nav is open
      if (pageNavOpen) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigateBy(-1) }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigateBy(1) }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [pageNavOpen]) // eslint-disable-line

  // ── 3-finger long press → settings (mobile) ─────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 3) timer = setTimeout(() => setSettingsOpen(v => !v), 500)
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
        content: JSON.stringify(notebookRef.current),
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
    const top = rect.top - 52 + window.scrollY
    setSelPopupPos({ top, left })
    setSelPopupVisible(true)
  }, [])

  useEffect(() => {
    const onMouseUp = () => setTimeout(showPopupForSelection, 10)
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [showPopupForSelection])

  useEffect(() => {
    const onTouchEnd = () => setTimeout(showPopupForSelection, 200)
    document.addEventListener('touchend', onTouchEnd)
    return () => document.removeEventListener('touchend', onTouchEnd)
  }, [showPopupForSelection])

  // ── DB settings helpers ───────────────────────────────────────────────────
  function loadLocalSettings() {
    try {
      const s = localStorage.getItem('void_settings')
      if (!s) return
      const parsed = JSON.parse(s) as Partial<UISettings>
      const validFonts: FontFamily[] = ['serif', 'sans', 'mono', 'display', 'news', 'literata', 'source']
      if (parsed.font && !validFonts.includes(parsed.font)) delete parsed.font
      const langs: VoiceLanguage[] = ['en-US', 'ru-RU', 'pl-PL']
      if (parsed.voice_language && !langs.includes(parsed.voice_language)) delete parsed.voice_language
      setSettings(prev => ({
        ...prev,
        ...parsed,
        command_suggestions: parsed.command_suggestions ?? prev.command_suggestions ?? true,
        keyboard_hints: parsed.keyboard_hints ?? prev.keyboard_hints ?? true,
        voice_input_enabled: parsed.voice_input_enabled ?? prev.voice_input_enabled ?? true,
        voice_language: parsed.voice_language ?? prev.voice_language ?? 'en-US',
      }))
    } catch {}
  }

  async function loadDBSettings() {
    if (!supabase || !session) return
    try {
      const { data } = await supabase
          .from('user_settings')
          .select('gemini_key, gemini_model')
          .eq('user_id', session.user.id)
          .single()
      if (data) setSettings(prev => ({
        ...prev,
        gemini_key: data.gemini_key || prev.gemini_key,
        gemini_model: data.gemini_model || prev.gemini_model,
      }))
    } catch {}
  }

  function saveLocalSettings(s: UISettings) {
    try { localStorage.setItem('void_settings', JSON.stringify(s)) } catch {}
  }

  async function saveDBSettings(key: string, model: string) {
    if (!supabase || !session) return
    await supabase.from('user_settings').upsert({ user_id: session.user.id, gemini_key: key, gemini_model: model })
  }

  function authHeaders(): Record<string, string> {
    return session ? { Authorization: `Bearer ${session.access_token}` } : {}
  }

  // ── Settings handlers ─────────────────────────────────────────────────────
  function handleThemeChange(v: Theme) { const s = { ...settings, theme: v }; setSettings(s); saveLocalSettings(s) }
  function handleFontChange(v: FontFamily) { const s = { ...settings, font: v }; setSettings(s); saveLocalSettings(s) }
  function handleFontSizeChange(delta: number) {
    const s = { ...settings, font_size: Math.min(28, Math.max(14, settings.font_size + delta)) }
    setSettings(s); saveLocalSettings(s)
  }
  function handleWidthChange(v: number) { const s = { ...settings, width: v }; setSettings(s); saveLocalSettings(s) }
  function handleCommandSuggestionsChange(v: boolean) {
    const s = { ...settings, command_suggestions: v }; setSettings(s); saveLocalSettings(s)
    if (!v) setCmdSuggestFilter(null)
  }
  function handleKeyboardHintsChange(v: boolean) { const s = { ...settings, keyboard_hints: v }; setSettings(s); saveLocalSettings(s) }
  function handleVoiceInputEnabledChange(v: boolean) { const s = { ...settings, voice_input_enabled: v }; setSettings(s); saveLocalSettings(s) }
  function handleVoiceLanguageChange(v: VoiceLanguage) { const s = { ...settings, voice_language: v }; setSettings(s); saveLocalSettings(s) }
  function handleGeminiKeyChange(v: string) {
    const s = { ...settings, gemini_key: v }
    setSettings(s); saveLocalSettings(s)
    if (keyTimerRef.current) clearTimeout(keyTimerRef.current)
    keyTimerRef.current = setTimeout(() => saveDBSettings(v, settings.gemini_model), 800)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  async function signInWithGoogle() {
    if (!supabase) return
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }
  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setSession(null)
  }

  // ── Page navigation ───────────────────────────────────────────────────────
  function navigateToPage(pageId: string, dir: 'left' | 'right' = 'right') {
    if (isPageTransitioning) return
    // Save current editor content first
    flushCurrentPage()
    setPageSwitcherAnimDir(dir)
    setIsPageTransitioning(true)
    setTimeout(() => {
      setShowTOC(false)
      setNotebook(prev => ({ ...prev, currentPageId: pageId }))
      setIsPageTransitioning(false)
    }, 180)
  }

  function navigateToTOC(dir: 'left' | 'right' = 'left') {
    if (isPageTransitioning) return
    flushCurrentPage()
    setPageSwitcherAnimDir(dir)
    setIsPageTransitioning(true)
    setTimeout(() => {
      setShowTOC(true)
      setIsPageTransitioning(false)
    }, 180)
  }

  function navigateBy(delta: number) {
    if (showTOC) {
      if (delta > 0) navigateToPage(notebook.pages[0].id, 'right')
      return
    }
    const idx = currentPageIndex
    if (delta < 0) {
      if (idx === 0) navigateToTOC('left')
      else navigateToPage(notebook.pages[idx - 1].id, 'left')
    } else {
      if (idx < notebook.pages.length - 1) navigateToPage(notebook.pages[idx + 1].id, 'right')
      else addNewPage()
    }
  }

  function flushCurrentPage() {
    if (showTOCRef.current) return
    const html = editorRef.current?.innerHTML ?? ''
    setNotebook(prev => {
      const pages = prev.pages.map(p =>
          p.id === prev.currentPageId
              ? {
                ...p,
                content: html,
                updatedAt: Date.now(),
                title: p.titleManual ? p.title : (extractTitle(html) || p.title),
              }
              : p
      )
      const nb = { ...prev, pages }
      scheduleSave(nb)
      return nb
    })
  }

  function updatePageTitle(raw: string) {
    const title = raw.trim() || 'Untitled'
    setNotebook(prev => {
      const pages = prev.pages.map(p =>
          p.id === prev.currentPageId
              ? { ...p, title, titleManual: true, updatedAt: Date.now() }
              : p
      )
      const nb = { ...prev, pages }
      scheduleSave(nb)
      broadcastContent(nb)
      return nb
    })
  }

  function addNewPage() {
    flushCurrentPage()
    const page = createPage('New page')
    setNotebook(prev => {
      const pages = [...prev.pages, page]
      const nb = { pages, currentPageId: page.id }
      scheduleSave(nb)
      broadcastContent(nb)
      return nb
    })
    setShowTOC(false)
  }

  function deletePage(pageId: string) {
    setNotebook(prev => {
      const pages = prev.pages.filter(p => p.id !== pageId)
      if (pages.length === 0) {
        const fresh = createPage('New page')
        return { pages: [fresh], currentPageId: fresh.id }
      }
      const newCurrentId = prev.currentPageId === pageId
          ? (pages[0]?.id ?? '')
          : prev.currentPageId
      const nb = { pages, currentPageId: newCurrentId }
      scheduleSave(nb)
      return nb
    })
  }

  // ── Command palette detection ─────────────────────────────────────────────
  function detectAndConsumeCommand(): CommandType | null {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return null
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return null
    const textNode = node as Text
    const full = textNode.textContent ?? ''
    const beforeCursor = full.slice(0, range.startOffset)
    const match = beforeCursor.match(/!!(\S+)$/)
    if (!match) return null
    const key = match[1].toLowerCase()
    const cmd = COMMAND_MAP[key]
    if (!cmd) return null
    const consumed = match[0]
    const newBefore = beforeCursor.slice(0, beforeCursor.length - consumed.length)
    const afterCursor = full.slice(range.startOffset)
    const newText = newBefore + afterCursor
    const newOffset = newBefore.length
    textNode.textContent = newText
    const r = document.createRange()
    const safe = Math.min(Math.max(0, newOffset), newText.length)
    r.setStart(textNode, safe)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    return cmd
  }

  function openCommand(cmd: CommandType) {
    setActiveCommand(cmd)
  }

  function handleInsertFromCommand(text: string) {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    document.execCommand('insertText', false, text)
    handleEditorInput()
  }

  function handleInsertHtmlFromCommand(html: string) {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    document.execCommand('insertHTML', false, html)
    handleEditorInput()
  }

  async function captureEditorScreenshot() {
    const el = editorRef.current
    if (!el || showTOC) return
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(el, {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#fafaf8',
      scale: Math.min(2, window.devicePixelRatio || 1),
    })
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${(currentPage?.title || 'note').replace(/[^\w\-]+/g, '_')}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  function printNotebook() {
    window.print()
  }

  async function shareNotebook() {
    const title = currentPage?.title || 'void note'
    const text = editorRef.current?.innerText?.slice(0, 8000) ?? ''
    const payload = { title: `void — ${title}`, text, url: window.location.href }
    try {
      if (navigator.share && text.trim()) {
        await navigator.share(payload)
        return
      }
    } catch {
      /* user cancelled or share failed */
    }
    try {
      await navigator.clipboard.writeText(`${title}\n\n${text}\n\n${window.location.href}`)
    } catch {
      /* ignore */
    }
  }

  function completeBangCommand(cmd: CommandType) {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return
    const node = sel.focusNode
    if (node?.nodeType !== Node.TEXT_NODE || !editorRef.current?.contains(node)) return
    const textNode = node as Text
    const full = textNode.textContent ?? ''
    const beforeCursor = full.slice(0, sel.focusOffset)
    const match = beforeCursor.match(/!!(\w*)$/)
    if (!match) return
    const consumed = match[0]
    const newBefore = beforeCursor.slice(0, beforeCursor.length - consumed.length)
    const afterCursor = full.slice(sel.focusOffset)
    const newText = newBefore + afterCursor
    textNode.textContent = newText
    const pos = newBefore.length
    const r = document.createRange()
    const safe = Math.min(Math.max(0, pos), newText.length)
    r.setStart(textNode, safe)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    setCmdSuggestFilter(null)
    setActiveCommand(cmd)
    handleEditorInput()
  }

  function toggleVoiceInput() {
    if (!settings.voice_input_enabled || showTOC) return
    bumpChromeActivity()
    if (voiceListening && voiceRecRef.current) {
      voiceRecRef.current.stop()
      return
    }
    type SpeechRecCtor = new () => SpeechRecognition
    const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor }
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!SR) {
      alert('Voice input needs a browser with Web Speech API (e.g. Chrome or Edge).')
      return
    }
    const r = new SR()
    voiceRecRef.current = r
    r.lang = settings.voice_language
    r.interimResults = false
    r.continuous = false
    setVoiceListening(true)
    r.onend = () => { setVoiceListening(false); voiceRecRef.current = null }
    r.onerror = () => { setVoiceListening(false); voiceRecRef.current = null }
    r.onresult = (ev: SpeechRecognitionEvent) => {
      const t = ev.results[0]?.[0]?.transcript
      if (t) {
        editorRef.current?.focus()
        document.execCommand('insertText', false, t + ' ')
        handleEditorInput()
      }
    }
    try {
      r.start()
    } catch {
      setVoiceListening(false)
    }
  }

  // ── Editor key handling ───────────────────────────────────────────────────
  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      const cmd = detectAndConsumeCommand()
      if (cmd !== null) {
        e.preventDefault()
        openCommand(cmd)
        return
      }
    }
    handleMarkdownShortcuts(e)
  }

  function handleMarkdownShortcuts(e: React.KeyboardEvent) {
    // Skip on key repeat — fixes held-key not printing characters
    if (e.repeat) return

    const sel = window.getSelection()
    if (!sel?.rangeCount) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return

    // ── Inline formatting: triggered on any printable key ─────────────────
    // **bold**, *italic*, `code`, ~~strikethrough~~, [text](url)
    if (e.key.length === 1 || e.key === 'Backspace') {
      applyInlineMarkdown(node as Text, range)
    }

    if (e.key !== ' ' && e.key !== 'Enter') return

    const fullText = node.textContent ?? ''
    const beforeCursor = fullText.substring(0, range.startOffset).trimStart()

    // ── Block shortcuts (triggered on Space) ─────────────────────────────
    if (e.key === ' ') {
      const headings: Record<string, string> = { '#': 'h1', '##': 'h2', '###': 'h3' }
      if (headings[beforeCursor]) {
        e.preventDefault()
        const newEl = document.createElement(headings[beforeCursor])
        newEl.innerHTML = '&#8203;'
        ;(node.parentElement?.closest('div,p') ?? node.parentElement as HTMLElement)?.replaceWith(newEl)
        const r = document.createRange()
        r.setStart(newEl.childNodes[0], 1); r.collapse(true)
        sel.removeAllRanges(); sel.addRange(r)
        return
      }
      if (beforeCursor === '>') {
        e.preventDefault()
        document.execCommand('formatBlock', false, 'blockquote')
        const r = window.getSelection()?.getRangeAt(0)
        if (r?.startContainer.nodeType === Node.TEXT_NODE)
          (r.startContainer as Text).textContent = (r.startContainer as Text).textContent?.replace(/^>\s*/, '') ?? ''
        return
      }
      if (beforeCursor === '-' || beforeCursor === '*') {
        e.preventDefault()
        document.execCommand('insertUnorderedList')
        const r = window.getSelection()?.getRangeAt(0)
        if (r?.startContainer.nodeType === Node.TEXT_NODE)
          (r.startContainer as Text).textContent = (r.startContainer as Text).textContent?.replace(/^[-*]\s*/, '') ?? ''
        return
      }
      if (/^\d+\.$/.test(beforeCursor)) {
        e.preventDefault()
        document.execCommand('insertOrderedList')
        const r = window.getSelection()?.getRangeAt(0)
        if (r?.startContainer.nodeType === Node.TEXT_NODE)
          (r.startContainer as Text).textContent = (r.startContainer as Text).textContent?.replace(/^\d+\.\s*/, '') ?? ''
        return
      }
    }

    // ── Hr: --- + Enter ───────────────────────────────────────────────────
    if (e.key === 'Enter' && beforeCursor === '---') {
      e.preventDefault()
      const parent = node.parentElement?.closest('div,p') ?? node.parentElement as HTMLElement
      const hr = document.createElement('hr')
      const newP = document.createElement('p')
      newP.innerHTML = '&#8203;'
      parent?.replaceWith(hr, newP)
      const r = document.createRange()
      r.setStart(newP.childNodes[0], 1); r.collapse(true)
      sel.removeAllRanges(); sel.addRange(r)
      return
    }
  }

  // ── Inline markdown (marked): **bold**, *italic*, `code`, ~~strike~~, [l](url) ─
  function applyInlineMarkdown(node: Text, range: Range) {
    const text = node.textContent ?? ''
    const offset = range.startOffset
    const before = text.slice(0, offset)

    const patterns = [
      /\*\*([^*]+)\*\*$/,
      /~~([^~]+)~~$/,
      /`([^`]+)`$/,
      /\*([^*]+)\*$/,
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/,
    ]

    for (const re of patterns) {
      const match = before.match(re)
      if (!match) continue
      const full = match[0]
      const start = offset - full.length
      let html: string
      try {
        html = markdownInlineToHtml(full)
      } catch {
        continue
      }
      if (!html || !/<[a-z]/i.test(html)) continue

      const tpl = document.createElement('template')
      tpl.innerHTML = html.trim()
      node.textContent = text.slice(0, start)
      const parent = node.parentNode!
      const ref = node.nextSibling
      parent.insertBefore(tpl.content, ref)
      const after = text.slice(offset)
      const space = document.createTextNode('\u200B' + after)
      parent.insertBefore(space, ref)

      const r = document.createRange()
      r.setStart(space, 1)
      r.collapse(true)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(r)
      return
    }
  }

  function pastedMarkdownToHtml(plain: string): string | null {
    const t = plain.trim()
    if (!t) return null
    try {
      if (/\n/.test(plain)) {
        if (!/[#*`>\[\]]|^\s*[-*+]\s|^\s*\d+\.\s/m.test(plain)) return null
        const h = markdownBlockToHtml(t)
        return h && /<[a-z]/i.test(h) ? h : null
      }
      if (!/(\*\*|~~|`|\*|\[)/.test(t)) return null
      const h = markdownInlineToHtml(t)
      return h && /<[a-z]/i.test(h) ? h : null
    } catch {
      return null
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()

    // ── Image paste ─────────────────────────────────────────────────────────
    const imageFile = Array.from(e.clipboardData.items)
        .find(item => item.type.startsWith('image/'))
    if (imageFile) {
      const file = imageFile.getAsFile()
      if (file) { insertImageFile(file); return }
    }

    // ── Plain text with markdown link detection ──────────────────────────────
    const text = e.clipboardData.getData('text/plain')
    if (!text) return

    const mdHtml = pastedMarkdownToHtml(text)
    if (mdHtml) {
      const tpl = document.createElement('template')
      tpl.innerHTML = mdHtml.trim()
      const sel = window.getSelection()
      if (sel?.rangeCount && editorRef.current?.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const first = tpl.content.firstChild
        range.insertNode(tpl.content)
        if (first?.parentNode) {
          let last: ChildNode = first
          while (last.nextSibling) last = last.nextSibling
          const r = document.createRange()
          r.setStartAfter(last)
          r.collapse(true)
          sel.removeAllRanges()
          sel.addRange(r)
        }
      }
      handleEditorInput()
      return
    }

    // Detect [title](url) markdown link
    const linkMatch = text.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (linkMatch) {
      const a = document.createElement('a')
      a.href = linkMatch[2]
      a.textContent = linkMatch[1]
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(a)
        range.setStartAfter(a)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      handleEditorInput()
      return
    }

    // Detect bare URL — wrap in anchor
    const urlMatch = text.match(/^(https?:\/\/\S+)$/)
    if (urlMatch) {
      const a = document.createElement('a')
      a.href = urlMatch[1]
      a.textContent = urlMatch[1]
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(a)
        range.setStartAfter(a)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      handleEditorInput()
      return
    }

    document.execCommand('insertText', false, text)
  }

  // ── Image insertion ───────────────────────────────────────────────────────
  function insertImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const src = ev.target?.result as string
      if (!src) return
      const img = document.createElement('img')
      img.src = src
      img.style.cssText = 'max-width:100%;height:auto;border-radius:6px;margin:8px 0;display:block;'
      img.alt = file.name.replace(/\.[^.]+$/, '')
      const editor = editorRef.current
      if (!editor) return
      editor.focus()
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(img)
        range.setStartAfter(img)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        editor.appendChild(img)
      }
      handleEditorInput()
    }
    reader.readAsDataURL(file)
  }

  // ── Editor input ──────────────────────────────────────────────────────────
  function handleEditorInput() {
    if (showTOCRef.current) return
    isLocalEditRef.current = true
    if (localEditTimerRef.current) clearTimeout(localEditTimerRef.current)
    localEditTimerRef.current = setTimeout(() => { isLocalEditRef.current = false }, 500)
    const html = editorRef.current?.innerHTML ?? ''
    setNotebook(prev => {
      const pages = prev.pages.map(p =>
          p.id === prev.currentPageId
              ? {
                ...p,
                content: html,
                updatedAt: Date.now(),
                title: p.titleManual ? p.title : (extractTitle(html) || p.title),
              }
              : p
      )
      const nb = { ...prev, pages }
      broadcastContent(nb)
      scheduleSave(nb)
      return nb
    })
    queueMicrotask(() => syncCommandSuggestRef.current())
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
    handleEditorInput()
  }

  // ── Search ────────────────────────────────────────────────────────────────
  const searchResults = searchQuery.trim().length > 0
      ? notebook.pages.map((p, idx) => {
        const q = searchQuery.toLowerCase()
        const titleMatch = p.title.toLowerCase().includes(q)
        const div = document.createElement('div')
        div.innerHTML = p.content
        const text = div.textContent || ''
        const contentMatch = text.toLowerCase().includes(q)
        if (!titleMatch && !contentMatch) return null
        // Find snippet
        let snippet = ''
        if (contentMatch) {
          const pos = text.toLowerCase().indexOf(q)
          const start = Math.max(0, pos - 40)
          snippet = (start > 0 ? '…' : '') + text.slice(start, pos + q.length + 60) + (pos + q.length + 60 < text.length ? '…' : '')
        }
        return { page: p, idx, snippet }
      }).filter(Boolean)
      : []

  // ── Page number display ───────────────────────────────────────────────────
  const pageDisplayNum = showTOC ? '≡' : String(currentPageIndex + 1)
  const totalPages = notebook.pages.length

  const isSignedIn = !!session
  const chromeHiddenClass = chromeIdleHidden ? ' app-chrome--hidden' : ''

  return (
      <>
        <AuthScreen visible={!isSignedIn} onSignIn={signInWithGoogle} />

        {isSignedIn && (
            <div className="app">
              {/* Page indicator — top right */}
              <button
                  type="button"
                  className={`page-indicator app-chrome print-hide${chromeHiddenClass}`}
                  onPointerDown={(e) => { e.preventDefault(); bumpChromeActivity(); setPageNavOpen(v => !v) }}
                  title="Pages (click to browse)"
              >
                <span className="page-indicator-num">{pageDisplayNum}</span>
                {!showTOC && (
                    <span className="page-indicator-total">/{totalPages}</span>
                )}
              </button>

              {/* Page navigation panel */}
              {pageNavOpen && (
                  <div
                      className="page-nav-overlay print-hide"
                      onPointerDown={(e) => { if (e.target === e.currentTarget) setPageNavOpen(false) }}
                  >
                    <div className="page-nav-panel" onPointerDown={(e) => e.stopPropagation()}>
                      <div className="page-nav-header">
                        <span className="page-nav-title">Pages</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                              className="page-nav-add"
                              onPointerDown={(e) => { e.preventDefault(); addNewPage(); setPageNavOpen(false) }}
                          >+ New page</button>
                          <button className="settings-close" onPointerDown={() => setPageNavOpen(false)}>×</button>
                        </div>
                      </div>

                      <div className="page-nav-list">
                        {/* TOC item */}
                        <div
                            className={`page-nav-item${showTOC ? ' active' : ''}`}
                            onPointerDown={(e) => { e.preventDefault(); navigateToTOC('left'); setPageNavOpen(false) }}
                        >
                          <span className="page-nav-num">≡</span>
                          <div className="page-nav-info">
                            <span className="page-nav-name">Contents</span>
                            <span className="page-nav-excerpt">{totalPages} page{totalPages !== 1 ? 's' : ''}</span>
                          </div>
                        </div>

                        {notebook.pages.map((p, idx) => (
                            <div
                                key={p.id}
                                className={`page-nav-item${!showTOC && p.id === notebook.currentPageId ? ' active' : ''}`}
                                onPointerDown={(e) => {
                                  e.preventDefault()
                                  navigateToPage(p.id, idx > currentPageIndex ? 'right' : 'left')
                                  setPageNavOpen(false)
                                }}
                            >
                              <span className="page-nav-num">{idx + 1}</span>
                              <div className="page-nav-info">
                                <span className="page-nav-name">{p.title || 'Untitled'}</span>
                                {p.content && (
                                    <span className="page-nav-excerpt">{getExcerpt(p.content)}</span>
                                )}
                              </div>
                              {notebook.pages.length > 1 && (
                                  <button
                                      className="page-nav-del"
                                      title="Delete page"
                                      onPointerDown={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        if (confirm(`Delete page "${p.title || 'Untitled'}"?`)) {
                                          deletePage(p.id)
                                        }
                                      }}
                                  >×</button>
                              )}
                            </div>
                        ))}
                      </div>
                    </div>
                  </div>
              )}

              {/* Previous / Next page arrows */}
              <button
                  type="button"
                  className={`page-arrow page-arrow--left app-chrome print-hide${chromeHiddenClass}`}
                  onPointerDown={(e) => { e.preventDefault(); bumpChromeActivity(); navigateBy(-1) }}
                  title={showTOC ? '' : currentPageIndex === 0 ? 'Contents' : 'Previous page'}
                  style={{ opacity: showTOC ? 0.2 : 1 }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </button>

              <button
                  type="button"
                  className={`page-arrow page-arrow--right app-chrome print-hide${chromeHiddenClass}`}
                  onPointerDown={(e) => { e.preventDefault(); bumpChromeActivity(); navigateBy(1) }}
                  title={!showTOC && currentPageIndex === totalPages - 1 ? 'New page' : 'Next page'}
              >
                {!showTOC && currentPageIndex === totalPages - 1 ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                )}
              </button>

              {/* Page title strip */}
              {!showTOC && (
                  <div className={`page-title-strip app-chrome print-hide${chromeHiddenClass}`}>
                    <input
                        type="text"
                        className="page-title-input"
                        value={currentPage?.title ?? ''}
                        onChange={(e) => updatePageTitle(e.target.value)}
                        onFocus={bumpChromeActivity}
                        placeholder="Untitled"
                        aria-label="Page title"
                    />
                  </div>
              )}
              {showTOC && (
                  <div className={`page-title-strip app-chrome print-hide${chromeHiddenClass}`}>
                    <span className="page-title-text" style={{ fontStyle: 'italic', opacity: 0.5 }}>Contents</span>
                  </div>
              )}

              {/* Editor */}
              <div className={`editor-wrap${isPageTransitioning ? ` page-exit-${pageSwitcherAnimDir}` : ''}`}>
                {!showTOC && settings.command_suggestions && cmdSuggestFilter !== null && filterSuggestions(cmdSuggestFilter).length > 0 && (
                    <div className={`cmd-suggest-bar print-hide app-chrome${chromeHiddenClass}`} role="listbox" aria-label="Command suggestions">
                      {filterSuggestions(cmdSuggestFilter).map(row => (
                          <button
                              key={row.type}
                              type="button"
                              className="cmd-suggest-chip"
                              onPointerDown={(e) => {
                                e.preventDefault()
                                completeBangCommand(row.type as CommandType)
                              }}
                          >
                            <span>{row.title}</span>
                            <span className="cmd-suggest-bang">{`!!${BANG_WORD[row.type]}`}</span>
                          </button>
                      ))}
                    </div>
                )}
                {/* Image + voice — bottom left of editor area */}
                {!showTOC && (
                    <div className={`editor-side-tools app-chrome print-hide${chromeHiddenClass}`}>
                      <label className="img-insert-btn" title="Insert image" onPointerDown={bumpChromeActivity}>
                        <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) insertImageFile(file)
                              e.target.value = ''
                            }}
                        />
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <path d="M21 15l-5-5L5 21"/>
                        </svg>
                      </label>
                      {settings.voice_input_enabled && (
                          <button
                              type="button"
                              className={`voice-input-btn${voiceListening ? ' voice-input-btn--active' : ''}`}
                              title={`Voice (${settings.voice_language})`}
                              onPointerDown={(e) => { e.preventDefault(); bumpChromeActivity(); toggleVoiceInput() }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3z"/>
                              <path d="M19 11a7 7 0 0 1-14 0M12 18v3M8 21h8"/>
                            </svg>
                          </button>
                      )}
                    </div>
                )}
                {isSignedIn && !showTOC && settings.keyboard_hints && (
                    <div className={`keyboard-hint-bar print-hide app-chrome${chromeHiddenClass}`}>
                      <span><kbd className="hint-kbd">Ctrl</kbd><kbd className="hint-kbd">K</kbd> Settings</span>
                      <span className="keyboard-hint-sep" aria-hidden>·</span>
                      <span><kbd className="hint-kbd">Ctrl</kbd><kbd className="hint-kbd">J</kbd> Search</span>
                      <span className="keyboard-hint-sep" aria-hidden>·</span>
                      <span><kbd className="hint-kbd">Esc</kbd> Close</span>
                    </div>
                )}
                <div
                    ref={editorRef}
                    className={`editor${showTOC ? ' editor--toc' : ''}`}
                    contentEditable={!showTOC}
                    suppressContentEditableWarning
                    data-placeholder="start writing…  (!!python, !!draw, !!diagram, !!ai…)"
                    spellCheck
                    onInput={handleEditorInput}
                    onKeyDown={handleEditorKeyDown}
                    onPaste={handlePaste}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
                    onDrop={(e) => {
                      const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'))
                      if (file) { e.preventDefault(); insertImageFile(file) }
                    }}
                    onClick={(e) => {
                      // TOC: navigate on click
                      if (showTOC) {
                        const target = (e.target as HTMLElement).closest('[data-page-id]') as HTMLElement
                        if (target?.dataset.pageId) {
                          navigateToPage(target.dataset.pageId, 'right')
                        }
                      }
                    }}
                />
              </div>
            </div>
        )}

        <SelectionPopup
            visible={selPopupVisible && isSignedIn && !showTOC}
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
                onPrint={printNotebook}
                onSavePdf={printNotebook}
                onShare={shareNotebook}
                onScreenshot={captureEditorScreenshot}
                onCommandSuggestionsChange={handleCommandSuggestionsChange}
                onKeyboardHintsChange={handleKeyboardHintsChange}
                onVoiceInputEnabledChange={handleVoiceInputEnabledChange}
                onVoiceLanguageChange={handleVoiceLanguageChange}
            />
        )}

        <CommandModal
            command={activeCommand}
            onClose={() => setActiveCommand(null)}
            onInsert={handleInsertFromCommand}
            onInsertHtml={handleInsertHtmlFromCommand}
            geminiKey={settings.gemini_key}
            geminiModel={settings.gemini_model}
        />

        {/* Search modal (Cmd+J) */}
        {isSignedIn && searchOpen && (
            <div
                className="search-overlay print-hide"
                onPointerDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false) }}
            >
              <div className="search-panel" onPointerDown={(e) => e.stopPropagation()}>
                <div className="search-input-wrap">
                  <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <input
                      ref={searchInputRef}
                      className="search-input"
                      placeholder="Search notebook…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setSearchOpen(false)
                        if (e.key === 'Enter' && searchResults[0]) {
                          const r = searchResults[0]!
                          navigateToPage(r.page.id)
                          setSearchOpen(false)
                          setSearchQuery('')
                        }
                      }}
                  />
                  <span className="search-close-hint">Esc</span>
                </div>

                <div className="search-results">
                  {searchQuery.trim() && searchResults.length === 0 && (
                      <div className="search-empty">Nothing found</div>
                  )}
                  {searchResults.map((r) => r && (
                      <div
                          key={r.page.id}
                          className="search-result-item"
                          onPointerDown={(e) => {
                            e.preventDefault()
                            navigateToPage(r.page.id)
                            setSearchOpen(false)
                            setSearchQuery('')
                          }}
                      >
                        <span className="search-result-num">{r.idx + 1}</span>
                        <div className="search-result-info">
                          <span className="search-result-title">{r.page.title || 'Untitled'}</span>
                          {r.snippet && <span className="search-result-snippet">{r.snippet}</span>}
                        </div>
                      </div>
                  ))}
                  {!searchQuery.trim() && (
                      <div className="search-all-pages">
                        {notebook.pages.map((p, idx) => (
                            <div
                                key={p.id}
                                className="search-result-item"
                                onPointerDown={(e) => {
                                  e.preventDefault()
                                  navigateToPage(p.id)
                                  setSearchOpen(false)
                                }}
                            >
                              <span className="search-result-num">{idx + 1}</span>
                              <div className="search-result-info">
                                <span className="search-result-title">{p.title || 'Untitled'}</span>
                              </div>
                            </div>
                        ))}
                      </div>
                  )}
                </div>
              </div>
            </div>
        )}

        {/* Realtime sync dot */}
        {isSignedIn && (
            <div
                className={`sync-dot app-chrome print-hide${chromeIdleHidden ? ' app-chrome--hidden' : ''}`}
                title={syncStatus === 'connected' ? 'Live sync active' : syncStatus === 'error' ? 'Sync error' : ''}
                style={{
                  position: 'fixed', bottom: 28, right: 60,
                  width: 6, height: 6, borderRadius: '50%',
                  background: syncStatus === 'connected' ? '#4caf50' : syncStatus === 'error' ? '#f44336' : 'transparent',
                  transition: 'background 0.4s, opacity 0.65s ease',
                  pointerEvents: 'none',
                }}
            />
        )}

        <div className={`save-indicator app-chrome print-hide${chromeIdleHidden && !showSaved ? ' app-chrome--hidden' : ''}${showSaved ? ' visible' : ''}`}>saved</div>
      </>
  )
}