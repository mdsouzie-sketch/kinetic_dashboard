// ═══════════════════════════════════════════════════════════════
// ATHLETE DATA — from ForceDecks master sheet
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://pournuabsdndozpouuke.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvdXJudWFic2RuZG96cG91dWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Njg3MTgsImV4cCI6MjA5MzM0NDcxOH0.IfvzHQzetK53iKcCXDVASMka6ZzCeEmUQP9K7Rwpdzw';
const SUPABASE_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };
let ATHLETE_DB = [];

// ForceDeck-measured keys (always real for every athlete — legacy fallback)
const REAL_KEYS = new Set(['cmj','power','rfd','eccBrakingRFD']);
function isEstimatedForAthlete(key, athlete) {
  if (athlete.measured) return !athlete.measured[key];
  if (key === 'rsi') return !athlete.rsiMeasured;
  return !REAL_KEYS.has(key);
}
function isEstimated(key) { return isEstimatedForAthlete(key, athleteData); }
const CORE_MEASURED_DEFAULTS = ['power','cmj','rsi','broad','sprint10','sprintFly','shuttle'];
let coreMeasuredKeys = new Set(CORE_MEASURED_DEFAULTS);
function hasAllMeasured(a) {
  for (const k of coreMeasuredKeys) { if (!a.measured || !a.measured[k]) return false; }
  return true;
}

function getAthleteOverallTier(a) {
  const normKey = 'Roster — ' + (a.sex === 'M' ? 'Male' : 'Female') + ' (Measured)';
  const n = norms[normKey] || {};
  const pcts = METRICS.filter(m => !disabledMetrics.has(m.key) && typeof a[m.key] === 'number' && a[m.key] > 0 && n[m.key])
    .map(m => calcPercentile(a[m.key], n[m.key], m.inv));
  if (!pcts.length) return null;
  return getTier(Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length));
}
function toggleCoreMetric(key) {
  if (coreMeasuredKeys.has(key)) coreMeasuredKeys.delete(key);
  else coreMeasuredKeys.add(key);
  renderSettings();
  renderRosterTable();
  renderAll(false);
  saveState();
}

// ═══════════════════════════════════════════════════════════════
// METRICS CONFIG
// ═══════════════════════════════════════════════════════════════
const METRICS = [
  { key:'power',         label:'Power',            testName:'Peak power',              inv:false, unit:'W/kg',   step:0.1  },
  { key:'rsi',           label:'Reactivity',       testName:'Drop jump RSI',           inv:false, unit:'idx',    step:0.01 },
  { key:'rfd',           label:'Explosiveness',    testName:'Concentric RFD',          inv:false, unit:'N/s/kg', step:1    },
  { key:'eccBrakingRFD', label:'Braking force',    testName:'Eccentric braking RFD',   inv:false, unit:'N/s/kg', step:1    },
  { key:'cmj',           label:'Vertical jump',    testName:'Countermovement jump',    inv:false, unit:'in',     step:0.1  },
  { key:'sprint10',      label:'Acceleration',     testName:'10-yard sprint',          inv:true,  unit:'s',      step:0.01 },
  { key:'sprintFly',     label:'Top speed',        testName:'Fly 10 (20–30y)',         inv:true,  unit:'s',      step:0.01 },
  { key:'sprint1020',    label:'Transition speed', testName:'10–20y split',            inv:true,  unit:'s',      step:0.01 },
  { key:'broad',         label:'Broad jump',       testName:'Standing broad jump',     inv:false, unit:'in',     step:0.1  },
  { key:'shuttle',       label:'Agility',          testName:'Pro agility (5-10-5)',    inv:true,  unit:'s',      step:0.01 },
];

const INVERSE_METRICS = new Set(METRICS.filter(m => m.inv).map(m => m.key));

const TEST_GROUPS = [
  { key:'cmj', label:'CMJ & Force', shortLabel:'CMJ',
    metrics:['cmj','rfd','eccBrakingRFD','power'],
    defaultNorm: sex => `Roster — ${sex==='M'?'Male':'Female'} (Measured)`,
    hasData: a => (a.cmj||0) > 0 || (a.rfd||0) > 0 },
  { key:'sprint', label:'Sprint', shortLabel:'Sprint',
    metrics:['sprint10','sprintFly','sprint1020'],
    defaultNorm: sex => `Roster — ${sex==='M'?'Male':'Female'} (Measured)`,
    hasData: a => (a.sprint10||0) > 0 },
  { key:'jump', label:'Jump & Reactive', shortLabel:'Jump',
    metrics:['cmj','broad','rsi'],
    defaultNorm: sex => `Roster — ${sex==='M'?'Male':'Female'} (Measured)`,
    hasData: a => (a.cmj||0) > 0 || (a.broad||0) > 0 || (a.rsi||0) > 0 },
];

// ═══════════════════════════════════════════════════════════════
// NORMS — internal (computed from measured roster only) + external NCAA
//
// Only athletes with a real measurement for a given metric contribute
// to that metric's norm. Estimated/auto-derived values are not used —
// untested athletes simply have no value, which the UI surfaces as
// "Test required" rather than fabricating a number.
// ═══════════════════════════════════════════════════════════════

// When true: roster table + Roster (Measured) norms restricted to full-data athletes.
// Declared here (before computeMeasuredNorms / INITIAL_NORMS) to avoid TDZ.
let rosterFullOnly = false;

function computeMeasuredNorms(sexKey) {
  let group = ATHLETE_DB.filter(a => a.sex === sexKey);
  // Full-only mode: derive comparison norms from athletes with all core metrics measured
  if (rosterFullOnly) {
    const full = group.filter(hasAllMeasured);
    if (full.length >= 2) group = full;
  }
  const out = {};
  METRICS.forEach(m => {
    // Only real measurements contribute to the norm. If fewer than 2 athletes
    // have a measured value, leave the metric out of the norm map — comparisons
    // for that metric will surface "Test required" instead of estimating.
    const vals = group
      .filter(a => a.measured && a.measured[m.key])
      .map(a => a[m.key])
      .filter(v => v > 0);
    if (vals.length < 2) return;
    const mean = vals.reduce((s,v)=>s+v,0)/vals.length;
    const sd   = Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length) || 1;
    out[m.key] = { m: parseFloat(mean.toFixed(3)), sd: parseFloat(sd.toFixed(3)) };
  });
  return out;
}


let INITIAL_NORMS = {
  "Roster — Male (Measured)":   computeMeasuredNorms('M'),
  "Roster — Female (Measured)": computeMeasuredNorms('F'),
  "Male NCAA D1":   { power:{m:72.0,sd:4.5}, sprint10:{m:1.45,sd:0.03}, sprintFly:{m:0.98,sd:0.02}, rsi:{m:1.65,sd:0.15}, cmj:{m:11.2,sd:1.5}, broad:{m:109,sd:8.0}, rfd:{m:240,sd:20.0}, eccBrakingRFD:{m:95,sd:30}, shuttle:{m:4.15,sd:0.10} },
  "Male NCAA D2":   { power:{m:66.5,sd:4.8}, sprint10:{m:1.51,sd:0.04}, sprintFly:{m:1.04,sd:0.03}, rsi:{m:1.48,sd:0.18}, cmj:{m:10.2,sd:1.8}, broad:{m:99,sd:9.0},  rfd:{m:210,sd:22.0}, eccBrakingRFD:{m:80,sd:28}, shuttle:{m:4.32,sd:0.12} },
  "Male NCAA D3":   { power:{m:58.2,sd:5.5}, sprint10:{m:1.58,sd:0.06}, sprintFly:{m:1.12,sd:0.04}, rsi:{m:1.30,sd:0.20}, cmj:{m:9.2,sd:2.0},  broad:{m:90,sd:10.0}, rfd:{m:185,sd:25.0}, eccBrakingRFD:{m:65,sd:25}, shuttle:{m:4.48,sd:0.15} },
  "Female NCAA D1": { power:{m:54.5,sd:4.2}, sprint10:{m:1.74,sd:0.05}, sprintFly:{m:1.21,sd:0.04}, rsi:{m:1.42,sd:0.15}, cmj:{m:8.8,sd:1.4},  broad:{m:87,sd:7.0},  rfd:{m:165,sd:18.0}, eccBrakingRFD:{m:75,sd:28}, shuttle:{m:4.62,sd:0.12} },
  "Female NCAA D2": { power:{m:49.8,sd:4.5}, sprint10:{m:1.82,sd:0.06}, sprintFly:{m:1.29,sd:0.05}, rsi:{m:1.25,sd:0.16}, cmj:{m:8.1,sd:1.6},  broad:{m:80,sd:8.0},  rfd:{m:145,sd:20.0}, eccBrakingRFD:{m:60,sd:25}, shuttle:{m:4.80,sd:0.15} },
  "Female NCAA D3": { power:{m:44.5,sd:5.0}, sprint10:{m:1.90,sd:0.08}, sprintFly:{m:1.38,sd:0.06}, rsi:{m:1.10,sd:0.18}, cmj:{m:7.2,sd:1.8},  broad:{m:73,sd:9.0},  rfd:{m:125,sd:22.0}, eccBrakingRFD:{m:50,sd:22}, shuttle:{m:5.05,sd:0.20} },

};

let norms = JSON.parse(JSON.stringify(INITIAL_NORMS));
let selectedNorm = "Roster — Female (Measured)";
let currentAthlete = null;
let athleteData = {};

// ── New athlete / comparison state ──
let compareAthletes = []; // [{name, color}] max 4
let newAthleteSex = 'F';
let addPanelOpen = false;
let editMode = false;      // true = editing existing athlete, false = new
let newMeasured = {};      // per-metric measured flags in the open panel
let newCmjFD = false;     // CMJ Force Deck toggle in the open panel
const COMPARE_COLORS = ['#2dd4bf','#a78bfa','#f0c040','#fb923c'];
let measuredOnlyMode = true;
let selectedChartKeys = new Set(METRICS.map(m => m.key)); // refined in init()
let rosterSortKey = 'name';
let rosterSortDir = 1; // 1 = asc (A→Z / low→high), -1 = desc (Z→A / high→low)
let rosterVisibleCols = new Set(['cmj','power','rfd','eccBrakingRFD','rsi','sprint10','sprintFly','sprint1020','broad','shuttle']);
let collapsedCards = new Set();
let suppressEstimated = true;
let selectedChartMode = 'measured'; // 'all' | 'measured' | 'none' | 'custom'
let cardsAthleteLeft  = null;
let cardsAthleteRight = null;
let cardsNormLeft  = 'Roster — Male (Measured)';
let cardsNormRight = 'Roster — Female (Measured)';
let cardsPanelSexLeft  = 'M';
let cardsPanelSexRight = 'F';
let activeTab       = 'analytics';
let testActiveGroup = 'cmj';
let testSex         = 'M';
let testAthlete     = null;
let testNorm        = null;
let testCompare     = [];
let testRankMetric  = null;
const TEST_COMPARE_COLORS = ['#f97316','#a78bfa','#34d399','#fb7185'];
let disabledMetrics = new Set();

// ── Tunable thresholds (also persisted to coach_state when changed in Settings) ──
// Target percentile — "meeting standard" if athlete's percentile >= this.
// Used as the goal for gap calculations, the bar-target line, and the dossier hero copy.
const TARGET_PCT = 85;
// Z-score corresponding to TARGET_PCT (approx Φ⁻¹(0.85) ≈ 1.036433).
// If TARGET_PCT changes, recompute this from a normal-distribution table.
const Z_TARGET = 1.036433;
// Default tier cutoffs in descending percentile order: Elite, Advanced, Developed, Sub-optimal.
// Anything below the last entry is Critical.
const DEFAULT_TIER_THRESHOLDS = [90, 70, 40, 15];
// Default Force × Reactive matrix split — scores >= this count as "high" on each axis.
const DEFAULT_MATRIX_THRESHOLD = 50;

let tierThresholds  = [...DEFAULT_TIER_THRESHOLDS];
let matrixThreshold = DEFAULT_MATRIX_THRESHOLD;
let compactRoster   = false;
let historySmoothing = false;

// ═══════════════════════════════════════════════════════════════
// HTML ESCAPING — used wherever user-controlled strings (athlete names,
// session notes, freely-typed input) are interpolated into HTML via
// template literals. Prevents stray '<', '>', '&', quotes from breaking
// the page or injecting markup if an athlete is named e.g. "<Tom>".
// ═══════════════════════════════════════════════════════════════
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════
// TIER / MATH HELPERS
// ═══════════════════════════════════════════════════════════════
// Backwards-compat alias — Z_85 was the original name when TARGET_PCT was hardcoded to 85.
const Z_85 = Z_TARGET;
const TIERS = [
  { min:90, label:'Elite',       color:'#a78bfa', bg:'rgba(167,139,250,0.15)'  },
  { min:70, label:'Advanced',    color:'#60a5fa', bg:'rgba(96,165,250,0.15)'   },
  { min:40, label:'Developed',   color:'#34d399', bg:'rgba(52,211,153,0.15)'   },
  { min:15, label:'Sub-optimal', color:'#fb923c', bg:'rgba(251,146,60,0.15)'   },
  { min:0,  label:'Critical',    color:'#f87171', bg:'rgba(248,113,113,0.15)'  },
];
const QUADRANTS = [
  { id:'high-performer',    xHigh:true,  yHigh:true,  label:'High performer',     color:'#a78bfa', bg:'rgba(167,139,250,0.12)', border:'rgba(167,139,250,0.4)', title:'High performer',     desc:'Strong force production and well-developed elastic/reactive qualities. Athlete is near their neuromuscular ceiling.', rx:'Maintenance loading · Sport integration · Resilience work' },
  { id:'strength-deficient',xHigh:true,  yHigh:false, label:'Strength deficient', color:'#34d399', bg:'rgba(52,211,153,0.12)',  border:'rgba(52,211,153,0.4)',  title:'Strength deficient', desc:'Elastic and reactive qualities are developed, but absolute force production is the limiting factor. Maximal strength is the primary lever.', rx:'Maximal strength emphasis · Force ceiling development' },
  { id:'power-deficient',   xHigh:false, yHigh:true,  label:'Power deficient',    color:'#34d399', bg:'rgba(52,211,153,0.12)',  border:'rgba(52,211,153,0.4)',  title:'Power deficient',   desc:'Strong force foundation but elastic efficiency and reactive output are underexpressed. SSC development and reactive loading should be prioritized.', rx:'SSC efficiency training · Reactive loading · Plyometric volume' },
  { id:'underdeveloped',    xHigh:false, yHigh:false, label:'Underdeveloped',     color:'#f87171', bg:'rgba(248,113,113,0.12)', border:'rgba(248,113,113,0.4)', title:'Underdeveloped',    desc:'Both force production and elastic/reactive qualities are below threshold. GPP targeting foundational strength and basic plyometric exposure is the starting point.', rx:'General physical preparedness · Foundational strength · Basic plyometrics' },
];
const COACHING_LIB = {
  shuttle:   { title:'Change-of-direction efficiency', text:'Deceleration capacity is the primary limiter. Shift emphasis toward eccentric overload methods and repeated direction-change exposure at near-maximal intent.', methods:['Eccentric overload','Deceleration emphasis','COD at max intent','Reactive agility'] },
  sprintFly: { title:'Maximum velocity development',   text:'Top-end speed is underexpressed. Prioritize high-velocity running volume, elastic stiffness development, and reducing ground contact time at speed.',          methods:['High-velocity running','Elastic stiffness loading','Sprint mechanics','Speed endurance'] },
  rsi:       { title:'Reactive strength & SSC efficiency', text:'Tendon-muscle stiffness and SSC efficiency are limiting power output. Emphasize short-contact plyometrics with strict constraints on amortization time.',   methods:['Short-contact plyometrics','SSC efficiency work','Stiffness-based loading','Tendon conditioning'] },
  rfd:       { title:'Rate of force development',      text:'Early-phase explosive force is the primary deficit. Target neural drive through intent-based training and rapid concentric acceleration.',                        methods:['Ballistic intent training','Neural drive emphasis','Contrast loading','Early-phase RFD'] },
  eccBrakingRFD: { title:'Eccentric braking capacity', text:'Eccentric braking RFD reflects how quickly the athlete absorbs and reverses force at jump landing — a key driver of SSC efficiency. Target heavy eccentrics, accentuated-eccentric jumps, and tempo squats.', methods:['Heavy eccentric loading','Accentuated-eccentric jumps','Tempo squat work','Drop-landing absorption'] },
  sprint10:  { title:'Acceleration mechanics',         text:'Force application in initial acceleration is below norms. Prioritize horizontal force production and drive phase positional strength.',                          methods:['Resisted acceleration','Horizontal force emphasis','Drive phase mechanics','Positional strength'] },
  cmj:       { title:'Vertical power expression',      text:'CMJ height indicates a deficit in vertical power. Develop reactive power through SSC alongside eccentric loading to build the force foundation.',               methods:['Loaded jump training','SSC power development','Eccentric loading','Concentric intent'] },
  broad:     { title:'Horizontal power output',        text:'Horizontal power and projection mechanics underperforming. Develop unilateral hip extension strength and horizontal momentum generation.',                      methods:['Unilateral hip extension','Horizontal intent loading','Projection mechanics','Single-leg power'] },
  power:     { title:'Maximal strength foundation',    text:'Absolute force capacity is limiting downstream power expression. Primary intervention: raise the maximal strength ceiling through progressive bilateral overload.', methods:['Maximal strength emphasis','Progressive overload','Bilateral compound loading','Strength-first periodization'] },
};

// Plain-English one-liners used in the athlete dossier (parent/athlete-facing copy).
const METRIC_EXPLAINER = {
  power:         'Explosive force generated relative to body weight.',
  rsi:           'How efficiently you absorb and rebound from the ground — a measure of springiness.',
  rfd:           'How quickly you produce force at the start of an explosive movement.',
  eccBrakingRFD: 'How efficiently you decelerate before reversing direction.',
  cmj:           'Vertical jump height from a still position.',
  sprint10:      'How fast you reach top speed in the first 10 yards.',
  sprintFly:     'Peak running speed once already in motion.',
  sprint1020:    'How smoothly you transition from acceleration to maximum velocity.',
  broad:         'Horizontal jump distance from a standing start.',
  shuttle:       'How quickly you change direction over short distances.',
};

function getTier(p) {
  for (let i = 0; i < tierThresholds.length; i++) {
    if (p >= tierThresholds[i]) return TIERS[i];
  }
  return TIERS[TIERS.length - 1];
}
function erf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const s=x<0?-1:1; x=Math.abs(x);
  const t=1/(1+p*x);
  const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return s*y;
}
function calcPercentile(value, norm, inv) {
  const z=((value-norm.m)/(norm.sd||0.001))*(inv?-1:1);
  return Math.min(99,Math.max(1,Math.round((0.5*(1+erf(z/Math.sqrt(2))))*100)));
}

function getResults() {
  const n = norms[selectedNorm];
  return METRICS.filter(m => !disabledMetrics.has(m.key)).map(m => {
    const nd = n[m.key];
    if (!nd) return {...m, val:athleteData[m.key]||0, percentile:1, tier:getTier(1), target85:0, meetingTarget:false, suppressed:true};
    const suppressed = suppressEstimated && isEstimatedForAthlete(m.key, currentAthlete);
    const val = suppressed ? 0 : (athleteData[m.key] || 0);
    const percentile = val > 0 ? calcPercentile(val, nd, m.inv) : 1;
    const t85 = m.inv ? nd.m - Z_85*nd.sd : nd.m + Z_85*nd.sd;
    const target85 = parseFloat(t85.toFixed(m.step < 0.1 ? 2 : 1));
    const meetingTarget = m.inv ? val <= target85 : val >= target85;
    return {...m, val, percentile, tier: getTier(percentile), target85, meetingTarget, suppressed};
  });
}

function getResultsFor(athlete, normKey) {
  const n     = norms[normKey] || norms[selectedNorm];
  return METRICS.filter(m => !disabledMetrics.has(m.key)).map(m => {
    const nd = n[m.key];
    if (!nd) return {...m, val:athlete[m.key]||0, percentile:1, tier:getTier(1), target85:0, meetingTarget:false, suppressed:true};
    const suppressed = suppressEstimated && isEstimatedForAthlete(m.key, athlete);
    const val = suppressed ? 0 : (athlete[m.key] || 0);
    const percentile = val > 0 ? calcPercentile(val, nd, m.inv) : 1;
    const t85 = m.inv ? nd.m - Z_85*nd.sd : nd.m + Z_85*nd.sd;
    const target85 = parseFloat(t85.toFixed(m.step < 0.1 ? 2 : 1));
    const meetingTarget = m.inv ? val <= target85 : val >= target85;
    return {...m, val, percentile, tier: getTier(percentile), target85, meetingTarget, suppressed};
  });
}

const FORCE_WEIGHTS    = {power:0.25, rfd:0.25, cmj:0.20, sprint10:0.15, broad:0.15};
const REACTIVE_WEIGHTS = {rsi:0.40, sprintFly:0.35, shuttle:0.25};

function getZoneStyle(force, reactive) {
  const highT = 65, lowT = 30, midT = matrixThreshold;
  if (force >= highT && reactive >= highT)
    return { color:'#a78bfa', bg:'rgba(167,139,250,0.15)', border:'rgba(167,139,250,0.4)' };
  if (force < lowT && reactive < lowT)
    return { color:'#f87171', bg:'rgba(248,113,113,0.15)', border:'rgba(248,113,113,0.4)' };
  if (force >= midT && reactive >= midT)
    return { color:'#60a5fa', bg:'rgba(96,165,250,0.15)',  border:'rgba(96,165,250,0.4)'  };
  if (Math.max(force, reactive) >= midT && Math.min(force, reactive) < lowT)
    return { color:'#fb923c', bg:'rgba(251,146,60,0.15)',  border:'rgba(251,146,60,0.4)'  };
  return   { color:'#34d399', bg:'rgba(52,211,153,0.15)',  border:'rgba(52,211,153,0.4)'  };
}

function computeMatrixProfile(results) {
  function weightedScore(weights) {
    const active = Object.entries(weights).filter(([k]) => !disabledMetrics.has(k));
    if (!active.length) return 50;
    const totalW = active.reduce((s,[,w]) => s+w, 0);
    return active.reduce((s,[k,w]) => s + (results.find(r=>r.key===k)?.percentile??50) * (w/totalW), 0);
  }
  const forceScore    = weightedScore(FORCE_WEIGHTS);
  const reactiveScore = weightedScore(REACTIVE_WEIGHTS);
  const xHigh = reactiveScore >= matrixThreshold;
  const yHigh = forceScore    >= matrixThreshold;
  const baseQuadrant = QUADRANTS.find(q=>q.xHigh===xHigh&&q.yHigh===yHigh);
  const quadrant = { ...baseQuadrant, ...getZoneStyle(forceScore, reactiveScore) };
  return { forceScore, reactiveScore, xHigh, yHigh, quadrant };
}

// ═══════════════════════════════════════════════════════════════
// NEW ATHLETE + COMPARISON
// ═══════════════════════════════════════════════════════════════
function selectNewSex(s) {
  newAthleteSex = s;
  const mBtn = document.getElementById('new-sex-m');
  const fBtn = document.getElementById('new-sex-f');
  if (!mBtn || !fBtn) return;
  if (s === 'M') {
    mBtn.style.cssText = 'border-color:rgba(96,165,250,0.6);color:var(--blue);background:rgba(96,165,250,0.1);';
    fBtn.style.cssText = 'border-color:rgba(255,255,255,0.13);color:var(--text3);background:var(--bg2);';
  } else {
    fBtn.style.cssText = 'border-color:rgba(167,139,250,0.6);color:var(--purple);background:rgba(167,139,250,0.1);';
    mBtn.style.cssText = 'border-color:rgba(255,255,255,0.13);color:var(--text3);background:var(--bg2);';
  }
}

function closeAthletePanel() {
  addPanelOpen = false;
  document.getElementById('add-athlete-panel').style.display = 'none';
  document.getElementById('btn-add-athlete').style.cssText = '';
  document.getElementById('btn-edit-athlete').style.cssText = '';
}

function toggleAddPanel(wantEdit) {
  const closing = addPanelOpen && editMode === wantEdit;
  if (closing) { closeAthletePanel(); return; }
  addPanelOpen = true;
  editMode = wantEdit;
  document.getElementById('add-athlete-panel').style.display = '';
  document.getElementById('btn-add-athlete').style.borderColor = (!wantEdit) ? 'var(--gold)' : '';
  document.getElementById('btn-add-athlete').style.color      = (!wantEdit) ? 'var(--gold)' : '';
  document.getElementById('btn-edit-athlete').style.borderColor = (wantEdit) ? 'var(--gold)' : '';
  document.getElementById('btn-edit-athlete').style.color      = (wantEdit) ? 'var(--gold)' : '';
  if (wantEdit) {
    newAthleteSex = currentAthlete.sex;
    newMeasured = currentAthlete.measured ? {...currentAthlete.measured}
      : Object.fromEntries(METRICS.map(m=>[m.key, !isEstimatedForAthlete(m.key, currentAthlete)]));
    newCmjFD = !!currentAthlete.cmjFD;
  } else {
    newAthleteSex = 'F';
    newMeasured = Object.fromEntries(METRICS.map(m=>[m.key, true]));
    newCmjFD = false;
  }
  renderAthletePanel();
  selectNewSex(newAthleteSex);
}

