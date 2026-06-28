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

function parseMatches() {
  const candidatePaths = [
    path.join(__dirname, '../../matches.js'),
    path.join(__dirname, '../matches.js'),
    path.join(__dirname, 'matches.js'),
    path.join(process.cwd(), 'matches.js')
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const raw = fs.readFileSync(candidate, 'utf8');
      const match = raw.match(/window\.WC2026_MATCHES\s*=\s*(\[[\s\S]*?\]);\s*$/);
      if (!match) throw new Error(`Nu pot interpreta matches.js: ${candidate}`);
      return JSON.parse(match[1]);
    }
  }
  throw new Error('Nu pot citi matches.js. Verifică netlify.toml included_files.');
}

const TEAM_FLAGS = {
  'Algeria':'dz','Argentina':'ar','Australia':'au','Austria':'at','Belgium':'be','Bosnia and Herzegovina':'ba','Brazil':'br','Canada':'ca','Cape Verde':'cv','Colombia':'co','Croatia':'hr','Curacao':'cw','Czechia':'cz','DR Congo':'cd','Ecuador':'ec','Egypt':'eg','England':'gb-eng','France':'fr','Germany':'de','Ghana':'gh','Haiti':'ht','Iran':'ir','Iraq':'iq','Ivory Coast':'ci','Japan':'jp','Jordan':'jo','Mexico':'mx','Morocco':'ma','Netherlands':'nl','New Zealand':'nz','Norway':'no','Panama':'pa','Paraguay':'py','Portugal':'pt','Qatar':'qa','Saudi Arabia':'sa','Scotland':'gb-sct','Senegal':'sn','South Africa':'za','South Korea':'kr','Spain':'es','Sweden':'se','Switzerland':'ch','Tunisia':'tn','Turkey':'tr','USA':'us','Uruguay':'uy','Uzbekistan':'uz'
};

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

const MANUAL_KNOCKOUT_TEAM_CORRECTIONS = {
  'R32-03': { home: 'Germany', away: 'Paraguay' },
  'R32-06': { home: 'France', away: 'Sweden' },
  'R32-09': { home: 'Belgium', away: 'Senegal' },
  'R32-13': { home: 'Switzerland', away: 'Algeria' }
};

function applyManualKnockoutRowCorrection(row) {
  const correction = MANUAL_KNOCKOUT_TEAM_CORRECTIONS[row?.match_id];
  if (!correction) return row;
  return { ...row, home: correction.home, away: correction.away };
}

async function upsertOverrides(baseUrl, anonKey, rows) {
  const response = await fetch(`${baseUrl}/rest/v1/wc2026_match_overrides?on_conflict=match_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`Salvarea override-urilor a eșuat: ${(await response.text()).slice(0, 500)}`);
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

    const matches = parseMatches();
    const knockouts = matches.filter(m => Number(m.matchNo) >= 73 && Number(m.matchNo) <= 104).sort((a, b) => Number(a.matchNo) - Number(b.matchNo));
    if (knockouts.length !== 32) throw new Error(`Meciuri eliminatorii găsite: ${knockouts.length}, așteptat 32.`);

    const teams = Object.keys(TEAM_FLAGS);
    let rows;
    if (action === 'reset') {
      rows = knockouts.map(m => ({
        match_id: m.id,
        home: m.home,
        away: m.away,
        api_match_id: null,
        api_stage: 'SIMULATION_RESET',
        api_utc_date: null,
        updated_at: new Date().toISOString()
      }));
    } else {
      rows = knockouts.map((m, index) => ({
        match_id: m.id,
        home: teams[(index * 2) % teams.length],
        away: teams[(index * 2 + 1) % teams.length],
        api_match_id: 900000 + Number(m.matchNo),
        api_stage: `SIMULATED_${String(m.stage || '').toUpperCase().replace(/\s+/g, '_')}`,
        api_utc_date: new Date(m.startTimeRo).toISOString(),
        updated_at: new Date().toISOString()
      }));
    }

    rows = rows.map(applyManualKnockoutRowCorrection);
    await upsertOverrides(SUPABASE_URL, SUPABASE_ANON_KEY, rows);
    const flagsFound = rows.reduce((acc, row) => acc + (TEAM_FLAGS[row.home] ? 1 : 0) + (TEAM_FLAGS[row.away] ? 1 : 0), 0);
    const placeholderPattern = /winner|loser|runner|third|group|match|tbd|to be decided|qualified|place|\d+[a-z]|\d+[a-z]\//i;
    const placeholdersRemaining = rows.filter(r => placeholderPattern.test(String(r.home)) || placeholderPattern.test(String(r.away))).length;
    const summary = {
      action,
      matchesUpdated: rows.length,
      flagsFound,
      expectedFlags: rows.length * 2,
      placeholdersRemaining,
      sample: rows.slice(0, 8).map(r => ({ match_id: r.match_id, home: r.home, away: r.away }))
    };
    await insertLog(SUPABASE_URL, SUPABASE_ANON_KEY, { provider: 'internal-test', mode: action === 'reset' ? 'reset-knockout-population' : 'simulate-knockout-population', status: 'success', summary });
    return json(200, { ok: true, ...summary });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Simularea eliminatoriilor a eșuat.' });
  }
};
