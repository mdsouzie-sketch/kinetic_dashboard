-- Kinetic Benchmark — Supabase schema
--
-- The dashboard (index.html) and the Python ingest scripts both read/write
-- via the PostgREST endpoint at https://<project>.supabase.co/rest/v1/
-- using the anon key.
--
-- RLS note: these tables currently run with RLS DISABLED so the anon key
-- has full read/write/delete access. The dashboard ships with a soft
-- client-side password gate (see COACHES in index.html) — it stops casual
-- visitors but is not a real security boundary while the anon key is in
-- the page source. Tighten with proper Supabase Auth + RLS policies if you
-- ever expose a parent/athlete-facing portal.

-- ─── athletes ────────────────────────────────────────────────────────────
create table if not exists public.athletes (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  sex         text        not null check (sex in ('M', 'F')),
  created_at  timestamptz not null default now()
);
create index if not exists athletes_name_idx on public.athletes (name);

-- ─── sessions ────────────────────────────────────────────────────────────
-- One session = one testing day for an athlete.
create table if not exists public.sessions (
  id            uuid        primary key default gen_random_uuid(),
  athlete_id    uuid        not null references public.athletes (id) on delete cascade,
  session_date  date        not null,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists sessions_athlete_idx on public.sessions (athlete_id);
create index if not exists sessions_date_idx    on public.sessions (session_date);

-- ─── measurements ────────────────────────────────────────────────────────
-- One row per (session, metric). `source` distinguishes platform/method:
--   FD       = ForceDecks (preferred — wins in the dashboard's resolver)
--   sensor   = generic non-FD sensor (gold † flag in the UI for CMJ)
--   manual   = hand-entered (sprint times, broad jump tape, etc.)
create table if not exists public.measurements (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references public.sessions (id) on delete cascade,
  metric      text        not null,
  value       numeric     not null,
  source      text        not null default 'manual',
  created_at  timestamptz not null default now()
);
create index if not exists measurements_session_idx on public.measurements (session_id);
create index if not exists measurements_metric_idx  on public.measurements (metric);

-- ─── coach_state ─────────────────────────────────────────────────────────
-- Per-coach dashboard state (selected athlete, norm, disabled metrics,
-- compact mode, etc.). Synced from index.html so layout follows the coach
-- across devices. coach_id matches the keys in the COACHES const.
create table if not exists public.coach_state (
  coach_id    text        primary key,
  state       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ─── Recommended seed sources for `measurements.source` ─────────────────
-- (No CHECK constraint so new sources can be introduced without a migration.)
--   'FD' | 'sensor' | 'manual'
