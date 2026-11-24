import initialQuestions from '../supabase/functions/_shared/initial-questions.json'
import { fixedQuestions } from '../supabase/functions/_shared/questions'
import type { Answers, ApplicationStatus } from '../supabase/functions/_shared/questions'
import type { intake, IntakeResult } from './connection'

const key = 'qa-tester-demo-apps'
const questions = [...initialQuestions.map(({ id, title, hint, options, multi }) => ({ id, title, hint, options, multi })), ...fixedQuestions]
type DemoRow = {
  id: string
  name: string
  email: string
  token: string
  answers: Answers
  focus_events: number
  score?: number
  profile_tags?: string[]
  status: ApplicationStatus
}

export function demoIntake(action: Parameters<typeof intake>[0], input: object): IntakeResult {
  const body = input as Partial<DemoRow>
  const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as DemoRow[]
  let row = rows.find((item) => item.token === body.token && (action === 'start' ? item.email === body.email : item.id === body.id))
  if (action === 'start' && !row && body.email && body.name && body.token) {
    row = { id: crypto.randomUUID(), token: body.token, name: body.name, email: body.email, status: 'in_progress', answers: {}, focus_events: 0 }
    rows.push(row)
  }
  if (!row) throw new Error('No encontramos esta evaluación de demostración.')
  if (row.status === 'in_progress') {
    row.focus_events = Math.max(row.focus_events, body.focus_events ?? 0)
    if (action === 'cancel' || row.focus_events >= 2) row.status = 'cancelled'
    else if (action === 'save' || action === 'complete') row.answers = body.answers ?? {}
    if (action === 'complete' && row.status === 'in_progress') {
      const correct = initialQuestions.filter((item) => row.answers[item.id] === item.correct).length
      const test = row.answers.test
      const findings = typeof test === 'object' && !Array.isArray(test) ? test.findings.length : 0
      row.score = Math.round((correct + Math.min(findings, 3)) / (initialQuestions.length + 3) * 100)
      row.profile_tags = [row.score >= 80 ? 'nivel-avanzado' : row.score >= 50 ? 'nivel-intermedio' : 'nivel-inicial']
      row.status = 'completed'
    }
  }
  localStorage.setItem(key, JSON.stringify(rows))
  const { id, status, focus_events, score, profile_tags, answers } = row
  return { id, status, focus_events, score, profile_tags, answers, questions }
}
