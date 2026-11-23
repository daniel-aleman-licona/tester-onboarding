create table if not exists public.tester_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null unique check (char_length(email) <= 254),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'cancelled')),
  answers jsonb not null default '{}'::jsonb,
  score integer check (score between 0 and 100),
  profile_tags text[] not null default '{}',
  focus_events integer not null default 0 check (focus_events >= 0),
  candidate_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tester_applications enable row level security;
revoke all on public.tester_applications from anon, authenticated;
grant select on public.tester_applications to authenticated;
grant select, insert, update on public.tester_applications to service_role;

create policy "Only admins can view tester applications"
on public.tester_applications
for select
to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create index if not exists tester_applications_created_at_idx
  on public.tester_applications (created_at desc);
create index if not exists tester_applications_status_idx
  on public.tester_applications (status);
