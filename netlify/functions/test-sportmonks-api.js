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

function safeArray(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.response)) return data.response;
  return [];
}

function summarizeFixture(item) {
  const participants = Array.isArray(item?.participants) ? item.participants : [];
  const home = participants.find(p => p?.meta?.location === 'home') || participants[0] || {};
  const away = participants.find(p => p?.meta?.location === 'away') || participants[1] || {};
  const scores = Array.isArray(item?.scores) ? item.scores : [];
  const scoreSummary = scores.slice(0, 8).map(s => ({
    description: s?.description || s?.type?.name || s?.type_id || '',
    participant_id: s?.participant_id,
    score: s?.score?.goals ?? s?.score?.participant ?? s?.score ?? null
  }));

  return {
    fixtureId: item?.id,
    name: item?.name || '',
    startingAt: item?.starting_at || item?.starting_at_timestamp || '',
    dateRo: roDateTime(item?.starting_at),
    home: home?.name || home?.short_code || '—',
    away: away?.name || away?.short_code || '—',
    state: item?.state?.name || item?.state?.short_name || item?.state_id || '—',
    league: item?.league?.name || item?.league_id || '',
    round: item?.round?.name || item?.round_id || '',
    stage: item?.stage?.name || item?.stage_id || '',
    scores: scoreSummary
  };
}

function summarizeItem(item, path) {
  if (path.includes('/fixtures')) return summarizeFixture(item);
  if (path.includes('/leagues')) return {
    id: item?.id,
    name: item?.name,
    shortCode: item?.short_code,
    type: item?.type,
    subtype: item?.sub_type,
    country: item?.country?.name || item?.country_id,
    active: item?.active
  };
  if (path.includes('/seasons')) return {
    id: item?.id,
    name: item?.name,
    leagueId: item?.league_id,
    startingAt: item?.starting_at,
    endingAt: item?.ending_at,
    finished: item?.finished,
    stages: Array.isArray(item?.stages) ? item.stages.slice(0, 5).map(s => ({ id: s.id, name: s.name })) : undefined
  };
  if (path.includes('/standings')) return {
    id: item?.id,
    participant: item?.participant?.name || item?.participant_id,
    position: item?.position,
    points: item?.points,
    group: item?.group?.name || item?.group_id
  };
  return item;
}

async function callSportmonks(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.sportmonks.com/v3/football${path}${sep}api_token=${encodeURIComponent(token)}`;
  const started = Date.now();
  const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 800) }; }
  const items = safeArray(data);
  return {
    path,
    ok: response.ok,
    status: response.status,
    elapsedMs: Date.now() - started,
    apiResults: items.length,
    message: data?.message || data?.error || data?.errors || null,
    pagination: data?.pagination || data?.meta?.pagination || null,
    rateLimit: {
      remaining: response.headers.get('x-ratelimit-remaining') || response.headers.get('rate-limit-remaining') || null,
      limit: response.headers.get('x-ratelimit-limit') || response.headers.get('rate-limit-limit') || null
    },
    sample: items.slice(0, 5).map(item => summarizeItem(item, path)),
    rawKeys: data ? Object.keys(data) : []
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const SPORTMONKS_API_TOKEN = process.env.SPORTMONKS_API_TOKEN;
  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SPORTMONKS_API_TOKEN) return json(500, { ok: false, error: 'Lipsește variabila Netlify SPORTMONKS_API_TOKEN.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500, { ok: false, error: 'Lipsesc variabilele Netlify SUPABASE_URL / SUPABASE_ANON_KEY.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Body JSON invalid.' }); }

  const { adminEmail, adminPin } = payload;
  if (!adminEmail || !adminPin) return json(401, { ok: false, error: 'Date admin lipsă.' });

  try {
    await validateAdmin(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin);

    // Sportmonks public pages identify World Cup 2026 as League ID 732 and Season ID 26618.
    const leagueId = 732;
    const seasonId = 26618;
    const endpoints = [
      { label: 'League World Cup 2026', path: `/leagues/${leagueId}?include=country;currentSeason` },
      { label: 'Season World Cup 2026', path: `/seasons/${seasonId}?include=league;stages;rounds` },
      { label: 'Fixtures World Cup 2026', path: `/fixtures?include=participants;scores;state;league;round;stage&filters=fixtureLeagues:${leagueId};fixtureSeasons:${seasonId}` },
      { label: 'Fixtures by date 2026-06-11', path: `/fixtures/date/2026-06-11?include=participants;scores;state;league;round;stage` },
      { label: 'Standings by season', path: `/standings/seasons/${seasonId}?include=participant;group;details.type` },
      { label: 'Schedules by season', path: `/schedules/seasons/${seasonId}?include=fixtures.participants;fixtures.scores;fixtures.state` }
    ];

    const tests = [];
    for (const endpoint of endpoints) {
      try {
        const result = await callSportmonks(endpoint.path, SPORTMONKS_API_TOKEN);
        tests.push({ label: endpoint.label, ...result });
      } catch (err) {
        tests.push({ label: endpoint.label, path: endpoint.path, ok: false, status: 0, error: err.message || 'Request eșuat.' });
      }
    }

    const fixtureSamples = tests.flatMap(t => Array.isArray(t.sample) && t.path?.includes('/fixtures') ? t.sample : []).slice(0, 8);
    const totalFixtureResults = tests.filter(t => t.path?.includes('/fixtures') || t.path?.includes('/schedules')).reduce((sum, t) => sum + (Number(t.apiResults) || 0), 0);

    return json(200, {
      ok: true,
      provider: 'Sportmonks',
      leagueId,
      seasonId,
      totalFixtureResults,
      fixturesSample: fixtureSamples,
      tests,
      note: totalFixtureResults > 0
        ? 'Sportmonks returnează date pentru cel puțin unul dintre endpoint-urile testate.'
        : 'Sportmonks răspunde, dar endpoint-urile testate nu au returnat momentan fixtures pentru World Cup 2026 sau planul nu are acces.'
    });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Testul Sportmonks a eșuat.' });
  }
};
