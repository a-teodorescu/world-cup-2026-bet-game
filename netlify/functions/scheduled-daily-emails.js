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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[c]));
}

function parseMatches() {
  // Netlify bundles serverless functions separately. `matches.js` may be copied
  // either near the function file or in the function working directory, depending
  // on the deploy/bundling mode. Try all common locations so the scheduled test
  // and cron runner behave the same in production.
  const candidatePaths = [
    path.join(__dirname, '../../matches.js'),
    path.join(__dirname, '../matches.js'),
    path.join(__dirname, 'matches.js'),
    path.join(process.cwd(), 'matches.js')
  ];

  let raw = '';
  let foundPath = '';
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      raw = fs.readFileSync(candidate, 'utf8');
      foundPath = candidate;
      break;
    }
  }

  if (!raw) {
    throw new Error('Nu pot citi lista de meciuri din matches.js. Verifică netlify.toml included_files.');
  }

  const match = raw.match(/window\.WC2026_MATCHES\s*=\s*(\[[\s\S]*?\]);\s*$/);
  if (!match) throw new Error(`Nu pot interpreta lista de meciuri din matches.js: ${foundPath}`);
  return JSON.parse(match[1]);
}

function getRomaniaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function toIsoDate({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysIso(isoDate, delta) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  return utc.toISOString().slice(0, 10);
}

function formatRoDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

function outcome(home, away) {
  if (home > away) return '1';
  if (home < away) return '2';
  return 'X';
}

function scorePrediction(pred, result) {
  if (!pred || pred.home === null || pred.home === undefined || pred.away === null || pred.away === undefined) {
    return { points: 0, type: 'missing' };
  }
  const ph = Number(pred.home);
  const pa = Number(pred.away);
  const rh = Number(result.home);
  const ra = Number(result.away);
  if (ph === rh && pa === ra) return { points: 3, type: 'exact' };
  if (outcome(ph, pa) === outcome(rh, ra)) return { points: 1, type: 'winner' };
  return { points: 0, type: 'wrong' };
}

function denseRanks(players) {
  const sorted = [...players].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let currentRank = 0;
  let previousPoints = null;
  let distinctRank = 0;
  for (const player of sorted) {
    if (previousPoints === null || player.total !== previousPoints) {
      distinctRank += 1;
      currentRank = distinctRank;
      previousPoints = player.total;
    }
    player.rank = currentRank;
  }
  return sorted;
}

async function supabaseGet(baseUrl, anonKey, table, query = '') {
  const response = await fetch(`${baseUrl}/rest/v1/${table}${query}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase GET ${table} a eșuat: ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function supabaseInsert(baseUrl, anonKey, table, row) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase INSERT ${table} a eșuat: ${text.slice(0, 300)}`);
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
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase RPC ${fn} a eșuat.`);
  }
  return data;
}

async function alreadySent(baseUrl, anonKey, email, reportDate, reportType = 'daily') {
  const query = `?select=id&email=eq.${encodeURIComponent(email)}&report_date=eq.${encodeURIComponent(reportDate)}&report_type=eq.${encodeURIComponent(reportType)}&status=eq.sent&limit=1`;
  const rows = await supabaseGet(baseUrl, anonKey, 'wc2026_email_logs', query);
  return rows.length > 0;
}

function buildEmail({ user, periodLabel, totalLabel, rankLabel, dailyPoints, dailyExact, dailyWinner, items, siteUrl }) {
  const rows = items.map(i => {
    const badgeBg = i.type === 'exact' ? '#dcfce7' : i.type === 'winner' ? '#fef3c7' : i.type === 'wrong' ? '#fee2e2' : '#e2e8f0';
    const badgeColor = i.type === 'exact' ? '#166534' : i.type === 'winner' ? '#92400e' : i.type === 'wrong' ? '#991b1b' : '#475569';
    const badgeText = i.type === 'exact' ? 'Scor exact' : i.type === 'winner' ? 'Pronostic corect' : i.type === 'wrong' ? 'Pronostic gresit' : 'Fara pronostic';
    return `<tr><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#0f172a">#${i.matchNo} ${escapeHtml(i.label)}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155">${escapeHtml(i.result)}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155">${escapeHtml(i.prediction)}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right"><span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-weight:800;white-space:nowrap">${i.points}p · ${badgeText}</span></td></tr>`;
  }).join('');

  const html = `<div style="margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2ff;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.14)"><tr><td style="padding:30px 26px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 52%,#7c3aed 100%);color:#fff"><div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.85">Cupa Mondială 2026</div><h1 style="margin:10px 0 0;font-size:28px;line-height:1.15">🏆 Salut, ${escapeHtml(user.name)}!</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.6;opacity:.9">Rezultatele tale pentru meciurile ${escapeHtml(periodLabel)}.</p></td></tr><tr><td style="padding:22px 24px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="width:50%;padding:8px"><div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">🎯 Puncte selecție</div><div style="font-size:30px;font-weight:900;color:#1d4ed8;margin-top:4px">${dailyPoints}p</div></div></td><td style="width:50%;padding:8px"><div style="border:1px solid #ede9fe;background:#f5f3ff;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">📊 Loc în clasament</div><div style="font-size:30px;font-weight:900;color:#6d28d9;margin-top:4px">#${user.rank}</div></div></td></tr><tr><td style="width:50%;padding:8px"><div style="border:1px solid #dcfce7;background:#f0fdf4;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">✅ Scoruri exacte</div><div style="font-size:26px;font-weight:900;color:#15803d;margin-top:4px">${dailyExact}</div></div></td><td style="width:50%;padding:8px"><div style="border:1px solid #fef3c7;background:#fffbeb;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">🟡 Pronosticuri corecte</div><div style="font-size:26px;font-weight:900;color:#b45309;margin-top:4px">${dailyWinner}</div></div></td></tr></table></td></tr><tr><td style="padding:8px 32px 22px"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:16px"><div style="font-size:14px;color:#475569;font-weight:800">🏅 ${escapeHtml(totalLabel)}</div><div style="font-size:24px;font-weight:900;color:#0f172a;margin-top:4px">${user.total}p</div><div style="font-size:13px;color:#64748b;margin-top:4px">${escapeHtml(rankLabel)}: locul ${user.rank}</div></div></td></tr>${items.length ? `<tr><td style="padding:0 32px 26px"><h2 style="font-size:18px;margin:0 0 12px;color:#0f172a">⚽ Rezultate</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><thead><tr style="background:#f8fafc"><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Meci</th><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Rezultat</th><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Pronostic</th><th align="right" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Puncte</th></tr></thead><tbody>${rows}</tbody></table></td></tr>` : `<tr><td style="padding:0 32px 26px"><div style="padding:16px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-weight:700">Nu există rezultate pentru selecția curentă.</div></td></tr>`}<tr><td align="center" style="padding:0 32px 30px">${siteUrl ? `<a href="${escapeHtml(siteUrl)}" style="display:inline-block;text-decoration:none;background:#0f172a;color:#ffffff;border-radius:999px;padding:13px 22px;font-weight:900">Vezi clasamentul</a>` : ''}<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6">Continuă pronosticurile pentru următoarele meciuri! 🔥</p></td></tr></table><p style="max-width:640px;margin:14px auto 0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center">Email trimis automat de Cupa Mondială 2026 Predictor.</p></td></tr></table></div>`;

  const text = `Salut, ${user.name}!\n\nRezultatele pentru ${periodLabel}\nPuncte câștigate: ${dailyPoints}p\n${totalLabel}: ${user.total}p\n${rankLabel}: locul ${user.rank}\n\nRezultate:\n${items.map(i => `#${i.matchNo} ${i.label} | Rezultat: ${i.result} | Pronostic: ${i.prediction} | ${i.points}p`).join('\n')}`;
  return { html, text };
}


