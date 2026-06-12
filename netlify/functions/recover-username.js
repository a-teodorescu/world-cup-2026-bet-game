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
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">Username-ul tău pentru Cupa Mondială 2026 este ${safeUsername}.</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0;padding:0;background:#07111f;">
      <tr>
        <td align="center" style="padding:32px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:650px;border-collapse:separate;border-spacing:0;background:#0d1728;background-image:radial-gradient(circle at 18% 0%,rgba(110,231,249,.16),transparent 34%),radial-gradient(circle at 82% 42%,rgba(139,92,246,.12),transparent 36%),linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04));border:1px solid rgba(190,210,255,.18);border-radius:30px;box-shadow:0 28px 90px rgba(0,0,0,.38);overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 26px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="vertical-align:middle;white-space:nowrap;">
                      <span style="display:inline-block;width:54px;height:54px;line-height:54px;text-align:center;vertical-align:middle;border-radius:18px;background:#6ee7f9;background-image:linear-gradient(135deg,#6ee7f9 0%,#8b5cf6 100%);color:#07111f;font-weight:900;font-size:26px;letter-spacing:-.04em;box-shadow:0 10px 28px rgba(110,231,249,.18);">26</span>
                      <span style="display:inline-block;vertical-align:middle;margin-left:14px;color:#ffffff;font-size:21px;font-weight:900;letter-spacing:-.03em;line-height:1.2;">Cupa Mondială 2026</span>
                    </td>
                  </tr>
                </table>

                <div style="height:1px;background:rgba(255,255,255,.12);margin:28px 0 30px;"></div>

                <h1 style="margin:0 0 12px;font-size:36px;line-height:1.08;letter-spacing:-.055em;color:#ffffff;font-weight:950;">Ți-am găsit username-ul</h1>
                <p style="margin:0 0 26px;color:#c2ccdc;font-size:16px;line-height:1.65;">Ai cerut recuperarea username-ului folosit la logarea în joc.</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;border:1px solid rgba(56,189,248,.32);background:#101d31;background-image:linear-gradient(135deg,rgba(56,189,248,.12),rgba(139,92,246,.07));border-radius:22px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05);">
                  <tr>
                    <td style="padding:24px 26px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:18px;">
                        <tr>
                          <td style="vertical-align:middle;width:42px;">
                            <span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:50%;background:rgba(139,92,246,.20);color:#8b5cf6;font-size:18px;">&#128100;</span>
                          </td>
                          <td style="vertical-align:middle;color:#b9c7dc;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;">Date de logare</td>
                        </tr>
                      </table>

                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:17px;line-height:1.45;">
                        <tr>
                          <td style="width:46px;padding:2px 0 18px;color:#8b5cf6;font-size:22px;">&#128100;</td>
                          <td style="width:145px;padding:2px 0 18px;color:#c2ccdc;">Username:</td>
                          <td style="padding:2px 0 18px;color:#ffffff;font-weight:900;">${safeUsername}</td>
                        </tr>
                        <tr>
                          <td colspan="3" style="height:1px;background:rgba(255,255,255,.13);font-size:1px;line-height:1px;">&nbsp;</td>
                        </tr>
                        <tr>
                          <td style="width:46px;padding:18px 0 2px;color:#8b5cf6;font-size:22px;">&#9993;</td>
                          <td style="width:145px;padding:18px 0 2px;color:#c2ccdc;">Email:</td>
                          <td style="padding:18px 0 2px;color:#2f8cff;font-weight:900;word-break:break-word;">${safeEmail}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td align="center" style="padding:34px 0 28px;">
                      <a href="${safeLoginUrl}" style="display:inline-block;min-width:230px;text-align:center;background:#6ee7f9;background-image:linear-gradient(135deg,#6ee7f9 0%,#d9f99d 100%);color:#07111f;text-decoration:none;font-size:18px;font-weight:950;border-radius:18px;padding:17px 26px;box-shadow:0 16px 36px rgba(110,231,249,.22);">Intră în joc&nbsp;&nbsp;&rsaquo;</a>
                    </td>
                  </tr>
                </table>

                <div style="height:1px;background:rgba(255,255,255,.12);margin:0 0 22px;"></div>

                <p style="margin:0;color:#9eabba;font-size:13px;line-height:1.65;text-align:center;">
                  <span style="color:#c2ccdc;">&#128274;</span>&nbsp; Dacă nu ai cerut tu acest email, îl poți ignora.
                  <span style="color:rgba(255,255,255,.32);padding:0 10px;">|</span>
                  Link: <a href="${safeSiteUrl}" style="color:#2f8cff;text-decoration:none;">${safeSiteUrl}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
