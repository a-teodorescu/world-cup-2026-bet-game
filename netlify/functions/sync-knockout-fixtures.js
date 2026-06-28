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

function getRomaniaDateParts(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
}
function getRomaniaIsoDate(date = new Date()) {
  const p = getRomaniaDateParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
function roDateTimeFromUtc(utcDate) {
  if (!utcDate) return { dateRo: '', timeRo: '' };
  const p = getRomaniaDateParts(new Date(utcDate));
  return { dateRo: `${p.year}-${p.month}-${p.day}`, timeRo: `${p.hour}:${p.minute}` };
}

const TEAM_DISPLAY_ALIASES = {
  'united states': 'USA',
  'united states of america': 'USA',
  'usa': 'USA',
  'bosnia-herzegovina': 'Bosnia and Herzegovina',
  'bosnia herzegovina': 'Bosnia and Herzegovina',
  'bosnia and herzegovina': 'Bosnia and Herzegovina',
  'cote d ivoire': 'Ivory Coast',
  'ivory coast': 'Ivory Coast',
  'czech republic': 'Czechia',
  'czechia': 'Czechia',
  'korea republic': 'South Korea',
  'south korea': 'South Korea',
  'ir iran': 'Iran',
  'cape verde islands': 'Cape Verde',
  'cape verde': 'Cape Verde',
  'congo dr': 'DR Congo',
  'dr congo': 'DR Congo',
  'democratic republic of congo': 'DR Congo',
  'curaçao': 'Curacao',
  'curacao': 'Curacao'
};
function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function displayTeamName(value) {
  const raw = String(value || '').trim();
  const key = normalizeKey(raw);
  return TEAM_DISPLAY_ALIASES[key] || raw;
}
function isGroupStage(apiMatch) {
  return String(apiMatch?.stage || '').toUpperCase() === 'GROUP_STAGE' || String(apiMatch?.group || '').toUpperCase().startsWith('GROUP_');
}
function hasKnownTeams(apiMatch) {
  const home = String(apiMatch?.home || '').trim();
  const away = String(apiMatch?.away || '').trim();
  if (!home || !away) return false;
  const placeholderPattern = /winner|runner|third|group|match|tbd|to be decided|qualified|place/i;
  return !placeholderPattern.test(home) && !placeholderPattern.test(away);
}

const MANUAL_KNOCKOUT_TEAM_CORRECTIONS = {
  'R32-03': { home: 'Germany', away: 'Paraguay' },
  'R32-06': { home: 'France', away: 'Sweden' },
  'R32-07': { home: 'Mexico', away: 'Ecuador' },
  'R32-09': { home: 'Belgium', away: 'Senegal' },
  'R32-10': { home: 'USA', away: 'Bosnia and Herzegovina' },
  'R32-13': { home: 'Switzerland', away: 'Algeria' }
};

function applyManualKnockoutRowCorrection(row) {
  const correction = MANUAL_KNOCKOUT_TEAM_CORRECTIONS[row?.match_id];
  if (!correction) return row;
  return { ...row, home: correction.home, away: correction.away, api_stage: row.api_stage || 'MANUAL_CORRECTION' };
}
function summarizeApiMatch(match) {
  const { dateRo, timeRo } = roDateTimeFromUtc(match?.utcDate);
  return {
    apiMatchId: match?.id,
    utcDate: match?.utcDate,
    dateRo,
    timeRo,
    home: displayTeamName(match?.homeTeam?.name || match?.homeTeam?.shortName || ''),
    away: displayTeamName(match?.awayTeam?.name || match?.awayTeam?.shortName || ''),
    status: match?.status || '',
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
async function supabaseUpsertOverrides(baseUrl, anonKey, rows) {
  if (!rows.length) return;
  const response = await fetch(`${baseUrl}/rest/v1/wc2026_match_overrides?on_conflict=match_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`Salvarea echipelor eliminatorii a eșuat: ${(await response.text()).slice(0, 500)}`);
}
async function supabaseInsertLog(baseUrl, anonKey, row) {
  try {
    await fetch(`${baseUrl}/rest/v1/wc2026_api_sync_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}`, Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (err) {
    console.warn('Nu am putut salva logul de sync:', err.message);
  }
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
function findInternalByDateTime(api, internalKnockouts, usedIds) {
  return internalKnockouts.find(m => !usedIds.has(m.id) && m.romaniaDate === api.dateRo && m.romaniaTime === api.timeRo);
}
async function runSync({ mode, adminEmail, adminPin }) {
  const FOOTBALL_DATA_API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!FOOTBALL_DATA_API_TOKEN) throw new Error('Lipsește variabila Netlify FOOTBALL_DATA_API_TOKEN.');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Lipsesc variabilele Netlify SUPABASE_URL / SUPABASE_ANON_KEY.');
  if (!adminEmail || !adminPin) throw new Error('Lipsesc credentialele admin pentru sincronizare.');
  await validateAdmin(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin);

  const matches = parseMatches();
  const internalKnockouts = matches.filter(m => Number(m.matchNo) >= 73 && Number(m.matchNo) <= 104).sort((a,b) => a.matchNo - b.matchNo);
  const existing = await supabaseGet(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_match_overrides', '?select=match_id,home,away,api_match_id');
  const existingById = new Map((existing || []).map(r => [r.match_id, r]));
  const apiMatches = await callFootballData(FOOTBALL_DATA_API_TOKEN);
  const apiKnockouts = apiMatches.map(summarizeApiMatch).filter(m => !isGroupStage(m)).sort((a,b) => new Date(a.utcDate || 0) - new Date(b.utcDate || 0));

  const usedIds = new Set();
  const rows = [];
  const updated = [];
  const pending = [];
  let matched = 0;
  let changed = 0;
  for (let i = 0; i < apiKnockouts.length; i += 1) {
    const api = apiKnockouts[i];
    let internal = findInternalByDateTime(api, internalKnockouts, usedIds) || internalKnockouts[i];
    if (!internal) continue;
    usedIds.add(internal.id);
    if (!hasKnownTeams(api)) {
      pending.push(api);
      continue;
    }
    matched += 1;
    const row = { match_id: internal.id, home: api.home, away: api.away, api_match_id: api.apiMatchId, api_stage: api.stage, api_utc_date: api.utcDate, updated_at: new Date().toISOString() };
    const prev = existingById.get(internal.id);
    const isChanged = !prev || prev.home !== row.home || prev.away !== row.away || String(prev.api_match_id || '') !== String(row.api_match_id || '');
    if (isChanged) changed += 1;
    rows.push(row);
    updated.push({ match_id: internal.id, matchNo: internal.matchNo, dateRo: internal.romaniaDate, home: api.home, away: api.away, apiMatchId: api.apiMatchId, stage: api.stage, changed: isChanged });
  }

  const forcedCorrectionRows = Object.entries(MANUAL_KNOCKOUT_TEAM_CORRECTIONS).map(([match_id, teams]) => ({
    match_id,
    home: teams.home,
    away: teams.away,
    api_match_id: existingById.get(match_id)?.api_match_id || null,
    api_stage: 'MANUAL_KNOCKOUT_CORRECTION',
    api_utc_date: existingById.get(match_id)?.api_utc_date || null,
    updated_at: new Date().toISOString()
  }));
  const correctedRows = [...rows.map(applyManualKnockoutRowCorrection), ...forcedCorrectionRows];
  await supabaseUpsertOverrides(SUPABASE_URL, SUPABASE_ANON_KEY, correctedRows);

  const summary = { mode, apiMatches: apiMatches.length, knockoutApi: apiKnockouts.length, ready: matched, matched, changed: changed + forcedCorrectionRows.length, updated: correctedRows.map(row => ({ match_id: row.match_id, home: row.home, away: row.away, apiMatchId: row.api_match_id, stage: row.api_stage })), pendingSample: pending.slice(0, 10) };
  await supabaseInsertLog(SUPABASE_URL, SUPABASE_ANON_KEY, { provider: 'football-data.org', mode: `knockout-${mode}`, status: 'success', summary });
  return summary;
}

exports.handler = async (event) => {
  try {
    let mode = 'scheduled';
    let adminEmail = process.env.WC2026_ADMIN_EMAIL || 'admin@gmail.com';
    let adminPin = process.env.WC2026_ADMIN_PIN || '';
    if (event.httpMethod === 'POST') {
      mode = 'manual';
      const body = JSON.parse(event.body || '{}');
      adminEmail = body.adminEmail || adminEmail;
      adminPin = body.adminPin || adminPin;
    } else {
      const todayRo = getRomaniaIsoDate(new Date());
      if (todayRo < '2026-06-28' || todayRo > '2026-07-20') {
        return json(200, { ok: true, skipped: true, reason: 'În afara ferestrei pentru sincronizarea eliminatoriilor.', todayRo });
      }
    }
    const summary = await runSync({ mode, adminEmail, adminPin });
    return json(200, { ok: true, ...summary });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Sincronizarea eliminatoriilor a eșuat.' });
  }
};
