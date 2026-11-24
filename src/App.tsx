import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { configurationError, demo, intake, IntakeHttpError, supabase } from './connection'
import type { IntakeResult } from './connection'
import { maxFindings, severities, visibleQuestions } from '../supabase/functions/_shared/questions'
import type { Answers, CandidateQuestion, Report } from '../supabase/functions/_shared/questions'
import Admin from './Admin'
import './App.css'

type Session = { id: string; token: string }
type Stage = 'intro' | 'identity' | 'restoring' | 'questions' | 'practice' | 'cancelling' | 'done' | 'cancelled'
type PendingStart = { email: string; token: string }
const sessionKey = 'qa-tester-session'
const draftKeys = [sessionKey, 'qa-answers', 'qa-focus', 'qa-start', 'qa-position', 'qa-findings', 'qa-cancel-pending', 'qa-name', 'qa-email']
const emptyReport = { description: '', severity: '' }

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') as T ?? fallback } catch { return fallback }
}

function write(key: string, value: unknown) {
  sessionStorage.setItem(key, JSON.stringify(value))
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('')
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'No pudimos procesar la solicitud. Intenta de nuevo.'
}

async function request(action: Parameters<typeof intake>[0], body: object) {
  if (import.meta.env.DEV && demo) return (await import('./demo')).demoIntake(action, body)
  return intake(action, body)
}

