import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configurationError, supabase } from './connection'
import QuestionEditor from './QuestionEditor'
import { fixedQuestions } from '../supabase/functions/_shared/questions'
import type { Answers, ApplicationStatus, Questionnaire } from '../supabase/functions/_shared/questions'

type Application = {
  id: string
  name: string
  email: string
  status: ApplicationStatus
  answers: Answers
  score: number | null
  profile_tags: string[]
  focus_events: number
  created_at: string
  questionnaire: Questionnaire | null
}

const statuses = { in_progress: 'En curso', cancelled: 'Cancelada', completed: 'Completada' }
const pageSize = 25

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  const [checked, setChecked] = useState<{ token: string; admin: boolean; error?: string } | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [resendAfter, setResendAfter] = useState(0)
  const [clock, setClock] = useState(Date.now)
  const [tab, setTab] = useState<'applications' | 'questions'>('applications')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const token = session?.access_token
  const authorized = Boolean(token && checked?.token === token && checked.admin)
  const accessError = token && checked?.token === token ? checked.error : ''
  const seconds = Math.max(0, Math.ceil((resendAfter - clock) / 1000))

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !token) return
    let active = true
    void supabase.auth.getUser(token).then(({ data, error }) => {
      if (!active) return
      setChecked({
        token,
        admin: data.user?.app_metadata.role === 'admin',
        error: error ? 'No pudimos validar tu sesión. Vuelve a iniciar sesión.'
          : data.user?.app_metadata.role !== 'admin' ? 'Esta cuenta no tiene acceso al panel.' : undefined,
      })
    }).catch(() => {
      if (active) setChecked({ token, admin: false, error: 'No pudimos validar tu sesión. Vuelve a iniciar sesión.' })
    })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!seconds) return
    const timer = window.setTimeout(() => setClock(Date.now()), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds, clock])

  async function sendOtp(address: string) {
    if (!supabase || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } })
      if (!error || error.status === 429) {
        const now = Date.now()
        setClock(now)
        setResendAfter(now + 60_000)
      }
      if (error) {
        setError(error.status === 429 ? 'Se alcanzó el límite de envíos. Espera antes de solicitar otro código.'
          : 'No pudimos enviar un código a ese correo. Verifica la dirección o vuelve a intentarlo.')
        return
      }
      setCode('')
      setSentTo(address)
      setNotice('Código enviado. Revisa tu bandeja de entrada y correo no deseado.')
    } catch {
      setError('No pudimos conectar con el servicio. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    if (!sentTo) {
      if (!seconds) await sendOtp(email.trim().toLowerCase())
      return
    }
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ email: sentTo, token: code, type: 'email' })
      if (error) setError(error.status === 429 ? 'Demasiados intentos. Espera antes de verificar el código.'
        : 'El código es inválido o venció. Revisa el código o solicita uno nuevo.')
    } catch {
      setError('No pudimos conectar con el servicio. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setError('')
    try {
      const { error } = await supabase!.auth.signOut({ scope: 'local' })
      if (error) throw error
      setChecked(null)
      setSentTo('')
      setCode('')
      setNotice('')
      setTab('applications')
    } catch {
      setError('No pudimos cerrar la sesión. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="admin-shell">
    <header className="topbar">
      <a className="brand" href="https://liconainsurance.com" target="_blank" rel="noreferrer" aria-label="Licona Insurance Group">
        <img className="brand-logo" src="/licona-logo.webp" alt="Licona Insurance Group"/>
      </a>
      <a className="text-button admin-back" href="#">← Volver al onboarding</a>
    </header>
    {!ready || (token && checked?.token !== token) ? <section className="admin-login" role="status">Validando sesión…</section>
      : authorized ? <section className="admin-content">
        <div className="admin-heading"><h1>Administración</h1><button className="outline-button" disabled={busy} onClick={()=>void logout()}>Cerrar sesión</button></div>
        {error&&<p className="error" role="alert">{error}</p>}
        <nav className="admin-tabs" aria-label="Administración">
          <button type="button" aria-current={tab==='applications'?'page':undefined} onClick={()=>setTab('applications')}>Solicitudes</button>
          <button type="button" aria-current={tab==='questions'?'page':undefined} onClick={()=>setTab('questions')}>Preguntas</button>
        </nav>
        {tab==='applications'?<Applications/>:<QuestionEditor/>}
      </section> : <section className="admin-login">
        <h1>Administración</h1>
        {session ? <>
          <p className="error" role="alert">{accessError}</p>
          {error&&<p className="error" role="alert">{error}</p>}
          <button className="outline-button" disabled={busy} onClick={()=>void logout()}>Usar otro correo</button>
        </> : <>
          <p className="subcopy">{sentTo?'Ingresa el código de un solo uso que enviamos a tu correo.':'Te enviaremos un código de acceso de un solo uso a tu correo.'}</p>
          <form onSubmit={(event)=>void login(event)} className="identity-form">
            <label>Correo de administración<input required type="email" autoComplete="email" value={email}
              onChange={(event)=>setEmail(event.target.value)} readOnly={Boolean(sentTo)} disabled={!supabase||busy}/></label>
            {sentTo&&<label>Código de acceso<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g, '').slice(0,6))} disabled={busy}/></label>}
            {!supabase&&<p className="error" role="alert">{configurationError}</p>}
            {error&&<p className="error" role="alert">{error}</p>}
            {notice&&<p className="subcopy" role="status">{notice}</p>}
            <button className="primary" disabled={!supabase||busy||(!sentTo&&seconds>0)||(Boolean(sentTo)&&code.length!==6)}>
              {busy?'Conectando…':sentTo?'Verificar código':seconds?`Enviar código en ${seconds} s`:'Enviar código'} <span>→</span>
            </button>
            {sentTo&&<div className="admin-actions">
              <button type="button" className="text-button" disabled={busy||seconds>0} onClick={()=>void sendOtp(sentTo)}>{seconds?`Reenviar en ${seconds} s`:'Reenviar código'}</button>
              <button type="button" className="text-button" disabled={busy} onClick={()=>{setSentTo('');setCode('');setError('');setNotice('')}}>Usar otro correo</button>
            </div>}
          </form>
        </>}
      </section>}
    <footer className="footer"><span>© 2026 <a href="https://liconainsurance.com" target="_blank" rel="noreferrer">Licona Insurance Group</a></span></footer>
  </main>
}

