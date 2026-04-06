import { NextRequest, NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase-server'

async function getUserFromRequest(req: NextRequest) {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.split(' ')[1]
  const anon = createAnonClient()
  const { data } = await anon.auth.getUser(token)
  return data.user ?? null
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const { action, selected_text, context, gemini_api_key, gemini_model } = body

  if (!gemini_api_key) {
    return NextResponse.json({ error: 'Gemini API key not set' }, { status: 400 })
  }

  const model = gemini_model || 'gemini-2.0-flash-lite'

  const prompts: Record<string, string> = {
    continue: `You are a writing assistant. Continue the following selected text naturally, matching the tone and style. Return ONLY the continuation text, nothing else.\n\nContext (surrounding text):\n${context}\n\nSelected text to continue:\n${selected_text}`,
    explain: `Explain the following text clearly and concisely. Return ONLY the explanation.\n\nText to explain:\n${selected_text}`,
    replace: `Rewrite the following text to make it better — clearer, more engaging, and more precise. Preserve the original meaning. Return ONLY the improved version, nothing else.\n\nOriginal text:\n${selected_text}`,
    beautify: `You are a Markdown formatting expert. Rewrite the following text beautifully using proper Markdown formatting.
Rules:
- Use **bold** for important terms, key concepts, and critical information
- Use *italic* for emphasis, titles of works, or subtle stress
- Use \`inline code\` for technical terms, commands, or specific values
- Use > blockquote for notable quotes or key ideas worth highlighting
- Use ## or ### headings if the text has clear sections
- Use - bullet lists for enumerations if appropriate
- Use ~~strikethrough~~ sparingly for corrections or outdated info
- Preserve ALL original meaning and information — do not add or remove facts
- Keep the same language as the original text
- Return ONLY the formatted Markdown text, nothing else. No preamble, no explanation.

Original text:
${selected_text}`,
  }

  const prompt = prompts[action]
  if (!prompt) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  try {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemini_api_key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
          }),
          signal: AbortSignal.timeout(30000),
        }
    )

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ error: `Gemini error: ${text}` }, { status: 502 })
    }

    const data = await response.json()
    const text = data.candidates[0].content.parts[0].text
    return NextResponse.json({ result: text.trim() })
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Gemini request timed out' }, { status: 504 })
    }
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}