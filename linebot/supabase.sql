create table if not exists public.line_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id text,
  message text,
  flow text
);

create index if not exists line_logs_created_at_idx
  on public.line_logs (created_at desc);

create index if not exists line_logs_user_id_idx
  on public.line_logs (user_id);

alter table public.line_logs enable row level security;

drop policy if exists "allow_insert_line_logs" on public.line_logs;

create policy "allow_insert_line_logs"
on public.line_logs
for insert
to anon, authenticated
with check (true);
