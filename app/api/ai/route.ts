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

  const model = gemini_model || 'gemini-3.1-flash-lite-preview'

  const prompts: Record<string, string> = {
    continue: `You are a writing assistant. Continue the following selected text naturally, matching the tone and style. Return ONLY the continuation text, nothing else.\n\nContext (surrounding text):\n${context}\n\nSelected text to continue:\n${selected_text}`,
    explain: `Explain the following text clearly and concisely. Return ONLY the explanation.\n\nText to explain:\n${selected_text}`,
    replace: `Rewrite the following text to make it better — clearer, more engaging, and more precise. Preserve the original meaning. Return ONLY the improved version, nothing else.\n\nOriginal text:\n${selected_text}`,
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
