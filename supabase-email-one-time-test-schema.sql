-- One-time scheduled email automation tests.
-- Run this once in Supabase SQL Editor after uploading this version.

create table if not exists public.wc2026_scheduled_email_tests (
  id uuid primary key default gen_random_uuid(),
  report_date text not null,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'sent', 'partial', 'error', 'cancelled')),
  created_by_email text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  summary jsonb,
  error_message text
);

create index if not exists wc2026_scheduled_email_tests_pending_idx
on public.wc2026_scheduled_email_tests (run_at)
where status = 'pending';

alter table public.wc2026_scheduled_email_tests enable row level security;

drop policy if exists "wc2026_scheduled_email_tests_select" on public.wc2026_scheduled_email_tests;
drop policy if exists "wc2026_scheduled_email_tests_insert" on public.wc2026_scheduled_email_tests;
drop policy if exists "wc2026_scheduled_email_tests_update" on public.wc2026_scheduled_email_tests;

create policy "wc2026_scheduled_email_tests_select"
on public.wc2026_scheduled_email_tests
for select
using (true);

create policy "wc2026_scheduled_email_tests_insert"
on public.wc2026_scheduled_email_tests
for insert
with check (true);

create policy "wc2026_scheduled_email_tests_update"
on public.wc2026_scheduled_email_tests
for update
using (true)
with check (true);