function renderAthletePanel() {
  const LBL = 'display:block;font-size:11px;font-weight:500;color:var(--text3);margin-bottom:4px;font-family:\'DM Sans\',sans-serif;';
  const nameRow = editMode
    ? `<div style="flex:1;min-width:160px;">
        <label style="${LBL}">Athlete name</label>
        <input id="new-name" type="text" value="${(currentAthlete.name || '').replace(/"/g,'&quot;')}"
          style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:8px 10px;font-size:13px;color:var(--text);outline:none;font-family:'DM Sans',sans-serif;transition:border-color .15s;"
          onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor=''" />
       </div>`
    : `<div style="flex:1;min-width:160px;">
        <label style="${LBL}">Athlete name</label>
        <input id="new-name" type="text" placeholder="First Last"
          style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:8px 10px;font-size:13px;color:var(--text);outline:none;font-family:'DM Sans',sans-serif;transition:border-color .15s;"
          onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor=''" />
       </div>`;

  const metricCells = METRICS.map(m => {
    const isMeas = !!newMeasured[m.key];
    const val = editMode ? (currentAthlete[m.key] ?? '') : '';
    const gc = 'var(--green)', oc = 'var(--orange)';
    const sub = m.testName ? `<span class="metric-sub">${m.testName}</span>` : '';
    return `<div class="metric-field">
      <label title="${m.testName || m.label}">${m.label} <span style="color:var(--text3);font-size:10px;">(${m.unit})</span></label>
      ${sub}
      <input id="new-inp-${m.key}" type="number" step="${m.step}" value="${val}" placeholder="—"
        style="-moz-appearance:textfield;-webkit-appearance:none;"
        oninput="this.style.borderColor=this.value?'var(--teal)':'';" />
      <button id="meas-${m.key}" class="meas-toggle" onclick="togglePanelMeasured('${m.key}')"
        style="color:${isMeas?gc:oc};border-color:${isMeas?'rgba(52,211,153,.4)':'rgba(251,146,60,.4)'};">
        ${isMeas?'✓ Measured':'− Untested'}
      </button>
    </div>`;
  }).join('');

  document.getElementById('panel-inner').innerHTML = `
    <div class="card-label" style="margin-bottom:12px;">${editMode?'Edit athlete':'New athlete'}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end;">
      ${nameRow}
      <div>
        <label style="${LBL}">Sex</label>
        <div style="display:flex;gap:6px;">
          <button id="new-sex-m" class="btn" onclick="selectNewSex('M')">♂ Male</button>
          <button id="new-sex-f" class="btn" onclick="selectNewSex('F')">♀ Female</button>
        </div>
      </div>
    </div>
    <div class="metric-grid">${metricCells}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap;">
      <span style="font-size:11px;font-weight:500;color:var(--text3);font-family:'DM Sans',sans-serif;">CMJ source</span>
      <button id="panel-cmjfd-btn" onclick="togglePanelCmjFD()"
        style="font-size:11px;font-family:'DM Mono',monospace;padding:5px 14px;border-radius:8px;border:1px solid ${newCmjFD?'rgba(52,211,153,.4)':'rgba(255,255,255,.13)'};background:${newCmjFD?'rgba(52,211,153,.08)':'var(--bg2)'};color:${newCmjFD?'var(--green)':'var(--text3)'};cursor:pointer;transition:all .15s;">
        ${newCmjFD?'✓ Force Deck':'~ Standard sensor'}
      </button>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
      <button class="btn" onclick="saveAthletePanel()"
        style="background:rgba(240,192,64,0.1);border-color:rgba(240,192,64,0.4);color:var(--gold);">
        ✓ ${editMode?'Update athlete':'Save &amp; load'}
      </button>
      <button class="btn" onclick="closeAthletePanel()">Cancel</button>
    </div>`;
}

function togglePanelMeasured(key) {
  newMeasured[key] = !newMeasured[key];
  const btn = document.getElementById('meas-'+key);
  const on = newMeasured[key];
  btn.style.color = on ? 'var(--green)' : 'var(--orange)';
  btn.style.borderColor = on ? 'rgba(52,211,153,.4)' : 'rgba(251,146,60,.4)';
  btn.textContent = on ? '✓ Measured' : '− Untested';
}

function togglePanelCmjFD() {
  newCmjFD = !newCmjFD;
  const btn = document.getElementById('panel-cmjfd-btn');
  if (!btn) return;
  btn.style.borderColor = newCmjFD ? 'rgba(52,211,153,.4)' : 'rgba(255,255,255,.13)';
  btn.style.background  = newCmjFD ? 'rgba(52,211,153,.08)' : 'var(--bg2)';
  btn.style.color       = newCmjFD ? 'var(--green)' : 'var(--text3)';
  btn.textContent       = newCmjFD ? '✓ Force Deck' : '~ Standard sensor';
}

function saveAthletePanel() {
  if (editMode) {
    const newName = (document.getElementById('new-name').value || '').trim();
    if (!newName) { alert('Name cannot be empty.'); return; }
    const oldName = currentAthlete.name;
    const nameChanged = newName !== oldName;
    if (nameChanged && ATHLETE_DB.some(a => a !== currentAthlete && a.name === newName)) {
      alert('Another athlete already has that name.'); return;
    }
    METRICS.forEach(m => {
      const raw = document.getElementById('new-inp-'+m.key).value;
      const val = parseFloat(raw);
      if (!isNaN(val) && raw !== '') { currentAthlete[m.key] = val; athleteData[m.key] = val; }
      if (!currentAthlete.measured) currentAthlete.measured = {};
      currentAthlete.measured[m.key] = !!newMeasured[m.key];
    });
    currentAthlete.name = newName;
    currentAthlete.sex = newAthleteSex;
    currentAthlete.cmjFD = newCmjFD;
    athleteData = {...currentAthlete};
    if (nameChanged) {
      rebuildAthleteSelect();
      const sel = document.getElementById('athlete-select');
      if (sel) sel.value = newName;
    }
    rebuildNormSelect();
    const sb = document.getElementById('sex-badge');
    sb.textContent = currentAthlete.sex==='M'?'♂ Male':'♀ Female';
    sb.className = 'sex-badge '+(currentAthlete.sex==='M'?'male':'female');
    closeAthletePanel();
    renderAll(true);
    if (currentAthlete._supabase_id) {
      renameAthleteInSupabase(currentAthlete._supabase_id, newName, currentAthlete.sex);
      const mm = {};
      METRICS.forEach(m => { if (currentAthlete[m.key]) mm[m.key] = { value: currentAthlete[m.key], source: currentAthlete.measured && currentAthlete.measured[m.key] ? 'manual' : 'estimated' }; });
      saveSessionToSupabase(currentAthlete, mm);
    }
  } else {
    const name = document.getElementById('new-name').value.trim();
    if (!name) { alert('Please enter a name.'); return; }
    const measured = Object.fromEntries(METRICS.map(m=>[m.key, !!newMeasured[m.key]]));
    const athlete = { name, sex: newAthleteSex, custom: true, measured, cmjFD: newCmjFD };
    METRICS.forEach(m => {
      const raw = document.getElementById('new-inp-'+m.key).value;
      athlete[m.key] = parseFloat(raw) || 0;
    });
    const existIdx = ATHLETE_DB.findIndex(a=>a.name===name&&a.custom);
    if (existIdx >= 0) ATHLETE_DB.splice(existIdx, 1);
    ATHLETE_DB.push(athlete);
    insertAthleteToSupabase(athlete).then(() => {});
    rebuildAthleteSelect();
    document.getElementById('athlete-select').value = name;
    closeAthletePanel();
    onAthleteChange();
  }
}

