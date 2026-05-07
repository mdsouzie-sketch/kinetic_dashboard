# Kinetic Benchmark

Athletic performance dashboard. Tracks force-plate, sprint, and agility metrics
across a roster, computes percentile norms, and produces athlete-facing dossiers.

Live: <https://mdsouzie-sketch.github.io/kinetic_dashboard/>

## What's in here

| Path | Purpose |
|---|---|
| [`index.html`](index.html) | The entire dashboard — single-file static site served by GitHub Pages |
| [`schema.sql`](schema.sql) | Supabase tables (`athletes`, `sessions`, `measurements`, `coach_state`) |
| `ingest_*.py` | One-shot Python scripts that load CSV exports into Supabase |
| `*.csv` | Source data files consumed by the ingest scripts |
| `dropjump.csv`, `force_deck_cmj.csv`, … | ForceDecks / sensor / sprint exports |

## Running locally

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>. Running over `http://` instead of `file://`
avoids Chrome's "Unsafe URL" warning and is closer to the production environment
(GitHub Pages also serves over HTTP/S).

## Coach login

The dashboard gates content behind a client-side password prompt. Coach
accounts are defined in `index.html` under the `COACHES` constant — each entry
has a display name and a SHA-256 hash of the password. The current account:

- **Coach Matt** — password is in `index.html` history (don't commit changes).

To add a new coach:

```bash
python -c "import hashlib; print(hashlib.sha256(b'thepassword').hexdigest())"
```

Add the resulting hash to `COACHES` in `index.html`. The login UI auto-populates
from that constant on next reload.

> **Security note:** the gate stops casual visitors but is not a real security
> boundary — the Supabase anon key is in the page source and grants full
> read/write to the tables. RLS is disabled. If you need a real boundary
> (parent/athlete portal, etc.), enable Supabase Auth + RLS policies first.

## Supabase setup

The dashboard talks to a Supabase project at
`https://pournuabsdndozpouuke.supabase.co` via the anon key embedded in
`index.html`.

To bootstrap a fresh project:

1. Run [`schema.sql`](schema.sql) in **Supabase Studio → SQL Editor**.
2. Update `SUPABASE_URL` and `SUPABASE_KEY` in `index.html` (look for the
   `SUPABASE LOADER + ASYNC INIT` section).
3. Update the same values in any `ingest_*.py` script you intend to run
   (currently each script duplicates the constants — see "Cleanup notes" below).

## Importing data

Each ingest script is a one-shot loader for a specific CSV format. Typical
flow:

```bash
python ingest_dropjump.py     # imports dropjump.csv as RSI (source=FD)
python ingest_cmj.py          # imports force_deck_cmj.csv as CMJ/Power/RFD/eccBrakingRFD
python ingest_sprint_csv.py   # 10y / fly / shuttle splits
python ingest_agility_csv.py  # pro agility times
```

Scripts are idempotent — they look up athletes/sessions by name+date and skip
existing measurements at equal-or-better values for the same `source`.

## Architecture notes

- **Source-of-truth resolution.** When the dashboard loads measurements, it
  picks `source='FD'` (ForceDecks) over any other source for the same metric.
  This is in `buildAthleteFromSupabase` in `index.html`.
- **Per-coach state** lives in `localStorage` (fast path, keyed by coach id)
  and `coach_state` table (cross-device sync). Both are kept in sync by
  `saveState()` / `pullStateFromSupabase()`.
- **Norms** are computed at load time from the roster (`computeMeasuredNorms`)
  and merged with hardcoded NCAA D1/D2/D3 norms from the `INITIAL_NORMS`
  constant.

## Cleanup notes

Each Python ingest script redeclares the same `SUPABASE_URL`, `ANON_KEY`,
`HEADERS`, and `http()` helper. A future cleanup is to extract those into a
shared `ingest_lib.py` module and have each script import from it.
