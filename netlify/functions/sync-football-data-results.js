const fs = require('fs');
const path = require('path');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function cleanUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

function parseMatches() {
  const candidatePaths = [
    path.join(__dirname, '../../matches.js'),
    path.join(__dirname, '../matches.js'),
    path.join(__dirname, 'matches.js'),
    path.join(process.cwd(), 'matches.js')
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const raw = fs.readFileSync(candidate, 'utf8');
      const match = raw.match(/window\.WC2026_MATCHES\s*=\s*(\[[\s\S]*?\]);\s*$/);
      if (!match) throw new Error(`Nu pot interpreta matches.js: ${candidate}`);
      return JSON.parse(match[1]);
    }
  }
  throw new Error('Nu pot citi matches.js. Verifică netlify.toml included_files.');
}

function getRomaniaIsoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysIso(isoDate, delta) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function roDateFromUtc(utcDate) {
  if (!utcDate) return '';
  return getRomaniaIsoDate(new Date(utcDate));
}

const TEAM_ALIASES = {
  'united states': 'usa',
  'united states of america': 'usa',
  'usa': 'usa',
  'bosnia-herzegovina': 'bosnia and herzegovina',
  'bosnia herzegovina': 'bosnia and herzegovina',
  'bosnia and herzegovina': 'bosnia and herzegovina',
  'côte d’ivoire': 'cote d ivoire',
  'côte d\'ivoire': 'cote d ivoire',
  'ivory coast': 'cote d ivoire',
  'czech republic': 'czechia',
  'czechia': 'czechia',
  'korea republic': 'south korea',
  'korea republic of': 'south korea',
  'south korea': 'south korea',
  'iran': 'iran',
  'ir iran': 'iran',
  'england': 'england',
  'scotland': 'scotland',
  'curaçao': 'curacao',
  'curaçao': 'curacao',
  'cape verde islands': 'cape verde',
  'cape verde': 'cape verde',
  'congo dr': 'dr congo',
  'dr congo': 'dr congo',
  'democratic republic of congo': 'dr congo',
  'd r congo': 'dr congo'
};

function normalizeTeam(value) {
  const raw = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return TEAM_ALIASES[raw] || raw;
}

function internalMatchKey(home, away, dateRo) {
  return `${normalizeTeam(home)}__${normalizeTeam(away)}__${dateRo || ''}`;
}

function looseMatchKey(home, away) {
  return `${normalizeTeam(home)}__${normalizeTeam(away)}`;
}

function buildMatchIndexes(matches) {
  const byTeamAndDate = new Map();
  const byTeams = new Map();
  for (const m of matches) {
    byTeamAndDate.set(internalMatchKey(m.home, m.away, m.romaniaDate), m);
    byTeams.set(looseMatchKey(m.home, m.away), m);
  }
  return { byTeamAndDate, byTeams };
}

function summarizeApiMatch(match) {
  const ft = match?.score?.fullTime || {};
  return {
    apiMatchId: match?.id,
    utcDate: match?.utcDate,
    dateRo: roDateFromUtc(match?.utcDate),
    home: match?.homeTeam?.name || match?.homeTeam?.shortName || '',
    away: match?.awayTeam?.name || match?.awayTeam?.shortName || '',
    status: match?.status || '',
    homeScore: ft.home,
    awayScore: ft.away,
    stage: match?.stage || '',
    group: match?.group || '',
    matchday: match?.matchday || ''
  };
}

async function validateAdmin(baseUrl, anonKey, adminEmail, adminPin) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/wc2026_admin_validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    body: JSON.stringify({ admin_email: adminEmail, admin_pin: adminPin })
  });
  if (!response.ok) throw new Error(`Validarea adminului a eșuat: ${(await response.text()).slice(0, 240)}`);
  const ok = await response.json();
  if (ok !== true) throw new Error('PIN admin invalid.');
}

