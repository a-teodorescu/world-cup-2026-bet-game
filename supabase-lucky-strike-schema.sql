-- Lucky Strike schema for World Cup 2026 Predictor
-- Run once in Supabase SQL Editor.

create table if not exists public.wc2026_lucky_strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wc2026_users(id) on delete cascade,
  team text not null,
  created_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.wc2026_lucky_strikes enable row level security;

drop policy if exists "wc2026_lucky_strikes_select" on public.wc2026_lucky_strikes;
drop policy if exists "wc2026_lucky_strikes_insert" on public.wc2026_lucky_strikes;

create policy "wc2026_lucky_strikes_select"
on public.wc2026_lucky_strikes
for select
using (true);

create policy "wc2026_lucky_strikes_insert"
on public.wc2026_lucky_strikes
for insert
with check (true);
