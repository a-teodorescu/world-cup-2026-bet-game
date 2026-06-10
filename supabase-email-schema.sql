-- Rulează acest script în Supabase SQL Editor înainte să trimiți emailuri din Netlify.
-- Adaugă funcția prin care Netlify verifică PIN-ul de admin fără să expună tabela de setări.

create or replace function public.wc2026_admin_validate(admin_email text, admin_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists(
    select 1
    from public.wc2026_admin_settings s
    where lower(s.admin_email) = lower(wc2026_admin_validate.admin_email)
      and s.admin_pin = wc2026_admin_validate.admin_pin
  );
end;
$$;

grant execute on function public.wc2026_admin_validate(text, text) to anon;
