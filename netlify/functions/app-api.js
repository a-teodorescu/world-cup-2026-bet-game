const fs = require('fs');
const path = require('path');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

function cleanUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}


const LOCK_HOURS_BEFORE_START = 0.5;
let matchesCache = null;
function loadMatches() {
  if (matchesCache) return matchesCache;
  const candidates = [
    path.join(__dirname, '../../matches.js'),
    path.join(__dirname, '../matches.js'),
    path.join(__dirname, 'matches.js'),
    path.join(process.cwd(), 'matches.js')
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const raw = fs.readFileSync(candidate, 'utf8');
    const match = raw.match(/window\.WC2026_MATCHES\s*=\s*(\[[\s\S]*?\]);\s*$/);
    if (!match) throw new Error(`Nu pot interpreta matches.js: ${candidate}`);
    matchesCache = JSON.parse(match[1]);
    return matchesCache;
  }
  throw new Error('Nu pot citi matches.js. Verifică netlify.toml included_files.');
}
function isMatchLocked(matchId) {
  const match = loadMatches().find(m => m.id === matchId);
  if (!match || !match.startTimeRo) return false;
  const lockAt = new Date(match.startTimeRo).getTime() - LOCK_HOURS_BEFORE_START * 60 * 60 * 1000;
  return Date.now() >= lockAt;
}

const ADMIN_ACCOUNT = { name: 'admin', email: 'admin@gmail.com' };
function isAdminUser(user) {
  return normalize(user?.name || user?.username) === ADMIN_ACCOUNT.name && normalize(user?.email) === ADMIN_ACCOUNT.email;
}

function env() {
  const baseUrl = cleanUrl(process.env.SUPABASE_URL);
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error('Lipsesc SUPABASE_URL sau SUPABASE_ANON_KEY în Netlify Environment variables.');
  return { baseUrl, anonKey };
}

async function supabaseFetch(path, options = {}) {
  const { baseUrl, anonKey } = env();
  const response = await fetch(`${baseUrl}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    const msg = data?.message || data?.error || (typeof data === 'string' ? data : '') || `Supabase request failed: ${response.status}`;
    throw new Error(msg.slice(0, 500));
  }
  return data;
}

async function rpc(fn, payload) {
  return supabaseFetch(`/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

async function loadData() {
  const [users, predictions, results] = await Promise.all([
    supabaseFetch('/wc2026_users?select=id,username,email,role,created_at&order=created_at.asc'),
    supabaseFetch('/wc2026_predictions?select=user_id,match_id,home,away,updated_at'),
    supabaseFetch('/wc2026_results?select=match_id,home,away,updated_at')
  ]);

  let luckyStrikes = [];
  try {
    luckyStrikes = await supabaseFetch('/wc2026_lucky_strikes?select=user_id,team,created_at');
  } catch (err) {
    console.warn('[app-api] lucky strikes not available', err.message);
  }

  let matchOverrides = [];
  try {
    matchOverrides = await supabaseFetch('/wc2026_match_overrides?select=match_id,home,away,api_match_id,updated_at');
  } catch (err) {
    console.warn('[app-api] match overrides not available', err.message);
  }

  let prizeDismissals = [];
  try {
    prizeDismissals = await supabaseFetch('/wc2026_prize_popup_dismissals?select=user_id,dismissed_at');
  } catch (err) {
    console.warn('[app-api] prize popup dismissals not available', err.message);
  }

  return { users, predictions, results, luckyStrikes, matchOverrides, prizeDismissals };
}

async function registerOrLogin({ name, email }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = normalize(email);
  if (!cleanName || !cleanEmail) throw new Error('Numele și emailul sunt obligatorii.');

  const users = await supabaseFetch('/wc2026_users?select=id,username,email,role,created_at&order=created_at.asc');
  const sameNameDifferentEmail = (users || []).find(u => normalize(u.username) === normalize(cleanName) && normalize(u.email) !== cleanEmail);
  if (sameNameDifferentEmail) throw new Error(`Numele „${cleanName}” există deja în clasament. Alege alt nume.`);

  const existing = (users || []).find(u => normalize(u.email) === cleanEmail);
  if (existing && normalize(existing.username) !== normalize(cleanName)) {
    throw new Error(`Acest email este deja asociat cu numele „${existing.username}”. Nu poți schimba numele pentru același email.`);
  }
  if (existing) return { user: existing };

  const role = isAdminUser({ username: cleanName, email: cleanEmail }) ? 'admin' : 'player';
  const inserted = await supabaseFetch('/wc2026_users?select=id,username,email,role,created_at', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ username: cleanName, email: cleanEmail, role })
  });
  return { user: Array.isArray(inserted) ? inserted[0] : inserted };
}

async function savePredictions({ rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const unlockedRows = safeRows.filter(row => row && row.match_id && !isMatchLocked(row.match_id));
  const blocked = safeRows.length - unlockedRows.length;
  if (!unlockedRows.length) return { ok: true, saved: 0, blocked };
  await supabaseFetch('/wc2026_predictions?on_conflict=user_id,match_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(unlockedRows)
  });
  return { ok: true, saved: unlockedRows.length, blocked };
}

async function saveLuckyStrike({ userId, team }) {
  if (!userId || !team) throw new Error('Lipsește userul sau echipa Lucky Strike.');
  await supabaseFetch('/wc2026_lucky_strikes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ user_id: userId, team })
  });
  return { ok: true };
}

async function dismissPrizePopup({ userId }) {
  if (!userId) throw new Error('Lipsește userul pentru închiderea pop-up-ului de premii.');
  await supabaseFetch('/wc2026_prize_popup_dismissals?on_conflict=user_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ user_id: userId, dismissed_at: new Date().toISOString() })
  });
  return { ok: true };
}

async function adminDeleteUser({ adminEmail, adminPin, targetEmail }) {
  const data = await rpc('wc2026_admin_delete_user', {
    admin_email: adminEmail,
    admin_pin: adminPin,
    target_email: targetEmail
  });
  return { ok: data === true };
}

async function adminReplaceResults({ adminEmail, adminPin, payload }) {
  const data = await rpc('wc2026_admin_replace_results', {
    admin_email: adminEmail,
    admin_pin: adminPin,
    payload: Array.isArray(payload) ? payload : []
  });
  return { ok: data === true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const body = JSON.parse(event.body || '{}');
    const action = body.action;
    console.info('[app-api] action', action);

    if (action === 'loadData') return json(200, await loadData());
    if (action === 'registerOrLogin') return json(200, await registerOrLogin(body));
    if (action === 'savePredictions') return json(200, await savePredictions(body));
    if (action === 'saveLuckyStrike') return json(200, await saveLuckyStrike(body));
    if (action === 'dismissPrizePopup') return json(200, await dismissPrizePopup(body));
    if (action === 'adminDeleteUser') return json(200, await adminDeleteUser(body));
    if (action === 'adminReplaceResults') return json(200, await adminReplaceResults(body));

    return json(400, { error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('[app-api] error', err);
    return json(500, { error: err.message || 'Eroare app-api.' });
  }
};
