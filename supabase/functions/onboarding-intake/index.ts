import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { corsHeaders as sdkCorsHeaders } from 'npm:@supabase/supabase-js@2.119.2/cors'
import initialQuestions from '../_shared/initial-questions.json' with { type: 'json' }
import { fixedQuestions, maxFindings, severities, visibleQuestions } from '../_shared/questions.ts'
import type { Answers, CandidateQuestion, EditableQuestion, Questionnaire, Report } from '../_shared/questions.ts'

const corsHeaders = { ...sdkCorsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const SKILLS = new Map([
  ['Pruebas manuales', 'manual'], ['Automatización', 'automatizacion'], ['Pruebas de API', 'api'],
  ['Aplicaciones móviles', 'movil'], ['Accesibilidad', 'accesibilidad'],
])
const fallback = { revision: 1, questions: initialQuestions as EditableQuestion[] }
const fixedIds = new Set(['test', ...fixedQuestions.map(({ id }) => id)])
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const validId = /^[a-z0-9_-]{1,64}$/i

type Row = {
  id: string
  status: 'in_progress' | 'completed' | 'cancelled'
  answers: Answers
  questionnaire: Questionnaire | null
  score: number | null
  profile_tags: string[]
  focus_events: number
}
const columns = 'id,status,answers,questionnaire,score,profile_tags,focus_events'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function failure(action: string, error: { code?: string } | null) {
  console.error(JSON.stringify({ operation: action, code: error?.code ?? 'unexpected_response' }))
  return json({ error: 'No pudimos guardar o consultar los datos. Intenta de nuevo.' }, 500)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function candidateQuestions(questionnaire: Questionnaire): CandidateQuestion[] {
  const active = questionnaire.questions.filter(({ active }) => active)
  return [
    ...active.map(({ id, title, hint, multi, options }) => ({ id, title, hint, multi, options })),
    ...fixedQuestions,
  ]
}

function validQuestionSet(input: unknown): input is EditableQuestion[] {
  if (!Array.isArray(input) || input.length > 30) return false
  const ids = new Set(fixedIds)
  return input.every((q) => {
    if (!record(q) || typeof q.id !== 'string' || !validId.test(q.id) || ids.has(q.id) ||
        typeof q.title !== 'string' || !q.title.trim() || q.title.length > 200 ||
        typeof q.hint !== 'string' || q.hint.length > 300 ||
        typeof q.multi !== 'boolean' || typeof q.active !== 'boolean' ||
        !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) return false
    ids.add(q.id)
    const optionIds = new Set<string>()
    const labels = new Set<string>()
    for (const option of q.options) {
      if (!record(option) || typeof option.id !== 'string' || !validId.test(option.id) || optionIds.has(option.id) ||
          typeof option.label !== 'string' || !option.label.trim() || option.label.length > 160) return false
      const label = option.label.trim().toLocaleLowerCase('es')
      if (labels.has(label)) return false
      optionIds.add(option.id)
      labels.add(label)
    }
    return q.correct === null || (!q.multi && typeof q.correct === 'string' && optionIds.has(q.correct))
  })
}

function normalizeAnswers(raw: Record<string, unknown>, questionnaire: Questionnaire, findings?: Report[]): Answers {
  const results: Answers = {}
  const all = candidateQuestions(questionnaire)
  const skills = all.find((question) => question.id === 'skills')
  if (skills && Array.isArray(raw.skills)) {
    results.skills = skills.options.map(({ id }) => id).filter((id) => (raw.skills as unknown[]).includes(id))
  }
  for (const question of visibleQuestions(all, results)) {
    const value = raw[question.id]
    const ids = question.options.map(({ id }) => id)
    if (question.multi && Array.isArray(value)) results[question.id] = ids.filter((id) => value.includes(id))
    if (!question.multi && typeof value === 'string' && ids.includes(value)) results[question.id] = value
  }
  if (findings) results.test = { findings }
  return results
}

function parseFindings(raw: unknown): Report[] | null {
  if (!record(raw) || !Array.isArray(raw.findings) || raw.findings.length < 1 || raw.findings.length > maxFindings) return null
  const findings: Report[] = []
  for (const item of raw.findings) {
    if (!record(item) || typeof item.description !== 'string' || typeof item.severity !== 'string') return null
    const description = item.description.trim()
    if (description.length < 20 || description.length > 1500 || !severities.includes(item.severity)) return null
    findings.push({ description, severity: item.severity })
  }
  return findings
}

function calculate(answers: Answers, findings: Report[], questionnaire: Questionnaire) {
  const scored = questionnaire.questions.filter((question) => question.active && question.correct !== null)
  const correct = scored.filter((question) => answers[question.id] === question.correct).length
  const detected = new Map<string, boolean>()
  for (const { description: report, severity } of findings) {
    const description = report.toLocaleLowerCase('es')
    const mark = (key: string, expected: string) => detected.set(key, (detected.get(key) ?? false) || severity === expected)
    const quantity = /cantidad|boleto|boletos/.test(description)
    const total = /total|subtotal|importe/.test(description)
    const coupon = /c[oó]digo|cup[oó]n|promoci[oó]n|descuento|qa10/.test(description)
    if (quantity && /(menos de|por debajo|menor de|inferior a|negativ|cero|m[ií]nim|0|\s-\d)/.test(description)) mark('minimum-quantity', 'Crítica')
    if (quantity && total && /(no cambia|no actualiza|no baja|no disminuye|se mantiene|sigue igual|mismo)/.test(description)) mark('stale-total', 'Alta')
    if (coupon && /(10%|total|no cambia|no aplica|no descuenta|sin descuento|sigue igual)/.test(description)) mark('coupon-total', 'Media')
  }
  const score = Math.round(((correct + detected.size + [...detected.values()].filter(Boolean).length * 0.5) / (scored.length + 4.5)) * 100)
  const tags = Array.isArray(answers.skills) ? answers.skills.flatMap((skill) => SKILLS.get(skill) ?? []) : []
  const experience = answers.experience
  tags.push(experience === '3' ? 'experiencia-qa-3+' : experience === '2' ? 'experiencia-qa-1-3' : experience === '1' ? 'experiencia-qa-<1' : 'experiencia-qa-inicial')
  tags.push(score >= 80 ? 'nivel-avanzado' : score >= 50 ? 'nivel-intermedio' : 'nivel-inicial')
  return { score, tags }
}

function result(row: Row, includeQuestionnaire = false) {
  const { id, status, focus_events, score, profile_tags } = row
  return {
    id, status, focus_events, score, profile_tags,
    ...(includeQuestionnaire ? { answers: row.answers, questions: candidateQuestions(row.questionnaire ?? fallback) } : {}),
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'El servicio de evaluaciones no está configurado.' }, 503)
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const raw = await request.text().catch(() => '')
  if (raw.length > 75000) return json({ error: 'La solicitud es demasiado grande.' }, 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: 'La solicitud no es válida.' }, 400) }
  if (!record(body)) return json({ error: 'La solicitud no es válida.' }, 400)
  const { action } = body

  try {
    if (action === 'admin_questions' || action === 'admin_publish') {
      const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
      if (!bearer) return json({ error: 'Inicia sesión para continuar.' }, 401)
      const { data: { user }, error } = await db.auth.getUser(bearer)
      if (error || !user) return json({ error: 'Inicia sesión para continuar.' }, 401)
      if (user.app_metadata.role !== 'admin') return json({ error: 'Esta cuenta no tiene acceso al panel.' }, 403)
      let query = db.from('tester_questionnaire')
      if (action === 'admin_questions') {
        const { data, error: readError } = await query.select('revision,questions').eq('singleton', true).single()
        return readError ? failure(action, readError) : json(data)
      }
      const { revision, questions } = body
      if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1 || !validQuestionSet(questions)) {
        return json({ error: 'Revisa los enunciados y las opciones del cuestionario.' }, 400)
      }
      const clean = questions.map(({ id, title, hint, multi, active, correct, options }) => ({
        id, title: title.trim(), hint: hint.trim(), multi, active, correct,
        options: options.map(({ id, label }) => ({ id, label: label.trim() })),
      }))
      const { data, error: writeError } = await query.update({ revision: revision + 1, questions: clean, updated_at: new Date().toISOString() })
        .eq('singleton', true).eq('revision', revision).select('revision,questions').maybeSingle()
      if (writeError) return failure(action, writeError)
      return data ? json(data) : json({ error: 'Otra persona publicó cambios. Recarga el cuestionario antes de volver a editar.' }, 409)
    }

    if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/i.test(body.token)) {
      return json({ error: 'La sesión de evaluación no es válida.' }, 400)
    }
    const tokenHash = await hashToken(body.token)
    const modern = body.client_version === 2
    if (action === 'start') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!name || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'Revisa tu nombre y correo electrónico.' }, 400)
      }
      const findRetry = () => db.from('tester_applications').select(columns)
        .eq('email', email).eq('candidate_token_hash', tokenHash).maybeSingle<Row>()
      const previous = await findRetry()
      if (previous.error) return failure(action, previous.error)
      if (previous.data) return json(result(previous.data, true))

      let questionnaire = fallback
      if (modern) {
        const current = await db.from('tester_questionnaire').select('revision,questions').eq('singleton', true).single<Questionnaire>()
        if (current.error || !current.data) return failure(action, current.error)
        questionnaire = current.data
      }
      const created = await db.from('tester_applications').insert({ name, email, candidate_token_hash: tokenHash, questionnaire })
        .select(columns).single<Row>()
      if (created.error?.code === '23505') {
        const retry = await findRetry()
        if (retry.error) return failure(action, retry.error)
        return retry.data ? json(result(retry.data, true)) : json({ error: 'Ya existe una solicitud con este correo electrónico.' }, 409)
      }
      return created.error || !created.data ? failure(action, created.error) : json(result(created.data, true))
    }

    if (typeof body.id !== 'string' || !uuid.test(body.id) ||
        (action !== 'resume' && action !== 'focus' && action !== 'cancel' && action !== 'save' && action !== 'complete')) {
      return json({ error: 'La solicitud no es válida.' }, 400)
    }
    const lookup = await db.from('tester_applications').select(columns)
      .eq('id', body.id).eq('candidate_token_hash', tokenHash).maybeSingle<Row>()
    if (lookup.error) return failure(action, lookup.error)
    if (!lookup.data) return json({ error: 'No encontramos esta solicitud o ya no tienes acceso.' }, 404)
    const application = lookup.data
    if (action === 'resume') return json(result(application, true))
    if (application.status !== 'in_progress') {
      if (!modern && (action !== 'complete' || application.status !== 'completed')) {
        return json({ error: 'Esta solicitud ya fue cerrada.' }, 409)
      }
      return json(result(application))
    }

    const focus = typeof body.focus_events === 'number' && Number.isFinite(body.focus_events)
      ? Math.max(0, Math.min(20, Math.trunc(body.focus_events))) : 0
    const questionnaire = application.questionnaire ?? fallback
    let answers: Answers | null = null
    let score: number | null = null
    let tags: string[] | null = null
    if (action === 'save' || action === 'complete') {
      if (!record(body.answers)) return json({ error: 'Las respuestas no son válidas.' }, 400)
      if (action === 'complete') {
        const findings = parseFindings(body.answers.test)
        if (!findings) return json({ error: 'Completa el reporte del reto antes de enviar.' }, 400)
        answers = normalizeAnswers(body.answers, questionnaire, findings)
        ;({ score, tags } = calculate(answers, findings, questionnaire))
      } else {
        answers = normalizeAnswers(body.answers, questionnaire)
      }
    }
    const { data, error } = await db.rpc('tester_apply_intake', {
      p_id: application.id, p_token_hash: tokenHash, p_action: action, p_focus_events: focus,
      p_answers: answers, p_score: score, p_profile_tags: tags,
    })
    if (error) return failure(action, error)
    if (!data) return json({ error: 'No encontramos esta solicitud o ya no tienes acceso.' }, 404)
    if (!modern && action === 'complete' && data.status !== 'completed') {
      return json({ error: 'Esta solicitud ya fue cerrada.' }, 409)
    }
    return json(action === 'save' ? { ...data, saved: true } : data)
  } catch {
    return failure(typeof action === 'string' ? action : 'unknown', null)
  }
})
