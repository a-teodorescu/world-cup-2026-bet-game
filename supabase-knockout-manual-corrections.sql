-- Corecții manuale pentru meciurile eliminatorii CM 2026.
-- Rulează acest script în Supabase SQL Editor dacă tabelul wc2026_match_overrides conține încă echipele greșite.

insert into public.wc2026_match_overrides (match_id, home, away, api_stage, updated_at)
values
  ('R32-03', 'Germany', 'Paraguay', 'MANUAL_KNOCKOUT_CORRECTION', now()),
  ('R32-06', 'France', 'Sweden', 'MANUAL_KNOCKOUT_CORRECTION', now()),
  ('R32-07', 'Mexico', 'Ecuador', 'MANUAL_KNOCKOUT_CORRECTION', now()),
  ('R32-09', 'Belgium', 'Senegal', 'MANUAL_KNOCKOUT_CORRECTION', now()),
  ('R32-10', 'USA', 'Bosnia and Herzegovina', 'MANUAL_KNOCKOUT_CORRECTION', now()),
  ('R32-13', 'Switzerland', 'Algeria', 'MANUAL_KNOCKOUT_CORRECTION', now())
on conflict (match_id) do update set
  home = excluded.home,
  away = excluded.away,
  api_stage = excluded.api_stage,
  updated_at = now();
