create table if not exists public.wc2026_api_sync_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  mode text not null default 'manual',
  status text not null default 'success',
  summary jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.wc2026_api_sync_logs enable row level security;

drop policy if exists "wc2026_api_sync_logs_select" on public.wc2026_api_sync_logs;
drop policy if exists "wc2026_api_sync_logs_insert" on public.wc2026_api_sync_logs;

create policy "wc2026_api_sync_logs_select"
on public.wc2026_api_sync_logs
for select
using (true);

create policy "wc2026_api_sync_logs_insert"
on public.wc2026_api_sync_logs
for insert
with check (true);
