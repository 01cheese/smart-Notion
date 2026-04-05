import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createAnonClient } from '@/lib/supabase-server'

async function getUserFromRequest(req: NextRequest) {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.split(' ')[1]
  const anon = createAnonClient()
  const { data } = await anon.auth.getUser(token)
  return data.user ?? null
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const sb = createAdminClient()
  const { data } = await sb
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (data) return NextResponse.json(data)

  const defaults = { user_id: user.id, gemini_key: '', gemini_model: 'gemini-3.1-flash-lite-preview' }
  await sb.from('user_settings').insert(defaults)
  return NextResponse.json(defaults)
}

export async function PUT(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const sb = createAdminClient()

  const updateData: Record<string, string> = {}
  if (body.gemini_key != null) updateData.gemini_key = body.gemini_key
  if (body.gemini_model != null) updateData.gemini_model = body.gemini_model

  if (Object.keys(updateData).length === 0) return NextResponse.json({ ok: true })

  const { data: existing } = await sb
    .from('user_settings')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    await sb.from('user_settings').update(updateData).eq('user_id', user.id)
  } else {
    await sb.from('user_settings').insert({ user_id: user.id, ...updateData })
  }

  return NextResponse.json({ ok: true })
}
