export type Option = { id: string; label: string }
export type CandidateQuestion = {
  id: string
  title: string
  hint: string
  options: Option[]
  multi: boolean
  requiresSkill?: string
}
export type EditableQuestion = CandidateQuestion & { active: boolean; correct: string | null }
export type Questionnaire = { revision: number; questions: EditableQuestion[] }
export type Report = { description: string; severity: string }
export type Answers = Record<string, string | string[] | { findings: Report[] }>
export type ApplicationStatus = 'in_progress' | 'completed' | 'cancelled'

const options = (labels: string[], multi = false): Option[] =>
  labels.map((label, index) => ({ id: multi ? label : String(index), label }))

export const skillNames = [
  'Pruebas manuales', 'Automatización', 'Pruebas de API', 'Aplicaciones móviles', 'Accesibilidad',
]

export const fixedQuestions: CandidateQuestion[] = [
  {
    id: 'experience', title: '¿Cuánta experiencia tienes probando software?',
    hint: 'Cuenta experiencia laboral, académica o personal.', multi: false,
    options: options(['Estoy comenzando', 'Menos de 1 año', '1 a 3 años', 'Más de 3 años']),
  },
  {
    id: 'skills', title: '¿Qué áreas has probado o te gustaría probar?',
    hint: 'Puedes elegir varias. Las respuestas ayudan a sugerirte pruebas adecuadas.', multi: true,
    options: options(skillNames, true),
  },
  {
    id: 'frameworks', title: '¿Con qué herramientas de automatización has trabajado?',
    hint: 'Selecciona todas las que apliquen.', multi: true, requiresSkill: 'Automatización',
    options: options(['Playwright', 'Cypress', 'Selenium', 'Appium', 'Otro'], true),
  },
  {
    id: 'apiTools', title: '¿Qué herramientas has usado para probar APIs?',
    hint: 'Selecciona todas las que apliquen.', multi: true, requiresSkill: 'Pruebas de API',
    options: options(['Postman', 'Insomnia', 'curl', 'Otro'], true),
  },
  {
    id: 'mobileExperience', title: '¿Qué tipo de pruebas móviles has realizado?',
    hint: 'Selecciona todas las que apliquen.', multi: true, requiresSkill: 'Aplicaciones móviles',
    options: options(['Instalación y actualización', 'Interfaz en distintos tamaños', 'Permisos y notificaciones', 'Aún no tengo experiencia'], true),
  },
]

export function visibleQuestions(questions: CandidateQuestion[], answers: Answers) {
  const skills = Array.isArray(answers.skills) ? answers.skills : []
  return questions.filter((question) => !question.requiresSkill || skills.includes(question.requiresSkill))
}

export const severities = ['Crítica', 'Alta', 'Media', 'Baja']
export const maxFindings = 10
