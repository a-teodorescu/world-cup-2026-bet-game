-- Corecție manuală strict pentru meciul eliminatoriu #88 / R32-16.
-- Rulează acest script în Supabase SQL Editor.

insert into public.wc2026_match_overrides (match_id, home, away, api_stage, updated_at)
values
  ('R32-16', 'Colombia', 'Ghana', 'MANUAL_KNOCKOUT_CORRECTION', now())
on conflict (match_id) do update set
  home = excluded.home,
  away = excluded.away,
  api_stage = excluded.api_stage,
  updated_at = now();
