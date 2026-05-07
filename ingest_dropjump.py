"""
Ingest drop jump CSV into Supabase as the canonical RSI source.

DJ-RSI (Flight Time / Contact Time) is the authoritative reactive strength
index. We import the per-(athlete, day) max as metric='rsi', source='FD' so
the dashboard's FD-preference resolver uses it ahead of any sensor/manual RSI.

Other DJ columns (jump height, peak power) are intentionally NOT imported —
DJ jump height is not comparable to CMJ jump height, and peak power from a
DJ isn't comparable to CMJ peak power.

Idempotent: safe to re-run.
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
}

CSV_PATH = "dropjump.csv"
METRIC = "rsi"
SOURCE = "FD"
ALLOWED_TEST_TYPES = {"DJ"}
EXCLUDE_ATHLETES = {"Quinn Oliver", "Matt De Souza", "Ty Cox", "Jake Bishop"}

# Map CSV-spelling -> DB-canonical (lowercased, single-spaced).
NAME_ALIASES = {
    "kai fennel":   "kai fennell",
    "gabby nevarez": "gabriela nevarez",
    "ahnie murilo": "ahnalisa murillo",
}

VALUE_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)")


def parse_value(cell):
    if cell is None:
        return None
    cell = cell.strip()
    if not cell:
        return None
    m = VALUE_RE.match(cell)
    if not m:
        return None
    v = float(m.group(1))
    return v if v > 0 else None


def norm(s):
    return " ".join(str(s).split()).lower() if s else ""


def alias(n):
    return NAME_ALIASES.get(n, n)


def parse_date(s):
    return datetime.strptime(s.strip().split(" ")[0], "%m/%d/%Y").date().isoformat()


def http(method, path, body=None, prefer=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    h = dict(HEADERS)
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} on {method} {path}: {body_txt}", file=sys.stderr)
        raise


def find_column(fieldnames, target_substr):
    """Loose match — handles trailing-space header columns."""
    for fn in fieldnames:
        if target_substr.lower() in fn.lower():
            return fn
    raise KeyError(f"No column matching {target_substr!r} in {fieldnames}")


def parse_csv(path):
    """Return dict[(name_norm, date_iso)] = best_rsi."""
    best = {}
    skipped_test_type = 0
    skipped_excluded = 0
    skipped_zero = 0
    with open(path, encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        rsi_col = find_column(reader.fieldnames, "RSI (Flight Time/Contact Time)")
        for row in reader:
            name_raw = (row.get("Name") or "").strip()
            if not name_raw:
                continue
            test_type = (row.get("Test Type") or "").strip()
            if test_type not in ALLOWED_TEST_TYPES:
                skipped_test_type += 1
                continue
            if name_raw in EXCLUDE_ATHLETES:
                skipped_excluded += 1
                continue
            v = parse_value(row.get(rsi_col))
            if v is None:
                skipped_zero += 1
                continue
            n = alias(norm(name_raw))
            d = parse_date(row["Date"])
            key = (n, d)
            if key not in best or v > best[key]:
                best[key] = v
    print(f"Parsed: {len(best)} (athlete, day) RSI values")
    print(f"Skipped non-DJ rows: {skipped_test_type}")
    print(f"Skipped excluded athletes: {skipped_excluded}")
    print(f"Skipped zero/unparseable: {skipped_zero}")
    return best


def main():
    by_session = parse_csv(CSV_PATH)

    # Resolve athlete IDs
    _, athletes = http("GET", "athletes?select=id,name")
    id_for = {alias(norm(a["name"])): a["id"] for a in athletes}

    # Resolve existing sessions
    _, sessions = http("GET", "sessions?select=id,athlete_id,session_date")
    session_for = {(s["athlete_id"], s["session_date"]): s["id"] for s in sessions}

    # Existing RSI measurements (any source) — used to skip dups
    _, existing = http("GET", f"measurements?select=id,session_id,value,source&metric=eq.{METRIC}")
    cur_for = defaultdict(list)
    for m in existing:
        cur_for[m["session_id"]].append(m)

    unmatched = set()
    new_session_payload = []     # [{athlete_id, session_date, notes}]
    new_session_meta = []        # parallel list of (aid, date, value)
    inserts_existing = []         # measurements for sessions that already exist

    for (n, d), v in sorted(by_session.items()):
        if n not in id_for:
            unmatched.add(n)
            continue
        aid = id_for[n]
        sess_id = session_for.get((aid, d))
        if sess_id is None:
            new_session_payload.append({
                "athlete_id": aid, "session_date": d, "notes": "ForceDecks DJ import",
            })
            new_session_meta.append((aid, d, v))
            continue
        # Skip if this exact source is already at >= value (RSI is non-inverse)
        if any(float(m["value"]) >= v and m["source"] == SOURCE
               for m in cur_for.get(sess_id, [])):
            continue
        inserts_existing.append({
            "session_id": sess_id, "metric": METRIC, "value": v, "source": SOURCE,
        })

    print(f"\nPlan:")
    print(f"  New sessions to create: {len(new_session_payload)}")
    print(f"  RSI measurements for existing sessions: {len(inserts_existing)}")
    if unmatched:
        print(f"  UNMATCHED athletes (skipped — create them first): {sorted(unmatched)}")

    new_meas = []
    if new_session_payload:
        status, sess_rows = http("POST", "sessions", new_session_payload, prefer="return=representation")
        print(f"  Created sessions: HTTP {status}, {len(sess_rows)} rows")
        for (aid, d, v), srow in zip(new_session_meta, sess_rows):
            new_meas.append({
                "session_id": srow["id"], "metric": METRIC, "value": v, "source": SOURCE,
            })

    all_inserts = new_meas + inserts_existing
    if all_inserts:
        CHUNK = 500
        for i in range(0, len(all_inserts), CHUNK):
            http("POST", "measurements", all_inserts[i:i+CHUNK], prefer="return=minimal")
        print(f"  Inserted measurements: {len(all_inserts)}")
    else:
        print("  Nothing to insert.")

    # Final tally
    _, fd_rsi = http("GET", f"measurements?select=id&metric=eq.{METRIC}&source=eq.{SOURCE}")
    print(f"\nFinal: {METRIC}({SOURCE}) measurements in DB = {len(fd_rsi)}")


if __name__ == "__main__":
    main()
