const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function cleanUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
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

async function insertLog(baseUrl, anonKey, row) {
  try {
    await fetch(`${baseUrl}/rest/v1/wc2026_api_sync_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}`, Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (err) {
    console.warn('Nu am putut salva logul de test:', err.message);
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Metodă neacceptată.' });
    const body = JSON.parse(event.body || '{}');
    const action = body.action || 'save';
    const adminEmail = body.adminEmail;
    const adminPin = body.adminPin;
    const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Lipsesc variabilele Netlify SUPABASE_URL / SUPABASE_ANON_KEY.');
    if (!adminEmail || !adminPin) throw new Error('Lipsesc credentialele admin.');
    await validateAdmin(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin);

    const currentRows = await supabaseGet(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_results', '?select=match_id,home,away');
    const byId = new Map((currentRows || []).map(r => [r.match_id, { match_id: r.match_id, home: Number(r.home), away: Number(r.away) }]));

    const testRows = [
      { match_id: 'M001', home: 2, away: 1, label: 'Mexico vs South Africa' },
      { match_id: 'M002', home: 1, away: 1, label: 'South Korea vs Czechia' },
      { match_id: 'M003', home: 0, away: 2, label: 'Canada vs Bosnia and Herzegovina' }
    ];

    if (action === 'reset') {
      for (const row of testRows) byId.delete(row.match_id);
      const payload = [...byId.values()].sort((a, b) => String(a.match_id).localeCompare(String(b.match_id)));
      await replaceResults(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin, payload);
      const summary = { action, removed: testRows.map(r => r.match_id), remainingResults: payload.length };
      await insertLog(SUPABASE_URL, SUPABASE_ANON_KEY, { provider: 'internal-test', mode: 'reset-api-score-flow', status: 'success', summary });
      return json(200, { ok: true, ...summary });
    }

    for (const row of testRows) byId.set(row.match_id, { match_id: row.match_id, home: row.home, away: row.away });
    const payload = [...byId.values()].sort((a, b) => String(a.match_id).localeCompare(String(b.match_id)));
    await replaceResults(SUPABASE_URL, SUPABASE_ANON_KEY, adminEmail, adminPin, payload);
    const summary = {
      action: 'save',
      written: testRows,
      totalResultsAfterWrite: payload.length,
      note: 'Scoruri de test salvate temporar în wc2026_results pentru validarea Rezultate/Grupe/Clasament/Email.'
    };
    await insertLog(SUPABASE_URL, SUPABASE_ANON_KEY, { provider: 'internal-test', mode: 'save-api-score-flow', status: 'success', summary });
    return json(200, { ok: true, ...summary });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Testul de scor API a eșuat.' });
  }
};
