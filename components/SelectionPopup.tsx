'use client'

interface SelectionPopupProps {
    visible: boolean
    position: { top: number; left: number }
    loadingAction: string | null
    onAction: (action: string) => void
    onLinkPage?: () => void
    onTouchStart?: () => void
    onTouchEnd?: () => void
}

export default function SelectionPopup({
                                           visible,
                                           position,
                                           loadingAction,
                                           onAction,
                                           onLinkPage,
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
            {/* Copy */}
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

            {/* Search */}
            <button
                className="sel-btn"
                onPointerDown={(e) => handleActionPointer(e, 'search')}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                Search
            </button>

            <div className="sel-divider" />

            {/* Link page */}
            <button
                className="sel-btn"
                onPointerDown={(e) => { e.preventDefault(); onLinkPage?.() }}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                Link page
            </button>

            <div className="sel-divider" />

            {/* Continue — FIXED: proper className, no nested divider, correct SVG arrow */}
            <button
                className="sel-btn"
                onPointerDown={(e) => handleActionPointer(e, 'continue')}
            >
                {loadingAction === 'continue' ? <Dots /> : (
                    <>
                        {/* Clean, proportional arrow — fits 12×12 like other icons */}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14"/>
                            <path d="M13 6l6 6-6 6"/>
                        </svg>
                        Continue
                    </>
                )}
            </button>

            {/* Explain */}
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

            {/* Improve */}
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

            {/* Beautify — NEW: AI rewrites selection with Markdown formatting */}
            <button
                className="sel-btn"
                onPointerDown={(e) => handleActionPointer(e, 'beautify')}
            >
                {loadingAction === 'beautify' ? <Dots /> : (
                    <>
                        {/* Sparkle / magic wand icon */}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5L12 3z"/>
                            <path d="M5 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/>
                            <path d="M18 14l0.7 1.3 1.3 0.7-1.3 0.7L18 18l-0.7-1.3-1.3-0.7 1.3-0.7L18 14z"/>
                        </svg>
                        Beautify
                    </>
                )}
            </button>
        </div>
    )
}