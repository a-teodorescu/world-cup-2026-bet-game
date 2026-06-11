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

    const url = 'https://v3.football.api-sports.io/fixtures?league=1&season=2026';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-apisports-key': FOOTBALL_API_KEY,
        'Accept': 'application/json'
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(response.status, {
        ok: false,
        error: data?.message || data?.errors || `API-Football a răspuns cu status ${response.status}`,
        raw: data
      });
    }

    const fixtures = Array.isArray(data.response) ? data.response : [];
    const sample = fixtures.slice(0, 8).map(item => ({
      apiFixtureId: item?.fixture?.id,
      date: item?.fixture?.date,
      dateRo: roDateTime(item?.fixture?.date),
      home: item?.teams?.home?.name || '—',
      away: item?.teams?.away?.name || '—',
      status: item?.fixture?.status?.long || item?.fixture?.status?.short || '—',
      venue: item?.fixture?.venue?.name || ''
    }));

    return json(200, {
      ok: true,
      league: 1,
      season: 2026,
      fixturesCount: fixtures.length,
      fixturesSample: sample,
      requestsRemaining: data?.paging ? undefined : (data?.response ? undefined : undefined),
      requestsLimit: data?.errors ? undefined : undefined,
      apiResults: data?.results,
      apiPaging: data?.paging || null
    });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Testul API-Football a eșuat.' });
  }
};
