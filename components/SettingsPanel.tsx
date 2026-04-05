'use client'

import Link from 'next/link'
import { UISettings, Theme, FontFamily, VoiceLanguage } from '@/types'

const FONT_OPTIONS: { id: FontFamily; label: string }[] = [
  { id: 'serif', label: 'EB Garamond' },
  { id: 'sans', label: 'DM Sans' },
  { id: 'mono', label: 'JetBrains Mono' },
  { id: 'display', label: 'Playfair' },
  { id: 'news', label: 'Newsreader' },
  { id: 'literata', label: 'Literata' },
  { id: 'source', label: 'Source Serif 4' },
]

interface SettingsPanelProps {
  open: boolean
  settings: UISettings
  userEmail: string
  userAvatar: string
  onClose: () => void
  onThemeChange: (v: Theme) => void
  onFontChange: (v: FontFamily) => void
  onFontSizeChange: (delta: number) => void
  onWidthChange: (v: number) => void
  onGeminiKeyChange: (v: string) => void
  onSignOut: () => void
  onPrint: () => void
  onSavePdf: () => void
  onShare: () => void | Promise<void>
  onScreenshot: () => void | Promise<void>
  onCommandSuggestionsChange: (v: boolean) => void
  onKeyboardHintsChange: (v: boolean) => void
  onVoiceInputEnabledChange: (v: boolean) => void
  onVoiceLanguageChange: (v: VoiceLanguage) => void
}

