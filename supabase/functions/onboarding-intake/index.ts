import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const KNOWLEDGE: Record<string, number> = { regression: 1, severity: 2, smoke: 0, api: 1 }
const SKILLS: Record<string, string> = {
  'Pruebas manuales': 'manual',
  Automatización: 'automatizacion',
  'Pruebas de API': 'api',
  'Aplicaciones móviles': 'movil',
  Accesibilidad: 'accesibilidad',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function calculate(answers: Record<string, unknown>) {
  const correctAnswers = Object.entries(KNOWLEDGE).reduce((sum, [key, correct]) => sum + (Number(answers[key]) === correct ? 1 : 0), 0)
  const test = answers.test && typeof answers.test === 'object' ? answers.test as Record<string, unknown> : {}
  const findings = Array.isArray(test.findings) ? test.findings.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && typeof (item as Record<string, unknown>).description === 'string') : []
  const detected = new Map<string, boolean>()
  for (const finding of findings) {
    const description = String(finding.description).toLocaleLowerCase('es')
    const severity = String(finding.severity)
    const mark = (key: string, expected: string) => detected.set(key, (detected.get(key) ?? false) || severity === expected)
    const quantity = /cantidad|boleto|boletos/.test(description)
    const total = /total|subtotal|importe/.test(description)
    const coupon = /c[oó]digo|cup[oó]n|promoci[oó]n|descuento|qa10/.test(description)
    if (quantity && /(menos de|por debajo|menor de|inferior a|negativ|cero|m[ií]nim|0|\s-\d)/.test(description)) mark('minimum-quantity', 'Crítica')
    if (quantity && total && /(no cambia|no actualiza|no baja|no disminuye|se mantiene|sigue igual|mismo)/.test(description)) mark('stale-total', 'Alta')
    if (coupon && /(10%|total|no cambia|no aplica|no descuenta|sin descuento|sigue igual)/.test(description)) mark('coupon-total', 'Media')
  }
  const bugCount = detected.size
  const severityCount = [...detected.values()].filter(Boolean).length
  const score = Math.round(((correctAnswers + bugCount + severityCount * 0.5) / (Object.keys(KNOWLEDGE).length + 4.5)) * 100)
  const skillAnswers = Array.isArray(answers.skills) ? answers.skills : []
  const tags = skillAnswers.filter((item): item is string => typeof item === 'string' && item in SKILLS).map((item) => SKILLS[item])
  const experience = String(answers.experience ?? '')
  tags.push(experience === '3' ? 'experiencia-qa-3+' : experience === '2' ? 'experiencia-qa-1-3' : experience === '1' ? 'experiencia-qa-<1' : 'experiencia-qa-inicial')
  tags.push(score >= 80 ? 'nivel-avanzado' : score >= 50 ? 'nivel-intermedio' : 'nivel-inicial')
  return { score, tags: [...new Set(tags)] }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'La función de onboarding no está configurada.' }, 503)
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const body = await request.json() as Record<string, unknown>
    const action = body.action
    if (action === 'start') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : ''
      const token = typeof body.token === 'string' ? body.token : ''
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || token.length !== 64) return json({ error: 'Revisa tu nombre y correo electrónico.' }, 400)
      const { data, error } = await db.from('tester_applications').insert({ name, email, candidate_token_hash: await hashToken(token) }).select('id').single()
      if (error?.code === '23505') return json({ error: 'Ya existe una solicitud con este correo electrónico.' }, 409)
      if (error || !data) return json({ error: 'No pudimos crear tu solicitud. Intenta de nuevo.' }, 500)
      return json({ id: data.id })
    }

    const id = typeof body.id === 'string' ? body.id : ''
    const token = typeof body.token === 'string' ? body.token : ''
    if (!id || token.length !== 64) return json({ error: 'Solicitud no válida.' }, 400)
    const tokenHash = await hashToken(token)
    const { data: application, error: lookupError } = await db.from('tester_applications').select('id,status,answers').eq('id', id).eq('candidate_token_hash', tokenHash).maybeSingle()
    if (lookupError || !application) return json({ error: 'No encontramos esta solicitud o ya no tienes acceso.' }, 404)
    if (application.status !== 'in_progress') return json({ error: 'Esta solicitud ya fue cerrada.' }, 409)

    if (action === 'focus') {
      const focusEvents = Math.max(0, Math.min(20, Number(body.focus_events) || 0))
      const status = focusEvents >= 2 ? 'cancelled' : 'in_progress'
      const { error } = await db.from('tester_applications').update({ focus_events: focusEvents, status }).eq('id', id)
      if (error) return json({ error: 'No pudimos guardar el evento de foco.' }, 500)
      return json({ status })
    }
    if (action === 'save') {
      const answers = body.answers
      if (!answers || typeof answers !== 'object' || JSON.stringify(answers).length > 12000) return json({ error: 'Las respuestas no son válidas.' }, 400)
      const { error } = await db.from('tester_applications').update({ answers, focus_events: Math.max(0, Math.min(20, Number(body.focus_events) || 0)) }).eq('id', id)
      if (error) return json({ error: 'No pudimos guardar tus respuestas.' }, 500)
      return json({ saved: true })
    }
    if (action === 'cancel') {
      const focusEvents = Math.max(2, Math.min(20, Number(body.focus_events) || 2))
      const { error } = await db.from('tester_applications').update({ focus_events: focusEvents, status: 'cancelled' }).eq('id', id)
      if (error) return json({ error: 'No pudimos guardar la cancelación.' }, 500)
      return json({ status: 'cancelled' })
    }
    if (action === 'complete') {
      const answers = body.answers
      if (!answers || typeof answers !== 'object' || JSON.stringify(answers).length > 12000) return json({ error: 'Las respuestas no son válidas.' }, 400)
      const normalized = answers as Record<string, unknown>
      const test = normalized.test && typeof normalized.test === 'object' ? normalized.test as Record<string, unknown> : {}
      if (!Array.isArray(test.findings) || test.findings.length === 0 || test.findings.length > 10 || test.findings.some((item) => !item || typeof item !== 'object' || typeof (item as Record<string, unknown>).description !== 'string' || String((item as Record<string, unknown>).description).trim().length < 20 || !['Crítica', 'Alta', 'Media', 'Baja'].includes(String((item as Record<string, unknown>).severity)))) return json({ error: 'Completa el reporte del reto antes de enviar.' }, 400)
      const { score, tags } = calculate(normalized)
      const { error } = await db.from('tester_applications').update({ answers: normalized, score, profile_tags: tags, status: 'completed', focus_events: Math.max(0, Math.min(20, Number(body.focus_events) || 0)) }).eq('id', id)
      if (error) return json({ error: 'No pudimos guardar tu evaluación.' }, 500)
      return json({ score, profile_tags: tags })
    }
    return json({ error: 'Acción no reconocida.' }, 400)
  } catch {
    return json({ error: 'No pudimos procesar la solicitud.' }, 400)
  }
})