async function deleteAthlete(name) {
  if (ATHLETE_DB.length <= 1) { alert('Cannot delete the last athlete.'); return; }
  const idx = ATHLETE_DB.findIndex(a=>a.name===name);
  if (idx < 0) return;
  const athlete = ATHLETE_DB[idx];
  const sessionCount = (athlete._sessions || []).length;
  const detail = sessionCount > 0
    ? ` This will also delete ${sessionCount} session${sessionCount===1?'':'s'} of measurement history.`
    : '';
  if (!confirm(`Permanently delete "${name}" from the database?${detail} This cannot be undone.`)) return;

  // Delete from Supabase first if the athlete has a server-side row
  if (athlete._supabase_id) {
    try {
      // Sessions cascade to measurements (matches the existing session-delete pattern)
      await fetch(SUPABASE_URL + '/rest/v1/sessions?athlete_id=eq.' + athlete._supabase_id, {
        method: 'DELETE', headers: SUPABASE_HEADERS,
      });
      const resp = await fetch(SUPABASE_URL + '/rest/v1/athletes?id=eq.' + athlete._supabase_id, {
        method: 'DELETE', headers: SUPABASE_HEADERS,
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
    } catch(e) {
      console.error('Supabase athlete delete error:', e);
      alert(`Failed to delete "${name}" from the database. Athlete remains in roster. See console for details.`);
      return;
    }
  }

  // Local state
  ATHLETE_DB.splice(idx, 1);
  compareAthletes = compareAthletes.filter(c=>c.name!==name);
  if (currentAthlete.name === name) {
    currentAthlete = ATHLETE_DB[0];
    athleteData = {...currentAthlete};
    rebuildAthleteSelect();
    document.getElementById('athlete-select').value = currentAthlete.name;
    rebuildNormSelect();
    renderCompareStrip();
    renderAll(true);
  } else {
    rebuildAthleteSelect();
    renderCompareStrip();
  }
  // Recompute roster norms since the cohort changed
  rebuildInitialNorms();
  renderRosterTable();
  if (typeof showToast === 'function') showToast('Deleted ' + name);
}

function rebuildAthleteSelect() {
  const asel = document.getElementById('athlete-select');
  asel.innerHTML = '';
  [...ATHLETE_DB].sort((a,b)=>a.name.localeCompare(b.name)).forEach(a=>{
    const o = document.createElement('option');
    o.value = a.name;
    o.textContent = `${hasAllMeasured(a)?'● ':''}${a.name} (${a.sex})${a.custom?' ✦':''}`;
    if (hasAllMeasured(a)) o.style.color = '#34d399';
    asel.appendChild(o);
  });
}

function rebuildNormSelect() {
  const sex = currentAthlete ? currentAthlete.sex : 'F';
  const word = sex === 'M' ? 'Male' : 'Female';
  const nsel = document.getElementById('norm-select');
  if (!nsel) return;
  const cur = nsel.value;
  nsel.innerHTML = '';
  Object.keys(INITIAL_NORMS)
    .filter(k => k.includes(word))
    .forEach(k => {
      const o = document.createElement('option');
      o.value = k; o.textContent = k;
      nsel.appendChild(o);
    });
  // Keep current selection if still valid, otherwise default to roster norm
  nsel.value = nsel.querySelector(`option[value="${CSS.escape(cur)}"]`) ? cur
    : `Roster — ${word} (Measured)`;
  selectedNorm = nsel.value;
}

function addComparePick() {
  const sel = document.getElementById('compare-select');
  const name = sel.value;
  if (!name || compareAthletes.find(c=>c.name===name)) return;
  if (compareAthletes.length >= 4) return;
  compareAthletes.push({ name, color: COMPARE_COLORS[compareAthletes.length] });
  renderCompareStrip();
  renderAll(false);
}

function removeCompareAthlete(name) {
  compareAthletes = compareAthletes.filter(c=>c.name!==name);
  compareAthletes.forEach((c,i)=>c.color=COMPARE_COLORS[i]);
  renderCompareStrip();
  renderAll(false);
}

function renderCompareStrip() {
  const sel = document.getElementById('compare-select');
  sel.innerHTML = '<option value="">— pick athlete —</option>';
  ATHLETE_DB
    .filter(a=>a.name!==currentAthlete.name && a.sex===currentAthlete.sex && !compareAthletes.find(c=>c.name===a.name))
    .sort((a,b)=>a.name.localeCompare(b.name))
    .forEach(a=>{
      const o = document.createElement('option');
      o.value = a.name;
      o.textContent = `${hasAllMeasured(a)?'● ':''}${a.name} (${a.sex})${a.custom?' ✦':''}`;
      if (hasAllMeasured(a)) o.style.color = '#34d399';
      sel.appendChild(o);
    });
  const chips = document.getElementById('compare-chips');
  if (compareAthletes.length === 0) {
    chips.innerHTML = '<span style="font-size:11px;color:var(--text3);font-family:\'DM Mono\',monospace;">Select an athlete above to compare percentiles on the bar chart</span>';
  } else {
    chips.innerHTML = compareAthletes.map(c=>
      `<div class="athlete-chip active" style="border-color:${c.color}55;color:${c.color};background:${c.color}14;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0;"></span>
        ${escapeHtml(c.name)}
        <span onclick="removeCompareAthlete('${c.name.replace(/'/g,"\\'")}');" style="cursor:pointer;font-size:14px;line-height:1;margin-left:2px;opacity:0.6;" title="Remove">×</span>
      </div>`
    ).join('');
  }
  renderCompareTable();
}

function renderCompareTable() {
  const el = document.getElementById('compare-table');
  if (compareAthletes.length === 0) { el.style.display = 'none'; return; }
  el.style.display = '';
  const n = norms[selectedNorm];
  const cmpAthletes = compareAthletes.map(c => ATHLETE_DB.find(x => x.name === c.name)).filter(Boolean);

  // header row
  const nameCell = (a, color) =>
    `<th style="padding:6px 8px;font-size:11px;font-family:'DM Mono',monospace;font-weight:700;text-align:right;border-bottom:2px solid ${color};color:${color};white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis;">${a.name.split(' ')[0]}<br><span style="font-weight:400;opacity:.7;font-size:9px;">${a.name.split(' ').slice(1).join(' ')}</span></th>`;
  const diffHead = (color) =>
    `<th style="padding:6px 8px;font-size:12px;font-family:'DM Sans',sans-serif;font-weight:600;text-align:right;border-bottom:2px solid ${color};color:${color};opacity:.7;">Diff</th>`;

  let headCols = `<th style="padding:6px 8px 6px 0;font-size:12px;font-family:'DM Sans',sans-serif;font-weight:600;color:var(--text3);border-bottom:2px solid var(--border2);text-align:left;">Metric</th>`;
  headCols += `<th style="padding:6px 8px;font-size:11px;font-family:'DM Mono',monospace;font-weight:700;text-align:right;border-bottom:2px solid rgba(255,255,255,0.25);color:var(--text1);white-space:nowrap;">${currentAthlete.name.split(' ')[0]}<br><span style="font-weight:400;opacity:.7;font-size:9px;">${currentAthlete.name.split(' ').slice(1).join(' ')}</span></th>`;
  cmpAthletes.forEach((a, i) => {
    const col = compareAthletes[i].color;
    headCols += nameCell(a, col) + diffHead(col);
  });

  const rows = METRICS.filter(m => !disabledMetrics.has(m.key)).map(m => {
    const curVal = athleteData[m.key] || 0;
    const d = m.step < 0.1 ? 2 : 1;
    const curTier = getTier(calcPercentile(curVal, n[m.key], m.inv));
    const curEst = isEstimatedForAthlete(m.key, currentAthlete);
    const estDot = '';

    let cols = `<td style="padding:6px 8px 6px 0;border-bottom:1px solid var(--border);font-size:12px;font-weight:500;color:var(--text3);font-family:'DM Sans',sans-serif;white-space:nowrap;">${m.label}${estDot}</td>`;
    const curDisplay = curVal > 0
      ? `<span style="font-size:13px;font-weight:800;font-family:'DM Mono',monospace;color:${curTier.color};background:${curTier.bg};padding:2px 7px;border-radius:5px;">${curVal.toFixed(d)}</span><span style="font-size:8px;color:var(--text3);margin-left:2px;">${m.unit}</span>`
      : `<span style="color:var(--text3);font-size:12px;">—</span>`;
    cols += `<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${curDisplay}</td>`;

    cmpAthletes.forEach((a, i) => {
      const col = compareAthletes[i].color;
      const cmpEst = isEstimatedForAthlete(m.key, a);
      const cmpSuppressed = suppressEstimated && cmpEst;
      const cmpVal = cmpSuppressed ? 0 : (a[m.key] || 0);
      const cmpTier = getTier(calcPercentile(cmpVal, n[m.key], m.inv));
      const cmpEstDot = '';
      const cmpDisplay = cmpVal > 0
        ? `<span style="font-size:13px;font-weight:800;font-family:'DM Mono',monospace;color:${cmpTier.color};background:${cmpTier.bg};padding:2px 7px;border-radius:5px;">${cmpVal.toFixed(d)}</span><span style="font-size:8px;color:var(--text3);margin-left:2px;">${m.unit}</span>${cmpEstDot}`
        : `<span style="color:var(--text3);font-size:12px;opacity:${cmpSuppressed?'0.35':'1'};">—</span>`;
      cols += `<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${cmpDisplay}</td>`;

      // diff: positive = current athlete is BETTER (accounting for inv)
      let diffHtml;
      const curEffective = (suppressEstimated && isEstimatedForAthlete(m.key, currentAthlete)) ? 0 : curVal;
      if (curEffective > 0 && cmpVal > 0) {
        const rawDiff = m.inv ? (cmpVal - curEffective) : (curEffective - cmpVal);
        const prefix = rawDiff > 0 ? '+' : '';
        const diffColor = rawDiff > 0.001 ? '#34d399' : rawDiff < -0.001 ? '#f87171' : 'var(--text3)';
        diffHtml = `<span style="font-size:11px;font-weight:700;font-family:'DM Mono',monospace;color:${diffColor};">${prefix}${rawDiff.toFixed(d)}</span>`;
      } else {
        diffHtml = `<span style="color:var(--text3);font-size:11px;">—</span>`;
      }
      cols += `<td style="padding:6px 0 6px 4px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${diffHtml}</td>`;
    });

    return `<tr>${cols}</tr>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;margin-bottom:8px;letter-spacing:.04em;">
      ATHLETE COMPARISON &nbsp;·&nbsp; Diff = current vs compared &nbsp;·&nbsp; <span style="color:#34d399;">green = current leads</span> &nbsp;·&nbsp; <span style="color:#f87171;">red = compared leads</span>
    </div>
    <div class="tbl-scroll">
      <table style="width:100%;border-collapse:collapse;min-width:360px;">
        <thead><tr>${headCols}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════
function switchTab(tab) {
  activeTab = tab;
  ['analytics','roster','leaderboard','coaches','flags','cards','tests','history','settings'].forEach(t => {
    const pane = document.getElementById('pane-'+t);
    const btn  = document.getElementById('tab-'+t);
    if (!pane || !btn) return;
    pane.style.display = t===tab ? '' : 'none';
    if (t === tab) {
      pane.classList.remove('tab-fade-in');
      void pane.offsetWidth;
      pane.classList.add('tab-fade-in');
    }
    btn.className = 'tab-btn'+(t===tab?' active':'');
  });
  if (tab==='roster')      renderRosterTable();
  if (tab==='leaderboard') renderLeaderboard();
  if (tab==='coaches')     renderCoachesPage();
  if (tab==='flags')       renderFlags();
  if (tab==='cards')       renderCardsTab();
  if (tab==='settings')    renderSettings();
  if (tab==='tests')       renderTestsTab();
  if (tab==='history')     renderHistoryTab();
  saveState();
}

// ═══════════════════════════════════════════════════════════════
// ATHLETE SELECTOR
// ═══════════════════════════════════════════════════════════════
function updateAthleteAvatar(athlete) {
  const el = document.getElementById('athlete-avatar');
  if (!el || !athlete) return;
  const parts = athlete.name.trim().split(/\s+/);
  const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length-1][0] : parts[0].slice(0,2);
  const col = athlete.sex === 'M' ? 'var(--blue)' : 'var(--purple)';
  el.textContent = initials.toUpperCase();
  el.style.color = col;
  el.style.borderColor = col;
  el.style.background = athlete.sex === 'M' ? 'rgba(96,165,250,0.10)' : 'rgba(167,139,250,0.10)';

  // Athlete-header name display
  const nameEl = document.getElementById('athlete-name');
  if (nameEl) nameEl.textContent = athlete.name;
}

function updateNormDisplay() {
  const el = document.getElementById('norm-display');
  if (el) el.textContent = selectedNorm || '—';
}

function onAthleteChange() {
  const name = document.getElementById('athlete-select').value;
  currentAthlete = ATHLETE_DB.find(a=>a.name===name);
  athleteData = {...currentAthlete};
  compareAthletes = compareAthletes.filter(c=>c.name!==name && ATHLETE_DB.find(a=>a.name===c.name)?.sex===currentAthlete.sex);
  compareAthletes.forEach((c,i)=>c.color=COMPARE_COLORS[i]);
  rebuildNormSelect();
  updateAthleteAvatar(currentAthlete);
  renderCompareStrip();
  renderAll(true);
}

function onNormChange() {
  selectedNorm = document.getElementById('norm-select').value;
  renderAll(false);
}

function onInput(key, val) {
  athleteData[key] = parseFloat(val) || 0;
  if (!athleteData.measured) athleteData.measured = {};
  athleteData.measured[key] = true;
  renderAll(false);
}
function resetNorms() { norms = JSON.parse(JSON.stringify(INITIAL_NORMS)); renderAll(false); }

// ═══════════════════════════════════════════════════════════════
// RENDER — input grid
// ═══════════════════════════════════════════════════════════════
function renderInputGrid() {
  document.getElementById('input-grid').innerHTML = METRICS
    .filter(m => !disabledMetrics.has(m.key))
    .map(m => {
      const isEst = isEstimated(m.key);
      const sub = m.testName ? `<span class="metric-sub">${m.testName}</span>` : '';
      return `<div class="metric-field ${isEst?'estimated':''}">
        <label title="${m.testName || m.label}">${m.label} <span style="color:var(--text3);font-size:10px;">(${m.unit})</span></label>
        ${sub}
        <input id="inp-${m.key}" type="number" step="${m.step}" value="${athleteData[m.key]}" oninput="onInput('${m.key}',this.value)" />
      </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
// RENDER — summary cards
// ═══════════════════════════════════════════════════════════════
function renderSummaryCards(results, matrix) {
  const avg = Math.round(results.reduce((a,r)=>a+r.percentile,0)/results.length);
  const tier = getTier(avg);
  document.getElementById('composite-score').textContent = avg;
  const tb = document.getElementById('composite-tier');
  tb.textContent = tier.label;
  tb.style.cssText = `background:${tier.bg};color:${tier.color};font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:none;padding:3px 10px;border-radius:20px;`;

  // Strongest / Priority cards only consider measured metrics with real data —
  // estimated and missing metrics shouldn't claim the spotlight.
  const measuredOnly = results.filter(r => !r.suppressed && r.val > 0 && !isEstimated(r.key));
  const sorted = [...measuredOnly].sort((a,b)=>b.percentile-a.percentile);
  const top = sorted[0], low = sorted[sorted.length-1];

  const fmtVal = r => {
    if (!r || r.val == null || r.val <= 0) return '—';
    const d = r.step < 0.1 ? 2 : 1;
    const num = r.val.toFixed(d);
    return r.unit
      ? `${num}<span style="font-size:0.42em;opacity:0.6;font-weight:600;font-style:normal;margin-left:5px;">${r.unit}</span>`
      : num;
  };

  document.getElementById('top-percentile').innerHTML = top ? fmtVal(top) : '—';
  document.getElementById('top-metric').textContent   = top ? top.label : 'No measured metrics';
  document.getElementById('low-percentile').innerHTML = low ? fmtVal(low) : '—';
  document.getElementById('low-metric').textContent   = low ? low.label : 'No measured metrics';

  const q = matrix.quadrant;
  const lbl = document.getElementById('fv-profile-label');
  lbl.textContent = q.label; lbl.style.color = q.color;

  const fScore = Math.round(matrix.forceScore);
  const rScore = Math.round(matrix.reactiveScore);
  const fTier  = getTier(fScore);
  const rTier  = getTier(rScore);
  document.getElementById('fv-profile-desc').innerHTML =
    `<div style="display:flex;flex-direction:column;gap:5px;width:100%;">
       <div style="display:flex;align-items:center;gap:7px;">
         <span style="font-size:10px;color:var(--text3);font-family:'DM Sans',sans-serif;width:58px;text-align:right;flex-shrink:0;">Force</span>
         <div style="flex:1;height:5px;background:var(--bg3);border-radius:3px;overflow:hidden;">
           <div style="height:100%;width:${fScore}%;background:${fTier.color};border-radius:3px;"></div>
         </div>
         <span style="font-size:11px;font-weight:700;font-family:'DM Mono',monospace;color:${fTier.color};width:28px;">${fScore}</span>
       </div>
       <div style="display:flex;align-items:center;gap:7px;">
         <span style="font-size:10px;color:var(--text3);font-family:'DM Sans',sans-serif;width:58px;text-align:right;flex-shrink:0;">Reactive</span>
         <div style="flex:1;height:5px;background:var(--bg3);border-radius:3px;overflow:hidden;">
           <div style="height:100%;width:${rScore}%;background:${rTier.color};border-radius:3px;"></div>
         </div>
         <span style="font-size:11px;font-weight:700;font-family:'DM Mono',monospace;color:${rTier.color};width:28px;">${rScore}</span>
       </div>
     </div>`;

  const sb = document.getElementById('sex-badge');
  sb.textContent = currentAthlete.sex === 'M' ? '♂ Male' : '♀ Female';
  sb.className = 'sex-badge ' + (currentAthlete.sex==='M'?'male':'female');
}

// ═══════════════════════════════════════════════════════════════
// RENDER — bar chart
// ═══════════════════════════════════════════════════════════════
function toggleMeasuredOnly() {
  measuredOnlyMode = !measuredOnlyMode;
  // keep master suppress switch in sync
  suppressEstimated = measuredOnlyMode;
  selectedChartMode = measuredOnlyMode ? 'measured' : 'all';
  if (measuredOnlyMode) {
    selectedChartKeys = new Set(METRICS.filter(m => !disabledMetrics.has(m.key) && !isEstimatedForAthlete(m.key, currentAthlete)).map(m => m.key));
  } else {
    selectedChartKeys = new Set(METRICS.filter(m => !disabledMetrics.has(m.key)).map(m => m.key));
  }
  syncSuppressButtons();
  renderRosterTable();
  renderAll(false);
}

function setChartMode(mode) {
  selectedChartMode = mode;
  if (mode === 'all') {
    selectedChartKeys = new Set(METRICS.filter(m => !disabledMetrics.has(m.key)).map(m => m.key));
  } else if (mode === 'measured') {
    selectedChartKeys = new Set(METRICS.filter(m => !disabledMetrics.has(m.key) && !isEstimatedForAthlete(m.key, currentAthlete)).map(m => m.key));
  } else if (mode === 'none') {
    selectedChartKeys = new Set();
  }
  renderSelectedChart();
}

function syncChartModeButtons() {
  ['all', 'measured', 'none'].forEach(mode => {
    const btn = document.getElementById('chart-mode-' + mode);
    if (!btn) return;
    const active = selectedChartMode === mode;
    btn.style.background  = active ? 'rgba(52,211,153,0.12)'  : 'var(--bg2)';
    btn.style.borderColor = active ? 'rgba(52,211,153,0.45)'  : 'rgba(255,255,255,0.13)';
    btn.style.color       = active ? 'var(--green)'           : 'var(--text3)';
  });
}

function toggleSelectedMetric(key) {
  selectedChartMode = 'custom';
  if (selectedChartKeys.has(key)) selectedChartKeys.delete(key);
  else selectedChartKeys.add(key);
  renderSelectedChart();
}

function renderSelectedChart() {
  syncChartModeButtons();
  const results = getResults();

  document.getElementById('selected-chart-chips').innerHTML = METRICS
    .filter(m => !disabledMetrics.has(m.key))
    .map(m => {
      const active = selectedChartKeys.has(m.key);
      const est = isEstimatedForAthlete(m.key, currentAthlete);
      const estDot = '';
      return `<button onclick="toggleSelectedMetric('${m.key}')"
        style="padding:4px 11px;border-radius:12px;cursor:pointer;font-size:11px;font-family:'DM Mono',monospace;
               border:1px solid ${active ? 'rgba(96,165,250,0.5)' : 'rgba(255,255,255,0.1)'};
               background:${active ? 'rgba(96,165,250,0.1)' : 'var(--bg2)'};
               color:${active ? 'var(--blue)' : 'var(--text3)'};">${m.label}${estDot}</button>`;
    }).join('');

  const filtered = results.filter(r => selectedChartKeys.has(r.key));
  const sorted = [...filtered].sort((a, b) => b.percentile - a.percentile);

  document.getElementById('selected-bar-chart').innerHTML = sorted.length === 0
    ? '<div style="color:var(--text3);font-size:12px;padding:16px 0;font-family:\'DM Mono\',monospace;">No metrics selected</div>'
    : sorted.map(r => {
        const estMark = '';
        const isCmjNonFD = r.key==='cmj' && currentAthlete && !currentAthlete.cmjFD;
        const cmjMark = isCmjNonFD ? '<span style="color:var(--gold);font-size:9px;margin-left:2px;" title="Non-Force-Deck CMJ">†</span>' : '';
        const dec2 = r.step < 0.1 ? 2 : 1;
        const rawD2 = r.val > 0 ? `${r.val.toFixed(dec2)} ${r.unit}` : 'no data';
        return `<div class="bar-row has-tip" data-tip="${r.label}|${rawD2}|${r.percentile}th pct|85th: ${r.target85} ${r.unit}">
          <div class="bar-name" title="${r.testName || r.label}">${r.label}${estMark}${cmjMark}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${r.percentile}%;background:${r.tier.color};"></div>
            <div class="bar-target" style="left:85%;background:${targetLineColor(r.percentile)};"></div>
          </div>
          <div class="bar-pct" style="color:${r.tier.color};">${r.percentile}%</div>
          <div class="bar-badge"><span class="tier-badge" style="background:${r.tier.bg};color:${r.tier.color};">${r.tier.label}</span></div>
          ${makeTrendBadge(currentAthlete, r.key)}
        </div>`;
      }).join('');
}

function targetLineColor(pct) {
  if (pct >= 90) return '#a78bfa';
  if (pct >= 85) return '#34d399';
  if (pct >= 70) return '#60a5fa';
  if (pct >= 50) return '#f0c040';
  if (pct >= 30) return '#fb923c';
  return '#f87171';
}

function getTrendForMetric(athlete, key) {
  const sessions = [...(athlete._sessions || [])].sort((a,b) => b.session_date.localeCompare(a.session_date));
  const vals = [];
  for (const s of sessions) {
    const meas = (s.measurements || []).find(m => m.metric === key);
    if (meas) { const v = parseFloat(meas.value); if (v) { vals.push(v); if (vals.length === 2) break; } }
  }
  if (vals.length < 2) return null;
  const [latest, prev] = vals;
  return { delta: INVERSE_METRICS.has(key) ? prev - latest : latest - prev, latest, prev };
}

function makeTrendBadge(athlete, key) {
  const trend = getTrendForMetric(athlete, key);
  if (!trend) return '<div style="width:52px;flex-shrink:0;"></div>';
  const mDef = METRICS.find(m => m.key === key);
  const d = mDef && mDef.step < 0.1 ? 2 : 1;
  const abs = Math.abs(trend.delta).toFixed(d);
  const improved = trend.delta > 0.0009;
  const declined = trend.delta < -0.0009;
  const arrow = improved ? '↑' : declined ? '↓' : '→';
  const color = improved ? 'var(--green)' : declined ? 'var(--red)' : 'var(--text3)';
  return `<div style="width:52px;flex-shrink:0;text-align:right;font-size:10px;font-weight:700;font-family:'DM Mono',monospace;color:${color};white-space:nowrap;" title="vs prior session: ${trend.prev.toFixed(d)} → ${trend.latest.toFixed(d)}">${arrow}<span style="font-size:9px;"> ${abs}</span></div>`;
}

function renderBarChart(results) {
  const displayResults = measuredOnlyMode ? results.filter(r => !isEstimated(r.key)) : results;
  const sorted = [...displayResults].sort((a,b)=>b.percentile-a.percentile);

  document.getElementById('bar-chart').innerHTML = sorted.map(r => {
    const estMark = '';
    const isCmjNonFD = r.key==='cmj' && currentAthlete && !currentAthlete.cmjFD;
    const cmjMark = isCmjNonFD ? '<span style="color:var(--gold);font-size:9px;margin-left:2px;" title="Non-Force-Deck CMJ">†</span>' : '';
    const dec = r.step < 0.1 ? 2 : 1;
    const hasData = r.val > 0;
    const rawDisplay = hasData ? `${r.val.toFixed(dec)} ${r.unit}` : 'no data';
    if (!hasData) {
      return `<div class="bar-row has-tip" style="opacity:0.55;" data-tip="${r.label}|no data|—|85th: ${r.target85} ${r.unit}">
        <div class="bar-name" title="${r.testName || r.label}" style="color:var(--text3);">${r.label}</div>
        <div class="bar-track" style="background:transparent;border:1px dashed var(--border2);"></div>
        <div class="bar-pct" style="color:var(--text3);">—</div>
        <div class="bar-badge"><span class="tier-badge" style="background:var(--bg3);color:var(--text3);">Test required</span></div>
      </div>`;
    }
    return `<div class="bar-row has-tip" data-tip="${r.label}|${rawDisplay}|${r.percentile}th pct|85th: ${r.target85} ${r.unit}">
      <div class="bar-name" title="${r.testName || r.label}">${r.label}${estMark}${cmjMark}</div>
      <div class="bar-track">
        <div class="bar-marker" style="left:25%;"></div>
        <div class="bar-marker" style="left:50%;"></div>
        <div class="bar-marker" style="left:75%;"></div>
        <div class="bar-fill" style="width:${r.percentile}%;background:${r.tier.color};"></div>
        <div class="bar-target" style="left:85%;background:${targetLineColor(r.percentile)};"></div>
      </div>
      <div class="bar-pct" style="color:${r.tier.color};">${r.percentile}%</div>
      <div class="bar-badge"><span class="tier-badge" style="background:${r.tier.bg};color:${r.tier.color};">${r.tier.label}</span></div>
      ${makeTrendBadge(currentAthlete, r.key)}
    </div>`;
  }).join('');

  document.getElementById('tier-legend').innerHTML =
    TIERS.map(t=>`<div class="legend-item"><div class="legend-dot" style="background:${t.color};"></div>${t.label}</div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// RENDER — readiness gauges
// ═══════════════════════════════════════════════════════════════
function renderMatrix(matrix) {
  const forceScore    = Math.round(matrix.forceScore);
  const reactiveScore = Math.round(matrix.reactiveScore);
  const forceTier     = getTier(forceScore);
  const reactiveTier  = getTier(reactiveScore);
  const qDef          = matrix.quadrant;

  function gauge(label, score, tier) {
    return `
      <div style="margin-bottom:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:13px;font-weight:600;letter-spacing:0;font-family:'DM Sans',sans-serif;color:var(--text2);">${label}</div>
          <div style="display:flex;align-items:center;gap:9px;">
            <span style="font-size:26px;font-weight:900;font-family:'Barlow Condensed',sans-serif;font-style:italic;color:${tier.color};line-height:1;">${score}<span style="font-size:11px;opacity:0.55;font-style:normal;font-weight:600;">th</span></span>
            <span class="tier-badge" style="background:${tier.bg};color:${tier.color};">${tier.label}</span>
          </div>
        </div>
        <div style="height:10px;background:var(--bg3);border-radius:5px;overflow:hidden;position:relative;">
          <div class="gauge-bar-fill" data-w="${score}" style="height:100%;width:0%;background:linear-gradient(90deg,${tier.color}99,${tier.color});border-radius:5px;transition:width 0.6s cubic-bezier(.4,0,.2,1);box-shadow:0 0 10px ${tier.color}55;"></div>
        </div>
      </div>`;
  }

  document.getElementById('matrix-gauges').innerHTML =
    gauge('Force Production', forceScore, forceTier) +
    gauge('Elastic / Reactive', reactiveScore, reactiveTier);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.gauge-bar-fill').forEach(el => { el.style.width = el.dataset.w + '%'; });
  }));

  const card = document.getElementById('matrix-zone-card');
  card.style.background   = qDef.bg;
  card.style.borderColor  = qDef.border;
  card.innerHTML = `<div class="maz-title" style="color:${qDef.color};">${qDef.title}</div>
    <div class="maz-desc">${qDef.desc}</div>
    <div class="maz-rx" style="color:${qDef.color};">Recommended focus → <span style="opacity:0.7;font-weight:500;text-transform:none;">${qDef.rx}</span></div>`;
}

// ═══════════════════════════════════════════════════════════════
// REPORT MODAL + CARDS TAB
// ═══════════════════════════════════════════════════════════════
function buildReportCardHTML(athlete, normKey) {
  const results = getResultsFor(athlete, normKey);
  const matrix  = computeMatrixProfile(results);
  const q       = matrix.quadrant;
  const avg     = Math.round(results.reduce((a,r)=>a+r.percentile,0)/results.length);
  const tier    = getTier(avg);
  const sortedR = [...results].filter(r=>!r.suppressed).sort((a,b)=>a.percentile-b.percentile);

  const metricsHTML = results.map(r => {
    if (r.suppressed || r.val<=0) return `<div class="report-metric-row">
      <div class="report-metric-name">${r.label}</div>
      <div class="report-metric-val" style="color:var(--text3);">—</div>
      <div class="report-metric-pct" style="color:var(--text3);">—</div>
      <span class="tier-badge" style="background:var(--bg3);color:var(--text3);font-size:9px;">N/A</span>
    </div>`;
    const isCmjNonFD = r.key==='cmj' && !athlete.cmjFD;
    const valColor = isCmjNonFD ? 'var(--gold)' : r.tier.color;
    const cmjNote = isCmjNonFD ? '<sup style="font-size:8px;opacity:0.8;">†</sup>' : '';
    return `<div class="report-metric-row">
      <div class="report-metric-name">${r.label}</div>
      <div class="report-metric-val" style="color:${valColor};">${r.val} ${r.unit}${cmjNote}</div>
      <div class="report-metric-pct" style="color:${r.tier.color};">${r.percentile}th</div>
      <span class="tier-badge" style="background:${r.tier.bg};color:${r.tier.color};font-size:9px;">${r.tier.label}</span>
    </div>`;
  }).join('');

  const coachingRecs = sortedR.slice(0,2).map(r => {
    const c = COACHING_LIB[r.key] || {title:r.label, text:'Continued development indicated.', methods:[]};
    return `<div style="padding:9px 11px;background:var(--bg3);border-radius:var(--radius-md);margin-bottom:6px;border:1px solid var(--border);">
      <div style="font-size:13px;font-weight:600;font-family:'DM Sans',sans-serif;color:var(--orange);margin-bottom:4px;">${c.title}</div>
      <div style="font-size:11px;color:var(--text2);line-height:1.55;">${c.text}</div>
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${c.methods.map(m=>`<span class="tier-badge" style="background:rgba(251,146,60,0.1);color:var(--orange);font-size:9px;">${m}</span>`).join('')}</div>
    </div>`;
  }).join('');

  return `
    <div class="report-header">
      <div>
        <div class="report-name">${escapeHtml(athlete.name)}</div>
        <div class="report-meta">${athlete.sex==='M'?'Male':'Female'} &nbsp;·&nbsp; vs ${normKey} &nbsp;·&nbsp; ${new Date().toLocaleDateString()}</div>
      </div>
      <div class="report-composite">
        <div class="rc-score" style="color:${tier.color};">${avg}</div>
        <div style="margin-top:3px;"><span class="tier-badge" style="background:${tier.bg};color:${tier.color};">${tier.label}</span></div>
        <div class="rc-label">Composite</div>
      </div>
    </div>
    <div class="report-section-title">Metric breakdown</div>
    <div class="report-metrics-grid">${metricsHTML}</div>
    <div class="report-section-title">Neuromuscular profile</div>
    <div style="padding:10px 12px;background:var(--bg3);border-radius:var(--radius-md);border:1px solid ${q.border};">
      <div style="font-size:15px;font-weight:800;font-family:'Barlow Condensed',sans-serif;font-style:italic;color:${q.color};margin-bottom:3px;">${q.title}</div>
      <div style="font-size:11px;color:var(--text2);line-height:1.55;">${q.desc}</div>
      <div style="font-size:11px;color:${q.color};margin-top:7px;font-family:'DM Sans',sans-serif;font-weight:600;">Focus → <span style="opacity:0.75;font-weight:500;text-transform:none;">${q.rx}</span></div>
    </div>
    ${coachingRecs.length ? `<div class="report-section-title">Training priorities</div>${coachingRecs}` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════
// ATHLETE DOSSIER (printable, parent/athlete-facing)
// ═══════════════════════════════════════════════════════════════
let dossierIncludeDetail = true;
let dossierPrintMode = 'light';

function buildDossierHTML(athlete, normKey, opts) {
  opts = opts || {};
  const includeDetail = opts.includeDetail !== false;
  const results = getResultsFor(athlete, normKey).filter(r => !disabledMetrics.has(r.key));
  const measured = results.filter(r => !r.suppressed && r.val > 0 && !isEstimatedForAthlete(r.key, athlete));
  const matrix = computeMatrixProfile(results);
  const q = matrix.quadrant;
  const avg = measured.length
    ? Math.round(measured.reduce((a,r)=>a+r.percentile,0)/measured.length)
    : 0;
  const avgTier = getTier(avg);

  // Avatar initials
  const parts = athlete.name.trim().split(/\s+/);
  const initials = (parts.length >= 2 ? parts[0][0] + parts[parts.length-1][0] : parts[0].slice(0,2)).toUpperCase();
  const sexCol = athlete.sex === 'M' ? '#60a5fa' : '#a78bfa';
  const sexLabel = athlete.sex === 'M' ? 'Male' : 'Female';

  // Metrics meeting target vs not
  const metAbove = measured.filter(r => r.meetingTarget).length;

  // Strengths / priorities (from measured only)
  const sortedDesc = [...measured].sort((a,b)=>b.percentile-a.percentile);
  const sortedAsc  = [...measured].sort((a,b)=>a.percentile-b.percentile);
  const strengths  = sortedDesc.slice(0, 2);
  const priorities = sortedAsc.filter(r => !strengths.find(s => s.key === r.key)).slice(0, 2);

  const fmtVal = r => {
    const d = r.step < 0.1 ? 2 : 1;
    return r.val > 0 ? `${r.val.toFixed(d)} ${r.unit}` : '—';
  };
  const ordinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

  // Performance rail — all measured, sorted by percentile descending
  const railRows = [...measured].sort((a,b)=>b.percentile-a.percentile).map(r => `
    <div class="dossier-rail-row">
      <div class="dossier-rail-name" title="${r.testName || r.label}">${r.label}</div>
      <div class="dossier-rail-track">
        <div class="dossier-rail-marker" style="left:25%;"></div>
        <div class="dossier-rail-marker" style="left:50%;"></div>
        <div class="dossier-rail-marker" style="left:75%;"></div>
        <div class="dossier-rail-fill" style="width:${r.percentile}%;background:${r.tier.color};"></div>
        <div class="dossier-rail-target" style="left:85%;background:${r.tier.color};opacity:0.4;"></div>
      </div>
      <div class="dossier-rail-pct" style="color:${r.tier.color};">${ordinal(r.percentile)}</div>
    </div>`).join('') || '<div style="color:var(--text3);font-size:12px;">No measured metrics on file.</div>';

  // Callout (strength/priority) row
  const callout = (r, color) => `
    <div class="dossier-callout" style="border-left-color:${color};">
      <div style="flex:1;">
        <div class="dossier-callout-name">${r.label}
          <span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:6px;">${r.testName || ''}</span>
        </div>
        <div class="dossier-callout-stats">
          <b>${fmtVal(r)}</b> · ${ordinal(r.percentile)} percentile · <b style="color:${r.tier.color};">${r.tier.label}</b>
        </div>
        <div class="dossier-callout-explainer">${METRIC_EXPLAINER[r.key] || ''}</div>
      </div>
    </div>`;

  // Detail table rows (compact 4-col: Metric, Current, 85th, Gap)
  const detailRows = results.map(r => {
    if (r.suppressed || r.val <= 0) {
      return `<tr>
        <td>${r.label}</td>
        <td style="color:var(--text3);">—</td>
        <td style="color:var(--text3);">${r.target85 ? r.target85 : '—'}</td>
        <td style="color:var(--text3);">—</td>
      </tr>`;
    }
    const d = r.step < 0.1 ? 2 : 1;
    const gapRaw = r.inv ? (r.target85 - r.val) : (r.val - r.target85);
    const gapPct = (gapRaw / r.target85) * 100;
    const gapStr = (gapPct >= 0 ? '+' : '') + gapPct.toFixed(1) + '%';
    const gapColor = r.meetingTarget ? 'var(--green)' : 'var(--orange)';
    return `<tr>
      <td><b>${r.label}</b></td>
      <td style="color:${r.tier.color};font-weight:600;">${r.val.toFixed(d)}</td>
      <td>${r.target85}</td>
      <td style="color:${gapColor};font-weight:600;">${gapStr}</td>
    </tr>`;
  }).join('');

  // Training focus — top 2 priority areas (lowest percentile measured)
  const rxCards = priorities.map(r => {
    const c = COACHING_LIB[r.key] || { title: r.label, text: 'Continued development indicated.', methods: [] };
    return `<div class="dossier-rx-card" style="border-left-color:${r.tier.color};">
      <div class="dossier-rx-title" style="color:${r.tier.color};">${c.title}</div>
      <div class="dossier-rx-text">${c.text}</div>
      <div class="dossier-rx-methods">${(c.methods || []).map(m => `<span class="dossier-rx-tag">${m}</span>`).join('')}</div>
    </div>`;
  }).join('') || '<div style="color:var(--text3);font-size:12px;">No priority areas identified — keep doing what you\'re doing!</div>';

  // Generated date
  const today = new Date().toISOString().slice(0, 10);
  const coachLine = currentCoach && COACHES[currentCoach]
    ? `Generated by ${COACHES[currentCoach].displayName} · ${today}`
    : `Generated ${today}`;

  // ── Compose: single-page compact layout ──
  const heroAndReadiness = `
    <div class="dossier-grid-2col">
      <div class="dossier-hero" style="margin:0;">
        <div>
          <div class="dossier-hero-label">Composite score</div>
          <div class="dossier-hero-score" style="color:${avgTier.color};">${avg || '—'}<span style="font-size:0.4em;opacity:0.55;font-weight:600;font-style:normal;margin-left:6px;">th</span></div>
          <div style="margin-top:6px;"><span class="tier-badge" style="background:${avgTier.bg};color:${avgTier.color};font-size:12px;padding:3px 11px;">${avgTier.label}</span></div>
        </div>
        <div class="dossier-hero-summary">
          ${measured.length
            ? `<b>${metAbove} of ${measured.length}</b> measured metrics meet or exceed the 85th-percentile target.`
            : 'No measured metrics on file yet.'}
        </div>
      </div>
      <div class="dossier-zone" style="background:${q.bg};border-color:${q.border};">
        <div class="dossier-zone-title" style="color:${q.color};">${q.title}</div>
        <div class="dossier-zone-desc">${q.desc}</div>
        <div class="dossier-zone-rx" style="color:${q.color};">Focus → <span style="opacity:0.8;font-weight:400;color:var(--text2);">${q.rx}</span></div>
      </div>
    </div>`;

  const strengthsAndPriorities = `
    <div class="dossier-grid-2col">
      <div>
        <div class="dossier-row-title"><span class="num">▲</span>Strengths</div>
        ${strengths.length ? strengths.map(r => callout(r, r.tier.color)).join('') : '<div style="color:var(--text3);font-size:12px;">No measured metrics yet.</div>'}
      </div>
      <div>
        <div class="dossier-row-title"><span class="num">▼</span>Priority areas</div>
        ${priorities.length ? priorities.map(r => callout(r, r.tier.color)).join('') : '<div style="color:var(--text3);font-size:12px;">No priorities — keep going.</div>'}
      </div>
    </div>`;

  const railSection = `
    <div class="dossier-section">
      <div class="dossier-row-title">Performance profile</div>
      ${railRows}
    </div>`;

  const focusAndDetail = !includeDetail ? '' : `
    <div class="dossier-grid-2col">
      <div>
        <div class="dossier-row-title">Training focus</div>
        ${rxCards}
      </div>
      <div>
        <div class="dossier-row-title">Detailed metrics</div>
        <table class="dossier-detail-table">
          <thead><tr>
            <th>Metric</th><th>Current</th><th>85th</th><th>Gap</th>
          </tr></thead>
          <tbody>${detailRows}</tbody>
        </table>
      </div>
    </div>`;

  const header = `
    <div class="dossier-header">
      <div class="dossier-avatar" style="color:${sexCol};border-color:${sexCol};background:${sexCol}1a;">${initials}</div>
      <div style="flex:1;">
        <div class="dossier-header-brand">Kinetic Benchmark · Athlete Performance Report</div>
        <div class="dossier-header-name">${escapeHtml(athlete.name)}</div>
        <div class="dossier-header-meta">${sexLabel} · vs ${normKey}</div>
      </div>
    </div>`;

  const footer = `
    <div class="dossier-footer">
      <span>${coachLine}</span>
      <span>Norms based on internal roster · ${ATHLETE_DB.length} athletes</span>
    </div>`;

  return `<div class="dossier">${header}${heroAndReadiness}${strengthsAndPriorities}${railSection}${focusAndDetail}${footer}</div>`;
}

function openDossier() {
  const overlay = document.getElementById('dossier-overlay');
  if (!overlay) return;
  // Populate athlete + norm pickers
  const athSel = document.getElementById('dossier-athlete-select');
  const sorted = [...ATHLETE_DB].sort((a,b)=>a.name.localeCompare(b.name));
  athSel.innerHTML = sorted.map(a => `<option value="${escapeHtml(a.name)}"${a.name===currentAthlete.name?' selected':''}>${escapeHtml(a.name)} (${a.sex})</option>`).join('');
  const normSel = document.getElementById('dossier-norm-select');
  normSel.innerHTML = Object.keys(norms).map(k => `<option value="${k}"${k===selectedNorm?' selected':''}>${k}</option>`).join('');
  overlay.style.display = 'flex';
  updateDossierPreview();
}

function closeDossier() {
  document.getElementById('dossier-overlay').style.display = 'none';
}

function updateDossierPreview() {
  const athName = document.getElementById('dossier-athlete-select').value;
  const normKey = document.getElementById('dossier-norm-select').value;
  const athlete = ATHLETE_DB.find(a => a.name === athName) || currentAthlete;
  document.getElementById('dossier-preview').innerHTML =
    buildDossierHTML(athlete, normKey, { includeDetail: dossierIncludeDetail });
}

function toggleDossierDetail() {
  dossierIncludeDetail = !dossierIncludeDetail;
  const btn = document.getElementById('dossier-detail-btn');
  if (btn) {
    btn.textContent = dossierIncludeDetail ? '✓ Include training plan' : '＋ Include training plan';
    btn.style.borderColor = dossierIncludeDetail ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.13)';
    btn.style.color       = dossierIncludeDetail ? 'var(--green)'          : 'var(--text3)';
    btn.style.background  = dossierIncludeDetail ? 'rgba(52,211,153,0.10)' : 'var(--bg2)';
  }
  updateDossierPreview();
}

function setDossierPrintMode(mode) {
  dossierPrintMode = mode;
  document.getElementById('dossier-mode-dark').classList.toggle('active', mode === 'dark');
  document.getElementById('dossier-mode-light').classList.toggle('active', mode === 'light');
}

function printDossier() {
  const html = document.getElementById('dossier-preview').innerHTML;
  const printArea = document.getElementById('export-print-area');
  printArea.innerHTML = html;
  document.body.classList.add('export-print');
  if (dossierPrintMode === 'light') document.body.classList.add('print-light-mode');
  window.addEventListener('afterprint', function cleanup() {
    document.body.classList.remove('export-print', 'print-light-mode');
    printArea.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  });
  window.print();
}

// ═══════════════════════════════════════════════════════════════
// EXPORT PDF
// ═══════════════════════════════════════════════════════════════
let exportIncludedKeys = new Set();
let exportPrintMode = 'dark';

function getResultsForExport(athlete, normKey, includeSet) {
  const n     = norms[normKey] || norms[selectedNorm];
  return METRICS.filter(m => includeSet.has(m.key)).map(m => {
    const nd = n[m.key];
    if (!nd) return {...m, val:athlete[m.key]||0, percentile:1, tier:getTier(1), target85:0, meetingTarget:false, suppressed:true};
    const suppressed = suppressEstimated && isEstimatedForAthlete(m.key, athlete);
    const val = suppressed ? 0 : (athlete[m.key] || 0);
    const percentile = val > 0 ? calcPercentile(val, nd, m.inv) : 1;
    const t85 = m.inv ? nd.m - Z_85*nd.sd : nd.m + Z_85*nd.sd;
    const target85 = parseFloat(t85.toFixed(m.step < 0.1 ? 2 : 1));
    const meetingTarget = m.inv ? val <= target85 : val >= target85;
    return {...m, val, percentile, tier: getTier(percentile), target85, meetingTarget, suppressed};
  });
}

function computeMatrixProfileForExport(results, includeSet) {
  function weightedScore(weights) {
    const active = Object.entries(weights).filter(([k]) => includeSet.has(k));
    if (!active.length) return 50;
    const totalW = active.reduce((s,[,w]) => s+w, 0);
    return active.reduce((s,[k,w]) => s + (results.find(r=>r.key===k)?.percentile??50) * (w/totalW), 0);
  }
  const forceScore    = weightedScore(FORCE_WEIGHTS);
  const reactiveScore = weightedScore(REACTIVE_WEIGHTS);
  const xHigh = reactiveScore >= matrixThreshold;
  const yHigh = forceScore    >= matrixThreshold;
  return { forceScore, reactiveScore, xHigh, yHigh, quadrant: QUADRANTS.find(q=>q.xHigh===xHigh&&q.yHigh===yHigh) };
}

function buildExportCardHTML(athlete, normKey, includeSet) {
  const results = getResultsForExport(athlete, normKey, includeSet);
  if (!results.length) return '<div style="color:var(--text3);padding:20px;text-align:center;font-family:\'DM Mono\',monospace;font-size:12px;">No metrics selected.</div>';
  const matrix  = computeMatrixProfileForExport(results, includeSet);
  const q       = matrix.quadrant;
  const avg     = Math.round(results.reduce((a,r)=>a+r.percentile,0)/results.length);
  const tier    = getTier(avg);
  const sortedR = [...results].filter(r=>!r.suppressed).sort((a,b)=>a.percentile-b.percentile);
  const metricsHTML = results.map(r => {
    if (r.suppressed || r.val<=0) return `<div class="report-metric-row">
      <div class="report-metric-name">${r.label}</div>
      <div class="report-metric-val" style="color:var(--text3);">—</div>
      <div class="report-metric-pct" style="color:var(--text3);">—</div>
      <span class="tier-badge" style="background:var(--bg3);color:var(--text3);font-size:9px;">N/A</span>
    </div>`;
    const isCmjNonFD = r.key==='cmj' && !athlete.cmjFD;
    const valColor = isCmjNonFD ? 'var(--gold)' : r.tier.color;
    const cmjNote = isCmjNonFD ? '<sup style="font-size:8px;opacity:0.8;">†</sup>' : '';
    return `<div class="report-metric-row">
      <div class="report-metric-name">${r.label}</div>
      <div class="report-metric-val" style="color:${valColor};">${r.val} ${r.unit}${cmjNote}</div>
      <div class="report-metric-pct" style="color:${r.tier.color};">${r.percentile}th</div>
      <span class="tier-badge" style="background:${r.tier.bg};color:${r.tier.color};font-size:9px;">${r.tier.label}</span>
    </div>`;
  }).join('');
  const coachingRecs = sortedR.slice(0,2).map(r => {
    const c = COACHING_LIB[r.key] || {title:r.label, text:'Continued development indicated.', methods:[]};
    return `<div style="padding:9px 11px;background:var(--bg3);border-radius:var(--radius-md);margin-bottom:6px;border:1px solid var(--border);">
      <div style="font-size:13px;font-weight:600;font-family:'DM Sans',sans-serif;color:var(--orange);margin-bottom:4px;">${c.title}</div>
      <div style="font-size:11px;color:var(--text2);line-height:1.55;">${c.text}</div>
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${c.methods.map(m=>`<span class="tier-badge" style="background:rgba(251,146,60,0.1);color:var(--orange);font-size:9px;">${m}</span>`).join('')}</div>
    </div>`;
  }).join('');
  return `
    <div class="report-header">
      <div>
        <div class="report-name">${escapeHtml(athlete.name)}</div>
        <div class="report-meta">${athlete.sex==='M'?'Male':'Female'} &nbsp;·&nbsp; vs ${normKey} &nbsp;·&nbsp; ${new Date().toLocaleDateString()}</div>
      </div>
      <div class="report-composite">
        <div class="rc-score" style="color:${tier.color};">${avg}</div>
        <div style="margin-top:3px;"><span class="tier-badge" style="background:${tier.bg};color:${tier.color};">${tier.label}</span></div>
        <div class="rc-label">Composite</div>
      </div>
    </div>
    <div class="report-section-title">Metric breakdown</div>
    <div class="report-metrics-grid">${metricsHTML}</div>
    <div class="report-section-title">Neuromuscular profile</div>
    <div style="padding:10px 12px;background:var(--bg3);border-radius:var(--radius-md);border:1px solid ${q.border};">
      <div style="font-size:15px;font-weight:800;font-family:'Barlow Condensed',sans-serif;font-style:italic;color:${q.color};margin-bottom:3px;">${q.title}</div>
      <div style="font-size:11px;color:var(--text2);line-height:1.55;">${q.desc}</div>
      <div style="font-size:11px;color:${q.color};margin-top:7px;font-family:'DM Sans',sans-serif;font-weight:600;">Focus → <span style="opacity:0.75;font-weight:500;text-transform:none;">${q.rx}</span></div>
    </div>
    ${coachingRecs.length ? `<div class="report-section-title">Training priorities</div>${coachingRecs}` : ''}
  `;
}

function openExportPDF() {
  const overlay = document.getElementById('export-pdf-overlay');
  // Populate athlete selector
  const athSel = document.getElementById('export-athlete-select');
  const sorted = [...ATHLETE_DB].sort((a,b)=>a.name.localeCompare(b.name));
  athSel.innerHTML = sorted.map(a => `<option value="${escapeHtml(a.name)}"${a.name===currentAthlete.name?' selected':''}>${escapeHtml(a.name)}</option>`).join('');
  // Populate norm selector
  const normSel = document.getElementById('export-norm-select');
  normSel.innerHTML = Object.keys(norms).map(k => `<option value="${k}"${k===selectedNorm?' selected':''}>${k}</option>`).join('');
  // Build metric checkboxes: only metrics not globally disabled
  const activeMetrics  = METRICS.filter(m => !disabledMetrics.has(m.key));
  exportIncludedKeys   = new Set(activeMetrics.map(m => m.key));
  let checksHTML = activeMetrics.map(m => `<label class="export-check-item"><input type="checkbox" value="${m.key}" checked onchange="onExportMetricToggle(this)">${m.label}</label>`).join('');
  document.getElementById('export-metric-checks').innerHTML = checksHTML;
  overlay.style.display = 'flex';
  updateExportPreview();
}

function closeExportPDF() {
  document.getElementById('export-pdf-overlay').style.display = 'none';
}

function onExportMetricToggle(cb) {
  if (cb.checked) exportIncludedKeys.add(cb.value);
  else exportIncludedKeys.delete(cb.value);
  updateExportPreview();
}

function exportToggleAll(state) {
  document.querySelectorAll('#export-metric-checks input[type=checkbox]').forEach(cb => {
    cb.checked = state;
    if (state) exportIncludedKeys.add(cb.value);
    else exportIncludedKeys.delete(cb.value);
  });
  updateExportPreview();
}

function updateExportPreview() {
  const athName = document.getElementById('export-athlete-select').value;
  const normKey = document.getElementById('export-norm-select').value;
  const athlete = ATHLETE_DB.find(a => a.name === athName) || currentAthlete;
  document.getElementById('export-card-preview').innerHTML = buildExportCardHTML(athlete, normKey, exportIncludedKeys);
}

function setExportPrintMode(mode) {
  exportPrintMode = mode;
  document.getElementById('exp-mode-dark').classList.toggle('active', mode === 'dark');
  document.getElementById('exp-mode-light').classList.toggle('active', mode === 'light');
}
function printExportPDF() {
  const html      = document.getElementById('export-card-preview').innerHTML;
  const printArea = document.getElementById('export-print-area');
  printArea.innerHTML = `<div style="font-family:'DM Sans',sans-serif;max-width:680px;margin:0 auto;">${html}</div>`;
  document.body.classList.add('export-print');
  if (exportPrintMode === 'light') document.body.classList.add('print-light-mode');
  window.addEventListener('afterprint', function cleanup() {
    document.body.classList.remove('export-print', 'print-light-mode');
    printArea.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  });
  window.print();
}


function renderCardsTab() {
  const males   = ATHLETE_DB.filter(a=>a.sex==='M').sort((a,b)=>a.name.localeCompare(b.name));
  const females = ATHLETE_DB.filter(a=>a.sex==='F').sort((a,b)=>a.name.localeCompare(b.name));

  function renderPanel(sex, panelSlot) {
    const pool    = sex==='M' ? males : females;
    let   curName = panelSlot==='left' ? cardsAthleteLeft  : cardsAthleteRight;
    const normKey = panelSlot==='left' ? cardsNormLeft     : cardsNormRight;
    if (!curName || !pool.find(a=>a.name===curName)) curName = pool.length ? pool[0].name : null;
    if (!curName) return '<div style="color:var(--text3);padding:20px;">No athletes.</div>';
    if (panelSlot==='left') cardsAthleteLeft = curName; else cardsAthleteRight = curName;
    const athlete  = pool.find(a=>a.name===curName);
    const sexColor = sex==='M' ? 'var(--blue)' : 'var(--purple)';
    const sexLabel = sex==='M' ? '♂ Male' : '♀ Female';
    const athOpts  = pool.map(a=>`<option value="${escapeHtml(a.name)}"${a.name===curName?' selected':''}>${hasAllMeasured(a)?'● ':''} ${escapeHtml(a.name)}</option>`).join('');
    const normWord = sex === 'M' ? 'Male' : 'Female';
    const normOpts = Object.keys(INITIAL_NORMS).filter(k=>k.includes(normWord)).map(k=>`<option value="${k}"${k===normKey?' selected':''}>${k}</option>`).join('');
    return `<div class="report-modal" style="max-width:none;max-height:none;overflow:visible;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:12px;">
        <span onclick="toggleCardPanelSex('${panelSlot}')" title="Click to toggle male/female" style="font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif;color:${sexColor};cursor:pointer;padding:3px 9px;border:1px solid ${sexColor};border-radius:6px;transition:opacity 0.15s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">${sexLabel}</span>
        <div class="select-wrap" style="flex:1;min-width:140px;"><select onchange="onCardAthleteChange('${panelSlot}',this.value)">${athOpts}</select></div>
        <div class="select-wrap" style="max-width:210px;"><select onchange="onCardNormChange('${panelSlot}',this.value)">${normOpts}</select></div>
      </div>
      ${buildReportCardHTML(athlete, normKey)}
    </div>`;
  }

  document.getElementById('cards-panel-M').innerHTML = renderPanel(cardsPanelSexLeft, 'left');
  document.getElementById('cards-panel-F').innerHTML = renderPanel(cardsPanelSexRight, 'right');
}

function onCardAthleteChange(panelSlot, name) {
  if (panelSlot==='left') cardsAthleteLeft = name; else cardsAthleteRight = name;
  renderCardsTab();
}
function onCardNormChange(panelSlot, normKey) {
  if (panelSlot==='left') cardsNormLeft = normKey; else cardsNormRight = normKey;
  renderCardsTab();
}

function toggleCardPanelSex(panelSlot) {
  if (panelSlot === 'left') {
    cardsPanelSexLeft = cardsPanelSexLeft === 'M' ? 'F' : 'M';
    const pool = ATHLETE_DB.filter(a=>a.sex===cardsPanelSexLeft).sort((a,b)=>a.name.localeCompare(b.name));
    cardsAthleteLeft = pool.length ? pool[0].name : null;
    cardsNormLeft    = `Roster — ${cardsPanelSexLeft==='M'?'Male':'Female'} (Measured)`;
  } else {
    cardsPanelSexRight = cardsPanelSexRight === 'M' ? 'F' : 'M';
    const pool = ATHLETE_DB.filter(a=>a.sex===cardsPanelSexRight).sort((a,b)=>a.name.localeCompare(b.name));
    cardsAthleteRight = pool.length ? pool[0].name : null;
    cardsNormRight    = `Roster — ${cardsPanelSexRight==='M'?'Male':'Female'} (Measured)`;
  }
  renderCardsTab();
}


// ═══════════════════════════════════════════════════════════════
// TESTS TAB
// ═══════════════════════════════════════════════════════════════
function getTestPool() {
  const group = TEST_GROUPS.find(g => g.key === testActiveGroup);
  if (!group) return [];
  return ATHLETE_DB.filter(a => group.hasData(a) && a.sex === testSex).sort((a,b) => a.name.localeCompare(b.name));
}

function toggleTestSex() {
  testSex = testSex === 'M' ? 'F' : 'M';
  testAthlete = null; testCompare = []; testNorm = null;
  renderTestsTab();
}

function getTestResults(athlete, normKey) {
  const group = TEST_GROUPS.find(g => g.key === testActiveGroup);
  if (!group) return [];
  const n = norms[normKey] || {};
  return group.metrics.map(key => {
    const m = METRICS.find(x => x.key === key);
    if (!m) return null;
    const val = athlete[key] || 0;
    const nd  = n[key];
    if (!nd || val <= 0) return { ...m, val, percentile:0, tier:getTier(0), missing:true };
    const pct = calcPercentile(val, nd, m.inv);
    return { ...m, val, percentile:pct, tier:getTier(pct), missing:false };
  }).filter(Boolean);
}

function setTestGroup(key) {
  testActiveGroup = key;
  testAthlete = null; testNorm = null; testCompare = []; testRankMetric = null;
  renderTestsTab();
}

function onTestAthleteChange() {
  testAthlete = document.getElementById('test-athlete-select').value;
  testCompare = testCompare.filter(n => n !== testAthlete);
  renderTestsContent();
}

function onTestNormChange() {
  testNorm = document.getElementById('test-norm-select').value;
  renderTestsContent();
}

function addTestCompare() {
  const sel = document.getElementById('test-compare-select');
  if (!sel || !sel.value) return;
  const name = sel.value;
  if (name === testAthlete || testCompare.includes(name)) return;
  if (testCompare.length >= 4) testCompare.shift();
  testCompare.push(name);
  renderTestsTab();
}

function removeTestCompare(name) {
  testCompare = testCompare.filter(n => n !== name);
  renderTestsTab();
}

function setTestRankMetric(key) {
  testRankMetric = key;
  renderTestsContent();
}

function renderTestsTab() {
  const pane = document.getElementById('pane-tests');
  if (!pane) return;

  // Group selector buttons
  const btnContainer = document.getElementById('test-group-btns');
  if (btnContainer) {
    btnContainer.innerHTML = TEST_GROUPS.map(g => {
      const active = g.key === testActiveGroup;
      return `<button onclick="setTestGroup('${g.key}')" style="font-size:11px;font-family:'DM Mono',monospace;padding:5px 14px;border-radius:8px;cursor:pointer;
        border:1px solid ${active ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.13)'};
        background:${active ? 'rgba(240,192,64,0.12)' : 'var(--bg2)'};
        color:${active ? 'var(--gold)' : 'var(--text3)'};">${g.shortLabel}</button>`;
    }).join('');
  }

  const pool = getTestPool();
  if (!pool.length) {
    document.getElementById('tests-content').innerHTML =
      '<div style="color:var(--text3);font-size:13px;font-family:\'DM Mono\',monospace;padding:24px 0;">No athletes have data for this test.</div>';
    document.getElementById('test-athlete-select').innerHTML = '';
    document.getElementById('test-norm-select').innerHTML = '';
    document.getElementById('test-compare-select').innerHTML = '';
    return;
  }

  const group = TEST_GROUPS.find(g => g.key === testActiveGroup);
  if (!testAthlete || !pool.find(a => a.name === testAthlete)) testAthlete = pool[0].name;
  const athlete = pool.find(a => a.name === testAthlete);
  const sexWord = testSex === 'M' ? 'Male' : 'Female';
  if (!testNorm || !norms[testNorm] || !testNorm.includes(sexWord)) testNorm = group.defaultNorm(testSex);

  // Athlete select — same sex only
  const asel = document.getElementById('test-athlete-select');
  asel.innerHTML = pool.map(a =>
    `<option value="${escapeHtml(a.name)}"${a.name===testAthlete?' selected':''}>${escapeHtml(a.name)}</option>`
  ).join('');

  // Norm select — sex-filtered
  const nsel = document.getElementById('test-norm-select');
  nsel.innerHTML = Object.keys(INITIAL_NORMS)
    .filter(k => k.includes(sexWord))
    .map(k => `<option value="${k}"${k===testNorm?' selected':''}>${k}</option>`)
    .join('');
  nsel.value = testNorm;

  // Compare select — same sex only, excluding current athlete and already-added
  const csel = document.getElementById('test-compare-select');
  const cmpPool = pool.filter(a => a.name !== testAthlete && !testCompare.includes(a.name));
  csel.innerHTML = '<option value="">Add comparison…</option>' +
    cmpPool.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');

  // Sex badge — reflects testSex, clickable to toggle
  const sb = document.getElementById('test-sex-badge');
  if (sb) { sb.textContent = testSex==='M' ? '♂ Male' : '♀ Female'; sb.className = 'sex-badge ' + (testSex==='M'?'male':'female'); sb.style.cursor='pointer'; }

  // Default rank metric
  if (!testRankMetric || !group.metrics.includes(testRankMetric)) testRankMetric = group.metrics[0];

  renderTestsContent();
}

function renderTestsContent() {
  const pool    = getTestPool();
  const athlete = pool.find(a => a.name === testAthlete);
  if (!athlete) return;

  const group   = TEST_GROUPS.find(g => g.key === testActiveGroup);
  const results = getTestResults(athlete, testNorm);
  const cmpAthletes = testCompare
    .map((n, i) => ({ a: pool.find(x => x.name===n), color: TEST_COMPARE_COLORS[i] }))
    .filter(x => x.a);

  const validResults = results.filter(r => !r.missing);
  const avgPct  = validResults.length ? Math.round(validResults.reduce((s,r) => s+r.percentile, 0) / validResults.length) : 0;
  const avgTier = getTier(avgPct);

  // ── Bar chart rows ──
  const barRows = results.map(r => {
    if (r.missing) return `<div style="display:grid;grid-template-columns:160px 1fr 90px 80px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;">${r.label}<div style="font-size:9px;margin-top:1px;">${r.unit}</div></div>
      <div style="font-size:11px;color:var(--text3);font-style:italic;">No data</div>
      <div></div><div></div></div>`;
    const dec = r.step < 0.001 ? 4 : r.step < 0.01 ? 3 : r.step < 0.1 ? 2 : r.step < 1 ? 1 : 0;
    const cmpBars = cmpAthletes.map(({a:ca, color}) => {
      const cr = getTestResults(ca, testNorm).find(x => x.key===r.key);
      if (!cr || cr.missing) return '';
      return `<div style="height:3px;background:${color};width:${cr.percentile}%;max-width:100%;border-radius:2px;margin-top:3px;opacity:0.85;"></div>`;
    }).join('');
    return `<div style="display:grid;grid-template-columns:160px 1fr 90px 80px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:12px;color:var(--text2);font-family:'DM Mono',monospace;">${r.label}<div style="font-size:9px;color:var(--text3);margin-top:1px;">${r.unit}</div></div>
      <div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden;">
            <div style="width:${r.percentile}%;height:100%;background:${r.tier.color};border-radius:4px;"></div>
          </div>
          <span style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;min-width:34px;">${r.percentile}th</span>
        </div>
        ${cmpBars}
      </div>
      <div style="font-size:13px;font-weight:700;color:${r.tier.color};font-family:'DM Mono',monospace;text-align:right;">${r.val.toFixed(dec)}</div>
      <div><span class="tier-badge" style="background:${r.tier.bg};color:${r.tier.color};">${r.tier.label}</span></div>
    </div>`;
  }).join('');

  // ── Compare chips ──
  const cmpChips = testCompare.map((name, i) => {
    const ca = pool.find(a => a.name===name); if (!ca) return '';
    const color = TEST_COMPARE_COLORS[i];
    const safe  = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:${color}1a;border:1px solid ${color}55;border-radius:8px;">
      <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></div>
      <span style="font-size:12px;">${escapeHtml(ca.name)} (${ca.sex})</span>
      <button onclick="removeTestCompare('${safe}')" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 2px;font-size:15px;line-height:1;">&times;</button>
    </div>`;
  }).join('');

  // ── Rank summary (sidebar) ──
  const rankSummary = group.metrics.map(key => {
    const m = METRICS.find(x => x.key===key); if (!m) return '';
    const ranked = pool.filter(a => (a[key]||0)>0).sort((a,b) => m.inv ? a[key]-b[key] : b[key]-a[key]);
    const rank   = ranked.findIndex(a => a.name===testAthlete)+1;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${m.label}</span>
      <span style="font-size:12px;font-weight:700;color:var(--text);">#${rank||'—'}<span style="font-weight:400;color:var(--text3);">/${ranked.length}</span></span>
    </div>`;
  }).join('');

  // ── Full roster ranking table ──
  if (!testRankMetric || !group.metrics.includes(testRankMetric)) testRankMetric = group.metrics[0];
  const rankM   = METRICS.find(m => m.key===testRankMetric);
  const metTabs = group.metrics.map(key => {
    const m = METRICS.find(x => x.key===key); if (!m) return '';
    const active = key === testRankMetric;
    return `<button onclick="setTestRankMetric('${key}')" style="font-size:10px;font-family:'DM Mono',monospace;padding:3px 10px;border-radius:6px;cursor:pointer;
      border:1px solid ${active ? 'rgba(96,165,250,0.45)' : 'rgba(255,255,255,0.13)'};
      background:${active ? 'rgba(96,165,250,0.1)' : 'var(--bg3)'};
      color:${active ? 'var(--blue)' : 'var(--text3)'};">${m.label}</button>`;
  }).join('');

  const rankPool = pool.filter(a => (a[testRankMetric]||0) > 0)
    .sort((a,b) => rankM && rankM.inv ? a[testRankMetric]-b[testRankMetric] : b[testRankMetric]-a[testRankMetric]);
  const dec2 = rankM ? (rankM.step < 0.001 ? 4 : rankM.step < 0.01 ? 3 : rankM.step < 0.1 ? 2 : rankM.step < 1 ? 1 : 0) : 1;

  const rankTableRows = rankPool.map((a, i) => {
    const val   = a[testRankMetric];
    const n     = norms[`Roster — ${a.sex==='M'?'Male':'Female'} (Measured)`] || norms[testNorm] || {};
    const nd    = n[testRankMetric];
    const pct   = nd ? calcPercentile(val, nd, rankM && rankM.inv) : null;
    const tier  = pct !== null ? getTier(pct) : {color:'var(--text3)',bg:'var(--bg3)',label:'—'};
    const isCur = a.name === testAthlete;
    const medal = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : '';
    const sc    = a.sex==='M' ? 'var(--blue)' : 'var(--purple)';
    return `<tr style="${isCur ? 'background:rgba(240,192,64,0.06);' : ''}">
      <td style="padding:7px 10px 7px 6px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;text-align:center;width:36px;">${medal || (i+1)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:13px;font-weight:${isCur?'700':'500'};color:${isCur?'var(--gold)':'var(--text)'};">${escapeHtml(a.name)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;"><span style="font-size:10px;font-family:'DM Mono',monospace;color:${sc};background:${sc}22;padding:2px 7px;border-radius:6px;">${a.sex}</span></td>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:right;font-size:13px;font-weight:700;font-family:'DM Mono',monospace;color:${tier.color};">${val.toFixed(dec2)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;font-size:11px;font-family:'DM Mono',monospace;color:${tier.color};">${pct!==null?pct+'th':'—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);"><span class="tier-badge" style="background:${tier.bg};color:${tier.color};">${tier.label}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('tests-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 260px;gap:14px;align-items:start;margin-bottom:14px;">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
          <div class="card-label" style="margin:0;">${group.label} — Metric Profile</div>
        </div>
        ${cmpChips ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">${cmpChips}</div>` : ''}
        ${barRows}
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="card" style="text-align:center;">
          <div class="card-label" style="margin-bottom:8px;">${group.label} Composite</div>
          <div style="font-size:52px;font-weight:900;font-family:'Barlow Condensed',sans-serif;font-style:italic;color:${avgTier.color};line-height:1;">${avgPct}</div>
          <div style="margin-top:6px;"><span class="tier-badge" style="background:${avgTier.bg};color:${avgTier.color};font-size:11px;">${avgTier.label}</span></div>
          <div style="font-size:11px;color:var(--text3);font-family:'DM Sans',sans-serif;margin-top:8px;">${escapeHtml(athlete.name)}</div>
        </div>
        <div class="card">
          <div class="card-label" style="margin-bottom:10px;">Roster Rankings</div>
          ${rankSummary}
        </div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        <div class="card-label" style="margin:0;">Full Roster Ranking</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${metTabs}</div>
      </div>
      <div class="tbl-scroll">
        <table class="tbl-base">
          <thead><tr>
            <th style="padding:6px 10px 10px 6px;font-size:12px;font-weight:600;color:var(--text3);font-family:'DM Sans',sans-serif;border-bottom:1px solid var(--border2);text-align:center;">#</th>
            <th class="tbl-th tbl-th-l">Athlete</th>
            <th class="tbl-th tbl-th-c">Sex</th>
            <th class="tbl-th tbl-th-r">${rankM ? rankM.label : ''} (${rankM ? rankM.unit : ''})</th>
            <th class="tbl-th tbl-th-c">Pct</th>
            <th style="padding:6px 10px 10px;font-size:12px;font-weight:600;color:var(--text3);font-family:'DM Sans',sans-serif;border-bottom:1px solid var(--border2);">Tier</th>
          </tr></thead>
          <tbody>${rankTableRows}</tbody>
        </table>
      </div>
      <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:8px;">${rankPool.length} athlete${rankPool.length!==1?'s':''} with ${rankM ? rankM.label : ''} data · percentiles vs sex-specific roster norms</div>
    </div>`;
}
function toggleSexNorm() {
  const isMale    = selectedNorm.includes('Male');
  const measured  = selectedNorm.includes('Measured');
  selectedNorm = isMale
    ? `Roster — Female${measured ? ' (Measured)' : ''}`
    : `Roster — Male${measured ? ' (Measured)' : ''}`;
  document.getElementById('norm-select').value = selectedNorm;
  renderAll(true);
}

// ═══════════════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════════════
let histMode = 'individual';
let histAthlete = (typeof currentAthlete !== 'undefined' && currentAthlete) ? currentAthlete.name : '';
let histMetric = 'cmj';
let histSex = 'F';

const HIST_METRICS = [
  { key:'cmj',       label:'CMJ',     unit:'in',     inv:false },
  { key:'power',     label:'Power',   unit:'W/kg',   inv:false },
  { key:'rfd',       label:'RFD',     unit:'N/s/kg', inv:false },
  { key:'eccBrakingRFD', label:'Ecc Brk', unit:'N/s/kg', inv:false },
  { key:'rsi',       label:'RSI',     unit:'',       inv:false },
  { key:'sprint10',  label:'0-10',    unit:'s',      inv:true  },
  { key:'sprintFly', label:'Fly 10',  unit:'s',      inv:true  },
  { key:'sprint1020',label:'10-20',   unit:'s',      inv:true  },
  { key:'broad',     label:'Broad',   unit:'in',     inv:false },
  { key:'shuttle',   label:'Shuttle', unit:'s',      inv:true  },
];

function renderHistoryTab() {
  if (!histAthlete && ATHLETE_DB.length) histAthlete = ATHLETE_DB[0].name;
  const pane = document.getElementById('pane-history');

  const btnBase = 'font-size:11px;font-family:\'DM Mono\',monospace;padding:5px 16px;border-radius:20px;border:1px solid;cursor:pointer;transition:all .15s;';
  const modeInd = histMode==='individual';

  // Metric pill buttons
  const metricPills = HIST_METRICS.map(m => {
    const active = m.key === histMetric;
    return `<button onclick="histSetMetric('${m.key}')" style="${btnBase}background:${active?'rgba(240,192,64,0.15)':'var(--bg2)'};border-color:${active?'rgba(240,192,64,0.5)':'rgba(255,255,255,0.13)'};color:${active?'var(--gold)':'var(--text3)'};">${m.label}</button>`;
  }).join('');

  // Athlete selector for individual mode — show ALL athletes (sex filter only applies to team view)
  const athPool = [...ATHLETE_DB].sort((a,b)=>a.name.localeCompare(b.name));
  if (!histAthlete || !athPool.find(a=>a.name===histAthlete)) histAthlete = athPool.length ? athPool[0].name : '';
  const athOptions = athPool.map(a => `<option value="${a.name.replace(/"/g,'&quot;')}"${a.name===histAthlete?' selected':''}>${escapeHtml(a.name)} (${a.sex})</option>`).join('');

  // Sex toggle for team mode
  const sexM = `<button onclick="histSetSex('M')" style="${btnBase}background:${histSex==='M'?'rgba(96,165,250,0.15)':'var(--bg2)'};border-color:${histSex==='M'?'rgba(96,165,250,0.45)':'rgba(255,255,255,0.13)'};color:${histSex==='M'?'var(--blue)':'var(--text3)'};">♂ Male</button>`;
  const sexF = `<button onclick="histSetSex('F')" style="${btnBase}background:${histSex==='F'?'rgba(167,139,250,0.15)':'var(--bg2)'};border-color:${histSex==='F'?'rgba(167,139,250,0.45)':'rgba(255,255,255,0.13)'};color:${histSex==='F'?'var(--purple)':'var(--text3)'};">♀ Female</button>`;

  pane.innerHTML = `
  <div class="card gap-14">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div class="card-label" style="margin-bottom:0;">Performance History</div>
      <div style="display:flex;gap:6px;">
        <button onclick="histSetMode('individual')" style="${btnBase}background:${modeInd?'rgba(52,211,153,0.15)':'var(--bg2)'};border-color:${modeInd?'rgba(52,211,153,0.45)':'rgba(255,255,255,0.13)'};color:${modeInd?'var(--teal)':'var(--text3)'};">Individual</button>
        <button onclick="histSetMode('team')" style="${btnBase}background:${!modeInd?'rgba(52,211,153,0.15)':'var(--bg2)'};border-color:${!modeInd?'rgba(52,211,153,0.45)':'rgba(255,255,255,0.13)'};color:${!modeInd?'var(--teal)':'var(--text3)'};">Team</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      ${modeInd
        ? `<div class="select-wrap" style="min-width:200px;"><select onchange="histAthlete=this.value;renderHistChart()" style="font-size:12px;padding:6px 28px 6px 10px;">${athOptions}</select></div>`
        : `<div style="display:flex;gap:6px;">${sexM}${sexF}</div>`
      }
    </div>

    <div style="display:flex;gap:6px;flex-wrap:wrap;">${metricPills}</div>

    <div id="hist-chart-area" style="width:100%;"></div>
  </div>`;

  renderHistChart();
}

function histSetMode(m) { histMode = m; renderHistoryTab(); }
function histSetMetric(m) { histMetric = m; renderHistoryTab(); }
function histSetSex(s) {
  histSex = s;
  const pool = ATHLETE_DB.filter(a => a.sex === s);
  histAthlete = pool.length ? pool[0].name : '';
  renderHistoryTab();
}

function renderHistChart() {
  const area = document.getElementById('hist-chart-area');
  if (!area) return;

  const metaM = HIST_METRICS.find(m => m.key === histMetric) || HIST_METRICS[0];
  let series = []; // [{label, color, points:[{date,val}]}]

  if (histMode === 'individual') {
    const ath = ATHLETE_DB.find(a => a.name === histAthlete);
    if (!ath || !ath._sessions || ath._sessions.length === 0) {
      area.innerHTML = '<div style="color:var(--text3);font-family:\'DM Mono\',monospace;font-size:12px;padding:24px 0;text-align:center;">No session data for this athlete.</div>';
      return;
    }
    const pts = [];
    ath._sessions.forEach(s => {
      const meas = (s.measurements || []).find(m => m.metric === histMetric);
      if (meas && parseFloat(meas.value)) pts.push({ date: s.session_date, val: parseFloat(meas.value) });
    });
    pts.sort((a, b) => a.date.localeCompare(b.date));
    const col = ath.sex === 'M' ? 'var(--blue)' : 'var(--purple)';
    series = [{ label: ath.name, color: col, points: pts }];

  } else {
    // Team mode: one line per date showing mean value for the selected sex
    const pool = ATHLETE_DB.filter(a => a.sex === histSex);
    const byDate = {}; // date -> [val]
    pool.forEach(ath => {
      (ath._sessions || []).forEach(s => {
        const meas = (s.measurements || []).find(m => m.metric === histMetric);
        if (meas && parseFloat(meas.value)) {
          if (!byDate[s.session_date]) byDate[s.session_date] = [];
          byDate[s.session_date].push(parseFloat(meas.value));
        }
      });
    });
    const pts = Object.entries(byDate)
      .map(([date, vals]) => ({ date, val: vals.reduce((a,b)=>a+b,0)/vals.length, n: vals.length }))
      .sort((a,b) => a.date.localeCompare(b.date));

    if (pts.length === 0) {
      area.innerHTML = '<div style="color:var(--text3);font-family:\'DM Mono\',monospace;font-size:12px;padding:24px 0;text-align:center;">No data for this metric and sex.</div>';
      return;
    }
    const col = histSex === 'M' ? 'var(--blue)' : 'var(--purple)';
    series = [{ label: `${histSex==='M'?'Male':'Female'} avg (n=?)`, color: col, points: pts, teamMode: true }];
  }

  area.innerHTML = buildHistSVG(series, metaM);
}

function catmullRomPath(pts) {
  if (pts.length < 2) return pts.length === 1 ? `M${pts[0].x},${pts[0].y}` : '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function buildHistSVG(series, metaM) {
  const W = 760, H = 300;
  const ML = 54, MR = 20, MT = 20, MB = 50;
  const cw = W - ML - MR, ch = H - MT - MB;

  // Collect all points
  const allPts = series.flatMap(s => s.points);
  if (allPts.length === 0) return '<div style="color:var(--text3);padding:20px;text-align:center;">No data points.</div>';

  const allDates = [...new Set(allPts.map(p => p.date))].sort();
  const allVals  = allPts.map(p => p.val);
  let vMin = Math.min(...allVals), vMax = Math.max(...allVals);
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  const pad = (vMax - vMin) * 0.12;
  vMin = Math.max(0, vMin - pad);
  vMax = vMax + pad;

  const xScale = d => ML + (allDates.indexOf(d) / Math.max(allDates.length - 1, 1)) * cw;
  const yScale = v => MT + ch - ((v - vMin) / (vMax - vMin)) * ch;

  // Y-axis gridlines + labels
  let grid = '', yLabels = '';
  const nGrid = 5;
  for (let i = 0; i <= nGrid; i++) {
    const v = vMin + (vMax - vMin) * (i / nGrid);
    const y = yScale(v);
    grid += `<line x1="${ML}" x2="${ML+cw}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    yLabels += `<text x="${ML-6}" y="${y+4}" text-anchor="end" fill="rgba(255,255,255,0.4)" font-size="9" font-family="DM Mono,monospace">${v.toFixed(metaM.unit==='s'?2:1)}</text>`;
  }

  // X-axis date labels (show at most 8 evenly spaced)
  let xLabels = '';
  const step = Math.max(1, Math.ceil(allDates.length / 8));
  allDates.forEach((d, i) => {
    if (i % step !== 0 && i !== allDates.length - 1) return;
    const x = xScale(d);
    const label = d.slice(5); // MM-DD
    xLabels += `<text x="${x}" y="${H-MB+16}" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="9" font-family="DM Mono,monospace">${label}</text>`;
    xLabels += `<line x1="${x}" x2="${x}" y1="${MT}" y2="${H-MB}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`;
  });

  // Series lines + dots
  let linesHTML = '', dotsHTML = '', tooltipDefs = '';
  series.forEach(s => {
    if (s.points.length === 0) return;
    const sorted = [...s.points].sort((a,b) => a.date.localeCompare(b.date));

    // Best value
    const best = metaM.inv
      ? sorted.reduce((a,b) => b.val < a.val ? b : a)
      : sorted.reduce((a,b) => b.val > a.val ? b : a);

    // Path
    const pts = sorted.map(p => ({ x: xScale(p.date), y: yScale(p.val) }));
    const pathD = historySmoothing
      ? catmullRomPath(pts)
      : pts.map((p, i) => (i===0?'M':'L') + `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    linesHTML += `<path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;

    // Dots + tooltips
    sorted.forEach(p => {
      const x = xScale(p.date), y = yScale(p.val);
      const isBest = Math.abs(p.val - best.val) < 0.001 && p.date === best.date;
      const r = isBest ? 6 : 4;
      const fill = isBest ? 'var(--green)' : s.color;
      const unit = metaM.unit ? ' ' + metaM.unit : '';
      const nLabel = p.n ? ` (n=${p.n})` : '';
      const tip = `${p.date}: ${p.val.toFixed(metaM.unit==='s'?2:1)}${unit}${nLabel}${isBest?' ★ PR':''}`;
      dotsHTML += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="rgba(0,0,0,0.4)" stroke-width="1" opacity="0.95"><title>${tip}</title></circle>`;
    });
  });

  // Axis labels
  const yAxisLabel = `<text x="${ML-38}" y="${MT+ch/2}" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="9" font-family="DM Mono,monospace" transform="rotate(-90,${ML-38},${MT+ch/2})">${metaM.label}${metaM.unit?' ('+metaM.unit+')':''}</text>`;
  const title = histMode==='team'
    ? `${histSex==='M'?'Male':'Female'} — ${metaM.label} avg per test date`
    : `${histAthlete} — ${metaM.label} over time`;
  const titleEl = `<text x="${ML + cw/2}" y="${MT - 5}" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="11" font-family="DM Sans,sans-serif" font-weight="600">${title}</text>`;

  // Improvement arrow
  let improvHTML = '';
  if (series.length === 1 && series[0].points.length >= 2) {
    const s = series[0], sorted = [...s.points].sort((a,b) => a.date.localeCompare(b.date));
    const first = sorted[0].val, last = sorted[sorted.length-1].val;
    const diff = last - first;
    const improved = metaM.inv ? diff < 0 : diff > 0;
    const arrow = improved ? '▲' : (diff === 0 ? '—' : '▼');
    const col = improved ? '#34d399' : (diff === 0 ? 'rgba(255,255,255,0.4)' : '#f87171');
    const pct = Math.abs(diff / first * 100).toFixed(1);
    improvHTML = `<text x="${ML+cw}" y="${MT+14}" text-anchor="end" fill="${col}" font-size="10" font-family="DM Mono,monospace">${arrow} ${pct}% from first test</text>`;
  }

  return `<div class="tbl-scroll">
<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-height:320px;">
  ${grid}${xLabels}${yLabels}${yAxisLabel}${titleEl}${improvHTML}
  <line x1="${ML}" x2="${ML}" y1="${MT}" y2="${H-MB}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  <line x1="${ML}" x2="${ML+cw}" y1="${H-MB}" y2="${H-MB}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  ${linesHTML}${dotsHTML}
</svg></div>`;
}

// ═══════════════════════════════════════════════════════════════
// FLAGS TAB
// ═══════════════════════════════════════════════════════════════
function renderFlags() {
  const pane = document.getElementById('pane-flags');
  if (!pane) return;

  const flagged = ATHLETE_DB.map(a => {
    const sexNorm = norms[`Roster — ${a.sex==='M'?'Male':'Female'} (Measured)`] || norms[selectedNorm];
    const activeM = METRICS.filter(m => !disabledMetrics.has(m.key));
    const criticals = activeM.filter(m => {
      const v = a[m.key]; if (!v || v<=0) return false;
      return calcPercentile(v, sexNorm[m.key], m.inv) < 15;
    });
    const missing = activeM.filter(m => coreMeasuredKeys.has(m.key) && (!a.measured || !a.measured[m.key]));
    return { a, criticals, missing };
  }).filter(x => x.criticals.length>=1 || x.missing.length>=3);

  flagged.sort((x,y) => (y.criticals.length*2 + y.missing.length) - (x.criticals.length*2 + x.missing.length));

  const withCriticals = flagged.filter(x => x.criticals.length>=1);
  const gapsOnly      = flagged.filter(x => x.criticals.length===0 && x.missing.length>=3);

  function makeRow({a, criticals, missing}) {
    const critChips = criticals.map(m=>`<span class="flag-chip" style="background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);color:#f87171;">${m.label}</span>`).join('');
    const gapChips  = missing.map(m=>`<span class="flag-chip" style="background:rgba(251,146,60,0.09);border:1px solid rgba(251,146,60,0.25);color:var(--orange);">${m.label} ★</span>`).join('');
    return `<div class="flag-row">
      <div class="flag-name" style="color:${hasAllMeasured(a)?'var(--green)':'var(--text)'};">${escapeHtml(a.name)}</div>
      <span class="sex-badge ${a.sex==='M'?'male':'female'}" style="font-size:9px;padding:2px 6px;">${a.sex==='M'?'♂':'♀'}</span>
      <div class="flag-chips">${critChips}${gapChips}</div>
      <button class="flag-load-btn" onclick="loadAthleteFromFlags('${a.name.replace(/'/g, "\\'")}')">Load →</button>
    </div>`;
  }

  pane.innerHTML = `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      <div class="card-label" style="margin-bottom:0;">Athlete flags</div>
      <div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${flagged.length} athlete${flagged.length!==1?'s':''} flagged</div>
    </div>
    ${withCriticals.length ? `<div class="flag-section-title" style="color:var(--red);">Critical / Sub-optimal metrics (below 15th percentile)</div>${withCriticals.map(makeRow).join('')}` : ''}
    ${gapsOnly.length ? `<div class="flag-section-title" style="margin-top:${withCriticals.length?18:0}px;color:var(--orange);">Measurement gaps (3+ required metrics missing)</div>${gapsOnly.map(makeRow).join('')}` : ''}
    ${flagged.length===0 ? '<div style="color:var(--text3);font-family:\'DM Mono\',monospace;font-size:12px;padding:20px 0;text-align:center;">No flags — all athletes are performing above critical thresholds.</div>' : ''}
  </div>`;
}

function loadAthleteFromFlags(name) {
  const athlete = ATHLETE_DB.find(a=>a.name===name);
  if (!athlete) return;
  currentAthlete = athlete; athleteData = {...athlete};
  selectedNorm = `Roster — ${athlete.sex==='M'?'Male':'Female'} (Measured)`;
  document.getElementById('norm-select').value = selectedNorm;
  document.getElementById('athlete-select').value = name;
  if (selectedChartMode==='measured') selectedChartKeys = new Set(METRICS.filter(m=>!isEstimatedForAthlete(m.key,currentAthlete)).map(m=>m.key));
  switchTab('analytics');
  renderAll();
}

// ═══════════════════════════════════════════════════════════════
// RENDER — coaching
// ═══════════════════════════════════════════════════════════════
function renderCoaching(results) {
  const el = document.getElementById('coaching-content');
  if (!el) return;
  if (!results || results.length === 0) {
    el.innerHTML = `<div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">No metrics enabled.</div>`;
    return;
  }
  const sorted=[...results].sort((a,b)=>a.percentile-b.percentile);
  const primary=sorted[0], secondary=sorted[1];
  const metBelow=results.filter(r=>!r.meetingTarget).length;
  function makeCard(r,isPrimary) {
    const cue=COACHING_LIB[r.key]||{title:'General development',text:'Continued athletic development indicated.',methods:[]};
    const accent=isPrimary?'#fb923c':'#60a5fa';
    const bg=isPrimary?'rgba(251,146,60,0.06)':'rgba(96,165,250,0.06)';
    return `<div class="coaching-card" style="background:${bg};border-color:${accent}40;">
      <div class="ctype" style="color:${accent};">${isPrimary?'Primary priority':'Secondary priority'}</div>
      <div class="ctitle">${cue.title}</div>
      <div class="ctext">${cue.text}</div>
      <div class="cmethods">${cue.methods.map(m=>`<span class="cmethod-tag">${m}</span>`).join('')}</div>
      <div class="ctarget">Current: <b style="color:${r.tier.color};">${r.percentile}th pct</b> &nbsp;·&nbsp; Target: 85th (${r.target85} ${r.unit})</div>
    </div>`;
  }
  el.innerHTML=
    `<div class="coaching-below">${metBelow} of ${results.length} metrics below 85th percentile target &nbsp;·&nbsp; vs <b style="color:var(--text2);">${selectedNorm}</b></div>
     <div class="coaching-cards">${makeCard(primary,true)}${secondary?makeCard(secondary,false):''}</div>`;
}

// ═══════════════════════════════════════════════════════════════
// RENDER — roster table
// ═══════════════════════════════════════════════════════════════
function syncSuppressButtons() {
  document.querySelectorAll('.suppress-est-btn').forEach(btn => {
    btn.style.background  = suppressEstimated ? 'rgba(52,211,153,0.12)'  : 'var(--bg2)';
    btn.style.borderColor = suppressEstimated ? 'rgba(52,211,153,0.45)'  : 'rgba(255,255,255,0.13)';
    btn.style.color       = suppressEstimated ? 'var(--green)'           : 'var(--text3)';
  });
  // keep the bar-chart "Measured only" button visually in sync
  const mob = document.getElementById('measured-only-btn');
  if (mob) {
    mob.style.background  = measuredOnlyMode ? 'rgba(52,211,153,0.12)' : 'var(--bg2)';
    mob.style.borderColor = measuredOnlyMode ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.13)';
    mob.style.color       = measuredOnlyMode ? 'var(--green)'          : 'var(--text3)';
  }
}

function toggleSuppressEstimated() {
  suppressEstimated = !suppressEstimated;
  // cascade: measured-only toggle on bar chart and custom chart follow the master switch
  measuredOnlyMode = suppressEstimated;
  selectedChartMode = suppressEstimated ? 'measured' : 'all';
  if (suppressEstimated) {
    selectedChartKeys = new Set(METRICS.filter(m => !isEstimatedForAthlete(m.key, currentAthlete)).map(m => m.key));
  } else {
    selectedChartKeys = new Set(METRICS.map(m => m.key));
  }
  syncSuppressButtons();
  renderRosterTable();
  renderAll(false);
  const sp = document.getElementById('pane-settings');
  if (sp && sp.style.display !== 'none') renderSettings();
}

function toggleCardCollapse(id) {
  const body = document.getElementById(id);
  const btn  = document.querySelector(`.card-chevron[data-collapse="${id}"]`);
  if (!body) return;
  const collapsed = collapsedCards.has(id);
  body.classList.add('card-collapse-body');
  if (collapsed) {
    collapsedCards.delete(id);
    body.style.display = '';
    requestAnimationFrame(() => body.classList.remove('collapsing'));
    if (btn) btn.classList.remove('collapsed');
  } else {
    collapsedCards.add(id);
    body.classList.add('collapsing');
    setTimeout(() => { body.style.display = 'none'; body.classList.remove('collapsing'); }, 210);
    if (btn) btn.classList.add('collapsed');
  }
}

function toggleRosterCol(key) {
  if (rosterVisibleCols.has(key)) rosterVisibleCols.delete(key);
  else rosterVisibleCols.add(key);
  renderRosterTable();
}

function rosterSort(key) {
  if (key === '_full') {
    rosterSortKey = rosterSortKey === '_full' ? 'name' : '_full';
    rosterSortDir = 1;
  } else if (rosterSortKey === key) {
    rosterSortDir *= -1;
  } else {
    rosterSortKey = key;
    // numeric metrics default high→low first; name/sex default A→Z
    rosterSortDir = (key === 'name' || key === 'sex') ? 1 : -1;
  }
  renderRosterTable();
}

function toggleRosterFullOnly() {
  rosterFullOnly = !rosterFullOnly;
  // Recompute Roster — (Measured) norms so all comparison views use the new cohort
  rebuildInitialNorms();
  renderRosterTable();
  if (currentAthlete) renderAll(false);
  saveState();
}

// ─── Roster table — decomposed for readability ─────────────────────────────
// Public entry point. Orchestrates the helpers below.
function renderRosterTable() {
  const tbl = document.getElementById('roster-table');
  if (!tbl) return;

  const { visibleMetrics, activeCols } = _rosterColumnSetup();
  _renderRosterColumnToggles(activeCols);
  _syncRosterControlButtons();

  const colLabels = ['Name', 'Sex', ...visibleMetrics.map(c => c.label), ''];
  const keys      = ['name', 'sex', ...visibleMetrics.map(c => c.key),    '_del'];

  const sorted = _getRosterSortedPool();
  tbl.innerHTML = _buildRosterTableHTML(sorted, colLabels, keys);
  _wireRosterRowHover(tbl);
}

// Resolve which metric columns are visible right now, taking disabledMetrics
// (Settings tab) and the per-column show/hide toggle into account.
function _rosterColumnSetup() {
  const ALL = METRICS.map(m => ({ key: m.key, label: m.label + (m.unit ? ' (' + m.unit + ')' : '') }));
  ALL.forEach(c => { if (disabledMetrics.has(c.key)) rosterVisibleCols.delete(c.key); });
  const activeCols = ALL.filter(c => !disabledMetrics.has(c.key));
  const visibleMetrics = activeCols.filter(c => rosterVisibleCols.has(c.key));
  return { activeCols, visibleMetrics };
}

// Render the row of pill buttons above the roster that lets the user
// individually show/hide metric columns.
function _renderRosterColumnToggles(activeCols) {
  const el = document.getElementById('roster-col-toggles');
  if (!el) return;
  el.innerHTML = activeCols.map(c => {
    const on = rosterVisibleCols.has(c.key);
    return `<button onclick="toggleRosterCol('${c.key}')"
      style="font-size:10px;font-family:'DM Mono',monospace;padding:3px 10px;border-radius:10px;cursor:pointer;transition:all 0.15s;
      border:1px solid ${on ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.1)'};
      background:${on ? 'rgba(52,211,153,0.1)' : 'var(--bg3)'};
      color:${on ? 'var(--green)' : 'var(--text3)'};">${c.label}</button>`;
  }).join('');
}

// Sync the "Full first" and "Full only" toolbar buttons to current state.
function _syncRosterControlButtons() {
  const fullBtn = document.getElementById('roster-full-btn');
  if (fullBtn) {
    const active = rosterSortKey === '_full';
    fullBtn.style.background  = active ? 'rgba(52,211,153,0.12)' : 'var(--bg2)';
    fullBtn.style.borderColor = active ? 'rgba(52,211,153,0.45)' : 'rgba(52,211,153,0.3)';
    fullBtn.style.color       = active ? 'var(--green)'          : 'var(--text3)';
  }
  const fullOnlyBtn = document.getElementById('roster-fullonly-btn');
  if (fullOnlyBtn) {
    fullOnlyBtn.style.background  = rosterFullOnly ? 'rgba(52,211,153,0.12)' : 'var(--bg2)';
    fullOnlyBtn.style.borderColor = rosterFullOnly ? 'rgba(52,211,153,0.45)' : 'rgba(52,211,153,0.3)';
    fullOnlyBtn.style.color       = rosterFullOnly ? 'var(--green)'          : 'var(--text3)';
  }
}

// Apply Full-only filter and current sort; full-data athletes always float to top.
function _getRosterSortedPool() {
  const pool = rosterFullOnly ? ATHLETE_DB.filter(hasAllMeasured) : ATHLETE_DB;
  return [...pool].sort((a, b) => {
    const af = hasAllMeasured(a) ? 0 : 1;
    const bf = hasAllMeasured(b) ? 0 : 1;
    if (af !== bf) return af - bf;
    const k = rosterSortKey;
    if (k === '_full') return a.name.localeCompare(b.name);
    const av = a[k] ?? '';
    const bv = b[k] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * rosterSortDir;
    return String(av).localeCompare(String(bv)) * rosterSortDir;
  });
}

// Build the entire <thead> + <tbody> innerHTML.
function _buildRosterTableHTML(sorted, colLabels, keys) {
  const head = _buildRosterHead(colLabels, keys);
  const body = sorted.map(a => _buildRosterRow(a, keys)).join('');
  return `${head}<tbody>${body}</tbody>`;
}

// <thead> with a sortable header row + a legend sub-row.
function _buildRosterHead(colLabels, keys) {
  const thBase = 'padding:9px 10px;font-size:12px;font-weight:600;border-bottom:1px solid var(--border);white-space:nowrap;font-family:\'DM Sans\',sans-serif;';
  const headerCells = colLabels.map((h, i) => {
    const k = keys[i];
    const isNumeric = k !== 'name' && k !== 'sex' && k !== '_del';
    const align = isNumeric ? 'center' : (i === 0 ? 'left' : 'center');
    if (k === '_del') return `<th style="${thBase}text-align:center;color:var(--text3);"></th>`;
    const active = rosterSortKey === k;
    const arrow = active ? (rosterSortDir === -1 ? ' ▼' : ' ▲') : '';
    const color = active ? 'var(--text1)' : 'var(--text3)';
    return `<th onclick="rosterSort('${k}')" style="${thBase}text-align:${align};color:${color};cursor:pointer;user-select:none;"
      onmouseover="this.style.color='var(--text1)'" onmouseout="this.style.color='${color}'">${h}${arrow}</th>`;
  }).join('');
  const legendSpan = colLabels.length - 2;
  return `<thead>
    <tr>${headerCells}</tr>
    <tr><td colspan="2" style="padding:4px 10px 8px;font-size:12px;color:var(--text3);font-family:'DM Sans',sans-serif;border-bottom:1px solid var(--border);">
      <span style="color:var(--green);font-weight:700;">■</span> measured &nbsp;&nbsp;
      <span style="color:var(--text3);font-weight:700;">—</span> test required &nbsp;&nbsp;
      <span style="color:var(--gold);font-weight:700;">†</span> CMJ (non-FD sensor)
    </td><td colspan="${legendSpan}" style="border-bottom:1px solid var(--border);"></td></tr>
  </thead>`;
}

// One <tr>, including the click-to-load behavior on the row and per-cell rendering.
function _buildRosterRow(a, keys) {
  const escName = a.name.replace(/'/g, "\\'");
  const cells = keys.map(k => _buildRosterCell(a, k)).join('');
  return `<tr onclick="loadAthleteFromRoster('${escName}')" style="cursor:pointer;" class="roster-row">${cells}</tr>`;
}

// One <td>. The 'name', 'sex', '_del' keys have special rendering;
// numeric metric keys share a common formatter.
function _buildRosterCell(a, k) {
  const rp = compactRoster ? '3px 8px' : '7px 10px';
  if (k === '_del') {
    const escName = a.name.replace(/'/g, "\\'");
    return `<td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:center;">
      <button onclick="event.stopPropagation();deleteAthlete('${escName}');"
        title="Delete athlete"
        style="background:none;border:1px solid rgba(248,113,113,0.3);border-radius:6px;color:rgba(248,113,113,0.5);cursor:pointer;font-size:12px;padding:3px 7px;line-height:1;transition:all .15s;"
        onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)';"
        onmouseout="this.style.borderColor='rgba(248,113,113,0.3)';this.style.color='rgba(248,113,113,0.5)';">✕</button>
    </td>`;
  }
  if (k === 'name') {
    const nameColor = hasAllMeasured(a) ? 'color:var(--green);' : '';
    const tier = getAthleteOverallTier(a);
    const dot = tier ? `<span style="color:${tier.color};font-size:9px;margin-right:5px;">●</span>` : '';
    const flag = a.custom ? '<span style="color:var(--teal);">✦</span> ' : '';
    return `<td style="padding:${rp};font-size:12px;border-bottom:1px solid var(--border);font-weight:600;${nameColor}">${dot}${flag}${escapeHtml(a.name)}</td>`;
  }
  if (k === 'sex') {
    const col = a[k] === 'M' ? 'var(--blue)' : 'var(--purple)';
    return `<td style="padding:${rp};font-size:12px;border-bottom:1px solid var(--border);color:${col};font-family:'DM Mono',monospace;text-align:center;">${a[k]}</td>`;
  }
  // Numeric metric cell — value + optional CMJ-source dagger.
  // Untested metrics (no measurement, val == 0) render as a muted "—" rather
  // than a fake "0.00" or an orange estimated value.
  const measured = !!(a.measured && a.measured[k]);
  const hasValue = typeof a[k] === 'number' && a[k] > 0;
  if (!hasValue || !measured) {
    return `<td style="padding:${rp};font-size:12px;border-bottom:1px solid var(--border);color:var(--text3);font-family:'DM Mono',monospace;text-align:center;opacity:0.5;" title="Test required">—</td>`;
  }
  const decimals = k === 'rsi' ? 2 : (k === 'cmj' || k === 'broad' || k === 'rfd' ? 1 : 2);
  const display = a[k].toFixed(decimals);
  const isCmjNonFD = k === 'cmj' && !a.cmjFD;
  const cellColor = isCmjNonFD ? 'var(--gold)' : 'var(--green)';
  const cmjSuffix = isCmjNonFD ? '<sup style="font-size:8px;opacity:0.8;">†</sup>' : '';
  return `<td style="padding:${rp};font-size:12px;border-bottom:1px solid var(--border);color:${cellColor};font-family:'DM Mono',monospace;text-align:center;font-weight:600;">${display}${cmjSuffix}</td>`;
}

// Hover highlight on rows. Has to be wired post-render because the rows
// are recreated each render.
function _wireRosterRowHover(tbl) {
  tbl.querySelectorAll('.roster-row').forEach(r => {
    r.addEventListener('mouseenter', () => r.style.background = 'var(--bg3)');
    r.addEventListener('mouseleave', () => r.style.background = '');
  });
}

function loadAthleteFromRoster(name) {
  document.getElementById('athlete-select').value = name;
  onAthleteChange();
  switchTab('analytics');
}

function exportRosterCsv() {
  const pool = rosterFullOnly ? ATHLETE_DB.filter(hasAllMeasured) : ATHLETE_DB;
  const cols = METRICS.filter(m => !disabledMetrics.has(m.key));

  const csvEscape = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = [
    'Name', 'Sex', 'Custom', 'CMJ Source', 'All Core Measured',
    ...cols.map(c => `${c.label}${c.unit ? ' (' + c.unit + ')' : ''}`),
    'Untested Metrics',
  ];

  const rows = pool.map(a => {
    const cmjSource = a.cmj == null ? '' : (a.cmjFD ? 'ForceDecks' : 'Sensor');
    const untested = cols.filter(c => a[c.key] != null && isEstimatedForAthlete(c.key, a)).map(c => c.key);
    return [
      a.name,
      a.sex || '',
      a.custom ? 'Y' : '',
      cmjSource,
      hasAllMeasured(a) ? 'Y' : '',
      ...cols.map(c => {
        const v = a[c.key];
        if (typeof v !== 'number') return '';
        const decimals = c.key === 'rsi' ? 2 : (c.key === 'cmj' || c.key === 'broad' || c.key === 'rfd' ? 1 : 2);
        return v.toFixed(decimals);
      }),
      untested.join(';'),
    ].map(csvEscape).join(',');
  });

  const csv = [header.map(csvEscape).join(','), ...rows].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roster_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ═══════════════════════════════════════════════════════════════
// RENDER — norms table
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════
let lbSex = 'all';
let lbMeasuredOnly = false;

function lbSetSex(sex) {
  lbSex = sex;
  ['all','m','f','split'].forEach(s => {
    const btn = document.getElementById('lb-sex-' + s);
    if (!btn) return;
    const active = s === sex.toLowerCase();
    btn.style.background  = active ? 'rgba(52,211,153,0.12)' : 'var(--bg2)';
    btn.style.borderColor = active ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.13)';
    btn.style.color       = active ? 'var(--green)'          : 'var(--text3)';
  });
  renderLeaderboard();
}

function lbToggleMeasured() {
  lbMeasuredOnly = !lbMeasuredOnly;
  const btn = document.getElementById('lb-meas-btn');
  if (btn) {
    btn.style.background  = lbMeasuredOnly ? 'rgba(52,211,153,0.12)' : 'var(--bg2)';
    btn.style.borderColor = lbMeasuredOnly ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.13)';
    btn.style.color       = lbMeasuredOnly ? 'var(--green)'          : 'var(--text3)';
  }
  renderLeaderboard();
}

// Sex-specific norm lookup used by both leaderboard modes.
function _lbNormFor(sex) {
  const measuredKey = `Roster — ${sex==='M'?'Male':'Female'} (Measured)`;
  const baseKey     = `Roster — ${sex==='M'?'Male':'Female'}`;
  return norms[measuredKey] || norms[baseKey] || norms[selectedNorm];
}

// Populate the metric-select dropdown and return the currently selected key.
function _populateLbMetricSelect() {
  const sel = document.getElementById('lb-metric-select');
  if (!sel) return null;
  const prevKey = sel.value;
  sel.innerHTML = '';
  const compOpt = document.createElement('option');
  compOpt.value = '__composite__'; compOpt.textContent = 'Composite Score';
  sel.appendChild(compOpt);
  METRICS.filter(m => !disabledMetrics.has(m.key)).forEach(m => {
    const o = document.createElement('option');
    o.value = m.key; o.textContent = m.label + ' (' + m.unit + ')';
    sel.appendChild(o);
  });
  const activeKeys = ['__composite__', ...METRICS.filter(m => !disabledMetrics.has(m.key)).map(m => m.key)];
  if (activeKeys.includes(prevKey)) sel.value = prevKey;
  return sel.value || '__composite__';
}

function _syncLbSexButtons() {
  ['all','m','f','split'].forEach(s => {
    const btn = document.getElementById('lb-sex-' + s);
    if (!btn) return;
    const active = s === lbSex.toLowerCase();
    btn.style.background  = active ? 'rgba(52,211,153,0.12)' : 'var(--bg2)';
    btn.style.borderColor = active ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.13)';
    btn.style.color       = active ? 'var(--green)'          : 'var(--text3)';
  });
}

function renderLeaderboard() {
  _syncLbSexButtons();
  const metKey = _populateLbMetricSelect();
  if (metKey === null) return;
  const target = document.getElementById('leaderboard-content');
  if (!target) return;
  const metric = metKey === '__composite__' ? null : METRICS.find(m => m.key === metKey);
  const renderOne = sex => metric ? _renderLbMetric(metric, sex) : _renderLbComposite(sex);

  if (lbSex === 'split') {
    target.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--blue);margin-bottom:8px;font-family:'DM Sans',sans-serif;">♂ Male</div>
          ${renderOne('M')}
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--purple);margin-bottom:8px;font-family:'DM Sans',sans-serif;">♀ Female</div>
          ${renderOne('F')}
        </div>
      </div>`;
    return;
  }
  target.innerHTML = renderOne(lbSex);
}

// ── Composite leaderboard ──
// Returns HTML; the orchestrator (renderLeaderboard) places it into the DOM.
function _renderLbComposite(sex) {
  const entries = ATHLETE_DB
    .filter(a => sex === 'all' || a.sex === sex)
    .map(a => {
      const n = _lbNormFor(a.sex);
      const activeM = METRICS.filter(m => !disabledMetrics.has(m.key) && n[m.key]);
      const pcts = activeM
        .filter(m => (!suppressEstimated || !isEstimatedForAthlete(m.key, a)) && (a[m.key] || 0) > 0)
        .map(m => calcPercentile(a[m.key], n[m.key], m.inv));
      const score = pcts.length > 0 ? Math.round(pcts.reduce((s,v) => s+v, 0) / pcts.length) : null;
      return { a, score, cnt: pcts.length };
    })
    .filter(x => x.score !== null && (!lbMeasuredOnly || hasAllMeasured(x.a)))
    .sort((x, y) => y.score - x.score);

  const thC = `padding:6px 10px 10px;font-size:12px;font-weight:600;color:var(--text3);font-family:'DM Sans',sans-serif;border-bottom:1px solid var(--border2);`;
  const compRows = entries.map(({a, score, cnt}, i) => {
    const tier = getTier(score);
    const sc = a.sex === 'M' ? 'var(--blue)' : 'var(--purple)';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    const sexCell = sex === 'all'
      ? `<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;"><span style="font-size:11px;font-family:'DM Mono',monospace;color:${sc};background:${sc}22;padding:2px 8px;border-radius:8px;">${a.sex}</span></td>`
      : '';
    return `<tr>
      <td style="padding:8px 10px 8px 6px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;color:var(--text3);font-family:'DM Mono',monospace;text-align:center;width:36px;">${medal || (i+1)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;">${escapeHtml(a.name)}</td>
      ${sexCell}
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;"><span style="font-size:15px;font-weight:800;font-family:'DM Mono',monospace;color:${tier.color};background:${tier.bg};padding:3px 10px;border-radius:6px;">${score}</span><span style="font-size:9px;color:var(--text3);margin-left:3px;">pct</span></td>
      <td style="padding:8px 12px 8px 20px;border-bottom:1px solid var(--border);min-width:140px;"><div style="position:relative;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden;"><div style="position:absolute;left:0;top:0;height:100%;width:${score}%;background:${tier.color};border-radius:4px;transition:width .3s;"></div></div></td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;"><span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${cnt} metrics</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);"><span class="tier-badge" style="background:${tier.bg};color:${tier.color};">${tier.label}</span></td>
    </tr>`;
  }).join('');

  if (entries.length === 0) {
    return `<div style="color:var(--text3);font-size:13px;font-family:'DM Mono',monospace;padding:24px 0;">No athletes match the current filter.</div>`;
  }
  return `<table class="sticky-table tbl-base">
      <thead><tr>
        <th style="${thC}text-align:center;width:36px;">#</th>
        <th style="${thC}text-align:left;">Athlete</th>
        ${sex === 'all' ? `<th style="${thC}text-align:center;">Sex</th>` : ''}
        <th style="${thC}text-align:right;">Composite</th>
        <th style="padding:6px 20px 10px;border-bottom:1px solid var(--border2);"></th>
        <th style="${thC}text-align:center;">Metrics</th>
        <th style="${thC}">Tier</th>
      </tr></thead>
      <tbody>${compRows}</tbody>
    </table>
    <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:10px;">
      ${entries.length} athlete${entries.length!==1?'s':''} · composite = avg percentile across all active metrics · sex-specific norms
      ${lbMeasuredOnly ? ' · <span style="color:var(--green);">full athletes only</span>' : ''}
    </div>`;
}

// ── Single-metric leaderboard ──
// Returns HTML; the orchestrator (renderLeaderboard) places it into the DOM.
function _renderLbMetric(metric, sex) {
  const metKey = metric.key;
  let pool = ATHLETE_DB.filter(a => {
    if (sex !== 'all' && a.sex !== sex) return false;
    if (lbMeasuredOnly && (!a.measured || !a.measured[metKey])) return false;
    return (a[metKey] || 0) > 0;
  });

  // sort: lower = better for inv metrics, higher = better otherwise
  pool = [...pool].sort((a, b) => metric.inv ? a[metKey] - b[metKey] : b[metKey] - a[metKey]);

  const decimals = metric.step < 0.1 ? 2 : 1;
  const best = pool[0]?.[metKey] || 1;

  const rows = pool.map((a, i) => {
    const val = a[metKey];
    const n = _lbNormFor(a.sex);
    const pct = calcPercentile(val, n[metKey], metric.inv);
    const tier = getTier(pct);
    const est = isEstimatedForAthlete(metKey, a);
    const worst = pool[pool.length-1]?.[metKey];
    const barPct = metric.inv
      ? (val > 0 && worst > 0 ? Math.max(5, Math.round((worst / val) * 100)) : 5)
      : Math.round((val / best) * 100);
    const sexColor = a.sex === 'M' ? 'var(--blue)' : 'var(--purple)';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    const sexCell = sex === 'all'
      ? `<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;"><span style="font-size:11px;font-family:'DM Mono',monospace;color:${sexColor};background:${sexColor}22;padding:2px 8px;border-radius:8px;">${a.sex}</span></td>`
      : '';
    return `<tr>
      <td style="padding:8px 10px 8px 6px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;color:var(--text3);font-family:'DM Mono',monospace;text-align:center;width:36px;">${medal || (i+1)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;">
        ${a.custom ? '<span style="color:var(--teal);margin-right:4px;">✦</span>' : ''}${escapeHtml(a.name)}
        ${est ? '' : ''}
      </td>
      ${sexCell}
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">
        <span style="font-size:15px;font-weight:800;font-family:'DM Mono',monospace;color:${tier.color};background:${tier.bg};padding:3px 10px;border-radius:6px;">${val.toFixed(decimals)}</span>
        <span style="font-size:9px;color:var(--text3);margin-left:3px;">${metric.unit}</span>
      </td>
      <td style="padding:8px 12px 8px 20px;border-bottom:1px solid var(--border);min-width:140px;">
        <div style="position:relative;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden;">
          <div style="position:absolute;left:0;top:0;height:100%;width:${barPct}%;background:${tier.color};border-radius:4px;transition:width .3s;"></div>
        </div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;">
        <span style="font-size:12px;font-weight:700;font-family:'DM Mono',monospace;color:${tier.color};">${pct}th</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);">
        <span class="tier-badge" style="background:${tier.bg};color:${tier.color};">${tier.label}</span>
      </td>
    </tr>`;
  }).join('');

  if (pool.length === 0) {
    return `<div style="color:var(--text3);font-size:13px;font-family:'DM Mono',monospace;padding:24px 0;">No athletes match the current filter.</div>`;
  }
  return `<table class="sticky-table tbl-base">
      <thead><tr>
        <th class="tbl-th tbl-th-c" style="width:36px;">#</th>
        <th class="tbl-th tbl-th-l">Athlete</th>
        ${sex === 'all' ? '<th class="tbl-th tbl-th-c">Sex</th>' : ''}
        <th class="tbl-th tbl-th-r">Value</th>
        <th class="tbl-th"></th>
        <th class="tbl-th tbl-th-c">Percentile</th>
        <th class="tbl-th tbl-th-l">Tier</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:10px;">
      ${pool.length} athlete${pool.length!==1?'s':''} · ${metric.label} · sorted ${metric.inv?'low→high (faster = better)':'high→low'}
      ${lbMeasuredOnly ? ' · <span style="color:var(--green);">measured only</span>' : ''}
      · <span style="color:var(--text2);">percentiles are sex-specific</span>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// COACHES PAGE
// ═══════════════════════════════════════════════════════════════
let coachesMeasuredOnly = true;

function coachesToggleMeasured() {
  coachesMeasuredOnly = !coachesMeasuredOnly;
  const btn = document.getElementById('coaches-meas-btn');
  if (btn) {
    btn.style.background  = coachesMeasuredOnly ? 'rgba(52,211,153,0.12)' : 'var(--bg2)';
    btn.style.borderColor = coachesMeasuredOnly ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.13)';
    btn.style.color       = coachesMeasuredOnly ? 'var(--green)'          : 'var(--text3)';
  }
  renderCoachesPage();
}

function renderCoachesPage() {
  document.getElementById('coaches-content').innerHTML =
    buildGroupPanel('M', 'Male') + buildGroupPanel('F', 'Female');

  // Populate per-sex norm selectors (rendered inside the panels)
  ['M','F'].forEach(sex => {
    const sel = document.getElementById(`coaches-norm-${sex}`);
    if (!sel || sel.options.length > 0) return;
    const defaultNorm = `Roster — ${sex==='M'?'Male':'Female'} (Measured)`;
    const sexWord = sex === 'M' ? 'Male' : 'Female';
    Object.keys(INITIAL_NORMS).filter(s => s.includes(sexWord)).forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sel.appendChild(o);
    });
    sel.value = INITIAL_NORMS[defaultNorm] ? defaultNorm : Object.keys(INITIAL_NORMS).find(k=>k.includes(sexWord));
  });
}

function coachesRebuildPanel(sex) {
  // Re-render only the changed panel without touching the other
  const sexLabel = sex === 'M' ? 'Male' : 'Female';
  const sel = document.getElementById(`coaches-norm-${sex}`);
  const normKey = sel ? sel.value : `Roster — ${sexLabel} (Measured)`;
  const wrapper = document.getElementById(`coaches-panel-${sex}`);
  if (wrapper) wrapper.outerHTML = buildGroupPanel(sex, sexLabel, normKey);
  // Re-attach select since outerHTML replaced the element
  const newSel = document.getElementById(`coaches-norm-${sex}`);
  if (newSel && newSel.options.length === 0) {
    const defaultNorm = `Roster — ${sexLabel} (Measured)`;
    Object.keys(INITIAL_NORMS).filter(s => s.includes(sexLabel)).forEach(s => {
      const o = document.createElement('option'); o.value = s; o.textContent = s; newSel.appendChild(o);
    });
    newSel.value = normKey;
  }
}

function buildGroupPanel(sex, sexLabel, normKeyOverride) {
  const defaultNorm = `Roster — ${sexLabel} (Measured)`;
  const normKey = normKeyOverride || defaultNorm;
  const n = norms[normKey] || norms[Object.keys(norms)[0]];

  const sexColor = sex === 'M' ? 'var(--blue)' : 'var(--purple)';
  const sexBg    = sex === 'M' ? 'rgba(96,165,250,0.08)' : 'rgba(167,139,250,0.08)';

  let pool = ATHLETE_DB.filter(a => a.sex === sex);
  if (coachesMeasuredOnly) pool = pool.filter(a => a.measured && METRICS.some(m => !disabledMetrics.has(m.key) && a.measured[m.key]));

  const emptyPanel = `<div class="card" id="coaches-panel-${sex}">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="card-label" style="margin-bottom:0;">${sex==='M'?'♂':'♀'} ${sexLabel} athletes</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;">vs</div>
        <div class="select-wrap" style="min-width:190px;max-width:240px;">
          <select id="coaches-norm-${sex}" onchange="coachesRebuildPanel('${sex}')" style="font-size:11px;padding:5px 26px 5px 8px;"></select>
        </div>
      </div>
    </div>
    <div style="color:var(--text3);font-size:13px;font-family:'DM Mono',monospace;">No athletes found.</div>
  </div>`;

  if (pool.length === 0) return emptyPanel;

  const metStats = METRICS.filter(m => !disabledMetrics.has(m.key) && n[m.key]).map(m => {
    const vals = pool
      .filter(a => (!coachesMeasuredOnly || (a.measured && a.measured[m.key])) && (a[m.key] || 0) > 0)
      .map(a => ({ name: a.name, val: a[m.key], pct: calcPercentile(a[m.key], n[m.key], m.inv) }));
    const avgPct = vals.length ? Math.round(vals.reduce((s,v)=>s+v.pct,0)/vals.length) : null;
    const tier = avgPct !== null ? getTier(avgPct) : {color:'var(--text3)',bg:'var(--bg3)',label:'—'};
    return { ...m, vals, avgPct, tier, n: vals.length };
  }).filter(s => s.avgPct !== null);

  const sorted = [...metStats].sort((a,b) => b.avgPct - a.avgPct);
  const strengths  = sorted.slice(0, 3);
  const weaknesses = sorted.slice(-3).reverse();

  const athleteComposites = pool.map(a => {
    const pcts = metStats
      .filter(ms => (!coachesMeasuredOnly || (a.measured && a.measured[ms.key])) && (a[ms.key]||0) > 0)
      .map(ms => calcPercentile(a[ms.key], n[ms.key], ms.inv));
    const avg = pcts.length ? Math.round(pcts.reduce((s,v)=>s+v,0)/pcts.length) : 0;
    return { name: a.name, avg, tier: getTier(avg) };
  }).filter(a => a.avg > 0).sort((a,b) => b.avg - a.avg);

  const summaryCards = [
    { label:'Athletes',     val: pool.length,  sub: coachesMeasuredOnly ? 'with measured data' : 'total' },
    { label:'Group avg',    val: metStats.length ? Math.round(metStats.reduce((s,m)=>s+m.avgPct,0)/metStats.length)+'th' : '—', sub:'percentile' },
    { label:'Top strength', val: strengths[0]?.label||'—',  sub: strengths[0]  ? strengths[0].avgPct+'th avg'  : '' },
    { label:'Priority area',val: weaknesses[0]?.label||'—', sub: weaknesses[0] ? weaknesses[0].avgPct+'th avg' : '' },
  ].map(c => `<div style="background:${sexBg};border:1px solid ${sexColor}33;border-radius:10px;padding:12px 14px;text-align:center;">
    <div style="font-size:11px;color:${sexColor};font-family:'DM Sans',sans-serif;font-weight:600;margin-bottom:4px;">${c.label}</div>
    <div style="font-size:16px;font-weight:800;color:var(--text1);">${c.val}</div>
    <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;">${c.sub}</div>
  </div>`).join('');

  const strengthRows = (list, icon) => list.map(ms =>
    `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:14px;">${icon}</span>
      <div style="flex:1;font-size:12px;font-weight:600;">${ms.label}</div>
      <span style="font-size:11px;font-family:'DM Mono',monospace;color:${ms.tier.color};background:${ms.tier.bg};padding:2px 8px;border-radius:6px;">${ms.avgPct}th</span>
      <span class="tier-badge" style="background:${ms.tier.bg};color:${ms.tier.color};">${ms.tier.label}</span>
      <span style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;">${ms.n} athletes</span>
    </div>`
  ).join('');

  const barRows = sorted.map(ms =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="width:110px;font-size:12px;font-weight:500;color:var(--text3);font-family:'DM Sans',sans-serif;flex-shrink:0;">${ms.label}</div>
      <div style="flex:1;position:relative;height:14px;background:var(--bg3);border-radius:4px;overflow:hidden;">
        <div style="position:absolute;left:0;top:0;height:100%;width:${ms.avgPct}%;background:${ms.tier.color};border-radius:4px;opacity:0.85;"></div>
        <div style="position:absolute;left:85%;top:0;width:2px;height:100%;background:rgba(255,255,255,0.2);"></div>
      </div>
      <div style="width:36px;font-size:11px;font-weight:800;font-family:'DM Mono',monospace;color:${ms.tier.color};text-align:right;">${ms.avgPct}%</div>
    </div>`
  ).join('');

  const topAthletes = athleteComposites.slice(0,5).map((a,i) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;width:16px;flex-shrink:0;">${i+1}</span>
      <div style="font-size:12px;font-weight:600;margin-right:8px;">${escapeHtml(a.name)}</div>
      <span style="font-size:11px;font-family:'DM Mono',monospace;color:${a.tier.color};background:${a.tier.bg};padding:1px 7px;border-radius:6px;white-space:nowrap;">${a.avg}th</span>
    </div>`
  ).join('');

  const COACHING_TIPS = {
    cmj:       { title:'Vertical jump',        tip:'Prioritise reactive plyometrics — depth jumps, continuous hurdle hops, and loaded jump squats to drive CMJ height.' },
    power:     { title:'Peak power',           tip:'Add Olympic lifting variations (hang clean, power snatch) and short-contact box jumps to maximise rate of force development into peak power output.' },
    rfd:       { title:'Rate of force dev',    tip:'Incorporate ballistic exercises — jump squats, medicine-ball throws, and sprint-specific resisted starts — to sharpen neuromuscular firing rate.' },
    eccBrakingRFD: { title:'Ecc braking RFD',  tip:'Train eccentric absorption with tempo squats (4-1-1), heavy eccentric step-downs, and drop-landing progressions to build the braking phase that fuels reactive power.' },
    rsi:       { title:'Reactive strength',    tip:'Build RSI with a progressive drop-jump programme. Focus on short ground-contact times and stiffness cues; add ankle stiffness drills and bounding.' },
    sprint10:  { title:'10 yd acceleration',  tip:'Target starting mechanics: sled pushes at 80 % BW, wicket drills for stride frequency, and hip-flexor strength work to improve first-step explosiveness.' },
    sprintFly: { title:'Max velocity',         tip:'Address top-end speed with fly 10s, wicket runs, and A-skip / B-skip progressions. Focus on posture, dorsiflexion, and front-side mechanics.' },
    broad:     { title:'Broad jump',           tip:'Develop horizontal power through broad-jump progressions, single-leg bounding, and hip-dominant pulls (Romanian deadlifts, hip thrusts).' },
    shuttle:   { title:'Change of direction',  tip:'Sharpen COD with 5-10-5 rep work, deceleration coaching, and lateral band walks to build hip stability and plant-foot power.' },
  };

  const coachingRecs = weaknesses.slice(0, 3).map(ms => {
    const tip = COACHING_TIPS[ms.key];
    if (!tip) return '';
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-size:12px;font-weight:600;color:${ms.tier.color};font-family:'DM Sans',sans-serif;">${tip.title}</span>
        <span style="font-size:10px;font-family:'DM Mono',monospace;color:${ms.tier.color};background:${ms.tier.bg};padding:1px 6px;border-radius:5px;">${ms.avgPct}th avg</span>
      </div>
      <div style="font-size:11px;color:var(--text2);line-height:1.5;">${tip.tip}</div>
    </div>`;
  }).join('');

  return `<div class="card" id="coaches-panel-${sex}">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="card-label" style="margin-bottom:0;">${sex==='M'?'♂':'♀'} ${sexLabel} athletes</div>
        <span style="font-size:11px;font-family:'DM Mono',monospace;padding:3px 10px;border-radius:8px;background:${sexBg};color:${sexColor};border:1px solid ${sexColor}44;">${pool.length} athletes</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;">vs</div>
        <div class="select-wrap" style="min-width:190px;max-width:240px;">
          <select id="coaches-norm-${sex}" onchange="coachesRebuildPanel('${sex}')" style="font-size:11px;padding:5px 26px 5px 8px;"></select>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px;">${summaryCards}</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--green);font-family:'DM Sans',sans-serif;margin-bottom:8px;">▲ Group strengths</div>
        ${strengthRows(strengths,'💪')}
      </div>
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--orange);font-family:'DM Sans',sans-serif;margin-bottom:8px;">▼ Priority areas</div>
        ${strengthRows(weaknesses,'🎯')}
      </div>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:12px;font-weight:600;color:var(--text3);font-family:'DM Sans',sans-serif;margin-bottom:10px;">Group avg percentile per metric</div>
      ${barRows}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text3);font-family:'DM Sans',sans-serif;margin-bottom:8px;">Top performers (composite avg)</div>
        ${topAthletes || '<div style="color:var(--text3);font-size:12px;">No data</div>'}
      </div>
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--orange);font-family:'DM Sans',sans-serif;margin-bottom:8px;">Coaching focus areas</div>
        ${coachingRecs || '<div style="color:var(--text3);font-size:12px;">No priority areas identified.</div>'}
      </div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN RENDER
// ═══════════════════════════════════════════════════════════════
// RENDER — metrics breakdown table
// ═══════════════════════════════════════════════════════════════
function renderMetricsTable(results) {
  const display = measuredOnlyMode ? results.filter(r => !isEstimated(r.key)) : results;
  const sorted = [...display].sort((a,b) => b.percentile - a.percentile);
  const rows = sorted.map(r => {
    const d = r.step < 0.1 ? 2 : 1;
    const estMark = '';
    // gap as % of target: positive = exceeding target, negative = below target.
    // Direction is normalized so positive always means "better" regardless of inverse metrics.
    const gapRaw = r.inv ? (r.target85 - r.val) : (r.val - r.target85);
    const hasData = r.val > 0 && r.target85 > 0;
    const gapPct = hasData ? (gapRaw / r.target85) * 100 : 0;
    const gapStr = hasData
      ? (gapPct >= 0 ? '+' : '') + gapPct.toFixed(1) + '%'
      : '—';
    const gapColor = !hasData ? 'var(--text3)' : (r.meetingTarget ? 'var(--green)' : 'var(--orange)');
    const valDisplay = r.val > 0 ? r.val.toFixed(d) : '—';
    return `<tr>
      <td style="padding:5px 8px 5px 0;border-bottom:1px solid var(--border);font-size:12px;font-weight:500;color:var(--text3);font-family:'DM Sans',sans-serif;white-space:nowrap;width:35%;">
        ${r.label}${estMark}
      </td>
      <td style="padding:5px 6px;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap;width:22%;">
        <span style="display:inline-block;font-size:13px;font-weight:800;font-family:'DM Mono',monospace;color:${r.tier.color};background:${r.tier.bg};padding:2px 10px;border-radius:5px;min-width:78px;text-align:center;">
          ${valDisplay}<span style="font-size:0.7em;opacity:0.6;font-weight:500;margin-left:4px;">${r.unit}</span>
        </span>
      </td>
      <td style="padding:5px 6px;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap;width:22%;">
        <span style="display:inline-block;font-size:13px;font-family:'DM Mono',monospace;color:var(--text2);min-width:78px;text-align:center;">
          ${r.target85.toFixed(d)}<span style="font-size:0.75em;opacity:0.55;margin-left:4px;">${r.unit}</span>
        </span>
      </td>
      <td style="padding:5px 0 5px 8px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;font-family:'DM Sans',sans-serif;color:${gapColor};text-align:center;white-space:nowrap;width:21%;">
        ${hasData ? (r.meetingTarget ? '✓ ' : '▲ ') : ''}${gapStr}
      </td>
    </tr>`;
  }).join('');

  document.getElementById('metrics-breakdown-table').innerHTML = `
    <div style="border-top:1px solid var(--border);margin-top:14px;padding-top:12px;">
      <table class="tbl-base">
        <thead><tr>
          <th style="padding:0 8px 7px 0;font-size:12px;color:var(--text3);font-family:'DM Sans',sans-serif;font-weight:600;text-align:left;font-weight:700;border-bottom:1px solid var(--border2);width:35%;">Metric</th>
          <th style="padding:0 6px 7px;font-size:12px;color:var(--text3);font-family:'DM Sans',sans-serif;font-weight:600;text-align:center;font-weight:700;border-bottom:1px solid var(--border2);width:22%;">Athlete</th>
          <th style="padding:0 6px 7px;font-size:12px;color:var(--text3);font-family:'DM Sans',sans-serif;font-weight:600;text-align:center;font-weight:700;border-bottom:1px solid var(--border2);width:22%;">85th Target</th>
          <th style="padding:0 0 7px 8px;font-size:12px;color:var(--text3);font-family:'DM Sans',sans-serif;font-weight:600;text-align:center;font-weight:700;border-bottom:1px solid var(--border2);width:21%;">Gap</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
function renderAll(rebuildInputs=true) {
  if (rebuildInputs) renderInputGrid();
  else METRICS.forEach(m=>{const el=document.getElementById('inp-'+m.key);if(el)el.value=athleteData[m.key];});
  updateNormDisplay();
  const results = getResults();
  const matrix  = computeMatrixProfile(results);
  renderSummaryCards(results, matrix);
  renderBarChart(results);
  renderMetricsTable(results);
  renderMatrix(matrix);
  renderCoaching(results);
  // re-apply 'measured' mode if active, as the set changes per athlete
  if (selectedChartMode === 'measured') {
    selectedChartKeys = new Set(METRICS.filter(m => !isEstimatedForAthlete(m.key, currentAthlete)).map(m => m.key));
  }
  renderSelectedChart();
  renderCompareTable();
  saveState();
}

// ═══════════════════════════════════════════════════════════════
// PERSIST STATE — per-coach, synced to Supabase
// ═══════════════════════════════════════════════════════════════
function stateKey()   { return 'kinetic_v1:' + (currentCoach || 'anon'); }
function stateTsKey() { return stateKey() + ':ts'; }

let _stateSyncTimer = null;

function buildStateObj() {
  return {
    athlete:          currentAthlete?.name,
    norm:             selectedNorm,
    tab:              activeTab,
    suppressEstimated,
    measuredOnlyMode,
    rosterFullOnly,
    compactRoster,
    disabledMetrics:  [...disabledMetrics],
    coreMeasuredKeys: [...coreMeasuredKeys],
    tierThresholds,
    matrixThreshold,
    selectedChartMode,
    testActiveGroup,
    testSex,
    testAthlete,
    testNorm
  };
}

function saveState() {
  if (!currentCoach) return;
  const obj = buildStateObj();
  const now = Date.now();
  try {
    localStorage.setItem(stateKey(), JSON.stringify(obj));
    localStorage.setItem(stateTsKey(), String(now));
  } catch(e) {}
  // Debounced push to Supabase
  clearTimeout(_stateSyncTimer);
  _stateSyncTimer = setTimeout(() => syncStateToSupabase(obj, now), 600);
}

async function syncStateToSupabase(obj, ts) {
  if (!currentCoach) return;
  try {
    await fetch(SUPABASE_URL + '/rest/v1/coach_state?on_conflict=coach_id', {
      method: 'POST',
      headers: { ...SUPABASE_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        coach_id: currentCoach,
        state: obj,
        updated_at: new Date(ts).toISOString(),
      }),
    });
  } catch(e) { console.warn('coach_state sync failed:', e); }
}

async function pullStateFromSupabase() {
  if (!currentCoach) return;
  try {
    const url = SUPABASE_URL + '/rest/v1/coach_state?coach_id=eq.'
              + encodeURIComponent(currentCoach) + '&select=state,updated_at&limit=1';
    const resp = await fetch(url, { headers: SUPABASE_HEADERS });
    if (!resp.ok) return;
    const rows = await resp.json();
    if (!rows.length) return;
    const remoteTs = new Date(rows[0].updated_at).getTime();
    const localTs  = parseInt(localStorage.getItem(stateTsKey()) || '0', 10);
    if (remoteTs > localTs) {
      localStorage.setItem(stateKey(), JSON.stringify(rows[0].state));
      localStorage.setItem(stateTsKey(), String(remoteTs));
    }
  } catch(e) { console.warn('coach_state pull failed:', e); }
}

function loadState() {
  if (!currentCoach) return;
  try {
    const raw = localStorage.getItem(stateKey());
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.athlete) {
      const a = ATHLETE_DB.find(x => x.name === s.athlete);
      if (a) { currentAthlete = a; athleteData = Object.assign({}, a); }
    }
    if (s.norm && norms[s.norm])           selectedNorm      = s.norm;
    if (s.suppressEstimated !== undefined) suppressEstimated = s.suppressEstimated;
    if (s.measuredOnlyMode  !== undefined) measuredOnlyMode  = s.measuredOnlyMode;
    if (s.rosterFullOnly    !== undefined) rosterFullOnly    = s.rosterFullOnly;
    if (s.compactRoster     !== undefined) compactRoster     = s.compactRoster;
    if (Array.isArray(s.disabledMetrics))  disabledMetrics   = new Set(s.disabledMetrics);
    if (Array.isArray(s.coreMeasuredKeys)) coreMeasuredKeys  = new Set(s.coreMeasuredKeys);
    if (Array.isArray(s.tierThresholds) && s.tierThresholds.length === 4) tierThresholds = s.tierThresholds;
    if (typeof s.matrixThreshold === 'number') matrixThreshold = s.matrixThreshold;
    if (s.selectedChartMode) selectedChartMode = s.selectedChartMode;
    if (s.testActiveGroup)   testActiveGroup   = s.testActiveGroup;
    if (s.testSex)           testSex           = s.testSex;
    if (s.testAthlete)       testAthlete       = s.testAthlete;
    if (s.testNorm && norms[s.testNorm]) testNorm = s.testNorm;
    if (s.tab)               activeTab         = s.tab;
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
// ===============================================================
// SETTINGS TAB
// ===============================================================
function toggleAllMetrics() {
  if (disabledMetrics.size === 0) {
    METRICS.slice(1).forEach(m => disabledMetrics.add(m.key));
  } else {
    disabledMetrics.clear();
  }
  renderSettings();
  renderAll(false);
  const pr = document.getElementById('pane-roster');
  const pf = document.getElementById('pane-flags');
  const pl = document.getElementById('pane-leaderboard');
  const pc = document.getElementById('pane-coaches');
  if (pr && pr.style.display !== 'none') renderRosterTable();
  if (pf && pf.style.display !== 'none') renderFlags();
  if (pl && pl.style.display !== 'none') renderLeaderboard();
  if (pc && pc.style.display !== 'none') renderCoachesPage();
}

function toggleMetricEnabled(key) {
  if (disabledMetrics.has(key)) {
    disabledMetrics.delete(key);
  } else {
    if (disabledMetrics.size >= METRICS.length - 1) return;
    disabledMetrics.add(key);
  }
  renderSettings();
  renderAll(false);
  const pr = document.getElementById('pane-roster');
  const pf = document.getElementById('pane-flags');
  const pl = document.getElementById('pane-leaderboard');
  const pc = document.getElementById('pane-coaches');
  if (pr && pr.style.display !== 'none') renderRosterTable();
  if (pf && pf.style.display !== 'none') renderFlags();
  if (pl && pl.style.display !== 'none') renderLeaderboard();
  if (pc && pc.style.display !== 'none') renderCoachesPage();
}

function updateTierThreshold(idx, val) {
  const v = Math.round(parseFloat(val));
  if (isNaN(v) || v < 1 || v > 99) return;
  tierThresholds[idx] = v;
  renderSettings();
  renderAll(false);
}

function updateMatrixThreshold(val) {
  matrixThreshold = Math.round(parseFloat(val));
  const el = document.getElementById('matrix-thr-display');
  if (el) el.textContent = matrixThreshold + 'th';
  const desc = document.getElementById('matrix-thr-desc');
  if (desc) desc.textContent = 'Force score >= ' + matrixThreshold + ' = high  ·  Reactive score >= ' + matrixThreshold + ' = high';
  renderAll(false);
}

function toggleCompactRoster() {
  compactRoster = !compactRoster;
  document.body.classList.toggle('compact', compactRoster);
  renderSettings();
  renderRosterTable();
  renderAll(false);
  saveState();
}

function applyCompactClass() {
  document.body.classList.toggle('compact', !!compactRoster);
}

function toggleHistorySmoothing() {
  historySmoothing = !historySmoothing;
  renderSettings();
  renderHistoryTab();
}

function resetSettings() {
  disabledMetrics   = new Set();
  coreMeasuredKeys  = new Set(CORE_MEASURED_DEFAULTS);
  tierThresholds    = [...DEFAULT_TIER_THRESHOLDS];
  matrixThreshold   = DEFAULT_MATRIX_THRESHOLD;
  compactRoster     = false;
  historySmoothing  = false;
  renderSettings();
  renderRosterTable();
  renderAll(false);
}

function renderSettings() {
  const pane = document.getElementById('pane-settings');
  if (!pane) return;

  const metGrid = METRICS.map(m => {
    const on = !disabledMetrics.has(m.key);
    const c  = on ? 'var(--gold)'              : 'var(--text3)';
    const bg = on ? 'rgba(240,192,64,0.08)'   : 'var(--bg2)';
    const bd = on ? 'rgba(240,192,64,0.35)'   : 'var(--border)';
    const statusColor = on ? '#34d399' : 'rgba(248,113,113,0.7)';
    const statusBg    = on ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)';
    const statusBd    = on ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)';
    return '<button onclick="toggleMetricEnabled(\'' + m.key + '\')" style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:10px 14px;border-radius:var(--radius-md);border:1px solid ' + bd + ';background:' + bg + ';cursor:pointer;transition:all .15s;text-align:left;width:100%;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:6px;">'
      + '<span style="font-size:13px;font-weight:600;font-family:\'DM Sans\',sans-serif;color:' + c + ';">' + m.label + '</span>'
      + '<span style="font-size:11px;font-weight:600;font-family:\'DM Sans\',sans-serif;color:' + statusColor + ';background:' + statusBg + ';border:1px solid ' + statusBd + ';padding:1px 7px;border-radius:4px;">' + (on ? 'On' : 'Off') + '</span>'
      + '</div>'
      + '<span style="font-size:10px;color:var(--text3);">' + m.unit + '</span>'
      + '</button>';
  }).join('');

  const tierInputs = TIERS.slice(0, -1).map((t, i) =>
    '<div style="display:flex;flex-direction:column;gap:5px;">'
    + '<div style="display:flex;align-items:center;gap:6px;">'
    + '<div style="width:8px;height:8px;border-radius:50%;background:' + t.color + ';flex-shrink:0;"></div>'
    + '<span style="font-size:10px;font-weight:700;font-family:\'DM Mono\',monospace;color:' + t.color + ';">' + t.label + '</span>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:6px;">'
    + '<span style="font-size:10px;color:var(--text3);">&ge;</span>'
    + '<input type="number" min="1" max="99" value="' + tierThresholds[i] + '" oninput="updateTierThreshold(' + i + ',this.value)" style="width:56px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-md);color:var(--text);font-family:\'DM Mono\',monospace;font-size:13px;font-weight:700;padding:5px 8px;text-align:center;" />'
    + '<span style="font-size:10px;color:var(--text3);">th pct</span>'
    + '</div></div>'
  ).join('');

  const suppBg  = suppressEstimated ? 'rgba(52,211,153,0.12)' : 'var(--bg3)';
  const suppBd  = suppressEstimated ? 'rgba(52,211,153,0.45)' : 'var(--border2)';
  const suppCol = suppressEstimated ? 'var(--green)'          : 'var(--text3)';
  const activeCount = METRICS.length - disabledMetrics.size;

  const coreGrid = METRICS.map(m => {
    const on = coreMeasuredKeys.has(m.key);
    const c  = on ? 'var(--green)'          : 'var(--text3)';
    const bg = on ? 'rgba(52,211,153,0.08)' : 'var(--bg2)';
    const bd = on ? 'rgba(52,211,153,0.35)' : 'var(--border)';
    const sc = on ? '#34d399' : 'rgba(248,113,113,0.7)';
    const sb = on ? 'rgba(52,211,153,0.1)'  : 'rgba(248,113,113,0.1)';
    const sd = on ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)';
    return '<button onclick="toggleCoreMetric(\'' + m.key + '\')" style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:10px 14px;border-radius:var(--radius-md);border:1px solid ' + bd + ';background:' + bg + ';cursor:pointer;transition:all .15s;text-align:left;width:100%;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:6px;">'
      + '<span style="font-size:13px;font-weight:600;font-family:\'DM Sans\',sans-serif;color:' + c + ';">' + m.label + '</span>'
      + '<span style="font-size:11px;font-weight:600;font-family:\'DM Sans\',sans-serif;color:' + sc + ';background:' + sb + ';border:1px solid ' + sd + ';padding:1px 7px;border-radius:4px;">' + (on ? 'Required' : 'Optional') + '</span>'
      + '</div>'
      + '<span style="font-size:10px;color:var(--text3);">' + m.unit + '</span>'
      + '</button>';
  }).join('');

  function settingRow(label, desc, toggleFn, isOn) {
    const bg  = isOn ? 'rgba(52,211,153,0.12)' : 'var(--bg3)';
    const bd  = isOn ? 'rgba(52,211,153,0.45)' : 'var(--border2)';
    const col = isOn ? 'var(--green)'           : 'var(--text3)';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg3);border-radius:var(--radius-md);border:1px solid var(--border);margin-bottom:8px;">'
      + '<div><div style="font-size:13px;font-weight:600;">' + label + '</div>'
      + '<div style="font-size:11px;color:var(--text3);margin-top:2px;">' + desc + '</div></div>'
      + '<button onclick="' + toggleFn + '()" style="padding:6px 16px;border-radius:var(--radius-md);border:1px solid ' + bd + ';background:' + bg + ';color:' + col + ';font-size:12px;font-weight:600;font-family:\'DM Sans\',sans-serif;cursor:pointer;transition:all .15s;flex-shrink:0;margin-left:16px;">' + (isOn ? 'On' : 'Off') + '</button>'
      + '</div>';
  }

  const leftCol = '<div style="display:flex;flex-direction:column;gap:14px;">'

    + '<div class="card">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    + '<div class="card-label" style="margin-bottom:0;">Active Metrics</div>'
    + '<div style="display:flex;align-items:center;gap:10px;">'
    + '<span style="font-size:10px;color:var(--text3);font-family:\'DM Mono\',monospace;">' + activeCount + ' / ' + METRICS.length + ' active</span>'
    + '<button onclick="toggleAllMetrics()" style="font-size:10px;font-family:\'DM Mono\',monospace;padding:3px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--border2);background:var(--bg3);color:var(--text3);transition:all .15s;" onmouseover="this.style.color=\'var(--text)\'" onmouseout="this.style.color=\'var(--text3)\'">' + (disabledMetrics.size === 0 ? 'Disable all' : 'Enable all') + '</button>'
    + '</div>'
    + '</div>' // end flex header row
    + '<div style="font-size:11px;color:var(--text2);line-height:1.55;margin-bottom:12px;">Disabled metrics are excluded from composite scores, coaching priorities, bar charts, comparison tables, leaderboard, and matrix calculations. Raw values still appear in the roster.</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px;">' + metGrid + '</div>'
    + '</div>'

    + '<div class="card">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    + '<div class="card-label" style="margin-bottom:0;">Full Athlete Definition</div>'
    + '<span style="font-size:10px;color:var(--text3);font-family:\'DM Mono\',monospace;">' + coreMeasuredKeys.size + ' required</span>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--text2);line-height:1.55;margin-bottom:12px;">Required metrics for an athlete to be considered fully measured (green name, sorts to top of roster).</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px;">' + coreGrid + '</div>'
    + '</div>'

    + '</div>';

  const rightCol = '<div style="display:flex;flex-direction:column;gap:14px;min-width:300px;">'

    + '<div class="card">'
    + '<div class="card-label">Performance Tiers</div>'
    + '<div style="font-size:11px;color:var(--text2);line-height:1.55;margin-bottom:16px;">Minimum percentile for each tier. Applies globally to all badges, scores, and coaching.</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;">' + tierInputs + '</div>'
    + '</div>'

    + '<div class="card">'
    + '<div class="card-label">Matrix Quadrant Threshold</div>'
    + '<div style="font-size:11px;color:var(--text2);line-height:1.55;margin-bottom:14px;">Percentile boundary separating high from low on the force–reactive matrix.</div>'
    + '<div style="display:flex;align-items:center;gap:14px;">'
    + '<input type="range" min="20" max="80" value="' + matrixThreshold + '" oninput="updateMatrixThreshold(this.value)" style="flex:1;accent-color:var(--gold);height:4px;" />'
    + '<span id="matrix-thr-display" style="font-size:20px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--gold);min-width:52px;">' + matrixThreshold + 'th</span>'
    + '</div>'
    + '<div id="matrix-thr-desc" style="margin-top:10px;font-size:10px;color:var(--text3);font-family:\'DM Mono\',monospace;">Force score &ge; ' + matrixThreshold + ' = high &nbsp;&middot;&nbsp; Reactive score &ge; ' + matrixThreshold + ' = high</div>'
    + '</div>'

    + '<div class="card">'
    + '<div class="card-label">Display</div>'
    + settingRow('Hide untested metrics', 'Exclude metrics with no measured value from all calculations, charts, and comparisons', 'toggleSuppressEstimated', suppressEstimated)
    + settingRow('Compact mode', 'Reduce padding and row height across the dashboard to fit more on screen', 'toggleCompactRoster', compactRoster)
    + settingRow('Smooth history curves', 'Use bezier curves instead of straight lines in history charts', 'toggleHistorySmoothing', historySmoothing)
    + '</div>'

    + '<div>'
    + '<button class="btn" onclick="resetSettings()" style="background:transparent;border-color:rgba(248,113,113,0.35);color:rgba(248,113,113,0.8);width:100%;" onmouseover="this.style.borderColor=\'var(--red)\';this.style.color=\'var(--red)\'" onmouseout="this.style.borderColor=\'rgba(248,113,113,0.35)\';this.style.color=\'rgba(248,113,113,0.8)\'">Reset all settings to defaults</button>'
    + '</div>'

    + '</div>';

  pane.innerHTML = '<div style="display:grid;grid-template-columns:1fr 340px;gap:14px;align-items:start;">'
    + leftCol + rightCol
    + '</div>';
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE LOADER + ASYNC INIT
// ═══════════════════════════════════════════════════════════════

