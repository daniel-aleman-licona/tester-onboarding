import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import type { Answers, ApplicationStatus, CandidateQuestion, Questionnaire } from '../supabase/functions/_shared/questions'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()
export const demo = import.meta.env.DEV && import.meta.env.VITE_ONBOARDING_DEMO === 'true'
export const configurationError = 'El servicio de evaluaciones no está configurado. Intenta más tarde.'

function makeClient() {
  if (!url || !key || demo) return null
  try {
    return createClient(url, key)
  } catch {
    return null
  }
}

export const supabase = makeClient()

export type IntakeResult = {
  id: string
  status: ApplicationStatus
  questions?: CandidateQuestion[]
  answers?: Answers
  score?: number
  profile_tags?: string[]
  focus_events: number
}

export class IntakeHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Action = 'start' | 'resume' | 'save' | 'focus' | 'cancel' | 'complete'

async function invoke<T>(action: Action | 'admin_questions' | 'admin_publish', body: object = {}): Promise<T> {
  if (!supabase) throw new Error(configurationError)
  const { data, error } = await supabase.functions.invoke<T>('onboarding-intake', { body: { ...body, action, client_version: 2 } })
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response
    const payload = await response.json().catch(() => null)
    if (typeof payload?.error === 'string') throw new IntakeHttpError(payload.error, response.status)
  }
  if (error || !data) throw new Error('No pudimos conectar con el servicio. Intenta de nuevo.')
  return data
}

export const intake = (action: Action, body: object) => invoke<IntakeResult>(action, body)
export const getQuestionnaire = () => invoke<Questionnaire>('admin_questions')
export const publishQuestionnaire = (questionnaire: Questionnaire) => invoke<Questionnaire>('admin_publish', questionnaire)
