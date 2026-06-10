const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function cleanUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL;
  const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || 'Cupa Mondială Predictor';
  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!BREVO_API_KEY) return json(500, { ok: false, error: 'Lipsește variabila Netlify BREVO_API_KEY.' });
  if (!BREVO_FROM_EMAIL) return json(500, { ok: false, error: 'Lipsește variabila Netlify BREVO_FROM_EMAIL.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500, { ok: false, error: 'Lipsesc variabilele Netlify SUPABASE_URL / SUPABASE_ANON_KEY.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Body JSON invalid.' }); }

  const { adminEmail, adminPin, reports } = payload;
  if (!adminEmail || !adminPin) return json(401, { ok: false, error: 'Date admin lipsă.' });
  if (!Array.isArray(reports) || reports.length === 0) return json(400, { ok: false, error: 'Nu există emailuri de trimis.' });
  if (reports.length > 100) return json(400, { ok: false, error: 'Prea multe emailuri într-o singură trimitere. Max 100.' });

  const validation = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wc2026_admin_validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ admin_email: adminEmail, admin_pin: adminPin })
  });

  if (!validation.ok) {
    const errorText = await validation.text();
    return json(500, { ok: false, error: `Validarea adminului a eșuat. Detalii: ${errorText.slice(0, 240)}` });
  }

  const isAdminValid = await validation.json();
  if (isAdminValid !== true) return json(401, { ok: false, error: 'PIN admin invalid.' });

  const results = [];

  for (const report of reports) {
    const to = String(report.to || '').trim().toLowerCase();
    if (!to || !to.includes('@')) {
      results.push({ to, ok: false, error: 'Email invalid' });
      continue;
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          email: BREVO_FROM_EMAIL,
          name: BREVO_FROM_NAME
        },
        to: [
          {
            email: to,
            name: report.username || undefined
          }
        ],
        subject: report.subject || 'Rezumat pronosticuri Cupa Mondială 2026',
        htmlContent: report.html || `<pre>${escapeHtml(report.text)}</pre>`,
        textContent: report.text || undefined
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = data.message || data.error || data.code || 'Eroare Brevo';
      results.push({ to, ok: false, error: errorMessage });
    } else {
      results.push({ to, ok: true, id: data.messageId || data.messageIds || data.id || 'sent' });
    }
  }

  const sent = results.filter(r => r.ok).length;
  return json(200, { ok: true, sent, total: reports.length, results });
};