// ── Toast notification ──
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:var(--bg3);border:1px solid var(--border2);color:var(--text);font-family:\'DM Mono\',monospace;font-size:11px;padding:9px 14px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.4);transition:opacity 0.4s;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2000);
}

// ── Build ATHLETE_DB from Supabase response ──
function buildAthleteFromSupabase(row) {
  // Track per-source best per metric so we can prefer FD even when its value
  // is "lower" than non-FD readings. Shape: { metric: { source: bestVal } }.
  const perSource = {};

  (row.sessions || []).forEach(session => {
    (session.measurements || []).forEach(m => {
      const key = m.metric;
      const val = parseFloat(m.value) || 0;
      if (!val) return;
      const src = m.source || 'manual';
      if (!perSource[key]) perSource[key] = {};
      const cur = perSource[key][src];
      if (cur === undefined || (INVERSE_METRICS.has(key) ? val < cur : val > cur)) {
        perSource[key][src] = val;
      }
    });
  });

  // Resolve display value per metric: prefer FD when present, otherwise pick
  // the best across remaining sources.
  const bestValues = {};
  const bestSource = {};
  Object.keys(perSource).forEach(key => {
    const sources = perSource[key];
    if ('FD' in sources) {
      bestValues[key] = sources['FD'];
      bestSource[key] = 'FD';
      return;
    }
    const inv = INVERSE_METRICS.has(key);
    let bestVal = inv ? Infinity : -Infinity;
    let bestSrc = null;
    Object.entries(sources).forEach(([src, v]) => {
      if (inv ? v < bestVal : v > bestVal) { bestVal = v; bestSrc = src; }
    });
    bestValues[key] = bestVal;
    bestSource[key] = bestSrc;
  });

  const ALL_KEYS = ['cmj','power','rfd','eccBrakingRFD','rsi','sprint10','sprintFly','sprint1020','broad','shuttle'];

  const measured = {};
  ALL_KEYS.forEach(k => {
    measured[k] = bestSource[k] !== undefined && bestSource[k] !== 'estimated';
  });

  const athlete = {
    name: row.name,
    sex: row.sex,
    _supabase_id: row.id,
    _sessions: row.sessions || [],
    measured,
    rsiMeasured: bestSource['rsi'] !== undefined && bestSource['rsi'] !== 'estimated',
    cmjFD: bestSource['cmj'] === 'FD',
    rsiFD: bestSource['rsi'] === 'FD',
  };

  ALL_KEYS.forEach(k => { athlete[k] = bestValues[k] || 0; });

  return athlete;
}

