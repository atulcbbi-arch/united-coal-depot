-- Run ONCE in Supabase → SQL Editor → New query → Run.
create table if not exists public.tg_drafts (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  chat_id     text not null,
  status      text not null default 'pending',  -- pending | posting | done | cancelled | failed | undoing | undone
  source      text,
  draft       jsonb not null,
  result      jsonb
);
create index if not exists tg_drafts_chat_status on public.tg_drafts (chat_id, status, id desc);
-- Only the server (service role key) touches this table.
alter table public.tg_drafts enable row level security;
