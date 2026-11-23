import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import './App.css'

type Report = { description: string; severity: string }
type Answers = Record<string, string | string[] | { findings: Report[] }>
type Application = { id: string; name: string; email: string; status: string; answers: Answers; score: number | null; profile_tags: string[]; focus_events: number; created_at: string }
type Session = { id: string; token: string }
const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null
const localKey = 'qa-tester-apps'
const sessionKey = 'qa-tester-session'
const questions = [
  { id: 'regression', title: '¿Qué busca una prueba de regresión?', hint: 'Elige la opción más precisa.', options: ['Medir la velocidad de la red', 'Confirmar que cambios recientes no rompieron funciones existentes', 'Revisar únicamente el diseño visual'], correct: 1 },
  { id: 'severity', title: 'Encuentras que nadie puede completar el pago. ¿Cómo lo clasificarías?', hint: 'Piensa en el impacto para quien usa el producto.', options: ['Bajo: detalle visual', 'Medio: hay una alternativa sencilla', 'Crítico: bloquea una función principal'], correct: 2 },
  { id: 'smoke', title: '¿Para qué sirve una prueba smoke?', hint: 'Selecciona su objetivo principal.', options: ['Comprobar rápidamente que lo esencial funciona', 'Probar todos los casos límite', 'Reemplazar las pruebas de regresión'], correct: 0 },
  { id: 'api', title: 'Al probar una API, ¿qué revisarías además del código de respuesta?', hint: 'Una respuesta 200 no garantiza que todo esté bien.', options: ['Solo el tiempo del teclado', 'El contenido, formato y datos de la respuesta', 'El color del botón'], correct: 1 },
  { id: 'experience', title: '¿Cuánta experiencia tienes probando software?', hint: 'Cuenta experiencia laboral, académica o personal.', options: ['Estoy comenzando', 'Menos de 1 año', '1 a 3 años', 'Más de 3 años'] },
]
const skillNames = ['Pruebas manuales', 'Automatización', 'Pruebas de API', 'Aplicaciones móviles', 'Accesibilidad']
const skillQuestion = { id: 'skills', title: '¿Qué áreas has probado o te gustaría probar?', hint: 'Puedes elegir varias. Las respuestas ayudan a sugerirte pruebas adecuadas.', options: skillNames }