// ── Async Supabase data loader ──
async function loadFromSupabase() {
  const url = SUPABASE_URL + '/rest/v1/athletes?select=*,sessions(id,session_date,notes,measurements(metric,value,source))';
  const resp = await fetch(url, { headers: SUPABASE_HEADERS });
  if (!resp.ok) throw new Error('Supabase HTTP ' + resp.status);
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Empty response');
  return rows.map(buildAthleteFromSupabase);
}

// ── Save new session to Supabase (fire-and-forget) ──
async function saveSessionToSupabase(athlete, metricsMap, date) {
  if (!athlete._supabase_id) return;
  const sessionDate = date || new Date().toISOString().slice(0,10);
  try {
    const sessResp = await fetch(SUPABASE_URL + '/rest/v1/sessions', {
      method: 'POST',
      headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify({ athlete_id: athlete._supabase_id, session_date: sessionDate, notes: 'Manual entry' })
    });
    if (!sessResp.ok) throw new Error('Session insert failed');
    const sessArr = await sessResp.json();
    const sessionId = sessArr[0].id;

    const measurements = Object.entries(metricsMap)
      .filter(([,v]) => v.value !== null && v.value !== undefined && v.value !== '')
      .map(([metric, v]) => ({ session_id: sessionId, metric, value: parseFloat(v.value), source: v.source || 'manual' }));

    if (measurements.length > 0) {
      await fetch(SUPABASE_URL + '/rest/v1/measurements', {
        method: 'POST',
        headers: SUPABASE_HEADERS,
        body: JSON.stringify(measurements)
      });
    }
    showToast('Saved to database');
  } catch(e) {
    console.error('Supabase save error:', e);
    showToast('Saved locally (DB sync failed)');
  }
}

