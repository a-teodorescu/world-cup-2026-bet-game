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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[c]));
}

function isAllowedEmail(email) {
  const value = normalize(email);
  if (value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (!/^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i.test(domain)) return false;
  return domain.split('.').every(label => !label.startsWith('-') && !label.endsWith('-'));
}

function siteUrlFromEvent(event) {
  const configured = String(process.env.SITE_URL || process.env.URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = event?.headers?.host || event?.headers?.Host;
  return host ? `https://${host}` : 'https://pronosticuri-cm26.netlify.app';
}

async function getUserByEmail(baseUrl, anonKey, email) {
  const response = await fetch(`${baseUrl}/rest/v1/wc2026_users?email=eq.${encodeURIComponent(email)}&select=username,email&limit=1`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase GET wc2026_users a eșuat: ${text.slice(0, 240)}`);
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

function buildRecoverUsernameEmail({ username, email, siteUrl }) {
  const safeUsername = escapeHtml(username);
  const safeEmail = escapeHtml(email);
  const safeSiteUrl = escapeHtml(siteUrl);
  const loginUrl = `${siteUrl}/#home`;
  const safeLoginUrl = escapeHtml(loginUrl);

  const subject = 'Username-ul tău pentru Cupa Mondială 2026';
  const text = `Salut,\n\nAi cerut recuperarea username-ului pentru jocul Cupa Mondială 2026.\n\nDate de logare:\nUsername: ${username}\nEmail: ${email}\n\nIntră aici: ${loginUrl}\n\nDacă nu ai cerut tu acest email, îl poți ignora.\n`;
  const html = `
  <div style="margin:0;padding:0;background:#07111f;font-family:Inter,Arial,sans-serif;color:#f7fbff;">
    <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
      <div style="border:1px solid rgba(255,255,255,.14);background:linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.06));border-radius:28px;padding:26px;box-shadow:0 24px 80px rgba(0,0,0,.35);">
        <div style="display:inline-flex;align-items:center;gap:12px;margin-bottom:22px;">
          <span style="display:inline-grid;place-items:center;width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#6ee7f9,#8b5cf6);color:#07111f;font-weight:900;">26</span>
          <strong style="font-size:18px;letter-spacing:-.02em;">Cupa Mondială 2026</strong>
        </div>

        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;letter-spacing:-.04em;color:#ffffff;">Ți-am găsit username-ul</h1>
        <p style="margin:0 0 22px;color:#a7b4c8;line-height:1.6;">Ai cerut recuperarea username-ului folosit la logarea în joc.</p>

        <div style="border:1px solid rgba(110,231,249,.24);background:rgba(110,231,249,.08);border-radius:22px;padding:18px;margin:20px 0;">
          <div style="color:#a7b4c8;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Date de logare</div>
          <div style="font-size:17px;line-height:1.8;">
            <div><span style="color:#a7b4c8;">Username:</span> <strong style="color:#ffffff;">${safeUsername}</strong></div>
            <div><span style="color:#a7b4c8;">Email:</span> <strong style="color:#ffffff;">${safeEmail}</strong></div>
          </div>
        </div>

        <a href="${safeLoginUrl}" style="display:inline-block;margin-top:4px;background:linear-gradient(135deg,#6ee7f9,#d9f99d);color:#07111f;text-decoration:none;font-weight:900;border-radius:16px;padding:14px 18px;">Intră în joc</a>

        <p style="margin:24px 0 0;color:#a7b4c8;font-size:13px;line-height:1.6;">Dacă nu ai cerut tu acest email, îl poți ignora. Link: ${safeSiteUrl}</p>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

async function sendBrevoEmail({ apiKey, fromEmail, fromName, toEmail, username, subject, html, text }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        email: fromEmail,
        name: fromName
      },
      to: [
        {
          email: toEmail,
          name: username || undefined
        }
      ],
      subject,
      htmlContent: html,
      textContent: text
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || data.code || 'Eroare Brevo la trimiterea emailului.');
  }
  return data;
}

exports.handler = async (event = {}) => {
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

  const email = normalize(payload.email);
  if (!isAllowedEmail(email)) return json(400, { ok: false, error: 'Email invalid.' });

  const user = await getUserByEmail(SUPABASE_URL, SUPABASE_ANON_KEY, email);

  // Returnăm același răspuns chiar și dacă emailul nu există, ca să nu expunem lista de participanți.
  if (!user?.email || !user?.username) {
    return json(200, { ok: true, sent: false });
  }

  const siteUrl = siteUrlFromEvent(event);
  const emailTemplate = buildRecoverUsernameEmail({ username: user.username, email: user.email, siteUrl });
  const brevoResult = await sendBrevoEmail({
    apiKey: BREVO_API_KEY,
    fromEmail: BREVO_FROM_EMAIL,
    fromName: BREVO_FROM_NAME,
    toEmail: user.email,
    username: user.username,
    ...emailTemplate
  });

  return json(200, { ok: true, sent: true, id: brevoResult.messageId || brevoResult.messageIds || brevoResult.id || 'sent' });
};
