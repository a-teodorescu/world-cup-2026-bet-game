-- WC2026 - Fix pentru eroarea Supabase/Postgres: DELETE requires a WHERE clause
-- Rulează acest script o singură dată în Supabase SQL Editor.
-- Nu modifică tabelele și nu șterge date acum; doar redefinește funcția admin de salvare scoruri.

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

  -- Unele proiecte Supabase au activat un guard de siguranță care refuză DELETE fără WHERE.
  -- WHERE true păstrează comportamentul vechi: înlocuiește complet lista de rezultate cu payload-ul primit.
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

grant execute on function public.wc2026_admin_replace_results(text, text, jsonb) to anon;