function Applications() {
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [response, setResponse] = useState<{ page: number; retry: number; rows?: Application[]; total?: number; error?: string } | null>(null)

  useEffect(() => {
    if (!supabase) return
    const controller = new AbortController()
    void supabase.from('tester_applications')
      .select('id,name,email,status,answers,score,profile_tags,focus_events,created_at,questionnaire', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(page*pageSize, (page+1)*pageSize-1).abortSignal(controller.signal)
      .then(({ data, error, count }) => {
        if (controller.signal.aborted) return
        setResponse(error
          ? { page, retry, error: 'No pudimos cargar las solicitudes.' }
          : { page, retry, rows: data as Application[], total: count ?? 0 })
      })
    return () => controller.abort()
  }, [page, retry])

  const current = response?.page===page && response.retry===retry ? response : null
  const rows = current?.rows ?? []
  return <section aria-label="Solicitudes de testers">
    <h2>Solicitudes de testers</h2>
    {!current ? <p role="status">Cargando solicitudes…</p> : current.error ? <>
      <p className="error" role="alert">{current.error}</p>
      <button className="outline-button" onClick={()=>setRetry((value)=>value+1)}>Reintentar</button>
    </> : rows.length === 0 ? <div className="empty-state">Todavía no hay solicitudes guardadas.</div>
      : <div className="table-wrap"><table>
        <thead><tr><th>Tester</th><th>Estado</th><th>Puntaje</th><th>Perfil</th><th>Foco</th><th>Fecha</th><th>Detalle</th></tr></thead>
        <tbody>{rows.map((item)=><ApplicationRows key={item.id} item={item} open={expanded===item.id}
          toggle={()=>setExpanded(expanded===item.id?null:item.id)}/>)}</tbody>
      </table></div>}
    {current?.total!==undefined&&current.total>pageSize&&<div className="admin-actions pagination">
      <button className="outline-button" disabled={page===0} onClick={()=>setPage(page-1)}>Anterior</button>
      <span>Página {page+1} de {Math.ceil(current.total/pageSize)}</span>
      <button className="outline-button" disabled={(page+1)*pageSize>=current.total} onClick={()=>setPage(page+1)}>Siguiente</button>
    </div>}
  </section>
}

function ApplicationRows({ item, open, toggle }: { item: Application; open: boolean; toggle: () => void }) {
  const questions = [...(item.questionnaire?.questions ?? []), ...fixedQuestions]
  const findings = item.answers.test
  const answers = Object.entries(item.answers).filter(([id])=>id!=='test')
  return <>
    <tr><td><strong>{item.name}</strong><small>{item.email}</small></td>
      <td><span className={`status ${item.status}`}>{statuses[item.status]}</span></td>
      <td>{item.score===null?'—':`${item.score}/100`}</td>
      <td><div className="tag-list">{item.profile_tags.length?item.profile_tags.map((tag)=><span className="tag" key={tag}>{tag}</span>):'—'}</div></td>
      <td>{item.focus_events}</td><td>{new Date(item.created_at).toLocaleDateString('es-MX')}</td>
      <td><button className="outline-button" aria-expanded={open} aria-controls={`application-${item.id}`} onClick={toggle}>{open?'Ocultar':'Ver'} respuestas</button></td>
    </tr>
    {open&&<tr id={`application-${item.id}`}><td colSpan={7}>
      {answers.length ? <dl className="application-answers">{answers.map(([id,value])=>{
        const question = questions.find((item)=>item.id===id)
        const label = (choice: string) => question?.options.find((option)=>option.id===choice)?.label ?? choice
        return <div key={id}><dt>{question?.title??id}</dt><dd>{(Array.isArray(value)?value:typeof value==='string'?[value]:[]).map(label).join(', ') || 'Sin respuesta'}</dd></div>
      })}</dl> : <p>Sin respuestas guardadas.</p>}
      {findings&&typeof findings==='object'&&!Array.isArray(findings)&&findings.findings.length>0&&<>
        <h3>Hallazgos del reto</h3>
        <ul className="application-findings">{findings.findings.map(({severity,description},index)=><li key={index}><strong>{severity}</strong> {description}</li>)}</ul>
      </>}
    </td></tr>}
  </>
}
