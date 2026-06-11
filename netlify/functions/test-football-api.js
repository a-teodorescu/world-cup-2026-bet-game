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

function summarizeFixture(item) {
  return {
    apiFixtureId: item?.fixture?.id,
    date: item?.fixture?.date,
    dateRo: roDateTime(item?.fixture?.date),
    home: item?.teams?.home?.name || '—',
    away: item?.teams?.away?.name || '—',
    status: item?.fixture?.status?.long || item?.fixture?.status?.short || '—',
    round: item?.league?.round || '',
    venue: item?.fixture?.venue?.name || ''
  };
}

function safeArray(data) {
  return Array.isArray(data?.response) ? data.response : [];
}

async function callApi(path, apiKey) {
  const url = `https://v3.football.api-sports.io${path}`;
  const started = Date.now();
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-apisports-key': apiKey,
      'Accept': 'application/json'
    }
  });
  const data = await response.json().catch(() => ({}));
  const items = safeArray(data);
  return {
    path,
    ok: response.ok,
    status: response.status,
    elapsedMs: Date.now() - started,
    apiErrors: data?.errors || null,
    apiResults: typeof data?.results === 'number' ? data.results : items.length,
    paging: data?.paging || null,
    sample: items.slice(0, 5).map(item => {
      if (path.startsWith('/fixtures')) return summarizeFixture(item);
      if (path.startsWith('/leagues')) return {
        leagueId: item?.league?.id,
        leagueName: item?.league?.name,
        country: item?.country?.name,
        season: item?.seasons?.[0]?.year,
        current: item?.seasons?.[0]?.current
      };
      if (path.startsWith('/teams')) return {
        teamId: item?.team?.id,
        name: item?.team?.name,
        country: item?.team?.country,
        founded: item?.team?.founded
      };
      if (path.startsWith('/standings')) return {
        league: item?.league?.name,
        season: item?.league?.season,
        groups: Array.isArray(item?.league?.standings) ? item.league.standings.length : 0,
        firstGroupTeams: Array.isArray(item?.league?.standings?.[0]) ? item.league.standings[0].slice(0, 5).map(row => row?.team?.name) : []
      };
      return item;
    }),
    rawKeys: data ? Object.keys(data) : []
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!FOOTBALL_API_KEY) return json(500, { ok: false, error: 'Lipsește variabila Netlify FOOTBALL_API_KEY.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500, { ok: false, error: 'Lipsesc variabilele Netlify SUPABASE_URL / SUPABASE_ANON_KEY.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Body JSON invalid.' }); }

  const { adminEmail, adminPin } = payload;
  if (!adminEmail || !adminPin) return json(401, { ok: false, error: 'Date admin lipsă.' });

  try {
    await validateAdmin(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin);

    const endpoints = [
      { label: 'League info', path: '/leagues?id=1&season=2026' },
      { label: 'Fixtures simple', path: '/fixtures?league=1&season=2026' },
      { label: 'Fixtures by date 2026-06-11', path: '/fixtures?league=1&season=2026&date=2026-06-11' },
      { label: 'Fixtures group stage round 1', path: '/fixtures?league=1&season=2026&round=Group Stage - 1' },
      { label: 'Fixtures group stage', path: '/fixtures?league=1&season=2026&round=Group Stage' },
      { label: 'Standings', path: '/standings?league=1&season=2026' },
      { label: 'Teams', path: '/teams?league=1&season=2026' }
    ];

    const tests = [];
    for (const endpoint of endpoints) {
      try {
        const result = await callApi(endpoint.path, FOOTBALL_API_KEY);
        tests.push({ label: endpoint.label, ...result });
      } catch (err) {
        tests.push({ label: endpoint.label, path: endpoint.path, ok: false, status: 0, error: err.message || 'Request eșuat.' });
      }
    }

    const fixturesTest = tests.find(t => t.path === '/fixtures?league=1&season=2026') || tests.find(t => t.path?.startsWith('/fixtures'));
    const fixtureSamples = tests.flatMap(t => Array.isArray(t.sample) && t.path?.startsWith('/fixtures') ? t.sample : []).slice(0, 8);
    const totalFixtureResults = tests.filter(t => t.path?.startsWith('/fixtures')).reduce((sum, t) => sum + (Number(t.apiResults) || 0), 0);

    return json(200, {
      ok: true,
      league: 1,
      season: 2026,
      fixturesCount: fixturesTest?.apiResults || 0,
      totalFixtureResults,
      fixturesSample: fixtureSamples,
      tests,
      note: totalFixtureResults > 0
        ? 'API-ul returnează fixtures pentru cel puțin unul dintre endpoint-urile testate.'
        : 'API-ul răspunde, dar endpoint-urile testate nu returnează momentan fixtures pentru World Cup 2026.'
    });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Testul API-Football a eșuat.' });
  }
};