export default function SettingsPanel({
                                        open,
                                        settings,
                                        userEmail,
                                        userAvatar,
                                        onClose,
                                        onThemeChange,
                                        onFontChange,
                                        onFontSizeChange,
                                        onWidthChange,
                                        onGeminiKeyChange,
                                        onSignOut,
                                        onPrint,
                                        onSavePdf,
                                        onShare,
                                        onScreenshot,
                                        onCommandSuggestionsChange,
                                        onKeyboardHintsChange,
                                        onVoiceInputEnabledChange,
                                        onVoiceLanguageChange,
                                      }: SettingsPanelProps) {

  // Используем onPointerDown вместо onClick для всех интерактивных элементов —
  // это устраняет задержку 300ms на мобиле и проблемы с touch events.
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      fn()
    },
    // onClick оставляем как fallback для клавиатуры / assistive tech
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  })

  return (
      <div
          className={`settings-overlay print-hide${open ? ' visible' : ''}`}
          // Закрываем только по tap на затемнённый фон
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
          onClick={(e) => e.stopPropagation()}
      >
        <div
            className="settings-panel"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
          <div className="settings-header">
            <span className="settings-title">Settings</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/guide" className="settings-guide-link" onClick={() => onClose()}>
              Guide
            </Link>
            <span className="kbd">Ctrl K</span>
            <button
                type="button"
                className="settings-close"
                {...tap(onClose)}
            >×</button>
          </span>
          </div>

          <div className="settings-body">
            {/* User */}
            <div className="auth-row">
              <div className="user-info">
                {userAvatar && (
                    <img
                        className="user-avatar"
                        src={userAvatar}
                        alt=""
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                )}
                <span className="user-email">{userEmail || '—'}</span>
              </div>
              <button className="sign-out-btn" {...tap(onSignOut)}>Sign out</button>
            </div>

            <div className="settings-sep" />

            {/* Appearance */}
            <div className="settings-section">
              <div className="settings-section-label">Appearance</div>

              <div className="settings-row">
                <span className="settings-row-label">Theme</span>
                <div className="option-pills">
                  {(['light', 'dark', 'sepia', 'midnight'] as Theme[]).map((t) => (
                      <button
                          key={t}
                          className={`option-pill${settings.theme === t ? ' active' : ''}`}
                          {...tap(() => onThemeChange(t))}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                  ))}
                </div>
              </div>

              <div className="settings-row settings-row--fonts">
                <span className="settings-row-label">Font</span>
                <div className="option-pills option-pills--wrap">
                  {FONT_OPTIONS.map(({ id, label }) => (
                      <button
                          key={id}
                          type="button"
                          className={`option-pill${settings.font === id ? ' active' : ''}`}
                          {...tap(() => onFontChange(id))}
                      >
                        {label}
                      </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-row-label">Size</span>
                <div className="font-size-ctrl">
                  <button {...tap(() => onFontSizeChange(-1))}>−</button>
                  <span>{settings.font_size}</span>
                  <button {...tap(() => onFontSizeChange(1))}>+</button>
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-row-label">Width</span>
                <div className="option-pills">
                  {([600, 680, 820] as const).map((w) => (
                      <button
                          key={w}
                          className={`option-pill${settings.width === w ? ' active' : ''}`}
                          {...tap(() => onWidthChange(w))}
                      >
                        {w === 600 ? 'Narrow' : w === 680 ? 'Normal' : 'Wide'}
                      </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-sep" />

            {/* Writing & input */}
            <div className="settings-section">
              <div className="settings-section-label">Writing &amp; input</div>

              <div className="settings-row">
                <span className="settings-row-label">!! suggestions</span>
                <div className="option-pills">
                  <button
                      type="button"
                      className={`option-pill${settings.command_suggestions ? ' active' : ''}`}
                      {...tap(() => onCommandSuggestionsChange(true))}
                  >On</button>
                  <button
                      type="button"
                      className={`option-pill${!settings.command_suggestions ? ' active' : ''}`}
                      {...tap(() => onCommandSuggestionsChange(false))}
                  >Off</button>
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-row-label">Keyboard hints</span>
                <div className="option-pills">
                  <button
                      type="button"
                      className={`option-pill${settings.keyboard_hints ? ' active' : ''}`}
                      {...tap(() => onKeyboardHintsChange(true))}
                  >On</button>
                  <button
                      type="button"
                      className={`option-pill${!settings.keyboard_hints ? ' active' : ''}`}
                      {...tap(() => onKeyboardHintsChange(false))}
                  >Off</button>
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-row-label">Voice input</span>
                <div className="option-pills">
                  <button
                      type="button"
                      className={`option-pill${settings.voice_input_enabled ? ' active' : ''}`}
                      {...tap(() => onVoiceInputEnabledChange(true))}
                  >On</button>
                  <button
                      type="button"
                      className={`option-pill${!settings.voice_input_enabled ? ' active' : ''}`}
                      {...tap(() => onVoiceInputEnabledChange(false))}
                  >Off</button>
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-row-label">Voice language</span>
                <div className="option-pills option-pills--wrap">
                  {([
                    { id: 'en-US' as const, label: 'English' },
                    { id: 'ru-RU' as const, label: 'Русский' },
                    { id: 'pl-PL' as const, label: 'Polski' },
                  ]).map(({ id, label }) => (
                      <button
                          key={id}
                          type="button"
                          className={`option-pill${settings.voice_language === id ? ' active' : ''}`}
                          {...tap(() => onVoiceLanguageChange(id))}
                      >
                        {label}
                      </button>
                  ))}
                </div>
              </div>

              <p className="settings-hint settings-hint--tight">
                Suggestions appear while you type <code className="settings-inline-code">!!</code>. Voice uses the browser speech engine (Chrome / Edge work best).
              </p>
            </div>

            <div className="settings-sep" />

            {/* Export & share */}
            <div className="settings-section">
              <div className="settings-section-label">Document</div>
              <div className="settings-actions-grid">
                <button type="button" className="settings-action-btn" {...tap(onPrint)}>Print</button>
                <button type="button" className="settings-action-btn" {...tap(onSavePdf)}>Save as PDF</button>
                <button type="button" className="settings-action-btn" {...tap(() => { void onShare() })}>Share</button>
                <button type="button" className="settings-action-btn" {...tap(() => { void onScreenshot() })}>Save page image</button>
              </div>
              <p className="settings-hint">
                Save as PDF uses the system print dialog — choose “Save as PDF” as the printer. Save page image exports the current page as a PNG.
              </p>
            </div>

            <div className="settings-sep" />

            {/* AI */}
            <div className="settings-section">
              <div className="settings-section-label">AI — Gemini 3.1 Flash Lite Preview</div>
            </div>
            <div className="key-input-wrap">
              <input
                  className="key-input"
                  type="password"
                  placeholder="Paste your Gemini API key…"
                  autoComplete="off"
                  value={settings.gemini_key}
                  onChange={(e) => onGeminiKeyChange(e.target.value)}
              />
            </div>
            <div style={{ padding: '6px 20px 4px' }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--fg-dim)' }}>
              Select text in the editor to get AI actions.
            </span>
            </div>
          </div>
        </div>
      </div>
  )
}