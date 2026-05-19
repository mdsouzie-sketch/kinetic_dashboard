"""
Bulk-import multiple ForceDecks CSVs into Supabase.

Routes per Test Type column:
  CMJ  -> cmj, power, rfd, eccBrakingRFD
  SJ   -> sjump
  CMRJ -> rcmj  (cm -> in auto-converted)
  DJ   -> rsi

Matches incoming athlete names against existing roster (case- and
whitespace-insensitive). Only inserts truly new athletes; reuses existing IDs.
Inserts one new session per (athlete, day); within a day, best value per
metric wins (max — none of these are inverse). All measurements stored with
source = 'FD'.

Usage:
  python ingest_fd_multi.py                          # defaults to the 3 files below
  python ingest_fd_multi.py file_a.csv file_b.csv    # custom file list
  python ingest_fd_multi.py --dry-run [files...]     # parse + report, no DB writes
"""
import csv, json, re, sys, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime

SUPABASE_URL = "https://pournuabsdndozpouuke.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvdXJudWFic2RuZG96cG91dWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Njg3MTgsImV4cCI6MjA5MzM0NDcxOH0.IfvzHQzetK53iKcCXDVASMka6ZzCeEmUQP9K7Rwpdzw"

HEADERS = {
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

DEFAULT_FILES = ["squatjump.csv", "cmjrebound.csv", "drop jump.csv"]

# Athletes excluded across all prior ingests — keep consistent.
EXCLUDE_ATHLETES = {"Matt De Souza", "Ty Cox", "Quinn Oliver", "Jake Bishop"}

CM_TO_IN = 0.3937007874

FD_TEST_TYPE_MAP = {
    "CMJ": {
        "cmj":           {"col": "Jump Height (Imp-Mom) in Inches [in]"},
        "power":         {"col": "Peak Power / BM [W/kg]"},
        "rfd":           {"col": "Concentric RFD / BM [N/s/kg]"},
        "eccBrakingRFD": {"col": "Eccentric Braking RFD / BM [N/s/kg]"},
    },
    "SJ": {
        "sjump":         {"col": "Jump Height (Imp-Mom) in Inches [in]"},
    },
    "CMRJ": {
        "rcmj":          {"col": "Rebound Jump Height (Imp-Mom) [cm]", "conv": lambda v: v * CM_TO_IN},
    },
    "DJ": {
        "rsi":           {"col": "RSI (Flight Time/Contact Time)"},
    },
}

# Sex heuristics. Defaults to F; explicit M list + ambiguous list mirror
# ingest_cmj.py so newly-inserted athletes match prior conventions.
MALE_NAMES = {
    "cohen", "edward", "jack", "anthony", "sam mccoy", "nicolas", "brayden",
    "desean", "carter", "aaron", "justian", "jack dellinger", "wesley",
    "tristan", "rowan nishimoto", "sam shelton", "buck", "landon", "travis",
    "kai", "alexander", "ty", "dylan", "nicolas countreman",
}
AMBIGUOUS = {"tatum", "kaimana", "vai", "alexis", "riley", "alexia"}

VALUE_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)")


def parse_value(cell):
    if cell is None:
        return None
    s = cell.strip()
    if not s:
        return None
    m = VALUE_RE.match(s)
    if not m:
        return None
    v = float(m.group(1))
    return v if v > 0 else None


def normalize_name(raw):
    return re.sub(r"\s+", " ", (raw or "").strip())


