import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getQuestionnaire, publishQuestionnaire } from './connection'
import { fixedQuestions } from '../supabase/functions/_shared/questions'
import type { EditableQuestion, Option, Questionnaire } from '../supabase/functions/_shared/questions'

const createOption = (): Option => ({ id: crypto.randomUUID(), label: '' })
const createQuestion = (): EditableQuestion => ({
  id: crypto.randomUUID(), title: '', hint: '', multi: false, active: true, correct: null, options: [createOption(), createOption()],
})

export default function QuestionEditor() {
  const [catalog, setCatalog] = useState<Questionnaire | null>(null)
  const [reload, setReload] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void getQuestionnaire().then((data)=>{if(active) setCatalog(data)})
      .catch((error: Error)=>{if(active) setError(error.message)})
      .finally(()=>{if(active) setBusy(false)})
    return ()=>{active=false}
  }, [reload])

  function refresh() {
    setBusy(true)
    setError('')
    setNotice('')
    setChanged(false)
    setExpanded(null)
    setCatalog(null)
    setReload((value)=>value+1)
  }

  function update(questions: EditableQuestion[]) {
    if (!catalog) return
    setCatalog({ ...catalog, questions })
    setChanged(true)
    setNotice('')
  }

  function edit(id: string, patch: Partial<EditableQuestion>) {
    if (catalog) update(catalog.questions.map((question)=>question.id===id?{...question,...patch}:question))
  }

  function move(index: number, delta: number) {
    if (!catalog) return
    const questions = [...catalog.questions]
    const [question] = questions.splice(index, 1)
    questions.splice(index+delta,0,question)
    update(questions)
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!catalog||busy||!changed) return
    const invalid = catalog.questions.find((question)=>
      !question.title.trim() || question.options.some(({label})=>!label.trim()) ||
      new Set(question.options.map(({label})=>label.trim().toLocaleLowerCase('es'))).size!==question.options.length)
    if (invalid) {
      setExpanded(invalid.id)
      setError('Completa el enunciado y usa opciones distintas en cada pregunta.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const published = await publishQuestionnaire(catalog)
      setCatalog(published)
      setChanged(false)
      setNotice('Cambios publicados para las evaluaciones nuevas.')
    } catch (error) {
      setError(error instanceof Error?error.message:'No pudimos publicar el cuestionario.')
    } finally {
      setBusy(false)
    }
  }

  return <section aria-label="Preguntas">
    <div className="questions-heading">
      <div><h2>Preguntas</h2><p className="subcopy">Los cambios publicados se aplican a las evaluaciones nuevas.</p></div>
      {catalog&&<button type="button" className="outline-button" disabled={busy||catalog.questions.length>=30} onClick={()=>{
        const question = createQuestion()
        update([...catalog.questions, question])
        setExpanded(question.id)
      }}>+ Agregar pregunta</button>}
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="question-success" role="status">{notice}</p>}
    {busy&&!catalog&&<p role="status">Cargando preguntas…</p>}
    {!catalog&&!busy&&<button className="outline-button" onClick={refresh}>Reintentar</button>}
    {catalog&&<form onSubmit={(event)=>void publish(event)} className="question-editor" noValidate>
      {catalog.questions.map((question,index)=><article className="question-editor-row" key={question.id}>
        <div className="question-row-header">
          <button type="button" className="question-collapse" aria-expanded={expanded===question.id} aria-controls={`edit-${question.id}`}
            onClick={()=>setExpanded(expanded===question.id?null:question.id)}>
            {question.title||'Nueva pregunta'}
          </button>
          <div className="admin-actions">
            <label className="question-toggle"><input type="checkbox" checked={question.active} disabled={busy}
              onChange={(event)=>edit(question.id,{active:event.target.checked})}/> Activa</label>
            <button type="button" className="outline-button" aria-label={`Subir ${question.title||'pregunta'}`} disabled={busy||index===0} onClick={()=>move(index,-1)}>↑</button>
            <button type="button" className="outline-button" aria-label={`Bajar ${question.title||'pregunta'}`} disabled={busy||index===catalog.questions.length-1} onClick={()=>move(index,1)}>↓</button>
          </div>
        </div>
        {expanded===question.id&&<fieldset className="question-fields identity-form" id={`edit-${question.id}`} disabled={busy}>
          <label>Enunciado<input value={question.title} maxLength={200} onChange={(event)=>edit(question.id,{title:event.target.value})}/></label>
          <label>Ayuda opcional<input value={question.hint} maxLength={300} onChange={(event)=>edit(question.id,{hint:event.target.value})}/></label>
          <label className="field-label">Tipo de respuesta<select value={question.multi?'multi':'single'}
            onChange={(event)=>edit(question.id,{multi:event.target.value==='multi',correct:null})}>
            <option value="single">Opción única</option><option value="multi">Opción múltiple</option>
          </select></label>
          {question.options.map((option, optionIndex)=><div className="question-option" key={option.id}>
            <label>Opción {optionIndex+1}<input value={option.label} maxLength={160} onChange={(event)=>
              edit(question.id,{options:question.options.map((item)=>item.id===option.id?{...item,label:event.target.value}:item)})}/></label>
            {question.options.length>2&&<button type="button" className="outline-button" aria-label={`Quitar opción ${optionIndex+1}`}
              onClick={()=>edit(question.id,{options:question.options.filter(({id})=>id!==option.id),correct:question.correct===option.id?null:question.correct})}>Quitar</button>}
          </div>)}
          <div><button type="button" className="outline-button" disabled={question.options.length>=8}
            onClick={()=>edit(question.id,{options:[...question.options,createOption()]})}>+ Añadir opción</button></div>
          {!question.multi&&<label className="field-label">Respuesta correcta<select value={question.correct??''}
            onChange={(event)=>edit(question.id,{correct:event.target.value||null})}>
            <option value="">Sin puntuación</option>{question.options.map(({id,label},index)=><option key={id} value={id}>{label||`Opción ${index+1}`}</option>)}
          </select></label>}
        </fieldset>}
      </article>)}
      <div className="admin-actions question-publish">
        <button className="primary compact" disabled={busy||!changed}>{busy?'Publicando…':'Publicar cambios'}</button>
        <button type="button" className="outline-button" disabled={busy} onClick={refresh}>{changed?'Descartar cambios y recargar':'Recargar'}</button>
      </div>
    </form>}
    <details className="fixed-questions">
      <summary>Preguntas de perfil y condicionales</summary>
      <ul>{fixedQuestions.map(({id,title,requiresSkill})=><li key={id}>{title}{requiresSkill&&<> · {requiresSkill}</>}</li>)}</ul>
    </details>
  </section>
}
