const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function cleanUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

function formatRoDateTime(iso) {
  try {
    return new Intl.DateTimeFormat('ro-RO', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(iso));
  } catch (_) {
    return iso;
  }
}

async function supabaseRpc(baseUrl, anonKey, fn, payload) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase RPC ${fn} a eșuat.`);
  return data;
}

async function supabaseInsert(baseUrl, anonKey, table, row) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify(row)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const text = data?.message || data?.error || await response.text().catch(() => '');
    throw new Error(`Supabase INSERT ${table} a eșuat: ${String(text).slice(0, 300)}`);
  }
  return Array.isArray(data) ? data[0] : data;
}

exports.handler = async (event = {}) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json(500, { ok: false, error: 'Lipsesc variabilele Supabase în Netlify.' });
  }

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; }
  catch (_) { return json(400, { ok: false, error: 'Body JSON invalid.' }); }

  const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
  const adminPin = String(body.adminPin || '');
  const reportDate = String(body.reportDate || '').trim();
  const runAtIso = String(body.runAtIso || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return json(400, { ok: false, error: 'Data raportului este invalidă.' });
  }
  const runAt = new Date(runAtIso);
  if (!runAtIso || Number.isNaN(runAt.getTime())) {
    return json(400, { ok: false, error: 'Data/ora testului este invalidă.' });
  }

  const isAdminValid = await supabaseRpc(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_admin_validate', {
    admin_email: adminEmail,
    admin_pin: adminPin
  });
  if (isAdminValid !== true) return json(403, { ok: false, error: 'PIN admin invalid.' });

  const row = await supabaseInsert(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_scheduled_email_tests', {
    report_date: reportDate,
    run_at: runAt.toISOString(),
    status: 'pending',
    created_by_email: adminEmail
  });

  return json(200, {
    ok: true,
    id: row?.id,
    reportDate,
    runAt: runAt.toISOString(),
    runAtRo: formatRoDateTime(runAt.toISOString())
  });
};
