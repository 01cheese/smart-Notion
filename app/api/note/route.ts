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
    .from('notes')
    .select('id, content_text, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (data) return NextResponse.json(data)

  const { data: newNote } = await sb
    .from('notes')
    .insert({ user_id: user.id, content_text: '' })
    .select()
    .single()

  return NextResponse.json(newNote)
}

export async function PUT(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const sb = createAdminClient()

  const { data: existing } = await sb
    .from('notes')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (existing) {
    await sb.from('notes').update({ content_text: body.content }).eq('id', existing.id)
  } else {
    await sb.from('notes').insert({ user_id: user.id, content_text: body.content })
  }

  return NextResponse.json({ ok: true })
}