// ── Rename / update sex of an existing athlete in Supabase ──
async function renameAthleteInSupabase(id, name, sex) {
  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/athletes?id=eq.' + id, {
      method: 'PATCH',
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({ name, sex })
    });
    if (!resp.ok) throw new Error('Athlete update failed');
    showToast('Athlete updated in database');
  } catch(e) {
    console.error('Supabase rename error:', e);
    showToast('Rename saved locally only');
  }
}

// ── Insert new athlete to Supabase ──
async function insertAthleteToSupabase(athlete) {
  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/athletes', {
      method: 'POST',
      headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify({ name: athlete.name, sex: athlete.sex })
    });
    if (!resp.ok) throw new Error('Insert failed');
    const arr = await resp.json();
    athlete._supabase_id = arr[0].id;
    showToast('Athlete created in database');
  } catch(e) {
    console.error('Supabase insert error:', e);
    showToast('Athlete saved locally only');
  }
}

// ── New athlete form ──
let _newAthSex = 'M';
let _newAthCmjFD = false;

function openNewAthletePanel() {
  const p = document.getElementById('new-athlete-panel');
  const open = p.style.display === 'none';
  p.style.display = open ? '' : 'none';
  if (open) {
    document.getElementById('new-ath-name').value = '';
    _newAthSex = 'M';
    setNewAthSex('M');
    _newAthCmjFD = false;
    const cmjBtn = document.getElementById('new-ath-cmjfd');
    if (cmjBtn) { cmjBtn.textContent = '~ Standard sensor'; cmjBtn.style.borderColor = 'rgba(255,255,255,.13)'; cmjBtn.style.background = 'var(--bg2)'; cmjBtn.style.color = 'var(--text3)'; }
    document.getElementById('new-ath-name').focus();
  }
}

