'use client'

import { UISettings, Theme, FontFamily } from '@/types'

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
          className={`settings-overlay${open ? ' visible' : ''}`}
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
            <span className="kbd">Ctrl K</span>
            <button
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

              <div className="settings-row">
                <span className="settings-row-label">Font</span>
                <div className="option-pills">
                  {(['serif', 'sans', 'mono'] as FontFamily[]).map((f) => (
                      <button
                          key={f}
                          className={`option-pill${settings.font === f ? ' active' : ''}`}
                          {...tap(() => onFontChange(f))}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
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