function App() {
  const [admin, setAdmin] = useState(location.hash === '#admin')
  useEffect(() => {
    function onHash() {
      if (location.hash === '#admin' && !admin && sessionStorage.getItem(sessionKey)) {
        history.replaceState(null, '', location.pathname + location.search)
        return
      }
      setAdmin(location.hash === '#admin')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [admin])
  return admin ? <Admin /> : <Onboarding />
}

function Onboarding() {
  const [session, setSession] = useState(() => read<Session | null>(sessionKey, null))
  const [stage, setStage] = useState<Stage>(() => read<Session | null>(sessionKey, null) ? 'restoring' : 'intro')
  const [name, setName] = useState(sessionStorage.getItem('qa-name') ?? '')
  const [email, setEmail] = useState(() => sessionStorage.getItem('qa-email') ?? read<PendingStart | null>('qa-start', null)?.email ?? '')
  const [answers, setAnswers] = useState(() => read<Answers>('qa-answers', {}))
  const [catalog, setCatalog] = useState<CandidateQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [timeLeft, setTimeLeft] = useState(30)
  const focus = useRef(read('qa-focus', 0))
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [missingSession, setMissingSession] = useState(false)
  const working = useRef(false)
  const cancellation = useRef(false)
  const [quantity, setQuantity] = useState(2)
  const [coupon, setCoupon] = useState('')
  const [couponApplied, setCouponApplied] = useState(false)
  const [reports, setReports] = useState(() => read<Report[]>('qa-findings', [emptyReport]))
  const [result, setResult] = useState<{ score: number; tags: string[] } | null>(null)
  const allQuestions = visibleQuestions(catalog, answers)
  const question = allQuestions[index]

  function settle(data: IntakeResult) {
    if (data.status === 'in_progress') return false
    if (data.status === 'completed') {
      if (typeof data.score !== 'number' || !Array.isArray(data.profile_tags)) {
        throw new Error('No pudimos confirmar que se guardó tu evaluación. Intenta de nuevo.')
      }
      setResult({ score: data.score, tags: data.profile_tags })
      setStage('done')
    } else if (data.status === 'cancelled') {
      setStage('cancelled')
    } else {
      throw new Error('No pudimos confirmar el estado de tu evaluación. Intenta de nuevo.')
    }
    for (const key of draftKeys) sessionStorage.removeItem(key)
    setSession(null)
    setNotice('')
    setError('')
    return true
  }

  async function run(job: () => Promise<void>) {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      await job()
    } catch (error) {
      setError(errorText(error))
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function cancel(active: Session) {
    if (cancellation.current) return
    cancellation.current = true
    write('qa-cancel-pending', true)
    setStage('cancelling')
    setError('')
    try {
      const data = await request('cancel', { ...active, focus_events: focus.current })
      if (!settle(data)) throw new Error('No pudimos confirmar la cancelación. Intenta de nuevo.')
    } catch (error) {
      setError(errorText(error))
    } finally {
      cancellation.current = false
    }
  }

  function resume(active: Session) {
    return run(async () => {
      const data = await request('resume', active).catch((error: unknown) => {
        setMissingSession(error instanceof IntakeHttpError && error.status === 404)
        throw error
      })
      if (settle(data)) return
      if (!data.questions?.length) throw new Error('No pudimos cargar el cuestionario. Intenta de nuevo.')
      focus.current = Math.max(focus.current, data.focus_events)
      if (focus.current >= 2 || read('qa-cancel-pending', false)) {
        await cancel(active)
        return
      }
      if (focus.current === 1) setNotice('Detectamos un cambio de pestaña o ventana. Si vuelve a ocurrir, la solicitud se cancelará.')
      const restored = read('qa-answers', data.answers ?? {})
      setAnswers(restored)
      setCatalog(data.questions)
      const position = read<number | 'practice'>('qa-position', 0)
      setIndex(position === 'practice' ? 0 : Math.min(position, visibleQuestions(data.questions, restored).length - 1))
      setStage(position === 'practice' ? 'practice' : 'questions')
    })
  }
  const restoreOnMount = useEffectEvent(() => {
    if (session) void resume(session)
  })
  useEffect(() => { restoreOnMount() }, [])

  function restart() {
    for (const key of draftKeys) sessionStorage.removeItem(key)
    setSession(null)
    setAnswers({})
    setReports([emptyReport])
    focus.current = 0
    setMissingSession(false)
    setError('')
    setStage('identity')
  }

  function changeAnswer(id: string, value: string | string[]) {
    const next = { ...answers, [id]: value }
    setAnswers(next)
    write('qa-answers', next)
  }

  function changeReports(next: Report[]) {
    setReports(next)
    write('qa-findings', next)
  }

  function moveTo(position: number | 'practice') {
    write('qa-position', position)
    setTimeLeft(30)
    if (position === 'practice') setStage('practice')
    else setIndex(position)
  }

  function begin(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      if (!supabase && !demo) throw new Error(configurationError)
      const normalizedEmail = email.trim().toLowerCase()
      const pending = read<PendingStart | null>('qa-start', null)
      const token = pending?.email === normalizedEmail ? pending.token : randomToken()
      write('qa-start', { email: normalizedEmail, token })
      sessionStorage.setItem('qa-name', name.trim())
      sessionStorage.setItem('qa-email', normalizedEmail)
      const data = await request('start', { name: name.trim(), email: normalizedEmail, token })
      if (!data.id || !data.questions?.length) throw new Error('No pudimos iniciar la evaluación. Intenta de nuevo.')
      if (settle(data)) return
      const active = { id: data.id, token }
      write(sessionKey, active)
      setSession(active)
      sessionStorage.removeItem('qa-start')
      setCatalog(data.questions)
      setAnswers(data.answers ?? {})
      focus.current = data.focus_events
      write('qa-focus', data.focus_events)
      setIndex(0)
      setStage('questions')
    })
  }

  function advance(allowSkip: boolean) {
    if (!session || !question || focus.current >= 2) return
    const value = answers[question.id]
    if (!allowSkip && (question.multi ? !Array.isArray(value) || !value.length : typeof value !== 'string')) {
      setError('Selecciona una respuesta para continuar.')
      return
    }
    void run(async () => {
      const data = await request('save', { ...session, answers, focus_events: focus.current })
      if (settle(data) || focus.current >= 2) return
      moveTo(index + 1 < allQuestions.length ? index + 1 : 'practice')
    })
  }
  const timeExpired = useEffectEvent(() => { advance(true) })
  useEffect(() => {
    if (stage !== 'questions') return
    const initial = Date.now()
    let timer: number | undefined
    timer = window.setInterval(() => {
      const remaining = Math.max(30 - Math.floor((Date.now() - initial) / 1000), 0)
      setTimeLeft(remaining)
      if (!remaining) {
        window.clearInterval(timer)
        timeExpired()
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [stage, index])

  const handleFocusLoss = useEffectEvent(() => {
    if (!session || focus.current >= 2) return
    const count = ++focus.current
    write('qa-focus', count)
    if (count >= 2) {
      void cancel(session)
    } else {
      setNotice('Detectamos un cambio de pestaña o ventana. Si vuelve a ocurrir, la solicitud se cancelará.')
      void request('focus', { ...session, focus_events: count }).then((data) => settle(data)).catch(() => {})
    }
  })
  useEffect(() => {
    if (stage !== 'questions' && stage !== 'practice') return
    let lost = false
    function changed() {
      if (document.visibilityState === 'visible' && document.hasFocus()) lost = false
      else if (!lost) {
        lost = true
        handleFocusLoss()
      }
    }
    function beforeLeave(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', changed)
    window.addEventListener('blur', changed)
    window.addEventListener('focus', changed)
    window.addEventListener('beforeunload', beforeLeave)
    return () => {
      document.removeEventListener('visibilitychange', changed)
      window.removeEventListener('blur', changed)
      window.removeEventListener('focus', changed)
      window.removeEventListener('beforeunload', beforeLeave)
    }
  }, [stage])

  function complete(event: FormEvent) {
    event.preventDefault()
    if (!session || focus.current >= 2) return
    if (reports.some((item) => item.description.trim().length < 20 || !severities.includes(item.severity))) {
      setError('Describe cada hallazgo con al menos 20 caracteres y selecciona su severidad.')
      return
    }
    void run(async () => {
      const data = await request('complete', {
        ...session, answers: { ...answers, test: { findings: reports } }, focus_events: focus.current,
      })
      if (!settle(data)) throw new Error('No pudimos confirmar que se guardó tu evaluación. Intenta de nuevo.')
    })
  }

  const progress=stage==='practice'||stage==='done'?100:stage==='questions'?Math.round(((index+1)/(allQuestions.length+1))*72):stage==='identity'?8:0
  return <main className="shell"><header className="topbar"><a className="brand" href="https://liconainsurance.com" target="_blank" rel="noreferrer" aria-label="Licona Insurance Group"><img className="brand-logo" src="/licona-logo.webp" alt="Licona Insurance Group" /></a><span className="top-note">Programa de testers</span></header><div className="content">
    {(stage==='identity'||stage==='questions'||stage==='practice')&&<div className="progress-wrap"><div className="progress-caption"><span>Tu evaluación</span><span>{progress}%</span></div><div className="progress-track"><div className="progress-fill" style={{width:`${progress}%`}}/></div></div>}
    {(stage==='restoring'||stage==='cancelling')&&<section className="question-card"><h2>{stage==='restoring'?'Recuperando evaluación':'Guardando cancelación'}</h2>{error?<><p className="error" role="alert">{error}</p><button className="primary" disabled={busy} onClick={()=>{if(session) void (stage==='restoring'?resume(session):cancel(session))}}>Reintentar</button>{missingSession&&<button className="text-button" onClick={restart}>Volver al inicio</button>}</>:<p className="subcopy" role="status">Conectando con el servicio…</p>}</section>}
    {notice&&<div className="notice" role="alert">{notice}</div>}
    {stage==='intro'&&<section className="intro-card"><div className="eyebrow"><span className="eyebrow-dot"/> NUEVA APLICACIÓN</div><h1>Tu ojo encuentra<br/>lo que otros pasan por alto.</h1><p className="intro-copy">Cuéntanos cómo pruebas. Responde algunas preguntas y resuelve un reto práctico para que podamos recomendarte pruebas que encajan contigo.</p><div className="intro-meta"><span>◷ &nbsp;8–12 min</span><span>⌁ &nbsp;Preguntas + reto QA</span></div>{!supabase&&!demo&&<p className="error" role="alert">{configurationError}</p>}<button className="primary" disabled={!supabase&&!demo} onClick={()=>setStage('identity')}>Comenzar evaluación <span>→</span></button><p className="privacy-note">Tus respuestas se usarán para evaluar tu perfil de testing.</p></section>}
    {stage==='identity'&&<section className="question-card"><div className="eyebrow">ANTES DE COMENZAR</div><h2>¿Cómo te llamamos?</h2><p className="subcopy">Usaremos estos datos para asociar tu evaluación a tu perfil.</p><form className="identity-form" onSubmit={begin}><label>Nombre completo<input required maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre"/></label><label>Correo electrónico<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com"/></label>{error&&<p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?'Iniciando…':'Continuar'} <span>→</span></button></form></section>}

    {stage==='questions'&&question&&<section className="question-card" key={question.id}>
      <div className="question-topline"><div className="question-kicker">PREGUNTA {index+1} <span>·</span> PERFIL QA</div>
        <div className={`question-timer ${timeLeft<=10?'urgent':''}`} role="timer" aria-label={`Tiempo restante: ${timeLeft} segundos`}>00:{String(timeLeft).padStart(2,'0')}</div></div>
      <h2>{question.title}</h2><p className="subcopy">{question.hint}</p>
      <div className="answer-list">{question.options.map(({ id, label }) => {
        const value = answers[question.id]
        const selectedValues = Array.isArray(value) ? value : []
        const selected = question.multi ? selectedValues.includes(id) : value === id
        return <button key={id} type="button" className={`answer ${selected?'selected':''}`} aria-pressed={selected} disabled={busy}
          onClick={()=>changeAnswer(question.id, question.multi?(selected?selectedValues.filter((item)=>item!==id):[...selectedValues,id]):id)}>
          <span className={question.multi?'check':'radio'}>{question.multi&&selected?'✓':''}</span>{label}
        </button>
      })}</div>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="card-actions">
        <button className="text-button" disabled={!index||busy} onClick={()=>{setError('');moveTo(index-1)}}>← Anterior</button>
        <button className="primary compact" disabled={busy} onClick={()=>advance(timeLeft===0)}>{busy?'Guardando…':'Siguiente pregunta'} <span>→</span></button>
      </div>
    </section>}
    {stage==='practice'&&<section className="practice-card"><div className="practice-heading"><div><div className="question-kicker">RETO PRÁCTICO <span>·</span> TIENDA DEMO</div><h2>Prueba este resumen de compra</h2><p className="subcopy">Explora la pantalla como en una prueba real. Luego reporta cada problema con pasos, resultado actual y esperado.</p></div><span className="demo-badge">ENTORNO DE PRUEBA</span></div><DemoStore quantity={quantity} setQuantity={setQuantity} coupon={coupon} setCoupon={setCoupon} applied={couponApplied} setApplied={setCouponApplied}/><form className="report-form" onSubmit={complete}><div className="report-title"><div><h3>Registra tus hallazgos</h3><p className="muted">Describe cada problema que hayas encontrado.</p></div><button type="button" className="outline-button" disabled={busy||reports.length>=maxFindings} onClick={()=>changeReports([...reports,emptyReport])}>+ Agregar hallazgo</button></div>{reports.map((report,i)=><div className="finding" key={i}><div className="finding-head"><strong>Hallazgo {i+1}</strong>{reports.length>1&&<button type="button" className="text-button" disabled={busy} onClick={()=>changeReports(reports.filter((_,j)=>j!==i))}>Quitar</button>}</div><label className="field-label">Descripción<textarea required disabled={busy} minLength={20} maxLength={1500} value={report.description} onChange={e=>changeReports(reports.map((r,j)=>j===i?{...r,description:e.target.value}:r))} placeholder="Pasos para reproducir, resultado actual y esperado…"/></label><label className="field-label">Severidad<select required disabled={busy} value={report.severity} onChange={e=>changeReports(reports.map((r,j)=>j===i?{...r,severity:e.target.value}:r))}><option value="">Elige una severidad</option>{severities.map(severity=><option key={severity}>{severity}</option>)}</select></label></div>)}{error&&<p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?'Guardando evaluación…':'Enviar evaluación'} <span>→</span></button></form></section>}
    {stage==='done'&&<section className="question-card result-card"><div className="result-check">✓</div><div className="eyebrow">EVALUACIÓN COMPLETADA</div><h2>Gracias, {name.split(' ')[0]||'tester'}.</h2><p className="subcopy">Tu perfil está listo. Revisaremos tus respuestas y te contactaremos con pruebas acordes a tus habilidades.</p>{result&&<div className="score-panel"><div><span className="score-label">PUNTAJE</span><strong>{result.score}<small>/100</small></strong></div><div className="tag-list">{result.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div></div>}<p className="privacy-note">{demo?'Evaluación de demostración guardada en este navegador.':'Tu solicitud fue guardada. Puedes cerrar esta página.'}</p></section>}
    {stage==='cancelled'&&<section className="question-card result-card"><div className="cancel-icon">!</div><div className="eyebrow">SOLICITUD CANCELADA</div><h2>La evaluación se detuvo.</h2><p className="subcopy">{demo?'La evaluación de demostración se canceló.':'Detectamos cambios repetidos de pestaña o ventana. La solicitud quedó guardada como cancelada.'}</p></section>}
  </div><footer className="footer"><span>© 2026 <a href="https://liconainsurance.com" target="_blank" rel="noreferrer">Licona Insurance Group</a></span>{(stage==='intro'||stage==='done'||stage==='cancelled')&&<a href="#admin">Acceso de administración</a>}</footer></main>
}

function DemoStore({quantity,setQuantity,coupon,setCoupon,applied,setApplied}:{quantity:number;setQuantity:(n:number|((v:number)=>number))=>void;coupon:string;setCoupon:(v:string)=>void;applied:boolean;setApplied:(v:boolean)=>void}) {
  return <div className="demo-store"><div className="store-top"><div className="store-logo"><span>◈</span> TICKET<span className="brand-muted">LAB</span></div><span className="store-step">TU PEDIDO &nbsp;—&nbsp; PAGO &nbsp;—&nbsp; CONFIRMACIÓN</span></div><div className="store-body"><div className="ticket-art"><span>LIVE<br/>2026</span><i>♫</i></div><div className="ticket-info"><span className="ticket-label">CONCIERTO · GENERAL</span><h3>Noche Eléctrica</h3><p>Foro Central · 18 de diciembre, 20:00 h</p><div className="qty-row"><span>Cantidad de boletos</span><div className="stepper"><button type="button" aria-label="Disminuir cantidad" onClick={()=>setQuantity(q=>q-1)}>−</button><span>{quantity}</span><button type="button" aria-label="Aumentar cantidad" onClick={()=>setQuantity(q=>q+1)}>+</button></div></div></div><div className="checkout"><div className="coupon-row"><label htmlFor="coupon">Código promocional</label><div><input id="coupon" value={coupon} onChange={e=>setCoupon(e.target.value)} placeholder="Ingresa tu código"/><button type="button" onClick={()=>setApplied(Boolean(coupon.trim()))}>Aplicar</button></div>{applied&&<small className="coupon-success">Código aplicado · 10% de descuento</small>}</div><div className="total-row"><span>Subtotal ({quantity} boletos)</span><span>${(24*quantity).toFixed(2)} USD</span></div>{applied&&<div className="total-row discount"><span>Descuento</span><span>− $0.00 USD</span></div>}<div className="total-row grand-total"><strong>Total</strong><strong>${(24*quantity).toFixed(2)} USD</strong></div><button type="button" className="pay-button">Continuar al pago <span>→</span></button><p className="secure-note">⌑ &nbsp;Pago seguro · Tus datos están protegidos</p></div></div></div>
}


export default App