function localApps(): Application[] { try { return JSON.parse(localStorage.getItem(localKey) ?? '[]') as Application[] } catch { return [] } }
function saveLocal(items: Application[]) { localStorage.setItem(localKey, JSON.stringify(items)) }
function updateLocal(id: string, patch: Partial<Application>) { saveLocal(localApps().map((item) => item.id === id ? { ...item, ...patch } : item)) }
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2, '0')).join('') }
async function intake(action: string, body: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data, error } = await supabase.functions.invoke('onboarding-intake', { body: { action, ...body } })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data as { id?: string; score?: number; profile_tags?: string[] }
}
function App() {
  const [admin, setAdmin] = useState(location.hash === '#admin')
  useEffect(() => {
    const onHash = () => {
      if (location.hash === '#admin' && sessionStorage.getItem(sessionKey)) { history.replaceState(null, '', location.pathname + location.search); setAdmin(false); return }
      setAdmin(location.hash === '#admin')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return admin ? <Admin /> : <Onboarding />
}

function Onboarding() {
  const [stage, setStage] = useState<'intro'|'identity'|'questions'|'practice'|'done'|'cancelled'>(() => sessionStorage.getItem(sessionKey) ? 'questions' : 'intro')
  const [name, setName] = useState(sessionStorage.getItem('qa-name') ?? '')
  const [email, setEmail] = useState(sessionStorage.getItem('qa-email') ?? '')
  const [session, setSession] = useState<Session|null>(() => { try { return JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null') as Session|null } catch { return null } })
  const [answers, setAnswers] = useState<Answers>(() => { try { return JSON.parse(sessionStorage.getItem('qa-answers') ?? '{}') as Answers } catch { return {} } })
  const [index, setIndex] = useState(0)
  const [timeLeft, setTimeLeft] = useState(30)
  const [focusCount, setFocusCount] = useState(Number(sessionStorage.getItem('qa-focus') ?? 0))
  const focusRef = useRef(Number(sessionStorage.getItem('qa-focus') ?? 0))
  const lastFocus = useRef(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [quantity, setQuantity] = useState(2)
  const [coupon, setCoupon] = useState('')
  const [couponApplied, setCouponApplied] = useState(false)
  const [reports, setReports] = useState<Report[]>([{ description: '', severity: '' }])
  const [result, setResult] = useState<{ score: number; tags: string[] }|null>(null)
  const skillAnswers = (answers.skills as string[]|undefined) ?? []
  const branchQuestions = useMemo(() => {
    const result: { id:string; title:string; hint:string; options:string[]; multi?:boolean }[] = []
    if (skillAnswers.includes('Automatización')) result.push({ id:'frameworks', title:'¿Con qué herramientas de automatización has trabajado?', hint:'Selecciona todas las que apliquen.', options:['Playwright','Cypress','Selenium','Appium','Otro'], multi:true })
    if (skillAnswers.includes('Pruebas de API')) result.push({ id:'apiTools', title:'¿Qué herramientas has usado para probar APIs?', hint:'Selecciona todas las que apliquen.', options:['Postman','Insomnia','curl','Otro'], multi:true })
    if (skillAnswers.includes('Aplicaciones móviles')) result.push({ id:'mobileExperience', title:'¿Qué tipo de pruebas móviles has realizado?', hint:'Selecciona todas las que apliquen.', options:['Instalación y actualización','Interfaz en distintos tamaños','Permisos y notificaciones','Aún no tengo experiencia'], multi:true })
    return result
  }, [answers.skills])
  const allQuestions = [...questions.map((q) => ({ ...q, multi:false })), { ...skillQuestion, multi:true }, ...branchQuestions]
  useEffect(() => { setIndex((current) => Math.min(current, allQuestions.length - 1)) }, [allQuestions.length])
  useEffect(() => { setTimeLeft(30) }, [index, stage])
  useEffect(() => {
    if (stage !== 'questions') return
    const timer = window.setInterval(() => setTimeLeft((remaining) => Math.max(remaining - 1, 0)), 1000)
    return () => window.clearInterval(timer)
  }, [stage, index])
  useEffect(() => { if (session) { setStage((current) => current === 'intro' || current === 'identity' ? 'questions' : current) } }, [session])
  async function cancel(count: number) {
    if (!session) return
    try { if (supabase) await intake('cancel', { id:session.id, token:session.token, focus_events:count }); else updateLocal(session.id,{status:'cancelled',focus_events:count}) } catch { /* Keep the visible cancellation. */ }
    sessionStorage.removeItem(sessionKey)
  }
  useEffect(() => {
    if (!session || ['intro','identity','done','cancelled'].includes(stage)) return
    const focusLost = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) return
      const now = Date.now(); if (now - lastFocus.current < 1500) return; lastFocus.current = now
      const count = ++focusRef.current; setFocusCount(count); sessionStorage.setItem('qa-focus', String(count))
      if (count === 1) {
        setNotice('Detectamos un cambio de pestaña o ventana. Si vuelve a ocurrir, la solicitud se cancelará.')
        if (supabase) void intake('focus', { id:session.id, token:session.token, focus_events:count })
        else updateLocal(session.id,{focus_events:count})
      } else { setNotice('La solicitud se canceló por cambios repetidos de pestaña o ventana.'); setStage('cancelled'); void cancel(count) }
    }
    const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    document.addEventListener('visibilitychange', focusLost); window.addEventListener('blur', focusLost); window.addEventListener('beforeunload', beforeLeave)
    return () => { document.removeEventListener('visibilitychange', focusLost); window.removeEventListener('blur', focusLost); window.removeEventListener('beforeunload', beforeLeave) }
  }, [session, stage])
  function changeAnswer(id:string, value:string|string[]) {
    const next = { ...answers, [id]:value }; setAnswers(next); sessionStorage.setItem('qa-answers', JSON.stringify(next))
  }
  async function begin(event:FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    const token = randomToken()
    try {
      let id:string
      if (supabase) id = (await intake('start',{name:name.trim(),email:email.trim().toLowerCase(),token})).id!
      else { id=crypto.randomUUID(); saveLocal([...localApps(),{id,name:name.trim(),email:email.trim().toLowerCase(),status:'in_progress',answers:{},score:null,profile_tags:[],focus_events:0,created_at:new Date().toISOString()}]) }
      const next={id,token}; setSession(next); setAnswers({}); setFocusCount(0); focusRef.current=0; sessionStorage.setItem(sessionKey,JSON.stringify(next)); sessionStorage.setItem('qa-name',name.trim());sessionStorage.setItem('qa-email',email.trim());sessionStorage.setItem('qa-answers','{}');sessionStorage.setItem('qa-focus','0');setIndex(0);setStage('questions')
    } catch(e) { setError(e instanceof Error ? e.message : 'No pudimos iniciar la solicitud.') } finally { setBusy(false) }
  }
  async function next() {
    const current=allQuestions[index]; const value=answers[current.id]
    if (current.multi ? !Array.isArray(value)||value.length===0 : !value) { setError('Selecciona una respuesta para continuar.'); return }
    setError(''); setBusy(true)
    try {
      if (session) { if(supabase) await intake('save',{id:session.id,token:session.token,answers,focus_events:focusCount}); else updateLocal(session.id,{answers,focus_events:focusCount}) }
      if(index<allQuestions.length-1)setIndex(index+1);else setStage('practice')
    } catch(e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar tus respuestas.') } finally { setBusy(false) }
  }
  async function skipTimedOutQuestion() {
    setError('')
    if (session) {
      try {
        if (supabase) await intake('save', { id:session.id, token:session.token, answers, focus_events:focusCount })
        else updateLocal(session.id, { answers, focus_events:focusCount })
      } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar tus respuestas.'); return }
    }
    if (index < allQuestions.length - 1) setIndex(index + 1)
    else setStage('practice')
  }
  useEffect(() => {
    if (stage === 'questions' && timeLeft === 0) void skipTimedOutQuestion()
  }, [timeLeft, stage])
  async function complete(event:FormEvent) {
    event.preventDefault(); setError('')
    if(reports.some((item)=>item.description.trim().length<20||!item.severity)){setError('Describe cada hallazgo con al menos 20 caracteres y selecciona su severidad.');return}
    setBusy(true); const finalAnswers:Answers={...answers,test:{findings:reports}}
    try {
      let score=0; let tags:string[]=[]
      if(supabase&&session){const data=await intake('complete',{id:session.id,token:session.token,answers:finalAnswers,focus_events:focusCount});score=data.score??0;tags=data.profile_tags??[]}
      else if(session){const keys=['regression','severity','smoke','api'];const correct=[1,2,0,1].reduce((sum,val,i)=>sum+(Number(answers[keys[i]])===val?1:0),0);score=Math.round(((correct+Math.min(reports.length,3))/(keys.length+3))*100);tags=[...skillAnswers.map((item)=>item.toLowerCase().replace('pruebas de ','').replace('pruebas ','').replaceAll(' ','-')),Number(answers.experience)===3?'experiencia-qa-3+':Number(answers.experience)>=2?'experiencia-qa-1-3':'experiencia-qa-inicial',score>=80?'nivel-avanzado':score>=50?'nivel-intermedio':'nivel-inicial'];updateLocal(session.id,{status:'completed',answers:finalAnswers,score,profile_tags:tags,focus_events:focusCount})}
      setResult({score,tags});setStage('done');sessionStorage.removeItem(sessionKey);sessionStorage.removeItem('qa-answers');sessionStorage.removeItem('qa-focus')
    } catch(e){setError(e instanceof Error?e.message:'No se pudo guardar tu evaluación.')} finally{setBusy(false)}
  }
  const progress=stage==='practice'||stage==='done'?100:stage==='questions'?Math.round(((index+1)/(allQuestions.length+1))*72):stage==='identity'?8:0
  return <main className="shell"><header className="topbar"><a className="brand" href="https://liconainsurance.com" target="_blank" rel="noreferrer" aria-label="Licona Insurance Group"><img className="brand-logo" src="/licona-logo.webp" alt="Licona Insurance Group" /></a><span className="top-note">Programa de testers</span></header><div className="content">
    {stage!=='intro'&&stage!=='done'&&stage!=='cancelled'&&<div className="progress-wrap"><div className="progress-caption"><span>Tu evaluación</span><span>{progress}%</span></div><div className="progress-track"><div className="progress-fill" style={{width:`${progress}%`}}/></div></div>}
    {notice&&<div className="notice" role="alert">{notice}</div>}
    {stage==='intro'&&<section className="intro-card"><div className="eyebrow"><span className="eyebrow-dot"/> NUEVA APLICACIÓN</div><h1>Tu ojo encuentra<br/>lo que otros pasan por alto.</h1><p className="intro-copy">Cuéntanos cómo pruebas. Responde algunas preguntas y resuelve un reto práctico para que podamos recomendarte pruebas que encajan contigo.</p><div className="intro-meta"><span>◷ &nbsp;8–12 min</span><span>⌁ &nbsp;Preguntas + reto QA</span></div><button className="primary" onClick={()=>setStage('identity')}>Comenzar evaluación <span>→</span></button><p className="privacy-note">Tus respuestas se usarán para evaluar tu perfil de testing.</p></section>}
    {stage==='identity'&&<section className="question-card"><div className="eyebrow">ANTES DE COMENZAR</div><h2>¿Cómo te llamamos?</h2><p className="subcopy">Usaremos estos datos para asociar tu evaluación a tu perfil.</p><form className="identity-form" onSubmit={begin}><label>Nombre completo<input required maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre"/></label><label>Correo electrónico<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com"/></label>{error&&<p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?'Iniciando…':'Continuar'} <span>→</span></button></form></section>}
    {stage==='questions'&&<section className="question-card" key={allQuestions[index]?.id}><div className="question-topline"><div className="question-kicker">PREGUNTA {index+1} <span>·</span> PERFIL QA</div><div className={`question-timer ${timeLeft<=10?'urgent':''}`} role="timer" aria-label={`Tiempo restante: ${timeLeft} segundos`}>00:{String(timeLeft).padStart(2,'0')}</div></div><h2>{allQuestions[index]?.title}</h2><p className="subcopy">{allQuestions[index]?.hint}</p><div className="answer-list">{allQuestions[index]?.options.map((option,i)=>{const q=allQuestions[index];const selected=q.multi?((answers[q.id] as string[]|undefined)??[]).includes(option):answers[q.id]===String(i);return <button key={option} className={`answer ${selected?'selected':''}`} aria-pressed={selected} onClick={()=>q.multi?changeAnswer(q.id,selected?((answers[q.id] as string[]).filter(v=>v!==option)): [...((answers[q.id] as string[]|undefined)??[]),option]):changeAnswer(q.id,String(i))}><span className={q.multi?'check':'radio'}>{q.multi&&selected?'✓':''}</span>{option}</button>})}</div>{error&&<p className="error">{error}</p>}<div className="card-actions"><button className="text-button" disabled={!index} onClick={()=>index&&setIndex(index-1)}>← Anterior</button><button className="primary compact" disabled={busy} onClick={()=>void next()}>{busy?'Guardando…':'Siguiente pregunta'} <span>→</span></button></div></section>}
    {stage==='practice'&&<section className="practice-card"><div className="practice-heading"><div><div className="question-kicker">RETO PRÁCTICO <span>·</span> TIENDA DEMO</div><h2>Prueba este resumen de compra</h2><p className="subcopy">Explora la pantalla como en una prueba real. Luego reporta cada problema con pasos, resultado actual y esperado.</p></div><span className="demo-badge">ENTORNO DE PRUEBA</span></div><DemoStore quantity={quantity} setQuantity={setQuantity} coupon={coupon} setCoupon={setCoupon} applied={couponApplied} setApplied={setCouponApplied}/><form className="report-form" onSubmit={complete}><div className="report-title"><div><h3>Registra tus hallazgos</h3><p className="muted">Describe cada problema que hayas encontrado.</p></div><button type="button" className="outline-button" onClick={()=>setReports([...reports,{description:'',severity:''}])}>+ Agregar hallazgo</button></div>{reports.map((report,i)=><div className="finding" key={i}><div className="finding-head"><strong>Hallazgo {i+1}</strong>{reports.length>1&&<button type="button" className="text-button" onClick={()=>setReports(reports.filter((_,j)=>j!==i))}>Quitar</button>}</div><label className="field-label">Descripción<textarea required minLength={20} maxLength={1500} value={report.description} onChange={e=>setReports(reports.map((r,j)=>j===i?{...r,description:e.target.value}:r))} placeholder="Pasos para reproducir, resultado actual y esperado…"/></label><label className="field-label">Severidad<select required value={report.severity} onChange={e=>setReports(reports.map((r,j)=>j===i?{...r,severity:e.target.value}:r))}><option value="">Elige una severidad</option><option>Crítica</option><option>Alta</option><option>Media</option><option>Baja</option></select></label></div>)}{error&&<p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?'Guardando evaluación…':'Enviar evaluación'} <span>→</span></button></form></section>}
    {stage==='done'&&<section className="question-card result-card"><div className="result-check">✓</div><div className="eyebrow">EVALUACIÓN COMPLETADA</div><h2>Gracias, {name.split(' ')[0]||'tester'}.</h2><p className="subcopy">Tu perfil está listo. Revisaremos tus respuestas y te contactaremos con pruebas acordes a tus habilidades.</p>{result&&<div className="score-panel"><div><span className="score-label">PUNTAJE</span><strong>{result.score}<small>/100</small></strong></div><div className="tag-list">{result.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div></div>}<p className="privacy-note">Tu solicitud fue guardada. Puedes cerrar esta página.</p></section>}
    {stage==='cancelled'&&<section className="question-card result-card"><div className="cancel-icon">!</div><div className="eyebrow">SOLICITUD CANCELADA</div><h2>La evaluación se detuvo.</h2><p className="subcopy">Detectamos cambios repetidos de pestaña o ventana. La solicitud quedó guardada como cancelada.</p></section>}
  </div><footer className="footer"><span>© 2026 <a href="https://liconainsurance.com" target="_blank" rel="noreferrer">Licona Insurance Group</a></span>{(stage==='intro'||stage==='done'||stage==='cancelled')&&<a href="#admin">Acceso de administración</a>}</footer></main>
}

function DemoStore({quantity,setQuantity,coupon,setCoupon,applied,setApplied}:{quantity:number;setQuantity:(n:number|((v:number)=>number))=>void;coupon:string;setCoupon:(v:string)=>void;applied:boolean;setApplied:(v:boolean)=>void}) {
  return <div className="demo-store"><div className="store-top"><div className="store-logo"><span>◈</span> TICKET<span className="brand-muted">LAB</span></div><span className="store-step">TU PEDIDO &nbsp;—&nbsp; PAGO &nbsp;—&nbsp; CONFIRMACIÓN</span></div><div className="store-body"><div className="ticket-art"><span>LIVE<br/>2026</span><i>♫</i></div><div className="ticket-info"><span className="ticket-label">CONCIERTO · GENERAL</span><h3>Noche Eléctrica</h3><p>Foro Central · 18 de diciembre, 20:00 h</p><div className="qty-row"><span>Cantidad de boletos</span><div className="stepper"><button type="button" aria-label="Disminuir cantidad" onClick={()=>setQuantity(q=>q-1)}>−</button><span>{quantity}</span><button type="button" aria-label="Aumentar cantidad" onClick={()=>setQuantity(q=>q+1)}>+</button></div></div></div><div className="checkout"><div className="coupon-row"><label htmlFor="coupon">Código promocional</label><div><input id="coupon" value={coupon} onChange={e=>setCoupon(e.target.value)} placeholder="Ingresa tu código"/><button type="button" onClick={()=>setApplied(Boolean(coupon.trim()))}>Aplicar</button></div>{applied&&<small className="coupon-success">Código aplicado · 10% de descuento</small>}</div><div className="total-row"><span>Subtotal ({quantity} boletos)</span><span>${(24*quantity).toFixed(2)} USD</span></div>{applied&&<div className="total-row discount"><span>Descuento</span><span>− $0.00 USD</span></div>}<div className="total-row grand-total"><strong>Total</strong><strong>${(24*quantity).toFixed(2)} USD</strong></div><button type="button" className="pay-button">Continuar al pago <span>→</span></button><p className="secure-note">⌑ &nbsp;Pago seguro · Tus datos están protegidos</p></div></div></div>
}

function Admin() {
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [user,setUser]=useState(false);const [items,setItems]=useState<Application[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(false)
  useEffect(()=>{if(!supabase)return;void supabase.auth.getSession().then(({data})=>setUser(Boolean(data.session)));const {data}=supabase.auth.onAuthStateChange((_event,session)=>setUser(Boolean(session)));return()=>data.subscription.unsubscribe()},[])
  useEffect(()=>{if(!user)return;if(!supabase){setItems(localApps().sort((a,b)=>b.created_at.localeCompare(a.created_at)));return}setLoading(true);void supabase.from('tester_applications').select('id,name,email,status,answers,score,profile_tags,focus_events,created_at').order('created_at',{ascending:false}).then(({data,error})=>{if(error)setError(error.message);else setItems((data??[]) as Application[]);setLoading(false)})},[user])
  async function login(event:FormEvent){event.preventDefault();setError('');if(!supabase){setError('Configura Supabase para habilitar el panel.');return}const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setError('No se pudo iniciar sesión. Revisa las credenciales de administración.')}
  async function logout(){if(supabase)await supabase.auth.signOut();setUser(false);setItems([])}
  return <main className="admin-shell"><header className="topbar"><a className="brand" href="https://liconainsurance.com" target="_blank" rel="noreferrer" aria-label="Licona Insurance Group"><img className="brand-logo" src="/licona-logo.webp" alt="Licona Insurance Group" /></a><a className="text-button" href="#" style={{color: '#fff'}}>← Volver al onboarding</a></header>{!user?<section className="admin-login"><div className="eyebrow">ZONA PRIVADA</div><h1>Administración</h1><p className="subcopy">Inicia sesión con la cuenta compartida configurada en Supabase Auth.</p><form onSubmit={login} className="identity-form"><label>Correo de administración<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Código de acceso<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label>{error&&<p className="error">{error}</p>}<button className="primary">Entrar <span>→</span></button></form>{!supabase&&<p className="config-hint">Modo vista previa: configura Supabase para activar el acceso.</p>}</section>:<section className="admin-content"><div className="admin-heading"><div><div className="eyebrow">PANEL DE RESULTADOS</div><h1>Solicitudes de testers</h1><p className="subcopy">Perfiles, resultados y estado de cada evaluación.</p></div><button className="outline-button" onClick={()=>void logout()}>Cerrar sesión</button></div>{error&&<p className="error">{error}</p>}{loading?<p className="muted">Cargando…</p>:items.length===0?<div className="empty-state">Todavía no hay solicitudes guardadas.</div>:<div className="table-wrap"><table><thead><tr><th>Tester</th><th>Estado</th><th>Puntaje</th><th>Perfil</th><th>Foco</th><th>Fecha</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><strong>{item.name}</strong><small>{item.email}</small></td><td><span className={`status ${item.status}`}>{item.status==='completed'?'Completada':item.status==='cancelled'?'Cancelada':'En curso'}</span></td><td>{item.score===null?'—':`${item.score}/100`}</td><td><div className="tag-list">{item.profile_tags?.length?item.profile_tags.map(tag=><span className="tag" key={tag}>{tag}</span>):'—'}</div></td><td>{item.focus_events}</td><td>{new Date(item.created_at).toLocaleDateString('es-MX')}</td></tr>)}</tbody></table></div>}</section>}<footer className="footer"><span>© 2026 <a href="https://liconainsurance.com" target="_blank" rel="noreferrer">Licona Insurance Group</a></span></footer></main>
}

export default App
