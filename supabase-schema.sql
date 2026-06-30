-- World Cup 2026 Predictor - Supabase schema
-- Rulează tot acest script în Supabase SQL Editor.
-- Schimbă ADMIN_PIN_DEFAULT cu PIN-ul tău real înainte să rulezi scriptul.

create extension if not exists pgcrypto;

create table if not exists public.wc2026_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text not null unique,
  role text not null default 'player' check (role in ('player', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.wc2026_prize_popup_dismissals (
  user_id uuid primary key references public.wc2026_users(id) on delete cascade,
  dismissed_at timestamptz not null default now()
);

create table if not exists public.wc2026_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wc2026_users(id) on delete cascade,
  match_id text not null,
  home integer check (home between 0 and 20),
  away integer check (away between 0 and 20),
  updated_at timestamptz not null default now(),
  unique(user_id, match_id)
);

create table if not exists public.wc2026_results (
  match_id text primary key,
  home integer not null check (home between 0 and 20),
  away integer not null check (away between 0 and 20),
  final_home integer check (final_home between 0 and 40),
  final_away integer check (final_away between 0 and 40),
  winner_side text check (winner_side is null or winner_side in ('home', 'away')),
  api_winner text,
  score_duration text,
  updated_at timestamptz not null default now()
);

alter table public.wc2026_results add column if not exists final_home integer check (final_home between 0 and 40);
alter table public.wc2026_results add column if not exists final_away integer check (final_away between 0 and 40);
alter table public.wc2026_results add column if not exists winner_side text check (winner_side is null or winner_side in ('home', 'away'));
alter table public.wc2026_results add column if not exists api_winner text;
alter table public.wc2026_results add column if not exists score_duration text;

create table if not exists public.wc2026_admin_settings (
  id boolean primary key default true,
  admin_email text not null default 'admin@gmail.com',
  admin_pin text not null,
  constraint single_admin_settings_row check (id = true)
);

insert into public.wc2026_admin_settings (id, admin_email, admin_pin)
values (true, 'admin@gmail.com', 'ADMIN_PIN_DEFAULT')
on conflict (id) do update set admin_email = excluded.admin_email, admin_pin = excluded.admin_pin;

alter table public.wc2026_users enable row level security;
alter table public.wc2026_prize_popup_dismissals enable row level security;
alter table public.wc2026_predictions enable row level security;
alter table public.wc2026_results enable row level security;
alter table public.wc2026_admin_settings enable row level security;

-- Ștergem politicile dacă există, ca scriptul să poată fi rulat de mai multe ori.
drop policy if exists "wc2026_users_select" on public.wc2026_users;
drop policy if exists "wc2026_users_insert" on public.wc2026_users;
drop policy if exists "wc2026_prize_popup_dismissals_select" on public.wc2026_prize_popup_dismissals;
drop policy if exists "wc2026_prize_popup_dismissals_insert" on public.wc2026_prize_popup_dismissals;
drop policy if exists "wc2026_prize_popup_dismissals_update" on public.wc2026_prize_popup_dismissals;
drop policy if exists "wc2026_predictions_select" on public.wc2026_predictions;
drop policy if exists "wc2026_predictions_insert" on public.wc2026_predictions;
drop policy if exists "wc2026_predictions_update" on public.wc2026_predictions;
drop policy if exists "wc2026_results_select" on public.wc2026_results;

create policy "wc2026_users_select" on public.wc2026_users for select using (true);
create policy "wc2026_users_insert" on public.wc2026_users for insert with check (true);

create policy "wc2026_prize_popup_dismissals_select" on public.wc2026_prize_popup_dismissals for select using (true);
create policy "wc2026_prize_popup_dismissals_insert" on public.wc2026_prize_popup_dismissals for insert with check (true);
create policy "wc2026_prize_popup_dismissals_update" on public.wc2026_prize_popup_dismissals for update using (true) with check (true);

create policy "wc2026_predictions_select" on public.wc2026_predictions for select using (true);
create policy "wc2026_predictions_insert" on public.wc2026_predictions for insert with check (true);
create policy "wc2026_predictions_update" on public.wc2026_predictions for update using (true) with check (true);

create policy "wc2026_results_select" on public.wc2026_results for select using (true);

create or replace function public.wc2026_admin_replace_results(admin_email text, admin_pin text, payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  item jsonb;
begin
  select exists(
    select 1 from public.wc2026_admin_settings s
    where lower(s.admin_email) = lower(wc2026_admin_replace_results.admin_email)
      and s.admin_pin = wc2026_admin_replace_results.admin_pin
  ) into ok;

  if not ok then
    return false;
  end if;

  delete from public.wc2026_results
  where true;

  for item in select * from jsonb_array_elements(coalesce(payload, '[]'::jsonb))
  loop
    insert into public.wc2026_results (match_id, home, away, final_home, final_away, winner_side, api_winner, score_duration, updated_at)
    values (
      item->>'match_id',
      (item->>'home')::integer,
      (item->>'away')::integer,
      coalesce(nullif(item->>'final_home', '')::integer, (item->>'home')::integer),
      coalesce(nullif(item->>'final_away', '')::integer, (item->>'away')::integer),
      nullif(item->>'winner_side', ''),
      nullif(item->>'api_winner', ''),
      nullif(item->>'score_duration', ''),
      now()
    )
    on conflict (match_id) do update set
      home = excluded.home,
      away = excluded.away,
      final_home = excluded.final_home,
      final_away = excluded.final_away,
      winner_side = excluded.winner_side,
      api_winner = excluded.api_winner,
      score_duration = excluded.score_duration,
      updated_at = now();
  end loop;

  return true;
end;
$$;

create or replace function public.wc2026_admin_delete_user(admin_email text, admin_pin text, target_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  select exists(
    select 1 from public.wc2026_admin_settings s
    where lower(s.admin_email) = lower(wc2026_admin_delete_user.admin_email)
      and s.admin_pin = wc2026_admin_delete_user.admin_pin
  ) into ok;

  if not ok then
    return false;
  end if;

  delete from public.wc2026_users
  where lower(email) = lower(target_email)
    and lower(email) <> lower(wc2026_admin_delete_user.admin_email);

  return true;
end;
$$;

grant execute on function public.wc2026_admin_replace_results(text, text, jsonb) to anon;
grant execute on function public.wc2026_admin_delete_user(text, text, text) to anon;
