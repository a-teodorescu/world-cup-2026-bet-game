-- Cupa Mondială 2026 Predictor - popup premii închis per user
-- Rulează acest script în Supabase SQL Editor o singură dată.
-- După ce un user închide pop-up-ul de premii, acesta nu mai apare pentru acel user pe niciun device.

create table if not exists public.wc2026_prize_popup_dismissals (
  user_id uuid primary key references public.wc2026_users(id) on delete cascade,
  dismissed_at timestamptz not null default now()
);

alter table public.wc2026_prize_popup_dismissals enable row level security;

drop policy if exists "wc2026_prize_popup_dismissals_select" on public.wc2026_prize_popup_dismissals;
drop policy if exists "wc2026_prize_popup_dismissals_insert" on public.wc2026_prize_popup_dismissals;
drop policy if exists "wc2026_prize_popup_dismissals_update" on public.wc2026_prize_popup_dismissals;

create policy "wc2026_prize_popup_dismissals_select"
on public.wc2026_prize_popup_dismissals
for select
using (true);

create policy "wc2026_prize_popup_dismissals_insert"
on public.wc2026_prize_popup_dismissals
for insert
with check (true);

create policy "wc2026_prize_popup_dismissals_update"
on public.wc2026_prize_popup_dismissals
for update
using (true)
with check (true);
