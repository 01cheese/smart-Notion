'use client'

interface SelectionPopupProps {
  visible: boolean
  position: { top: number; left: number }
  loadingAction: string | null
  onAction: (action: string) => void
  onTouchStart?: () => void
  onTouchEnd?: () => void
}

export default function SelectionPopup({
                                         visible,
                                         position,
                                         loadingAction,
                                         onAction,
                                         onTouchStart,
                                         onTouchEnd,
                                       }: SelectionPopupProps) {
  const Dots = () => (
      <span className="ai-thinking">
      <span /><span /><span />
    </span>
  )

  // На мобиле используем onPointerDown чтобы среагировать раньше,
  // чем браузер сбросит selection при потере фокуса редактором.
  const handleActionPointer = (e: React.PointerEvent, action: string) => {
    // Prevent editor from losing selection on touch
    e.preventDefault()
    onAction(action)
  }

  return (
      <div
          className={`sel-popup print-hide${visible ? ' visible' : ''}`}
          style={{ top: position.top, left: position.left }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          // Не даём редактору потерять selection при клике на popup
          onMouseDown={(e) => e.preventDefault()}
      >
        <button
            className="sel-btn"
            onPointerDown={(e) => handleActionPointer(e, 'copy')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Copy
        </button>

        <div className="sel-divider" />

        <button
            className="sel-btn"
            onPointerDown={(e) => handleActionPointer(e, 'continue')}
        >
          {loadingAction === 'continue' ? <Dots /> : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                Continue
              </>
          )}
        </button>

        <button
            className="sel-btn"
            onPointerDown={(e) => handleActionPointer(e, 'explain')}
        >
          {loadingAction === 'explain' ? <Dots /> : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                Explain
              </>
          )}
        </button>

        <button
            className="sel-btn"
            onPointerDown={(e) => handleActionPointer(e, 'replace')}
        >
          {loadingAction === 'replace' ? <Dots /> : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Improve
              </>
          )}
        </button>
      </div>
  )
}