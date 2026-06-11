const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function cleanUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

function roDateTime(apiDate) {
  if (!apiDate) return '';
  try {
    return new Intl.DateTimeFormat('ro-RO', {
      timeZone: 'Europe/Bucharest',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(apiDate));
  } catch {
    return apiDate;
  }
}

async function validateAdmin(baseUrl, anonKey, adminEmail, adminPin) {
  const validation = await fetch(`${baseUrl}/rest/v1/rpc/wc2026_admin_validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`
    },
    body: JSON.stringify({ admin_email: adminEmail, admin_pin: adminPin })
  });

  if (!validation.ok) {
    const errorText = await validation.text();
    throw new Error(`Validarea adminului a eșuat. Detalii: ${errorText.slice(0, 240)}`);
  }
  const isAdminValid = await validation.json();
  if (isAdminValid !== true) throw new Error('PIN admin invalid.');
}

function safeArrayForPath(data, path) {
  if (!data || typeof data !== 'object') return [];
  if (path.includes('/matches')) return Array.isArray(data.matches) ? data.matches : [];
  if (path.includes('/standings')) return Array.isArray(data.standings) ? data.standings : [];
  if (path.includes('/teams')) return Array.isArray(data.teams) ? data.teams : [];
  if (path === '/competitions') return Array.isArray(data.competitions) ? data.competitions : [];
  if (path.startsWith('/competitions/WC')) return data.id || data.code ? [data] : [];
  return [];
}

function summarizeMatch(match) {
  const fullTime = match?.score?.fullTime || {};
  return {
    apiMatchId: match?.id,
    utcDate: match?.utcDate,
    dateRo: roDateTime(match?.utcDate),
    home: match?.homeTeam?.name || match?.homeTeam?.shortName || '—',
    away: match?.awayTeam?.name || match?.awayTeam?.shortName || '—',
    status: match?.status || '—',
    stage: match?.stage || '',
    group: match?.group || '',
    matchday: match?.matchday || '',
    score: `${fullTime.home ?? '—'} - ${fullTime.away ?? '—'}`
  };
}

function summarizeItem(item, path) {
  if (path.includes('/matches')) return summarizeMatch(item);
  if (path.includes('/teams')) return {
    id: item?.id,
    name: item?.name,
    shortName: item?.shortName,
    tla: item?.tla,
    crest: item?.crest
  };
  if (path.includes('/standings')) return {
    stage: item?.stage,
    type: item?.type,
    group: item?.group,
    tableCount: Array.isArray(item?.table) ? item.table.length : 0,
    teams: Array.isArray(item?.table) ? item.table.slice(0, 5).map(r => r?.team?.name) : []
  };
  if (path === '/competitions') return {
    id: item?.id,
    code: item?.code,
    name: item?.name,
    area: item?.area?.name,
    currentSeason: item?.currentSeason?.startDate ? `${item.currentSeason.startDate} - ${item.currentSeason.endDate}` : ''
  };
  return {
    id: item?.id,
    code: item?.code,
    name: item?.name,
    area: item?.area?.name,
    currentSeason: item?.currentSeason
  };
}

async function callFootballData(path, token) {
  const url = `https://api.football-data.org/v4${path}`;
  const started = Date.now();
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Auth-Token': token,
      'Accept': 'application/json'
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  const items = safeArrayForPath(data, path);
  return {
    path,
    ok: response.ok,
    status: response.status,
    elapsedMs: Date.now() - started,
    apiResults: items.length,
    message: data?.message || data?.error || null,
    sample: items.slice(0, 5).map(item => summarizeItem(item, path)),
    rawKeys: data ? Object.keys(data) : []
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const FOOTBALL_DATA_API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!FOOTBALL_DATA_API_TOKEN) return json(500, { ok: false, error: 'Lipsește variabila Netlify FOOTBALL_DATA_API_TOKEN.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500, { ok: false, error: 'Lipsesc variabilele Netlify SUPABASE_URL / SUPABASE_ANON_KEY.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Body JSON invalid.' }); }

  const { adminEmail, adminPin } = payload;
  if (!adminEmail || !adminPin) return json(401, { ok: false, error: 'Date admin lipsă.' });

  try {
    await validateAdmin(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin);

    const endpoints = [
      { label: 'Competition WC info', path: '/competitions/WC' },
      { label: 'World Cup matches simple', path: '/competitions/WC/matches' },
      { label: 'World Cup matches season 2026', path: '/competitions/WC/matches?season=2026' },
      { label: 'World Cup matches by date range', path: '/competitions/WC/matches?dateFrom=2026-06-11&dateTo=2026-07-19' },
      { label: 'World Cup teams', path: '/competitions/WC/teams?season=2026' },
      { label: 'World Cup standings', path: '/competitions/WC/standings?season=2026' },
      { label: 'Competitions list', path: '/competitions' }
    ];

    const tests = [];
    for (const endpoint of endpoints) {
      try {
        const result = await callFootballData(endpoint.path, FOOTBALL_DATA_API_TOKEN);
        tests.push({ label: endpoint.label, ...result });
      } catch (err) {
        tests.push({ label: endpoint.label, path: endpoint.path, ok: false, status: 0, apiResults: 0, message: err.message || 'Request eșuat.' });
      }
    }

    const matchTests = tests.filter(t => t.path.includes('/matches'));
    const totalMatchResults = matchTests.reduce((sum, t) => sum + (Number(t.apiResults) || 0), 0);
    const matchSamples = tests.flatMap(t => Array.isArray(t.sample) && t.path.includes('/matches') ? t.sample : []).slice(0, 8);

    return json(200, {
      ok: true,
      provider: 'football-data.org',
      competition: 'WC',
      season: 2026,
      totalMatchResults,
      fixturesSample: matchSamples,
      tests,
      note: totalMatchResults > 0
        ? 'football-data.org returnează meciuri pentru unul dintre endpoint-urile testate.'
        : 'football-data.org răspunde, dar endpoint-urile testate nu returnează momentan meciuri World Cup 2026 în planul/tokens-ul curent.'
    });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Testul football-data.org a eșuat.' });
  }
};