function buildNoResultsEmail({ user, reportDateRo, periodLabel, totalLabel, rankLabel, siteUrl }) {
  const title = `La data ${reportDateRo} nu s-au jucat meciuri`;
  const subtitle = 'Nu există rezultate de calculat pentru această zi, așa că punctajul tău rămâne neschimbat.';
  const html = `<div style="margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2ff;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.14)"><tr><td style="padding:30px 26px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 52%,#7c3aed 100%);color:#fff"><div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.85">Cupa Mondială 2026</div><h1 style="margin:10px 0 0;font-size:28px;line-height:1.15">🏆 Salut, ${escapeHtml(user.name)}!</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.6;opacity:.9">Actualizare pentru ${escapeHtml(periodLabel)}.</p></td></tr><tr><td style="padding:28px 32px 12px"><div style="text-align:center;border:1px solid #bfdbfe;background:#eff6ff;border-radius:22px;padding:28px 20px"><div style="font-size:42px;line-height:1">📭</div><h2 style="margin:14px 0 8px;font-size:23px;line-height:1.25;color:#0f172a">${escapeHtml(title)}</h2><p style="margin:0 auto;color:#475569;font-size:15px;line-height:1.6;max-width:470px">${escapeHtml(subtitle)}</p></div></td></tr><tr><td style="padding:8px 32px 22px"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:16px"><div style="font-size:14px;color:#475569;font-weight:800">🏅 ${escapeHtml(totalLabel)}</div><div style="font-size:24px;font-weight:900;color:#0f172a;margin-top:4px">${user.total}p</div><div style="font-size:13px;color:#64748b;margin-top:4px">${escapeHtml(rankLabel)}: locul ${user.rank}</div></div></td></tr><tr><td align="center" style="padding:0 32px 30px">${siteUrl ? `<a href="${escapeHtml(siteUrl)}" style="display:inline-block;text-decoration:none;background:#0f172a;color:#ffffff;border-radius:999px;padding:13px 22px;font-weight:900">Vezi clasamentul</a>` : ''}<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6">Pregătește pronosticurile pentru următoarele meciuri! 🔥</p></td></tr></table><p style="max-width:640px;margin:14px auto 0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center">Email trimis automat de Cupa Mondială 2026 Predictor.</p></td></tr></table></div>`;
  const text = `Salut, ${user.name}!\n\nLa data ${reportDateRo} nu s-au jucat meciuri.\nPunctajul tău rămâne neschimbat.\n\n${totalLabel}: ${user.total}p\n${rankLabel}: locul ${user.rank}`;
  return { html, text };
}

