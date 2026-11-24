grant select, insert, update on public.tester_applications to service_role;

alter table public.tester_applications add column questionnaire jsonb;

revoke all on public.tester_applications from public, anon, authenticated;
grant select (id, name, email, status, answers, score, profile_tags, focus_events, created_at, updated_at, questionnaire)
  on public.tester_applications to authenticated;

alter policy "Only admins can view tester applications" on public.tester_applications
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create table public.tester_questionnaire (
  singleton boolean primary key default true check (singleton),
  revision integer not null default 1 check (revision > 0),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.tester_questionnaire enable row level security;
revoke all on public.tester_questionnaire from public, anon, authenticated;
grant select, update on public.tester_questionnaire to service_role;

insert into public.tester_questionnaire (questions)
values ($seed$[{"id":"regression","title":"¿Qué busca una prueba de regresión?","hint":"Elige la opción más precisa.","options":[{"id":"0","label":"Medir la velocidad de la red"},{"id":"1","label":"Confirmar que cambios recientes no rompieron funciones existentes"},{"id":"2","label":"Revisar únicamente el diseño visual"}],"multi":false,"active":true,"correct":"1"},{"id":"severity","title":"Encuentras que nadie puede completar el pago. ¿Cómo lo clasificarías?","hint":"Piensa en el impacto para quien usa el producto.","options":[{"id":"0","label":"Bajo: detalle visual"},{"id":"1","label":"Medio: hay una alternativa sencilla"},{"id":"2","label":"Crítico: bloquea una función principal"}],"multi":false,"active":true,"correct":"2"},{"id":"smoke","title":"¿Para qué sirve una prueba smoke?","hint":"Selecciona su objetivo principal.","options":[{"id":"0","label":"Comprobar rápidamente que lo esencial funciona"},{"id":"1","label":"Probar todos los casos límite"},{"id":"2","label":"Reemplazar las pruebas de regresión"}],"multi":false,"active":true,"correct":"0"},{"id":"api","title":"Al probar una API, ¿qué revisarías además del código de respuesta?","hint":"Una respuesta 200 no garantiza que todo esté bien.","options":[{"id":"0","label":"Solo el tiempo del teclado"},{"id":"1","label":"El contenido, formato y datos de la respuesta"},{"id":"2","label":"El color del botón"}],"multi":false,"active":true,"correct":"1"}]$seed$::jsonb);

-- Existing applications used the initial questionnaire embedded in the earlier frontend.
update public.tester_applications
set questionnaire = (select jsonb_build_object('revision', revision, 'questions', questions) from public.tester_questionnaire where singleton);


create function public.tester_apply_intake(
  p_id uuid,
  p_token_hash text,
  p_action text,
  p_focus_events integer,
  p_answers jsonb,
  p_score integer,
  p_profile_tags text[]
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  application public.tester_applications%rowtype;
  focus_count integer;
begin
  select * into application
  from public.tester_applications
  where id = p_id and candidate_token_hash = p_token_hash
  for update;

  if not found then return null; end if;

  if application.status = 'in_progress' then
    focus_count := greatest(application.focus_events, least(20, coalesce(p_focus_events, 0)));
    if p_action = 'cancel' then focus_count := greatest(2, focus_count); end if;

    update public.tester_applications set
      focus_events = focus_count,
      status = case
        when focus_count >= 2 then 'cancelled'
        when p_action = 'complete' then 'completed'
        else 'in_progress'
      end,
      answers = case
        when p_action = 'save' or (p_action = 'complete' and focus_count < 2) then p_answers
        else application.answers
      end,
      score = case when p_action = 'complete' and focus_count < 2 then p_score else application.score end,
      profile_tags = case when p_action = 'complete' and focus_count < 2 then p_profile_tags else application.profile_tags end,
      updated_at = now()
    where id = p_id
    returning * into application;
  end if;

  return jsonb_build_object(
    'id', application.id,
    'status', application.status,
    'focus_events', application.focus_events,
    'score', application.score,
    'profile_tags', application.profile_tags
  );
end;
$$;

revoke all on function public.tester_apply_intake(uuid, text, text, integer, jsonb, integer, text[])
  from public, anon, authenticated;
grant execute on function public.tester_apply_intake(uuid, text, text, integer, jsonb, integer, text[])
  to service_role;
