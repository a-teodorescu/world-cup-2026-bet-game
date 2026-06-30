-- WC2026 - scor 90 min + scor final pentru Eliminatorii
-- Rulează acest script o singură dată în Supabase SQL Editor.
-- Poate fi rulat și peste schema existentă.

alter table public.wc2026_results add column if not exists final_home integer check (final_home between 0 and 40);
alter table public.wc2026_results add column if not exists final_away integer check (final_away between 0 and 40);
alter table public.wc2026_results add column if not exists winner_side text check (winner_side is null or winner_side in ('home', 'away'));
alter table public.wc2026_results add column if not exists api_winner text;
alter table public.wc2026_results add column if not exists score_duration text;

update public.wc2026_results
set
  final_home = coalesce(final_home, home),
  final_away = coalesce(final_away, away)
where final_home is null or final_away is null;

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

  delete from public.wc2026_results;

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

grant execute on function public.wc2026_admin_replace_results(text, text, jsonb) to anon;