async function sendBrevo({ apiKey, fromEmail, fromName, to, username, subject, html, text }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to, name: username || undefined }],
      subject,
      htmlContent: html,
      textContent: text || undefined
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || data.code || 'Eroare Brevo');
  return data.messageId || data.messageIds || data.id || 'sent';
}

exports.handler = async (event = {}) => {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL;
  const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || 'Cupa Mondială Predictor';
  const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SITE_URL = process.env.SITE_URL || process.env.URL || '';

  if (!BREVO_API_KEY || !BREVO_FROM_EMAIL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json(500, { ok: false, error: 'Lipsesc variabilele Netlify pentru Brevo/Supabase.' });
  }

  const isHttpTest = event.httpMethod === 'POST';
  let body = {};
  if (isHttpTest) {
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json(400, { ok: false, error: 'Body JSON invalid.' });
    }
    const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
    const adminPin = String(body.adminPin || '');
    const isAdminValid = await supabaseRpc(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_admin_validate', {
      admin_email: adminEmail,
      admin_pin: adminPin
    });
    if (isAdminValid !== true) {
      return json(403, { ok: false, error: 'PIN admin invalid.' });
    }
  }

  const todayRo = toIsoDate(getRomaniaDateParts(new Date()));
  const requestedReportDate = String(body.reportDate || '').trim();
  const reportDate = isHttpTest && /^\d{4}-\d{2}-\d{2}$/.test(requestedReportDate)
    ? requestedReportDate
    : addDaysIso(todayRo, -1);
  const reportType = isHttpTest ? 'daily-test' : 'daily';

  // Competition-day guard. Useful automatic run dates are 2026-06-11 through 2026-07-20.
  // Because the daily cron sends the report for the previous Romania date,
  // the 2026-06-11 04:00 run sends an informational no-results email for 2026-06-10.
  // The 2026-07-20 04:00 run sends the report for the final day, 2026-07-19.
  if (reportDate < '2026-06-10' || reportDate > '2026-07-19') {
    return json(200, { ok: true, skipped: true, mode: reportType, reason: 'În afara perioadei competiției.', todayRo, reportDate });
  }

  const matches = parseMatches();
  const players = (await supabaseGet(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_users', '?select=id,username,email,role&role=eq.player'))
    .filter(u => u.email && String(u.email).toLowerCase() !== 'admin@gmail.com')
    .map(u => ({ id: u.id, name: u.username, email: String(u.email).toLowerCase() }));

  const predictions = await supabaseGet(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_predictions', '?select=user_id,match_id,home,away');
  const resultsRows = await supabaseGet(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_results', '?select=match_id,home,away');
  let luckyRows = [];
  try {
    luckyRows = await supabaseGet(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_lucky_strikes', '?select=user_id,team');
  } catch (_) {
    luckyRows = [];
  }

  const resultsByMatch = new Map(resultsRows.map(r => [r.match_id, { home: Number(r.home), away: Number(r.away) }]));
  const predsByUserMatch = new Map(predictions.map(p => [`${p.user_id}|${p.match_id}`, { home: Number(p.home), away: Number(p.away) }]));
  const luckyByUser = new Map(luckyRows.map(row => [row.user_id, row.team]));
  const finalMatch = matches.find(m => Number(m.matchNo) === 104 || m.stage === 'Final');
  const finalResult = finalMatch ? resultsByMatch.get(finalMatch.id) : null;
  const finalWinner = finalMatch && finalResult
    ? (Number(finalResult.home) > Number(finalResult.away) ? finalMatch.home : Number(finalResult.away) > Number(finalResult.home) ? finalMatch.away : null)
    : null;

  const reportMatches = matches.filter(m => m.romaniaDate === reportDate && resultsByMatch.has(m.id));
  const noResultsMode = reportMatches.length === 0;

  const matchesUntilReportDate = matches.filter(m => m.romaniaDate <= reportDate && resultsByMatch.has(m.id));

  const rankedPlayers = denseRanks(players.map(player => {
    let total = 0;
    for (const m of matchesUntilReportDate) {
      const pred = predsByUserMatch.get(`${player.id}|${m.id}`);
      const result = resultsByMatch.get(m.id);
      total += scorePrediction(pred, result).points;
    }
    const luckyPick = luckyByUser.get(player.id);
    const finalIncluded = !!(finalMatch && matchesUntilReportDate.some(m => m.id === finalMatch.id));
    const luckyHit = !!(finalIncluded && finalWinner && luckyPick && String(luckyPick).toLowerCase() === String(finalWinner).toLowerCase());
    if (luckyHit) total += 25;
    return { ...player, total, luckyHit, luckyTeam: luckyPick || null };
  }));
  const rankByUserId = new Map(rankedPlayers.map(p => [p.id, p]));

  const periodLabel = `din ${formatRoDate(reportDate)}`;
  const totalLabel = `Puncte totale până la data ${formatRoDate(reportDate)}`;
  const rankLabel = `Poziția ta în clasament la data ${formatRoDate(reportDate)}`;
  const subject = noResultsMode ? `Nu s-au jucat meciuri - ${formatRoDate(reportDate)}` : `Rezumat pronosticuri - ${formatRoDate(reportDate)}`;

  const summary = { attempted: 0, sent: 0, skippedDuplicate: 0, failed: 0, details: [], noResults: noResultsMode };

  for (const player of players) {
    if (await alreadySent(SUPABASE_URL, SUPABASE_ANON_KEY, player.email, reportDate, reportType)) {
      summary.skippedDuplicate += 1;
      summary.details.push({ email: player.email, status: 'skipped_duplicate' });
      continue;
    }

    const ranked = rankByUserId.get(player.id) || { ...player, total: 0, rank: '-' };
    let dailyPoints = 0;
    let dailyExact = 0;
    let dailyWinner = 0;
    let items = [];

    if (!noResultsMode) {
      items = reportMatches.map(m => {
        const result = resultsByMatch.get(m.id);
        const pred = predsByUserMatch.get(`${player.id}|${m.id}`);
        const scored = scorePrediction(pred, result);
        dailyPoints += scored.points;
        if (scored.type === 'exact') dailyExact += 1;
        if (scored.type === 'winner') dailyWinner += 1;
        return {
          matchNo: m.matchNo,
          label: `${m.home} vs ${m.away}`,
          result: `${result.home} - ${result.away}`,
          prediction: pred ? `${pred.home} - ${pred.away}` : '-',
          points: scored.points,
          type: scored.type
        };
      });
    }

    const reportUser = { ...ranked, name: player.name, email: player.email };
    const content = noResultsMode
      ? buildNoResultsEmail({ user: reportUser, reportDateRo: formatRoDate(reportDate), periodLabel, totalLabel, rankLabel, siteUrl: SITE_URL })
      : buildEmail({ user: reportUser, periodLabel, totalLabel, rankLabel, dailyPoints, dailyExact, dailyWinner, items, siteUrl: SITE_URL });

    summary.attempted += 1;
    try {
      const deliveryId = await sendBrevo({
        apiKey: BREVO_API_KEY,
        fromEmail: BREVO_FROM_EMAIL,
        fromName: BREVO_FROM_NAME,
        to: player.email,
        username: player.name,
        subject,
        html: content.html,
        text: content.text
      });
      await supabaseInsert(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_email_logs', {
        email: player.email,
        username: player.name,
        subject,
        status: 'sent',
        report_date: reportDate,
        report_type: reportType,
        delivery_id: String(deliveryId),
        payload: { dailyPoints, dailyExact, dailyWinner, total: reportUser.total, rank: reportUser.rank, matchCount: items.length, noResults: noResultsMode }
      });
      summary.sent += 1;
      summary.details.push({ email: player.email, status: 'sent' });
    } catch (error) {
      await supabaseInsert(SUPABASE_URL, SUPABASE_ANON_KEY, 'wc2026_email_logs', {
        email: player.email,
        username: player.name,
        subject,
        status: 'error',
        report_date: reportDate,
        report_type: reportType,
        error_message: error.message,
        payload: { dailyPoints, dailyExact, dailyWinner, total: reportUser.total, rank: reportUser.rank, matchCount: items.length, noResults: noResultsMode }
      }).catch(() => {});
      summary.failed += 1;
      summary.details.push({ email: player.email, status: 'error', error: error.message });
    }
  }

  return json(200, { ok: true, mode: reportType, todayRo, reportDate, reportDateRo: formatRoDate(reportDate), matchCount: reportMatches.length, ...summary });
};
