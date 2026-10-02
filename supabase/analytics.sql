-- Page analytics: anonymous events written by the track Edge Function.
-- Run once in the Supabase SQL Editor.
--
-- Privacy model: no cookies, no IPs, no user identifiers. The session id is
-- random, lives only in page memory, and dies with the tab — it groups one
-- visit's events and nothing more.

create table if not exists public.page_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session    text not null,
  event      text not null check (event in ('view','click','read')),
  target     text,      -- click: the href or button label
  section    text,      -- the section the event happened in
  seconds    int,       -- read: seconds the section was actually on screen
  path       text,
  referrer   text,
  viewport   text
);

-- RLS on with no policies: only the Edge Function's service role writes,
-- and public API keys can neither read nor write.
alter table public.page_events enable row level security;

create index if not exists page_events_created_at_idx on public.page_events (created_at desc);
create index if not exists page_events_event_idx on public.page_events (event, created_at desc);

-- Convenience views for the Table Editor. security_invoker keeps them
-- governed by the table's RLS (not readable through the public API).

create or replace view public.daily_visits
with (security_invoker = on) as
select date_trunc('day', created_at)::date as day,
       count(distinct session)             as visitors,
       count(*) filter (where event = 'view') as pageviews
from public.page_events
group by 1 order by 1 desc;

create or replace view public.clicks_by_target
with (security_invoker = on) as
select date_trunc('day', created_at)::date as day,
       target,
       count(*) as clicks
from public.page_events
where event = 'click'
group by 1, 2 order by 1 desc, 3 desc;

create or replace view public.read_time_by_section
with (security_invoker = on) as
select section,
       count(distinct session)  as sessions,
       round(avg(seconds), 1)   as avg_seconds,
       sum(seconds)             as total_seconds
from public.page_events
where event = 'read'
group by 1 order by total_seconds desc;