async function supabaseGet(baseUrl, anonKey, table, query = '') {
  const response = await fetch(`${baseUrl}/rest/v1/${table}${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  });
  if (!response.ok) throw new Error(`Supabase GET ${table} eșuat: ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function supabaseInsertLog(baseUrl, anonKey, row) {
  try {
    await fetch(`${baseUrl}/rest/v1/wc2026_api_sync_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });
  } catch (err) {
    console.warn('Nu am putut salva logul de sync:', err.message);
  }
}

async function replaceResults(baseUrl, anonKey, adminEmail, adminPin, rows) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/wc2026_admin_replace_results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    body: JSON.stringify({ admin_email: adminEmail, admin_pin: adminPin, payload: rows })
  });
  if (!response.ok) throw new Error(`Salvarea scorurilor a eșuat: ${(await response.text()).slice(0, 500)}`);
  const ok = await response.json();
  if (ok !== true) throw new Error('Salvarea scorurilor a eșuat: PIN admin invalid.');
}

async function callFootballData(token) {
  const url = 'https://api.football-data.org/v4/competitions/WC/matches?dateFrom=2026-06-11&dateTo=2026-07-19';
  const response = await fetch(url, { headers: { 'X-Auth-Token': token, Accept: 'application/json' } });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`football-data.org error ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return Array.isArray(data.matches) ? data.matches : [];
}

async function runSync({ mode, adminEmail, adminPin, simulate = false }) {
  const FOOTBALL_DATA_API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!FOOTBALL_DATA_API_TOKEN) throw new Error('Lipsește variabila Netlify FOOTBALL_DATA_API_TOKEN.');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Lipsesc variabilele Netlify SUPABASE_URL / SUPABASE_ANON_KEY.');
  if (!adminEmail || !adminPin) throw new Error('Lipsesc credentialele admin pentru sincronizare.');

  await validateAdmin(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin);

  const matches = parseMatches();
  const { byTeamAndDate, byTeams } = buildMatchIndexes(matches);
  const apiMatches = await callFootballData(FOOTBALL_DATA_API_TOKEN);
  let simulatedMatch = null;
  let finished = apiMatches.map(summarizeApiMatch).filter(m => {
    const hasScore = m.homeScore !== null && m.homeScore !== undefined && m.awayScore !== null && m.awayScore !== undefined;
    return String(m.status).toUpperCase() === 'FINISHED' && hasScore;
  });

  if (simulate) {
    const candidates = apiMatches
      .map(summarizeApiMatch)
      .filter(m => m.home && m.away && m.utcDate)
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .slice(0, 24);
    if (!candidates.length) throw new Error('Nu am găsit niciun meci API pentru simulare.');
    finished = candidates.map((candidate, index) => ({
      ...candidate,
      status: 'SIMULATED_FINISHED',
      // Scoruri simulate diferite, dar stabile, doar pentru test de mapping. Nu se salvează în Supabase.
      homeScore: [1, 2, 0, 1][index % 4],
      awayScore: [0, 1, 0, 2][index % 4]
    }));
    simulatedMatch = finished[0];
  }

  const matchedUpdates = [];
  const unmatched = [];

  for (const api of finished) {
    let internal = byTeamAndDate.get(internalMatchKey(api.home, api.away, api.dateRo));
    if (!internal) internal = byTeams.get(looseMatchKey(api.home, api.away));
    if (!internal) {
      unmatched.push(api);
      continue;
    }
    matchedUpdates.push({
      match_id: internal.id,
      home: Number(api.homeScore),
      away: Number(api.awayScore),
      apiMatchId: api.apiMatchId,
      apiHome: api.home,
      apiAway: api.away,
      internalHome: internal.home,
      internalAway: internal.away,
      matchNo: internal.matchNo,
      dateRo: internal.romaniaDate
    });
  }

  const existingRows = await supabaseGet(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_results', '?select=match_id,home,away');
  const merged = new Map((existingRows || []).map(r => [r.match_id, { match_id: r.match_id, home: Number(r.home), away: Number(r.away) }]));
  let changed = 0;

  for (const u of matchedUpdates) {
    const prev = merged.get(u.match_id);
    if (!prev || Number(prev.home) !== Number(u.home) || Number(prev.away) !== Number(u.away)) changed += 1;
    merged.set(u.match_id, { match_id: u.match_id, home: u.home, away: u.away });
  }

  const payloadRows = Array.from(merged.values()).sort((a, b) => String(a.match_id).localeCompare(String(b.match_id)));
  if (!simulate && changed > 0) {
    await replaceResults(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin, payloadRows);
  }

  const summary = {
    mode,
    simulate,
    apiMatches: apiMatches.length,
    finished: finished.length,
    matched: matchedUpdates.length,
    unmatched: unmatched.length,
    changed,
    savedTotalResults: payloadRows.length,
    wouldSave: simulate ? matchedUpdates.length : undefined,
    simulatedMatch,
    simulatedMatches: simulate ? finished.slice(0, 24) : undefined,
    updated: matchedUpdates.slice(0, 30),
    unmatchedSample: unmatched.slice(0, 10)
  };

  await supabaseInsertLog(SUPABASE_URL, SUPABASE_ANON_KEY, {
    provider: 'football-data.org',
    mode,
    status: simulate ? 'simulated' : 'success',
    summary
  });

  return summary;
}

exports.handler = async (event) => {
  try {
    let mode = 'scheduled';
    let adminEmail = process.env.WC2026_ADMIN_EMAIL || 'admin@gmail.com';
    let adminPin = process.env.WC2026_ADMIN_PIN || '';

    let simulate = false;
    if (event.httpMethod === 'POST') {
      mode = 'manual';
      const body = JSON.parse(event.body || '{}');
      adminEmail = body.adminEmail || adminEmail;
      adminPin = body.adminPin || adminPin;
      simulate = body.simulate === true;
      if (simulate) mode = 'simulate';
    } else {
      // Real cron gate: do not consume API outside the useful tournament window.
      const todayRo = getRomaniaIsoDate(new Date());
      if (todayRo < '2026-06-12' || todayRo > '2026-07-20') {
        return json(200, { ok: true, skipped: true, reason: 'În afara ferestrei turneului pentru sincronizarea automată.', todayRo });
      }
    }

    const summary = await runSync({ mode, adminEmail, adminPin, simulate });
    return json(200, { ok: true, ...summary });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Sincronizarea football-data.org a eșuat.' });
  }
};
