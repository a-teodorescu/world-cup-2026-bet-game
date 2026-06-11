create table if not exists public.wc2026_match_overrides (
  match_id text primary key,
  home text not null,
  away text not null,
  api_match_id bigint,
  api_stage text,
  api_utc_date timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.wc2026_match_overrides enable row level security;

drop policy if exists "wc2026_match_overrides_select" on public.wc2026_match_overrides;
drop policy if exists "wc2026_match_overrides_insert" on public.wc2026_match_overrides;
drop policy if exists "wc2026_match_overrides_update" on public.wc2026_match_overrides;

create policy "wc2026_match_overrides_select"
on public.wc2026_match_overrides
for select
using (true);

create policy "wc2026_match_overrides_insert"
on public.wc2026_match_overrides
for insert
with check (true);

create policy "wc2026_match_overrides_update"
on public.wc2026_match_overrides
for update
using (true)
with check (true);
