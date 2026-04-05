import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createAnonClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const anon = createAnonClient()
    const { data } = await anon.auth.getUser(body.token)
    if (!data.user) return NextResponse.json({ ok: false })

    const uid = data.user.id
    const sb = createAdminClient()
    const { data: existing } = await sb
      .from('notes')
      .select('id')
      .eq('user_id', uid)
      .limit(1)
      .maybeSingle()

    if (existing) {
      await sb.from('notes').update({ content_text: body.content }).eq('id', existing.id)
    } else {
      await sb.from('notes').insert({ user_id: uid, content_text: body.content })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) })
  }
}