function setNewAthSex(sex) {
  _newAthSex = sex;
  const mBtn = document.getElementById('new-ath-m');
  const fBtn = document.getElementById('new-ath-f');
  if (mBtn) {
    mBtn.style.background  = sex==='M' ? 'rgba(96,165,250,0.15)'  : 'var(--bg2)';
    mBtn.style.borderColor = sex==='M' ? 'rgba(96,165,250,0.45)'  : 'var(--border2)';
    mBtn.style.color       = sex==='M' ? 'var(--blue)'            : 'var(--text3)';
  }
  if (fBtn) {
    fBtn.style.background  = sex==='F' ? 'rgba(167,139,250,0.15)' : 'var(--bg2)';
    fBtn.style.borderColor = sex==='F' ? 'rgba(167,139,250,0.45)' : 'var(--border2)';
    fBtn.style.color       = sex==='F' ? 'var(--purple)'          : 'var(--text3)';
  }
}

function toggleNewAthCmjFD() {
  _newAthCmjFD = !_newAthCmjFD;
  const btn = document.getElementById('new-ath-cmjfd');
  if (!btn) return;
  btn.style.borderColor = _newAthCmjFD ? 'rgba(52,211,153,.4)' : 'rgba(255,255,255,.13)';
  btn.style.background  = _newAthCmjFD ? 'rgba(52,211,153,.08)' : 'var(--bg2)';
  btn.style.color       = _newAthCmjFD ? 'var(--green)' : 'var(--text3)';
  btn.textContent       = _newAthCmjFD ? '✓ Force Deck' : '~ Standard sensor';
}

