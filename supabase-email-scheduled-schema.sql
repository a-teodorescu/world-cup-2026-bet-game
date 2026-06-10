-- Extra fields needed for scheduled daily email reports and duplicate protection.
-- Run this once in Supabase SQL Editor before enabling the scheduled function.

create table if not exists public.wc2026_email_logs (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  username text,
  subject text not null,
  status text not null default 'pending',
  payload jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.wc2026_email_logs
  add column if not exists report_date text,
  add column if not exists report_type text not null default 'manual',
  add column if not exists delivery_id text;

create unique index if not exists wc2026_email_logs_daily_sent_unique
on public.wc2026_email_logs (lower(email), report_date, report_type)
where status = 'sent' and report_date is not null;

alter table public.wc2026_email_logs enable row level security;

drop policy if exists "wc2026_email_logs_select" on public.wc2026_email_logs;
drop policy if exists "wc2026_email_logs_insert" on public.wc2026_email_logs;

create policy "wc2026_email_logs_select"
on public.wc2026_email_logs
for select
using (true);

create policy "wc2026_email_logs_insert"
on public.wc2026_email_logs
for insert
with check (true);
