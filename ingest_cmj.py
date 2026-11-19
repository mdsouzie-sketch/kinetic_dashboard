"""
Ingest force deck CMJ data into Supabase.

For each (athlete, day):
  - take MAX of: jump height (cmj), peak power (power),
    concentric RFD (rfd), eccentric braking RFD (eccBrakingRFD)
  - skip 0-valued or missing metrics
Sex is best-guessed from first name; ambiguous flagged in stdout.
"""
import csv, json, re, sys, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime

SUPABASE_URL = "https://gpjewqbhyfysiquadvid.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwamV3cWJoeWZ5c2lxdWFkdmlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMDg2NDgsImV4cCI6MjExMDU4NDY0OH0.JM4GfUngepPtIbPdOOv-xVYRckYVCiH5KtbTA-fNm0Y"

HEADERS = {
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# Athletes to skip entirely on user request.
EXCLUDE_ATHLETES = {
    "Matt De Souza", "Ty Cox", "Quinn Oliver", "Jake Bishop",
}

# Best-guess sex from first name. F by default for ambiguous-looking sets,
# explicit overrides for the names where I'm reasonably confident.
MALE_NAMES = {
    "cohen", "edward", "jack", "anthony", "sam mccoy", "nicolas", "brayden",
    "desean", "carter", "aaron", "justian", "jack dellinger", "wesley",
    "tristan",
    # confirmed by user prior round
    "rowan nishimoto", "sam shelton",
    # new from second import: Buck/Carter/Landon/Travis are M; Malia is F
    "buck", "landon", "travis",
    # confirmed third round
    "kai",
    # forcedecks-test-export-11_18_2026.csv
    "paxton", "connor", "jaxon", "hudson", "caden", "cole", "justus",
}
AMBIGUOUS = {
    "tatum", "kaimana", "vai", "alexis", "riley", "alexia",
    "drew", "cameron", "dylan", "talynn", "skylar", "teagan", "rypken",
    "addison",
}

METRIC_COLS = {
    "cmj": "Jump Height (Imp-Mom) in Inches [in]",
    "power": "Peak Power / BM [W/kg]",
    "rfd": "Concentric RFD / BM [N/s/kg]",
    "eccBrakingRFD": "Eccentric Braking RFD / BM [N/s/kg]",
}

# Only ingest standard CMJ rows; ABCMJ and other test types are skipped.
ALLOWED_TEST_TYPES = {"CMJ"}

VALUE_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*(?:[±+]|\\u00b1)?")


def parse_value(cell):
    """'12.6 ± 0.5' -> 12.6, returns None if zero or unparseable."""
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


def normalize_name(raw):
    n = raw.strip()
    n = re.sub(r"\s+", " ", n)
    return n


def parse_date(raw):
    return datetime.strptime(raw.strip(), "%m/%d/%Y").date().isoformat()


def guess_sex(name):
    first = name.split()[0].lower()
    full_lower = name.lower()
    # check ambiguous overrides first
    if first in AMBIGUOUS or full_lower in AMBIGUOUS:
        return None  # caller logs as ambiguous; defaults to F
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


def main():
    # usage: python ingest_cmj.py [--dry-run] [--force] [file.csv ...]
    # Multiple files are merged (best value per athlete/day/metric), so a
    # newer export missing a column (e.g. eccentric braking RFD) can be
    # combined with an older one that has it.
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    force = "--force" in args
    csv_paths = [a for a in args if not a.startswith("--")] or ["force_deck_cmj.csv"]
    # athlete name -> day -> {metric: best_value}
    grouped = defaultdict(lambda: defaultdict(dict))
    skipped_test_type = 0
    skipped_excluded = 0

    rows_iter = []
    for csv_path in csv_paths:
        with open(csv_path, encoding="utf-8-sig") as fh:
            # FD exports pad some headers with a trailing space
            rows_iter.extend({(k or '').strip(): v for k, v in r.items()} for r in csv.DictReader(fh))
    if True:
        for row in rows_iter:
            name = normalize_name(row["Name"])
            if not name or "DUPLICATE" in name:
                continue
            test_type = (row.get("Test Type") or "").strip()
            if test_type not in ALLOWED_TEST_TYPES:
                skipped_test_type += 1
                continue
            if name in EXCLUDE_ATHLETES:
                skipped_excluded += 1
                continue
            day = parse_date(row["Date"])
            for key, col in METRIC_COLS.items():
                v = parse_value(row.get(col))
                if v is None:
                    continue
                cur = grouped[name][day].get(key)
                if cur is None or v > cur:
                    grouped[name][day][key] = v

    print(f"Skipped (non-CMJ test type): {skipped_test_type}")
    print(f"Skipped (excluded athlete): {skipped_excluded}")

    # Build athlete list with sex guess
    athletes = sorted(grouped.keys())
    ambiguous_names = []
    athlete_payload = []
    for name in athletes:
        sex = guess_sex(name)
        if sex is None:
            ambiguous_names.append(name)
            sex = "F"
        athlete_payload.append({"name": name, "sex": sex})

    print(f"Athletes to insert: {len(athlete_payload)}")
    print(f"Ambiguous sex (defaulted to F): {ambiguous_names}")
    print("Male:", [a["name"] for a in athlete_payload if a["sex"] == "M"])

    if dry_run:
        n_sess = sum(len(d) for d in grouped.values())
        n_meas = sum(len(m) for d in grouped.values() for m in d.values())
        print(f"DRY RUN: {n_sess} sessions, {n_meas} measurements. Nothing written.")
        return

    status, existing = http("GET", "athletes?select=id&limit=1")
    if existing and not force:
        print("athletes table is not empty; re-running would duplicate athletes. Use --force to override.")
        return

    # Insert athletes
    status, ath_rows = http("POST", "athletes", athlete_payload)
    print(f"athletes insert: HTTP {status}, got {len(ath_rows)} rows")
    name_to_id = {r["name"]: r["id"] for r in ath_rows}

    # Build sessions list
    session_payload = []
    session_idx = []  # parallel: (athlete_name, day) so we can map ids back
    for name in athletes:
        for day in sorted(grouped[name].keys()):
            session_payload.append({
                "athlete_id": name_to_id[name],
                "session_date": day,
                "notes": "ForceDecks CMJ import",
            })
            session_idx.append((name, day))

    print(f"Sessions to insert: {len(session_payload)}")
    status, sess_rows = http("POST", "sessions", session_payload)
    print(f"sessions insert: HTTP {status}, got {len(sess_rows)} rows")

    # Map (name, day) -> session_id. PostgREST returns rows in insertion order.
    sess_id_for = {}
    for (name, day), row in zip(session_idx, sess_rows):
        sess_id_for[(name, day)] = row["id"]

    # Build measurements
    meas_payload = []
    for name in athletes:
        for day, metrics in grouped[name].items():
            sid = sess_id_for[(name, day)]
            for metric, value in metrics.items():
                meas_payload.append({
                    "session_id": sid,
                    "metric": metric,
                    "value": value,
                    "source": "FD",
                })

    print(f"Measurements to insert: {len(meas_payload)}")
    # POST in chunks to be polite to Supabase
    CHUNK = 500
    inserted = 0
    for i in range(0, len(meas_payload), CHUNK):
        chunk = meas_payload[i:i + CHUNK]
        status, _ = http("POST", "measurements", chunk)
        inserted += len(chunk)
    print(f"measurements inserted: {inserted}")

    # Final counts
    for t in ("athletes", "sessions", "measurements"):
        status, rows = http("GET", f"{t}?select=id")
        print(f"{t} final count: {len(rows)}")


if __name__ == "__main__":
    main()