async function submitNewAthlete() {
  const name = (document.getElementById('new-ath-name').value || '').trim();
  if (!name) { showToast('Enter a name'); return; }
  if (ATHLETE_DB.find(a => a.name.toLowerCase() === name.toLowerCase())) {
    showToast('Athlete already exists'); return;
  }
  const newAthlete = { name, sex: _newAthSex, measured: {}, _sessions: [], cmjFD: _newAthCmjFD, rsiFD: false, rsiMeasured: false };
  METRICS.forEach(m => { newAthlete[m.key] = 0; newAthlete.measured[m.key] = false; });
  await insertAthleteToSupabase(newAthlete);
  ATHLETE_DB.push(newAthlete);
  ATHLETE_DB.sort((a,b) => a.name.localeCompare(b.name));
  rebuildAthleteSelector();
  rebuildInitialNorms();
  document.getElementById('new-athlete-panel').style.display = 'none';
  renderRosterTable();
}

function rebuildAthleteSelector() {
  const asel = document.getElementById('athlete-select');
  if (!asel) return;
  const cur = asel.value;
  asel.innerHTML = '';
  ATHLETE_DB.sort((a,b) => a.name.localeCompare(b.name)).forEach(a => {
    const o = document.createElement('option');
    o.value = a.name;
    o.textContent = (hasAllMeasured(a) ? '● ' : '') + a.name + ' (' + a.sex + ')' + (a.custom ? ' ✦' : '');
    if (hasAllMeasured(a)) o.style.color = '#34d399';
    asel.appendChild(o);
  });
  if (cur) asel.value = cur;
}

// ── Rebuild norms after data loads ──
function rebuildInitialNorms() {
  INITIAL_NORMS["Roster — Male (Measured)"]   = computeMeasuredNorms('M');
  INITIAL_NORMS["Roster — Female (Measured)"] = computeMeasuredNorms('F');
  norms = JSON.parse(JSON.stringify(INITIAL_NORMS));
}

// ── Loading progress helper ──
function setLoadingProgress(pct, msg) {
  const bar = document.getElementById('loading-bar');
  const status = document.getElementById('loading-status');
  if (bar) bar.style.width = pct + '%';
  if (status && msg) status.textContent = msg;
}

// ── Async init ──
async function init() {
  setLoadingProgress(10, 'Connecting to database...');

  try {
    setLoadingProgress(25, 'Loading athlete roster...');
    const loaded = await loadFromSupabase();
    ATHLETE_DB = loaded;
    setLoadingProgress(60, `Processing ${ATHLETE_DB.length} athletes...`);
    console.log('Loaded', ATHLETE_DB.length, 'athletes from Supabase');
  } catch(e) {
    console.error('Supabase load failed:', e);
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;max-width:380px;text-align:center;">
        <div style="font-size:28px;">⚠️</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text);">Database Unavailable</div>
        <div style="font-size:13px;color:var(--text3);line-height:1.6;">Could not connect to Supabase. Check your internet connection and try again.</div>
        <div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;background:var(--bg3);padding:8px 14px;border-radius:8px;border:1px solid var(--border);max-width:100%;word-break:break-all;">${e.message}</div>
        <button onclick="location.reload()" style="padding:10px 28px;border-radius:var(--radius-md);border:1px solid rgba(240,192,64,0.4);background:rgba(240,192,64,0.1);color:var(--gold);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;">Retry</button>
      </div>`;
    return;
  }

  setLoadingProgress(70, 'Syncing your layout...');
  await pullStateFromSupabase();

  setLoadingProgress(78, 'Building performance norms...');
  rebuildInitialNorms();

  setLoadingProgress(88, 'Preparing interface...');

  // Athlete selector
  const asel = document.getElementById('athlete-select');
  ATHLETE_DB.sort((a,b)=>a.name.localeCompare(b.name)).forEach(a=>{
    const o = document.createElement('option');
    o.value = a.name;
    o.textContent = (hasAllMeasured(a)?'● ':'') + a.name + ' (' + a.sex + ')';
    if (hasAllMeasured(a)) o.style.color = '#34d399';
    asel.appendChild(o);
  });

  // Norm selector — populated per-sex via rebuildNormSelect()

  // Apply defaults
  currentAthlete = ATHLETE_DB[0];
  athleteData = Object.assign({}, currentAthlete);
  rebuildNormSelect();
  selectedChartKeys = new Set(METRICS.filter(m => !isEstimatedForAthlete(m.key, currentAthlete)).map(m => m.key));

  // Restore saved state (overrides defaults above)
  loadState();

  // Recompute roster norms in case loadState flipped rosterFullOnly
  if (rosterFullOnly) rebuildInitialNorms();

  // Apply any state-driven body classes (compact mode, etc.)
  applyCompactClass();

  // Sync selectors to state (may have changed via loadState)
  document.getElementById('norm-select').value = selectedNorm;
  asel.value = currentAthlete.name;

  syncSuppressButtons();
  updateAthleteAvatar(currentAthlete);
  renderCompareStrip();

  setLoadingProgress(100, 'Ready');
  renderAll();

  // Restore active tab (after renderAll so content is ready)
  if (activeTab !== 'analytics') switchTab(activeTab);

  // Fade out overlay
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 420);
  }

  let _resizeTid;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTid);
    _resizeTid = setTimeout(() => { const r=getResults(); renderMatrix(computeMatrixProfile(r)); }, 150);
  });

  // Arrow key athlete navigation (Left/Right when not typing)
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (activeTab !== 'analytics') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const sel = document.getElementById('athlete-select');
    if (!sel) return;
    const idx = sel.selectedIndex;
    const newIdx = e.key === 'ArrowLeft' ? Math.max(0, idx - 1) : Math.min(sel.options.length - 1, idx + 1);
    if (newIdx !== idx) { sel.selectedIndex = newIdx; onAthleteChange(); e.preventDefault(); }
  });
}

// ═══════════════════════════════════════════════════════════════
// COACH LOGIN (soft client-side gate)
// ═══════════════════════════════════════════════════════════════
// Add new coaches by computing sha256("their-password") and adding here.
const COACHES = {
  matt:   { displayName: 'Coach Matt',   passwordHash: 'c3e64604cb6275890df269cce33991366a0a008a53c5b639206a802759c21fb1' },
  desean: { displayName: 'Coach Desean', passwordHash: '64f363361a0acc78ce6d9e6240ca840dfc9a338bab1a2fcb7c6270baf81b1f86' },
};

let currentCoach = null;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function populateCoachDropdown() {
  const sel = document.getElementById('login-coach');
  if (!sel) return;
  sel.innerHTML = '';
  Object.entries(COACHES).forEach(([id, info]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = info.displayName;
    sel.appendChild(o);
  });
}

async function attemptLogin() {
  const coachId = document.getElementById('login-coach').value;
  const pw      = document.getElementById('login-pw').value;
  const errEl   = document.getElementById('login-error');
  const conf    = COACHES[coachId];
  if (!conf) { errEl.textContent = 'Unknown coach'; errEl.style.display = 'block'; return; }
  const hash = await sha256(pw);
  if (hash !== conf.passwordHash) {
    errEl.textContent = 'Wrong password';
    errEl.style.display = 'block';
    document.getElementById('login-pw').select();
    return;
  }
  sessionStorage.setItem('kb-coach', coachId);
  startApp(coachId);
}

function logout() {
  sessionStorage.removeItem('kb-coach');
  location.reload();
}

function showCoachBadge() {
  const conf = COACHES[currentCoach];
  if (!conf) return;
  const badge = document.getElementById('coach-badge');
  const btn   = document.getElementById('logout-btn');
  if (badge) { badge.textContent = '👤 ' + conf.displayName; badge.style.display = ''; }
  if (btn)   btn.style.display = '';
}

function migrateLegacyState(coachId) {
  // One-time: copy pre-login `kinetic_v1` to this coach's namespaced key
  // so existing layout doesn't disappear on first login.
  const legacy = localStorage.getItem('kinetic_v1');
  const newKey = 'kinetic_v1:' + coachId;
  if (legacy && !localStorage.getItem(newKey)) {
    localStorage.setItem(newKey, legacy);
    localStorage.setItem(newKey + ':ts', String(Date.now()));
  }
}

function startApp(coachId) {
  currentCoach = coachId;
  migrateLegacyState(coachId);
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'none';
  showCoachBadge();
  init();
}

function bootstrap() {
  populateCoachDropdown();
  const saved = sessionStorage.getItem('kb-coach');
  if (saved && COACHES[saved]) {
    startApp(saved);
  } else {
    // login overlay is visible by default; focus the password field
    setTimeout(() => document.getElementById('login-pw')?.focus(), 50);
  }
}

bootstrap();

// ── Bar click detail card ──
(function() {
  const tip = document.getElementById('bar-tooltip');
  if (!tip) return;
  let openRow = null;

  function showTip(row) {
    const parts = (row.dataset.tip || '').split('|');
    // parts: label | raw value+unit | Xth pct | 85th: Y unit
    const pctNum = parseInt((parts[2] || '').replace(/\D/g,'')) || 0;
    const tier = typeof getTier === 'function' ? getTier(pctNum) : { color: 'var(--text)', bg: 'transparent', label: '' };
    tip.innerHTML =
      `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px;">
         <span style="font-size:12px;font-weight:600;color:var(--text3);">${parts[0] || ''}</span>
         <span class="tier-badge" style="background:${tier.bg};color:${tier.color};">${tier.label}</span>
       </div>
       <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px;">
         <span style="font-size:28px;font-weight:900;font-family:'Barlow Condensed',sans-serif;font-style:italic;color:${tier.color};">${parts[1] || '—'}</span>
       </div>
       <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-bottom:10px;">
         <div style="height:100%;width:${pctNum}%;background:${tier.color};border-radius:3px;transition:width .4s;"></div>
       </div>
       <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);">
         <span>${parts[2] || ''}</span>
         <span>${parts[3] || ''}</span>
       </div>`;

    const rect = row.getBoundingClientRect();
    tip.style.left = rect.left + 'px';
    tip.style.top  = (rect.bottom + 6) + 'px';
    // clamp right edge
    requestAnimationFrame(() => {
      const tr = tip.getBoundingClientRect();
      if (tr.right > window.innerWidth - 8) tip.style.left = (window.innerWidth - tr.width - 8) + 'px';
      if (tr.bottom > window.innerHeight - 8) tip.style.top = (rect.top - tr.height - 6) + 'px';
    });
    tip.classList.add('visible');
    openRow = row;
  }

  document.addEventListener('click', e => {
    const row = e.target.closest('.has-tip');
    if (row) {
      if (row === openRow) { tip.classList.remove('visible'); openRow = null; }
      else showTip(row);
      e.stopPropagation();
    } else {
      tip.classList.remove('visible'); openRow = null;
    }
  });
})();

// ═══════════════════════════════════════════════════════════════
// PER-ATHLETE HISTORY MODAL
// ═══════════════════════════════════════════════════════════════
const HISTORY_METRICS = [
  { key:'cmj',        label:'CMJ'    },
  { key:'power',      label:'Power'  },
  { key:'rfd',        label:'RFD'    },
  { key:'eccBrakingRFD', label:'EccBrk' },
  { key:'rsi',        label:'RSI'    },
  { key:'sprint10',   label:'10yd'   },
  { key:'sprintFly',  label:'Fly10'  },
  { key:'sprint1020', label:'10-20'  },
  { key:'broad',      label:'Broad'  },
  { key:'shuttle',    label:'Shuttle'},
];
function openHistoryModal() {
  const a = currentAthlete;
  if (!a) return;

  // Compute per-metric all-time best from _sessions
  const bestPer = {};
  HISTORY_METRICS.forEach(m => {
    let best = null;
    (a._sessions || []).forEach(s => {
      (s.measurements || []).forEach(meas => {
        if (meas.metric !== m.key) return;
        const v = parseFloat(meas.value);
        if (!v) return;
        if (best === null) { best = v; return; }
        best = INVERSE_METRICS.has(m.key) ? Math.min(best, v) : Math.max(best, v);
      });
    });
    bestPer[m.key] = best;
  });

  const sessions = [...(a._sessions || [])].sort((x,y) => y.session_date.localeCompare(x.session_date));

  let rowsHTML = '';
  if (sessions.length === 0) {
    rowsHTML = '<tr><td colspan="' + (HISTORY_METRICS.length+1) + '" style="padding:14px;text-align:center;color:var(--text3);font-family:\'DM Mono\',monospace;font-size:11px;">No sessions recorded yet.</td></tr>';
  } else {
    sessions.forEach(sess => {
      const measMap = {};
      (sess.measurements || []).forEach(m => { measMap[m.metric] = parseFloat(m.value) || 0; });
      let cells = '<td style="padding:6px 10px;white-space:nowrap;font-family:\'DM Mono\',monospace;font-size:11px;border-bottom:1px solid var(--border);">' + (sess.session_date || '—') + '</td>';
      HISTORY_METRICS.forEach(m => {
        const val = measMap[m.key];
        const best = bestPer[m.key];
        const isBest = val && best !== null && Math.abs(val - best) < 0.001;
        const color = isBest ? 'var(--green)' : (val ? 'var(--text)' : 'var(--text3)');
        cells += '<td style="padding:6px 10px;text-align:center;font-family:\'DM Mono\',monospace;font-size:11px;color:' + color + ';border-bottom:1px solid var(--border);">' + (val || '—') + '</td>';
      });
      const delBtn = '<td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:center;">'
        + '<button onclick="deleteSession(\'' + (sess.id||'') + '\')" title="Delete session"'
        + ' style="background:none;border:1px solid rgba(248,113,113,0.3);border-radius:6px;color:rgba(248,113,113,0.5);cursor:pointer;font-size:12px;padding:3px 7px;line-height:1;transition:all .15s;"'
        + ' onmouseover="this.style.borderColor=\'var(--red)\';this.style.color=\'var(--red)\';"'
        + ' onmouseout="this.style.borderColor=\'rgba(248,113,113,0.3)\';this.style.color=\'rgba(248,113,113,0.5)\';">✕</button>'
        + '</td>';
      rowsHTML += '<tr>' + cells + delBtn + '</tr>';
    });
  }

  const headerCells = '<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:500;color:var(--text3);font-family:\'DM Sans\',sans-serif;white-space:nowrap;border-bottom:1px solid var(--border2);">Date</th>'
    + HISTORY_METRICS.map(m => '<th style="padding:6px 10px;text-align:center;font-size:11px;font-weight:500;color:var(--text3);font-family:\'DM Sans\',sans-serif;white-space:nowrap;border-bottom:1px solid var(--border2);">' + m.label + '</th>').join('')
    + '<th style="padding:6px 10px;border-bottom:1px solid var(--border2);"></th>';

  const modalHTML = '<div class="report-header">'
    + '<div><div class="report-name">' + a.name + '</div><div class="report-meta">Session history · ' + sessions.length + ' session' + (sessions.length!==1?'s':'') + '</div></div>'
    + '<button class="btn" onclick="document.getElementById(\'history-overlay\').style.display=\'none\'" style="padding:5px 10px;font-size:13px;">✕</button>'
    + '</div>'
    + '<button class="btn" onclick="openNewSessionForm()" style="margin-bottom:14px;">+ New Session</button>'
    + '<div id="new-session-form-area"></div>'
    + '<div class="tbl-scroll">'
    + '<table class="tbl-base">'
    + '<thead><tr>' + headerCells + '</tr></thead>'
    + '<tbody>' + rowsHTML + '</tbody>'
    + '</table>'
    + '</div>';

  let overlay = document.getElementById('history-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'history-overlay';
    overlay.className = 'report-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = '<div class="report-modal" id="history-modal-content" style="max-width:860px;"></div>';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.body.appendChild(overlay);
  }
  document.getElementById('history-modal-content').innerHTML = modalHTML;
  overlay.style.display = 'flex';
}

async function deleteSession(sessId) {
  if (!sessId) return;
  if (!confirm('Delete this session? This cannot be undone.')) return;

  if (currentAthlete._supabase_id) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/sessions?id=eq.' + sessId, {
        method: 'DELETE', headers: SUPABASE_HEADERS
      });
    } catch(e) { console.error('Supabase session delete error:', e); }
  }

  currentAthlete._sessions = (currentAthlete._sessions || []).filter(s => s.id !== sessId);

  // Recompute best values across remaining sessions
  const ALL_KEYS = ['cmj','power','rfd','eccBrakingRFD','rsi','sprint10','sprintFly','sprint1020','broad','shuttle'];
  const bestValues = {}, bestSource = {};
  (currentAthlete._sessions || []).forEach(session => {
    (session.measurements || []).forEach(m => {
      const val = parseFloat(m.value) || 0;
      if (!val) return;
      const existing = bestValues[m.metric];
      if (existing === undefined) { bestValues[m.metric] = val; bestSource[m.metric] = m.source; }
      else if (INVERSE_METRICS.has(m.metric) ? val < existing : val > existing) {
        bestValues[m.metric] = val; bestSource[m.metric] = m.source;
      }
    });
  });
  ALL_KEYS.forEach(k => { if (bestValues[k] !== undefined) currentAthlete[k] = bestValues[k]; });
  currentAthlete.cmjFD = bestSource['cmj'] === 'FD';
  currentAthlete.rsiFD = bestSource['rsi'] === 'FD';
  athleteData = {...currentAthlete};

  renderAll(true);
  openHistoryModal();
}

function openNewSessionForm() {
  const a = currentAthlete;
  if (!a) return;
  const area = document.getElementById('new-session-form-area');
  if (!area) return;
  if (area.innerHTML.trim()) { area.innerHTML = ''; return; } // toggle

  const sourceOpts = ['FD','sensor','manual'].map(s => '<option value="' + s + '"' + (s==='manual'?' selected':'') + '>' + s + '</option>').join('');

  let fieldRows = HISTORY_METRICS.map(m =>
    '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">'
    + '<label style="width:90px;font-size:11px;font-weight:500;color:var(--text3);font-family:\'DM Sans\',sans-serif;">' + m.label + '</label>'
    + '<input id="ns-inp-' + m.key + '" type="number" step="any" placeholder="—" style="width:80px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:12px;font-family:\'DM Mono\',monospace;color:var(--text);text-align:center;outline:none;">'
    + '<select id="ns-src-' + m.key + '" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:10px;color:var(--text2);font-family:\'DM Mono\',monospace;outline:none;">' + sourceOpts + '</select>'
    + '</div>'
  ).join('');

  area.innerHTML = '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:14px;margin-bottom:14px;">'
    + '<div style="font-size:12px;font-weight:600;color:var(--text3);font-family:\'DM Sans\',sans-serif;margin-bottom:10px;">New session</div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
    + '<label style="font-size:11px;font-weight:500;color:var(--text3);font-family:\'DM Sans\',sans-serif;">Date</label>'
    + '<input id="ns-date" type="date" value="' + new Date().toISOString().slice(0,10) + '" style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px;font-family:\'DM Mono\',monospace;color:var(--text);outline:none;">'
    + '</div>'
    + fieldRows
    + '<div style="margin-top:10px;display:flex;gap:8px;">'
    + '<button class="btn" onclick="submitNewSession()">Save session</button>'
    + '<button class="btn" onclick="document.getElementById(\'new-session-form-area\').innerHTML=\'\'">Cancel</button>'
    + '</div>'
    + '</div>';
}

async function submitNewSession() {
  const a = currentAthlete;
  if (!a) return;
  const dateVal = document.getElementById('ns-date').value;
  if (!dateVal) { showToast('Please pick a date'); return; }

  const metricsMap = {};
  HISTORY_METRICS.forEach(m => {
    const inp = document.getElementById('ns-inp-' + m.key);
    const src = document.getElementById('ns-src-' + m.key);
    if (inp && inp.value !== '') {
      metricsMap[m.key] = { value: inp.value, source: src ? src.value : 'manual' };
    }
  });

  if (Object.keys(metricsMap).length === 0) { showToast('Enter at least one value'); return; }

  // Update ATHLETE_DB in-memory: update best values
  HISTORY_METRICS.forEach(m => {
    if (!metricsMap[m.key]) return;
    const val = parseFloat(metricsMap[m.key].value);
    if (!val) return;
    const cur = a[m.key] || 0;
    const better = INVERSE_METRICS.has(m.key) ? (cur === 0 || val < cur) : val > cur;
    if (better) { a[m.key] = val; }
    // Update measured flag
    if (!a.measured) a.measured = {};
    if (metricsMap[m.key].source !== 'estimated') a.measured[m.key] = true;
  });

  // Add session to _sessions for display
  const newSess = {
    session_date: dateVal,
    notes: 'Manual entry',
    measurements: Object.entries(metricsMap).map(([metric, v]) => ({ metric, value: v.value, source: v.source }))
  };
  if (!a._sessions) a._sessions = [];
  a._sessions.push(newSess);

  await saveSessionToSupabase(a, metricsMap, dateVal);

  // Re-render
  if (a.name === currentAthlete.name) {
    athleteData = Object.assign({}, currentAthlete);
    renderAll(true);
  }
  openHistoryModal(); // refresh modal
}

