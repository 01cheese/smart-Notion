import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Guide · void',
  description: 'How to use void — writing, commands, export, and shortcuts.',
}

export default function GuidePage() {
  return (
      <div className="guide-page">
        <header className="guide-top">
          <Link href="/" className="guide-back">
            ← Back to void
          </Link>
          <span className="guide-wordmark">void</span>
        </header>

        <div className="guide-hero">
          <h1>Guide</h1>
          <p className="guide-lead">
            void is a minimal notebook: one flowing page per idea, Markdown while you type, and quick tools when you need them.
          </p>
        </div>

        <section className="guide-section">
          <h2>Essentials</h2>
          <ul>
            <li>Write in the main area. Your work syncs when you are signed in.</li>
            <li>Use the page control (top right) or side arrows to move between pages and the table of contents.</li>
            <li>Edit the page title in the strip at the bottom; it also updates the browser tab title.</li>
          </ul>
        </section>

        <section className="guide-section">
          <h2>Markdown (Notion-style)</h2>
          <p>Type inline syntax and finish with a space or continue typing — for example <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>, <code>~~strike~~</code>, and <code>[label](https://example.com)</code>.</p>
          <p>Start a line with <code>#</code>, <code>##</code>, or <code>###</code> and press Space for headings. Use <code>-</code> or <code>*</code> plus Space for lists, <code>&gt;</code> for quotes, and <code>---</code> then Enter for a horizontal rule.</p>
          <p>Pasting multi-line Markdown is converted using the same engine as inline transforms.</p>
        </section>

        <section className="guide-section">
          <h2>Quick commands</h2>
          <p>Type a trigger, then Space or Enter — for example <code>!!python</code> or <code>!!diagram</code>.</p>
          <div className="guide-command-grid">
            <div className="guide-command-row">
              <span><code>!!python</code></span>
              <span>Run Python in the browser (Pyodide).</span>
            </div>
            <div className="guide-command-row">
              <span><code>!!draw</code></span>
              <span>Sketch on a canvas; copy or insert the image.</span>
            </div>
            <div className="guide-command-row">
              <span><code>!!diagram</code></span>
              <span>Mermaid diagrams: flowcharts, sequences, Gantt, and more. Start with a valid header (e.g. <code>flowchart LR</code> or <code>graph TD</code>). Invalid syntax shows a single text error in the panel — not stacked icons.</span>
            </div>
            <div className="guide-command-row">
              <span><code>!!ai</code></span>
              <span>Chat with Gemini (API key in Settings).</span>
            </div>
            <div className="guide-command-row">
              <span><code>!!todo</code> / <code>!!calc</code></span>
              <span>Checklist and calculator panels.</span>
            </div>
          </div>
        </section>

        <section className="guide-section">
          <h2>Keyboard</h2>
          <ul>
            <li><span className="guide-kbd">Ctrl</span> <span className="guide-kbd">K</span> — Settings</li>
            <li><span className="guide-kbd">Ctrl</span> <span className="guide-kbd">J</span> — Search pages</li>
            <li><span className="guide-kbd">Esc</span> — Close panels</li>
          </ul>
        </section>

        <section className="guide-section">
          <h2>Export &amp; share</h2>
          <p>In Settings → Document: <strong>Print</strong> and <strong>Save as PDF</strong> use the system print dialog (choose “Save as PDF” where available). <strong>Share</strong> uses the device share sheet or copies text and the page URL. <strong>Save page image</strong> exports the current page as a PNG.</p>
        </section>

        <section className="guide-section">
          <h2>Appearance</h2>
          <p>Pick a theme, one of several reading fonts, size, and column width. UI controls fade when you are idle and return on interaction.</p>
        </section>
      </div>
  )
}