def parse_date(raw):
    s = (raw or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def guess_sex(name):
    first = name.split()[0].lower() if name.split() else ""
    full_lower = name.lower()
    if first in AMBIGUOUS or full_lower in AMBIGUOUS:
        return None
    if first in MALE_NAMES or full_lower in MALE_NAMES:
        return "M"
    return "F"


def http(method, path, body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} on {method} {path}: {body_txt}", file=sys.stderr)
        raise


def parse_fd_csv(path, grouped):
    """Read one FD CSV, merge into grouped[name][day][metric]. Returns counts."""
    counts = {
        "rows_kept": 0, "skip_test_type": 0, "skip_excluded": 0,
        "skip_no_date": 0, "test_types": set(), "metrics": set(),
    }
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        try:
            raw_headers = next(reader)
        except StopIteration:
            return counts
        # ForceDecks exports often have trailing spaces inside column headers
        # ("Jump Height (Imp-Mom) in Inches [in] "). Strip them so indexOf hits.
        headers = [(h or "").strip() for h in raw_headers]

        # Precompute, per test type, which columns are available in this file.
        type_to_cols = {}
        for test_type, metrics in FD_TEST_TYPE_MAP.items():
            found = []
            for key, defn in metrics.items():
                try:
                    idx = headers.index(defn["col"])
                except ValueError:
                    continue
                found.append((key, idx, defn.get("conv")))
            type_to_cols[test_type] = found

        try:
            name_idx = headers.index("Name")
            date_idx = headers.index("Date")
            type_idx = headers.index("Test Type") if "Test Type" in headers else -1
        except ValueError:
            print(f"  ! {path}: missing required Name/Date column — skipping file", file=sys.stderr)
            return counts

        for row in reader:
            if not row or all(not c for c in row):
                continue
            name = normalize_name(row[name_idx] if name_idx < len(row) else "")
            if not name:
                continue
            if name in EXCLUDE_ATHLETES:
                counts["skip_excluded"] += 1
                continue
            test_type = (row[type_idx].strip() if 0 <= type_idx < len(row) else "CMJ")
            cols = type_to_cols.get(test_type) or []
            if not cols:
                counts["skip_test_type"] += 1
                continue
            day = parse_date(row[date_idx] if date_idx < len(row) else "")
            if not day:
                counts["skip_no_date"] += 1
                continue
            counts["rows_kept"] += 1
            counts["test_types"].add(test_type)
            for key, idx, conv in cols:
                cell = row[idx] if idx < len(row) else ""
                v = parse_value(cell)
                if v is None:
                    continue
                if conv:
                    v = conv(v)
                cur = grouped[name][day].get(key)
                if cur is None or v > cur:
                    grouped[name][day][key] = v
                    counts["metrics"].add(key)
    return counts


def main():
    args = sys.argv[1:]
    dry_run = False
    if args and args[0] == "--dry-run":
        dry_run = True
        args = args[1:]
    files = args or DEFAULT_FILES

    print(f"Files: {files}")
    if dry_run:
        print("DRY RUN — no DB writes.")
    print()

    grouped = defaultdict(lambda: defaultdict(dict))
    for f in files:
        print(f"--- Parsing {f}")
        c = parse_fd_csv(f, grouped)
        print(f"    rows kept: {c['rows_kept']}  test types: {sorted(c['test_types'])}  "
              f"metrics: {sorted(c['metrics'])}")
        print(f"    skipped — test type: {c['skip_test_type']}, excluded: {c['skip_excluded']}, "
              f"no date: {c['skip_no_date']}")
    print()

    # Athlete-by-athlete summary
    print(f"Distinct athletes parsed: {len(grouped)}")
    total_sessions = sum(len(days) for days in grouped.values())
    total_meas = sum(len(m) for days in grouped.values() for m in days.values())
    print(f"Total (athlete, day) sessions: {total_sessions}")
    print(f"Total measurements: {total_meas}")
    print()

    if dry_run:
        print("Sample parsed rows:")
        shown = 0
        for name, days in sorted(grouped.items()):
            for day, m in sorted(days.items()):
                pretty = ", ".join(f"{k}={v:.2f}" for k, v in m.items())
                print(f"  {name} @ {day}: {pretty}")
                shown += 1
                if shown >= 8:
                    break
            if shown >= 8:
                break
        return

    # Resolve athlete IDs (match by normalized lowercase name)
    print("Fetching existing athletes...")
    _, existing = http("GET", "athletes?select=id,name")
    existing_by_norm = {normalize_name(a["name"]).lower(): a for a in (existing or [])}
    print(f"Existing athletes: {len(existing_by_norm)}")

    name_to_id = {}
    new_payload = []
    ambiguous = []
    for name in sorted(grouped.keys()):
        hit = existing_by_norm.get(name.lower())
        if hit:
            name_to_id[name] = hit["id"]
            continue
        sex = guess_sex(name)
        if sex is None:
            ambiguous.append(name)
            sex = "F"
        new_payload.append({"name": name, "sex": sex})

    print(f"New athletes to insert: {len(new_payload)}")
    if ambiguous:
        print(f"  ambiguous sex (defaulted to F): {ambiguous}")
    for a in new_payload:
        print(f"  + {a['name']}  ({a['sex']})")

    if new_payload:
        _, inserted = http("POST", "athletes", new_payload)
        for r in inserted or []:
            name_to_id[r["name"]] = r["id"]

    # Build session payload
    session_idx = []
    session_payload = []
    for name in sorted(grouped.keys()):
        if name not in name_to_id:
            print(f"  ! no athlete_id for {name}; skipping", file=sys.stderr)
            continue
        for day in sorted(grouped[name].keys()):
            session_payload.append({
                "athlete_id": name_to_id[name],
                "session_date": day,
                "notes": "ForceDecks multi-format ingest",
            })
            session_idx.append((name, day))

    print(f"Sessions to insert: {len(session_payload)}")
    sess_id_for = {}
    CHUNK = 500
    for i in range(0, len(session_payload), CHUNK):
        chunk = session_payload[i:i + CHUNK]
        idx_chunk = session_idx[i:i + CHUNK]
        _, sess_rows = http("POST", "sessions", chunk)
        for (name, day), r in zip(idx_chunk, sess_rows or []):
            sess_id_for[(name, day)] = r["id"]

    # Build measurements payload
    meas_payload = []
    for name in sorted(grouped.keys()):
        for day, metrics in grouped[name].items():
            sid = sess_id_for.get((name, day))
            if sid is None:
                continue
            for metric, value in metrics.items():
                meas_payload.append({
                    "session_id": sid,
                    "metric": metric,
                    "value": value,
                    "source": "FD",
                })

    print(f"Measurements to insert: {len(meas_payload)}")
    for i in range(0, len(meas_payload), CHUNK):
        chunk = meas_payload[i:i + CHUNK]
        http("POST", "measurements", chunk)

    print()
    print(f"Done. Athletes added: {len(new_payload)} · Sessions: {len(session_payload)} · Measurements: {len(meas_payload)}")


if __name__ == "__main__":
    main()
