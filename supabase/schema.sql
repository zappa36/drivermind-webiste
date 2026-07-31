-- Contact list: one row per website form submission.
-- Run once in the Supabase SQL Editor.

create table if not exists public.contacts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  email      text not null,
  company    text,
  message    text not null
);

-- RLS on with no policies: the anon and authenticated roles can neither read
-- nor write. Only the contact Edge Function (service role) touches this table.
alter table public.contacts enable row level security;

create index if not exists contacts_created_at_idx on public.contacts (created_at desc);
