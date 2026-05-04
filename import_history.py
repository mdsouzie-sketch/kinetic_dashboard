import sys, io, json, re, openpyxl, urllib.request, urllib.error
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

EXCEL_PATH = r'C:\Users\mattd\Downloads\Athletic_Performance_Master_2.xlsx'
SUPABASE_URL = 'https://pournuabsdndozpouuke.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvdXJudWFic2RuZG96cG91dWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Njg3MTgsImV4cCI6MjA5MzM0NDcxOH0.IfvzHQzetK53iKcCXDVASMka6ZzCeEmUQP9K7Rwpdzw'
HDRS = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Content-Type': 'application/json'}

def sb_get(path):
    req = urllib.request.Request(SUPABASE_URL + path, headers=HDRS)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def sb_post(path, data, prefer='return=representation'):
    h = {**HDRS, 'Prefer': prefer}
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(SUPABASE_URL + path, data=body, headers=h, method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        print(f'  POST error {e.code}: {e.read()[:300]}')
        return None

def sb_delete(path):
    req = urllib.request.Request(SUPABASE_URL + path, headers=HDRS, method='DELETE')
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        print(f'  DELETE error {e.code}: {e.read()[:200]}')

def parse_date(val):
    if val is None: return None
    s = str(val)
    m = re.match(r'(\d{4})/(\d{2})/(\d{2})', s)
    if m: return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m: return f'{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
    return None

def parse_mean(val):
    if val is None: return None
    try: return float(val)
    except (ValueError, TypeError): pass
    m = re.match(r'([\d.]+)\s*[±±]', str(val))
    return float(m.group(1)) if m else None

wb = openpyxl.load_workbook(EXCEL_PATH)

def get_rows(sheet_name):
    ws = wb[sheet_name]
    headers = [cell.value for cell in ws[1]]
    return [dict(zip(headers, row)) for row in ws.iter_rows(min_row=2, values_only=True)]

# Collect: (name_lower, date) -> metric -> [(value, source)]
raw = defaultdict(lambda: defaultdict(list))
OUTLIERS = {('lily barstad', 'sprint10', lambda v: v < 1.0)}
INVERSE = {'sprint10', 'sprintFly', 'sprint1020', 'shuttle'}

def add(name, date, metric, value, source='manual'):
    if not name or not date or value is None: return
    try: v = float(value)
    except (ValueError, TypeError): return
    if v <= 0: return
    # Outlier filter
    if name.lower() == 'lily barstad' and metric == 'sprint10' and v < 1.0:
        print(f'  OUTLIER SKIPPED: {name} {metric}={v}')
        return
    raw[(name.lower().strip(), date)][metric].append((v, source))

# 0-10 Acceleration → sprint10
for r in get_rows('0-10 Acceleration'):
    add(r.get('Full Name'), parse_date(r.get('Completed Date')), 'sprint10', r.get('Time (s)'))

# 10-20 Transition → sprint1020
for r in get_rows('10-20 Transition'):
    add(r.get('Full Name'), parse_date(r.get('Completed Date')), 'sprint1020', r.get('Time (s)'))

# 20-30 Fly → sprintFly
for r in get_rows('20-30 Fly'):
    add(r.get('Full Name'), parse_date(r.get('Completed Date')), 'sprintFly', r.get('Time (s)'))

# Broad Jump → broad (find column with ″)
broad_rows = get_rows('Broad Jump')
broad_col = next((k for k in (broad_rows[0].keys() if broad_rows else []) if 'Distance' in str(k)), None)
print(f'Broad Jump column: {broad_col}')
for r in broad_rows:
    add(r.get('Full Name'), parse_date(r.get('Completed Date')), 'broad', r.get(broad_col))

# CMJ → cmj (sensor)
cmj_rows = get_rows('CMJ')
cmj_col = next((k for k in (cmj_rows[0].keys() if cmj_rows else []) if 'Height' in str(k) and k), None)
print(f'CMJ column: {cmj_col}')
for r in cmj_rows:
    add(r.get('Full Name'), parse_date(r.get('Completed Date')), 'cmj', r.get(cmj_col), 'sensor')

# 5-10-5 Pro Agility → shuttle
for r in get_rows('5-10-5 Pro Agility'):
    add(r.get('Full Name'), parse_date(r.get('Completed Date')), 'shuttle', r.get('Duration (s)'))

# 10-5 Reactive Strength → rsi
for r in get_rows('10-5 Reactive Strength'):
    add(r.get('Full Name'), parse_date(r.get('Completed Date')), 'rsi', r.get('RSI'), 'sensor')

# Force Deck CMJ → cmj (FD), power, rfd
fd_rows = get_rows('Force Deck CMJ')
fd_cmj_col  = next((k for k in (fd_rows[0].keys() if fd_rows else []) if 'Height' in str(k) and k), None)
fd_pow_col  = next((k for k in (fd_rows[0].keys() if fd_rows else []) if 'Power' in str(k) and k), None)
fd_rfd_col  = next((k for k in (fd_rows[0].keys() if fd_rows else []) if 'RFD' in str(k) and k), None)
print(f'FD cols: cmj={fd_cmj_col}, power={fd_pow_col}, rfd={fd_rfd_col}')
for r in fd_rows:
    d = parse_date(r.get('Date'))
    add(r.get('Name'), d, 'cmj',   parse_mean(r.get(fd_cmj_col)), 'FD')
    add(r.get('Name'), d, 'power', parse_mean(r.get(fd_pow_col)), 'FD')
    add(r.get('Name'), d, 'rfd',   parse_mean(r.get(fd_rfd_col)), 'FD')

# Reduce to best value per (athlete, date, metric)
final = {}  # (name_lower, date) -> {metric: (value, source)}
for (name_lower, date), metrics in raw.items():
    day = {}
    for metric, values in metrics.items():
        if metric == 'cmj':
            fd = [(v, s) for v, s in values if s == 'FD']
            pool = fd if fd else values
        else:
            pool = values
        best = min(pool, key=lambda x: x[0]) if metric in INVERSE else max(pool, key=lambda x: x[0])
        day[metric] = best
    final[(name_lower, date)] = day

print(f'\nTotal (athlete, date) sessions to import: {len(final)}')

# Get athlete ID map from Supabase
athletes_sb = sb_get('/rest/v1/athletes?select=id,name,sex')
id_map = {a['name'].lower().strip(): a for a in athletes_sb}
print(f'Athletes in Supabase: {len(id_map)}')

# Delete all existing sessions (cascades to measurements)
print('\nDeleting existing sessions...')
for a in athletes_sb:
    sb_delete(f"/rest/v1/sessions?athlete_id=eq.{a['id']}")
print('Sessions cleared.')

# Insert new sessions + measurements
inserted_sess = 0
inserted_meas = 0
skipped = set()

for (name_lower, date), metrics in sorted(final.items()):
    if name_lower not in id_map:
        skipped.add(name_lower)
        continue
    ath = id_map[name_lower]

    sess = sb_post('/rest/v1/sessions',
                   {'athlete_id': ath['id'], 'session_date': date, 'notes': 'Excel import'})
    if not sess or not isinstance(sess, list) or len(sess) == 0:
        print(f'  Failed session: {name_lower} {date}')
        continue
    sess_id = sess[0]['id']
    inserted_sess += 1

    meas = [{'session_id': sess_id, 'metric': m, 'value': v, 'source': s}
            for m, (v, s) in metrics.items()]
    sb_post('/rest/v1/measurements', meas, prefer='return=minimal')
    inserted_meas += len(meas)

print(f'\nDone! Inserted {inserted_sess} sessions, {inserted_meas} measurements.')
if skipped:
    print(f'Skipped (not in Supabase): {sorted(skipped)[:20]}')
