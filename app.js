const MATCHES = window.WC2026_MATCHES || [];
const STORAGE = {
  users: 'wc2026_users_v3',
  current: 'wc2026_current_user_v3',
  predictions: 'wc2026_predictions_v3',
  resultOverrides: 'wc2026_result_overrides_v1'
};
const ADMIN_ACCOUNT = { name: 'admin', email: 'admin@gmail.com' };
const ALLOWED_EMAIL_PROVIDERS = ['gmail','googlemail','yahoo','ymail','rocketmail','outlook','hotmail','live','msn','icloud','me','mac','proton','protonmail','zoho','gmx','aol','fastmail','mail'];
const LOCK_HOURS_BEFORE_START = 2;

const TEAM_FLAGS = {
  'Algeria':'dz','Argentina':'ar','Australia':'au','Austria':'at','Belgium':'be','Bosnia and Herzegovina':'ba','Brazil':'br','Canada':'ca','Cape Verde':'cv','Colombia':'co','Croatia':'hr','Curacao':'cw','Czechia':'cz','DR Congo':'cd','Ecuador':'ec','Egypt':'eg','England':'gb-eng','France':'fr','Germany':'de','Ghana':'gh','Haiti':'ht','Iran':'ir','Iraq':'iq','Ivory Coast':'ci','Japan':'jp','Jordan':'jo','Mexico':'mx','Morocco':'ma','Netherlands':'nl','New Zealand':'nz','Norway':'no','Panama':'pa','Paraguay':'py','Portugal':'pt','Qatar':'qa','Saudi Arabia':'sa','Scotland':'gb-sct','Senegal':'sn','South Africa':'za','South Korea':'kr','Spain':'es','Sweden':'se','Switzerland':'ch','Tunisia':'tn','Turkey':'tr','USA':'us','Uruguay':'uy','Uzbekistan':'uz'
};
const TEAM_FLAG_FALLBACKS = {
  'England':'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f4-e0067-e0062-e0065-e006e-e0067-e007f.svg',
  'Scotland':'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f4-e0067-e0062-e0073-e0063-e0074-e007f.svg'
};

let currentUser = null;
let currentFilter = 'all';
let usersCache = [];
let predictionsCache = {};
let resultsCache = {};
let onlineMode = false;
let supabaseClient = null;

const $ = (id) => document.getElementById(id);
const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const isAdminUser = (user = currentUser) => normalize(user?.name || user?.username) === ADMIN_ACCOUNT.name && normalize(user?.email) === ADMIN_ACCOUNT.email;

function canUseSupabase() {
  const cfg = window.SUPABASE_CONFIG || {};
  return !!(window.supabase && cfg.url && cfg.anonKey && !cfg.url.includes('PASTE_') && !cfg.anonKey.includes('PASTE_'));
}

function initSupabase() {
  if (!canUseSupabase()) return false;
  supabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
  onlineMode = true;
  return true;
}

function setStorageModeLabel() {
  const el = $('storageModeMessage');
  if (!el) return;
  if (onlineMode) {
    el.textContent = 'Mod online: userii, pronosticurile, scorurile și clasamentul se salvează în Supabase.';
    el.classList.add('online');
  } else {
    el.textContent = 'Mod local: datele se salvează doar în browser până configurezi Supabase.';
    el.classList.remove('online');
  }
}

function isAllowedEmail(email) {
  const value = normalize(email);
  const match = value.match(/^([a-z0-9._%+-]+)@([a-z0-9-]+)\.([a-z]{2,})(?:\.([a-z]{2,}))?$/i);
  if (!match) return false;
  const provider = match[2].toLowerCase();
  const tld = [match[3], match[4]].filter(Boolean).join('.').toLowerCase();
  return ALLOWED_EMAIL_PROVIDERS.includes(provider) && /^[a-z]{2,}(\.[a-z]{2,})?$/.test(tld);
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function formatRoDate(match) {
  const d = new Date(match.startTimeRo);
  return new Intl.DateTimeFormat('ro-RO', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

function predictionFromScore(home, away) {
  if (home === '' || away === '' || home == null || away == null) return '—';
  const h = Number(home), a = Number(away);
  if (Number.isNaN(h) || Number.isNaN(a)) return '—';
  if (h > a) return '1';
  if (h < a) return '2';
  return 'X';
}

function localUsers() { return JSON.parse(localStorage.getItem(STORAGE.users) || '[]'); }
function saveLocalUsers(users) { localStorage.setItem(STORAGE.users, JSON.stringify(users)); }
function localPredictions() { return JSON.parse(localStorage.getItem(STORAGE.predictions) || '{}'); }
function saveLocalPredictions(data) { localStorage.setItem(STORAGE.predictions, JSON.stringify(data)); }
function localResults() { return JSON.parse(localStorage.getItem(STORAGE.resultOverrides) || '{}'); }
function saveLocalResults(data) { localStorage.setItem(STORAGE.resultOverrides, JSON.stringify(data)); }

function normalizeUserRow(u) {
  return {
    id: u.id || u.email,
    name: u.username || u.name,
    username: u.username || u.name,
    email: normalize(u.email),
    role: u.role || (isAdminUser({ name: u.username || u.name, email: u.email }) ? 'admin' : 'player'),
    createdAt: u.created_at || u.createdAt || new Date().toISOString()
  };
}

async function loadOnlineData() {
  const [{ data: users, error: usersError }, { data: preds, error: predsError }, { data: results, error: resultsError }] = await Promise.all([
    supabaseClient.from('wc2026_users').select('id, username, email, role, created_at').order('created_at', { ascending: true }),
    supabaseClient.from('wc2026_predictions').select('user_id, match_id, home, away, updated_at, wc2026_users(email)'),
    supabaseClient.from('wc2026_results').select('match_id, home, away, updated_at')
  ]);
  if (usersError || predsError || resultsError) {
    console.error({ usersError, predsError, resultsError });
    throw new Error('Nu am putut încărca datele din Supabase. Verifică dacă ai rulat scriptul SQL și dacă ai completat config.js.');
  }
  usersCache = (users || []).map(normalizeUserRow);
  predictionsCache = {};
  (preds || []).forEach(p => {
    const email = normalize(p.wc2026_users?.email || usersCache.find(u => u.id === p.user_id)?.email);
    if (!email) return;
    predictionsCache[email] ||= {};
    predictionsCache[email][p.match_id] = { home: p.home, away: p.away, updatedAt: p.updated_at };
  });
  resultsCache = {};
  (results || []).forEach(r => {
    resultsCache[r.match_id] = { home: r.home, away: r.away, updatedAt: r.updated_at };
  });
}

function loadLocalData() {
  usersCache = localUsers().map(normalizeUserRow);
  predictionsCache = localPredictions();
  resultsCache = localResults();
}

async function refreshData() {
  if (onlineMode) await loadOnlineData();
  else loadLocalData();
}

function getUsers() { return usersCache; }
function getAllPredictions() { return predictionsCache; }
function getResultOverrides() { return resultsCache; }

function effectiveMatch(m) {
  const o = resultsCache[m.id];
  if (!o || o.home === '' || o.away === '' || o.home == null || o.away == null) return m;
  return { ...m, resultHome: Number(o.home), resultAway: Number(o.away), resultSource: 'admin' };
}
function allEffectiveMatches() { return MATCHES.map(effectiveMatch); }
const isGroup = (m) => m.stage === 'group';
const isKnockout = (m) => m.stage !== 'group';
function hasResult(m) { const em = effectiveMatch(m); return em.resultHome !== null && em.resultAway !== null && em.resultHome !== undefined && em.resultAway !== undefined; }
function isLocked(m) {
  const start = new Date(m.startTimeRo).getTime();
  return Date.now() >= start - LOCK_HOURS_BEFORE_START * 60 * 60 * 1000;
}
function scorePrediction(match, pred) {
  const realMatch = effectiveMatch(match);
  if (!hasResult(realMatch) || !pred) return { points: 0, type: 'pending' };
  const exact = Number(pred.home) === Number(realMatch.resultHome) && Number(pred.away) === Number(realMatch.resultAway);
  if (exact) return { points: 3, type: 'exact' };
  const predSign = predictionFromScore(pred.home, pred.away);
  const realSign = predictionFromScore(realMatch.resultHome, realMatch.resultAway);
  if (predSign !== '—' && predSign === realSign) return { points: 1, type: 'winner' };
  return { points: 0, type: 'wrong' };
}
function userPredictions(email = currentUser?.email) { return getAllPredictions()[normalize(email)] || {}; }

function updateNavigationState() {
  const id = (location.hash || '#predictii').slice(1);
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
  const sectionSelect = $('sectionSelect');
  if (sectionSelect && sectionSelect.value !== id) sectionSelect.value = id;
  const admin = isAdminUser();
  document.body.classList.toggle('admin-mode', admin);
  document.querySelectorAll('.admin-only-option').forEach(o => o.hidden = !admin);
}

function allowedSections() {
  return isAdminUser() ? ['predictii', 'rezultate', 'grupe', 'clasament', 'admin-scoruri', 'admin-emailuri'] : ['predictii', 'rezultate', 'grupe', 'clasament'];
}

async function showApp() {
  await refreshData();
  $('home').classList.remove('active');
  $('topbar').classList.remove('hidden');
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  const requestedHash = location.hash && location.hash !== '#home' ? location.hash.slice(1) : 'predictii';
  const hash = allowedSections().includes(requestedHash) ? requestedHash : 'predictii';
  if (requestedHash !== hash) location.hash = hash;
  ($(hash) || $('predictii')).classList.add('active');
  $('currentPlayerLabel').textContent = isAdminUser() ? `${currentUser.name} · Admin` : currentUser.name;
  updateNavigationState();
  renderAll();
}
function showLanding() {
  $('topbar').classList.add('hidden');
  document.body.classList.remove('admin-mode');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  $('home').classList.add('active');
  setStorageModeLabel();
}

async function registerOrLoginOnline(name, email) {
  await refreshData();
  const sameNameDifferentEmail = usersCache.find(u => normalize(u.name) === normalize(name) && normalize(u.email) !== normalize(email));
  if (sameNameDifferentEmail) throw new Error(`Numele „${name}” există deja în clasament. Alege alt nume.`);
  const existing = usersCache.find(u => normalize(u.email) === normalize(email));
  if (existing && normalize(existing.name) !== normalize(name)) {
    throw new Error(`Acest email este deja asociat cu numele „${existing.name}”. Nu poți schimba numele pentru același email.`);
  }
  if (existing) return existing;
  const role = isAdminUser({ name, email }) ? 'admin' : 'player';
  const { data, error } = await supabaseClient
    .from('wc2026_users')
    .insert({ username: name, email, role })
    .select('id, username, email, role, created_at')
    .single();
  if (error) {
    if ((error.message || '').toLowerCase().includes('duplicate')) {
      throw new Error('Acest nume sau email există deja. Reîncarcă pagina și încearcă din nou.');
    }
    throw error;
  }
  return normalizeUserRow(data);
}

function registerOrLoginLocal(name, email) {
  let users = localUsers();
  const sameNameDifferentEmail = users.find(u => normalize(u.name || u.username) === normalize(name) && normalize(u.email) !== normalize(email));
  if (sameNameDifferentEmail) throw new Error(`Numele „${name}” există deja în clasament. Alege alt nume.`);
  let existing = users.find(u => normalize(u.email) === normalize(email));
  if (existing && normalize(existing.name || existing.username) !== normalize(name)) {
    throw new Error(`Acest email este deja asociat cu numele „${existing.name || existing.username}”. Nu poți schimba numele pentru același email.`);
  }
  if (!existing) {
    existing = { id: email, name, username: name, email, createdAt: new Date().toISOString(), role: isAdminUser({ name, email }) ? 'admin' : 'player' };
    users.push(existing);
    saveLocalUsers(users);
  }
  loadLocalData();
  return normalizeUserRow(existing);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('playerName').value.trim();
  const email = $('playerEmail').value.trim().toLowerCase();
  $('loginMessage').style.color = '';
  if (!name || !email) return;
  if (!isAllowedEmail(email)) {
    $('loginMessage').textContent = 'Te rog introdu un email valid de la un provider cunoscut, de forma exemplu@gmail.com, exemplu@yahoo.com, exemplu@outlook.com etc.';
    $('loginMessage').style.color = 'var(--red)';
    return;
  }
  try {
    let adminPin = null;
    if (isAdminUser({ name, email })) {
      adminPin = prompt('Introdu PIN-ul de admin:');
      if (!adminPin) return;
      sessionStorage.setItem('wc2026_admin_pin', adminPin);
    }
    const user = onlineMode ? await registerOrLoginOnline(name, email) : registerOrLoginLocal(name, email);
    currentUser = { id: user.id, name: user.name, username: user.name, email: user.email, role: user.role };
    localStorage.setItem(STORAGE.current, JSON.stringify(currentUser));
    location.hash = 'predictii';
    await showApp();
    toast(isAdminUser() ? 'Te-ai conectat ca admin.' : 'Te-ai conectat cu succes.');
  } catch (err) {
    console.error(err);
    $('loginMessage').textContent = err.message || 'Nu am putut face autentificarea.';
    $('loginMessage').style.color = 'var(--red)';
  }
});

$('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem(STORAGE.current);
  sessionStorage.removeItem('wc2026_admin_pin');
  currentUser = null;
  location.hash = 'home';
  showLanding();
});

const sectionSelect = $('sectionSelect');
if (sectionSelect) sectionSelect.addEventListener('change', () => { location.hash = sectionSelect.value; });

window.addEventListener('hashchange', async () => {
  if (!currentUser) return showLanding();
  const id = (location.hash || '#predictii').slice(1);
  if (id === 'home') return;
  if (!allowedSections().includes(id)) {
    location.hash = 'predictii';
    return;
  }
  document.querySelectorAll('.app-section').forEach(s => s.classList.toggle('active', s.id === id));
  updateNavigationState();
  await refreshData();
  renderAll();
});

document.querySelectorAll('.filter').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderPredictions();
}));


function flagForTeam(team) {
  const code = TEAM_FLAGS[team];
  if (!code) return '<span class="flag-fallback">⚑</span>';
  const safeTeam = escapeHtml(team);
  const fallback = TEAM_FLAG_FALLBACKS[team] || `https://flagcdn.com/w40/${code}.png`;
  const primary = `https://flagcdn.com/w40/${code}.png`;
  const src = TEAM_FLAG_FALLBACKS[team] ? TEAM_FLAG_FALLBACKS[team] : primary;
  return `<img class="flag-img" src="${src}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'"><span class="sr-only">${safeTeam}</span>`;
}
function isPlaceholderTeam(team) {
  return !TEAM_FLAGS[team];
}
function teamInline(team, align = 'left') {
  const placeholder = isPlaceholderTeam(team);
  return `<span class="team-inline ${align === 'right' ? 'right' : ''} ${placeholder ? 'placeholder' : ''}"><span class="flag-badge" aria-hidden="true">${flagForTeam(team)}</span><span class="team-name">${escapeHtml(team)}</span></span>`;
}
function teamLabel(team) {
  return `<span class="input-team-label">${teamInline(team)}</span>`;
}
function predictionInputLabel(team) {
  return `<span class="input-team-label no-flag"><span class="team-name">${escapeHtml(team)}</span></span>`;
}
function matchTitle(m) {
  return `<span class="match-title"><span class="match-number">#${m.matchNo}</span>${teamInline(m.home)}<span class="match-vs">vs</span>${teamInline(m.away, 'right')}</span>`;
}
function predictionTeamBlock(team, side = 'left') {
  const placeholder = isPlaceholderTeam(team);
  return `<div class="prediction-team ${side === 'right' ? 'right' : 'left'} ${placeholder ? 'placeholder' : ''}">
    <span class="flag-badge prediction-flag" aria-hidden="true">${flagForTeam(team)}</span>
    <span class="prediction-team-name">${escapeHtml(team)}</span>
  </div>`;
}
function predictionSideScoreBlock(team, matchId, side, value, locked) {
  const placeholder = isPlaceholderTeam(team);
  const sideClass = side === 'away' ? 'right' : 'left';
  return `<div class="prediction-side ${sideClass} ${placeholder ? 'placeholder' : ''}">
    <span class="flag-badge prediction-flag" aria-hidden="true">${flagForTeam(team)}</span>
    <span class="prediction-team-name">${escapeHtml(team)}</span>
    <input class="prediction-score-input" aria-label="Scor ${escapeHtml(team)}" type="number" min="0" max="20" data-id="${matchId}" data-side="${side}" value="${value ?? ''}" ${locked ? 'disabled' : ''}>
  </div>`;
}

function renderPredictions() {
  const list = $('matchList');
  const preds = userPredictions();
  const filtered = MATCHES.filter(m => currentFilter === 'all' || (currentFilter === 'group' && isGroup(m)) || (currentFilter === 'knockout' && m.matchNo >= 73 && m.matchNo <= 104));
  list.innerHTML = filtered.map(m => {
    const p = preds[m.id] || {};
    const locked = isLocked(m);
    const pred = predictionFromScore(p.home ?? '', p.away ?? '');
    const stageLabels = { 'Round of 32': 'Eliminatorii · Șaisprezecimi', 'Round of 16': 'Eliminatorii · Optimi', 'Quarterfinals': 'Eliminatorii · Sferturi', 'Semifinals': 'Eliminatorii · Semifinale', 'Third place play-off': 'Eliminatorii · Finala mică', 'Final': 'Eliminatorii · Finala' };
    const groupLabel = isGroup(m) ? `Grupa ${m.group}` : (stageLabels[m.stage] || `Eliminatorii · ${m.stage}`);
    return `<article class="match-card ${locked ? 'locked' : ''}">
      <div class="match-meta"><span>#${m.matchNo} • ${groupLabel}</span><span>${formatRoDate(m)} RO</span></div>
      <div class="prediction-duel">
        ${predictionSideScoreBlock(m.home, m.id, 'home', p.home, locked)}
        <span class="prediction-vs">vs</span>
        ${predictionSideScoreBlock(m.away, m.id, 'away', p.away, locked)}
      </div>
      <div class="prediction-pill">Pronostic:<strong data-pred="${m.id}">${pred}</strong></div>
      <div class="lock-info">${m.venue} • blocare: ${new Intl.DateTimeFormat('ro-RO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(new Date(m.startTimeRo).getTime() - LOCK_HOURS_BEFORE_START*3600000))} RO</div>
    </article>`;
  }).join('');
  list.querySelectorAll('input').forEach(input => input.addEventListener('input', updateLivePredPill));
}
function updateLivePredPill(e) {
  const id = e.target.dataset.id;
  const home = document.querySelector(`input[data-id="${id}"][data-side="home"]`)?.value ?? '';
  const away = document.querySelector(`input[data-id="${id}"][data-side="away"]`)?.value ?? '';
  const pill = document.querySelector(`[data-pred="${id}"]`);
  if (pill) pill.textContent = predictionFromScore(home, away);
}

$('savePredictions').addEventListener('click', async () => {
  if (!currentUser) return;
  const inputs = Array.from(document.querySelectorAll('#matchList input'));
  const grouped = {};
  inputs.forEach(input => {
    if (input.disabled) return;
    const id = input.dataset.id;
    const side = input.dataset.side;
    grouped[id] ||= {};
    grouped[id][side] = input.value === '' ? null : Number(input.value);
  });
  try {
    if (onlineMode) {
      const rows = Object.entries(grouped)
        .filter(([, v]) => v.home != null || v.away != null)
        .map(([matchId, v]) => ({ user_id: currentUser.id, match_id: matchId, home: v.home, away: v.away, updated_at: new Date().toISOString() }));
      if (rows.length) {
        const { error } = await supabaseClient.from('wc2026_predictions').upsert(rows, { onConflict: 'user_id,match_id' });
        if (error) throw error;
      }
    } else {
      const all = localPredictions();
      const existing = all[currentUser.email] || {};
      Object.entries(grouped).forEach(([id, v]) => {
        existing[id] = existing[id] || {};
        if (v.home == null) delete existing[id].home; else existing[id].home = v.home;
        if (v.away == null) delete existing[id].away; else existing[id].away = v.away;
        existing[id].updatedAt = new Date().toISOString();
      });
      all[currentUser.email] = existing;
      saveLocalPredictions(all);
    }
    await refreshData();
    toast('Pronosticurile au fost salvate.');
    renderAll();
  } catch (err) {
    console.error(err);
    toast('Nu am putut salva pronosticurile. Verifică setările Supabase.');
  }
});

function renderResults() {
  const preds = userPredictions();
  let total = 0;
  const playedOrPredicted = MATCHES.filter(m => hasResult(m) || preds[m.id]);
  $('resultsList').innerHTML = playedOrPredicted.length ? playedOrPredicted.map(m => {
    const pred = preds[m.id];
    const realMatch = effectiveMatch(m);
    const sc = scorePrediction(realMatch, pred);
    total += sc.points;
    return `<article class="result-row ${sc.type}">
      <div class="result-match-info"><strong>${matchTitle(m)}</strong><span>${isGroup(m) ? 'Grupa ' + m.group : m.stage} • ${formatRoDate(m)} RO</span></div>
      <div class="score-box"><b>Rezultat</b><span>${hasResult(realMatch) ? `${realMatch.resultHome} - ${realMatch.resultAway}` : 'Nejucat'}</span></div>
      <div class="score-box user-score"><b>Pronosticul tău</b><span>${pred?.home ?? '—'} - ${pred?.away ?? '—'}</span></div>
      <div class="points"><strong>${sc.points}p</strong><span>${sc.type === 'exact' ? 'Scor exact' : sc.type === 'winner' ? 'Pronostic corect' : sc.type === 'wrong' ? 'Greșit' : 'În așteptare'}</span></div>
    </article>`;
  }).join('') : `<div class="empty">Nu există încă rezultate sau pronosticuri salvate.</div>`;
  $('myTotalScore').textContent = `${total}p`;
}

function groupStats() {
  const groups = {};
  allEffectiveMatches().filter(isGroup).forEach(m => {
    groups[m.group] = groups[m.group] || {};
    [m.home, m.away].forEach(t => groups[m.group][t] ||= { team:t, MP:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, Pts:0 });
    if (!hasResult(m)) return;
    const h = groups[m.group][m.home], a = groups[m.group][m.away];
    h.MP++; a.MP++; h.GF += Number(m.resultHome); h.GA += Number(m.resultAway); a.GF += Number(m.resultAway); a.GA += Number(m.resultHome);
    if (m.resultHome > m.resultAway) { h.W++; a.L++; h.Pts += 3; }
    else if (m.resultHome < m.resultAway) { a.W++; h.L++; a.Pts += 3; }
    else { h.D++; a.D++; h.Pts++; a.Pts++; }
    h.GD = h.GF - h.GA; a.GD = a.GF - a.GA;
  });
  return groups;
}
function renderGroups() {
  const groups = groupStats();
  const order = 'ABCDEFGHIJKL'.split('');
  $('groupStandings').innerHTML = order.map(g => {
    const rows = Object.values(groups[g] || {}).sort((a,b) => b.Pts-a.Pts || b.GD-a.GD || b.GF-a.GF || a.team.localeCompare(b.team));
    return `<div class="group-card"><div class="group-title"><strong>Grupa ${g}</strong><span>${rows.reduce((s,r)=>s+r.MP,0)/2} meciuri jucate</span></div>
      <table class="group-table"><thead><tr><th>Țară</th><th>M</th><th>V</th><th>E</th><th>Î</th><th>GD</th><th>Pt</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${teamInline(r.team)}</td><td>${r.MP}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GD}</td><td><strong>${r.Pts}</strong></td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('');
}

async function deleteUser(email) {
  if (!isAdminUser()) return;
  const target = getUsers().find(u => normalize(u.email) === normalize(email));
  if (!target) return;
  if (isAdminUser(target)) return toast('Adminul nu poate fi șters din clasament.');
  const ok = confirm(`Ștergi definitiv userul „${target.name}” și toate pronosticurile lui?`);
  if (!ok) return;
  try {
    if (onlineMode) {
      const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
      if (!pin) return;
      sessionStorage.setItem('wc2026_admin_pin', pin);
      const { data, error } = await supabaseClient.rpc('wc2026_admin_delete_user', {
        admin_email: currentUser.email,
        admin_pin: pin,
        target_email: email
      });
      if (error) throw error;
      if (data !== true) throw new Error('PIN admin invalid sau user inexistent.');
    } else {
      const users = localUsers().filter(u => normalize(u.email) !== normalize(email));
      saveLocalUsers(users);
      const all = localPredictions();
      delete all[email];
      saveLocalPredictions(all);
    }
    await refreshData();
    toast('Userul a fost șters definitiv.');
    renderAll();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Nu am putut șterge userul.');
  }
}


function roDateKey(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function todayRoKey() {
  return roDateKey(new Date().toISOString());
}
function computeLeaderboardRows(matchesScope = MATCHES) {
  const users = getUsers().filter(u => !isAdminUser(u));
  const all = getAllPredictions();
  const rows = users.map(u => {
    let exact = 0, winner = 0, total = 0;
    const p = all[u.email] || {};
    matchesScope.forEach(m => {
      const sc = scorePrediction(m, p[m.id]);
      total += sc.points;
      if (sc.type === 'exact') exact++;
      if (sc.type === 'winner') winner++;
    });
    return { ...u, exact, winner, total };
  }).sort((a,b) => b.total-a.total || b.exact-a.exact || a.name.localeCompare(b.name));
  let currentRank = 0, previousPoints = null;
  return rows.map(r => {
    if (previousPoints === null || r.total !== previousPoints) { currentRank += 1; previousPoints = r.total; }
    return { ...r, rank: currentRank };
  });
}
function getEmailMatchScopes() {
  const includeAll = $('emailIncludeAllResults')?.checked;
  const selectedDate = $('emailReportDate')?.value || todayRoKey();
  const resulted = MATCHES.filter(m => hasResult(m));
  const selectedMatches = resulted.filter(m => includeAll || roDateKey(m.startTimeRo) === selectedDate);
  const cumulativeMatches = includeAll
    ? resulted
    : resulted.filter(m => roDateKey(m.startTimeRo) <= selectedDate);
  return { includeAll, selectedDate, selectedMatches, cumulativeMatches };
}
function selectedEmailMatches() {
  return getEmailMatchScopes().selectedMatches;
}
function buildEmailReports() {
  const { includeAll, selectedDate, selectedMatches, cumulativeMatches } = getEmailMatchScopes();
  const ranked = computeLeaderboardRows(cumulativeMatches);
  const all = getAllPredictions();
  return ranked.map(u => {
    const preds = all[u.email] || {};
    let dailyPoints = 0, dailyExact = 0, dailyWinner = 0;
    const items = selectedMatches.map(m => {
      const pred = preds[m.id];
      const real = effectiveMatch(m);
      const sc = scorePrediction(m, pred);
      dailyPoints += sc.points;
      if (sc.type === 'exact') dailyExact++;
      if (sc.type === 'winner') dailyWinner++;
      return {
        matchNo: m.matchNo,
        label: `${m.home} - ${m.away}`,
        result: `${real.resultHome}-${real.resultAway}`,
        prediction: pred ? `${pred.home ?? '—'}-${pred.away ?? '—'}` : '—',
        points: sc.points,
        type: sc.type
      };
    });
    const periodLabel = includeAll ? 'cu rezultat salvat' : 'din ' + selectedDate;
    const totalLabel = includeAll ? 'Puncte totale' : 'Puncte totale până la data selectată';
    const rankLabel = includeAll ? 'Poziția ta în clasament' : 'Poziția ta în clasament la data selectată';
    const subject = `Rezumat pronosticuri Cupa Mondială 2026 - ${selectedDate}`;
    const text = `Salut, ${u.name}!\n\nRezultatele tale după meciurile ${periodLabel}:\n\nScoruri exacte în selecție: ${dailyExact}\nPronosticuri corecte în selecție: ${dailyWinner}\nPuncte câștigate în selecție: ${dailyPoints}\n${totalLabel}: ${u.total}\n${rankLabel}: locul ${u.rank}\n\nContinuă pronosticurile pentru următoarele meciuri!`;
    const rows = items.map(i => `<tr><td>#${i.matchNo} ${escapeHtml(i.label)}</td><td>${i.result}</td><td>${i.prediction}</td><td><strong>${i.points}p</strong></td></tr>`).join('');
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a"><h2>Salut, ${escapeHtml(u.name)}!</h2><p>Rezultatele tale după meciurile ${periodLabel}:</p><ul><li><strong>Scoruri exacte în selecție:</strong> ${dailyExact}</li><li><strong>Pronosticuri corecte în selecție:</strong> ${dailyWinner}</li><li><strong>Puncte câștigate în selecție:</strong> ${dailyPoints}</li><li><strong>${totalLabel}:</strong> ${u.total}</li><li><strong>${rankLabel}:</strong> locul ${u.rank}</li></ul>${items.length ? `<table style="border-collapse:collapse;width:100%;margin-top:16px"><thead><tr><th align="left">Meci</th><th align="left">Rezultat</th><th align="left">Pronostic</th><th align="left">Puncte</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Nu există meciuri cu rezultat pentru selecția curentă.</p>'}<p style="margin-top:20px">Continuă pronosticurile pentru următoarele meciuri!</p></div>`;
    return { to: u.email, name: u.name, subject, text, html, dailyPoints, dailyExact, dailyWinner, total: u.total, rank: u.rank, matches: items.length };
  });
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function renderEmailPreview() {
  const wrap = $('emailPreview');
  if (!wrap) return;
  if (!isAdminUser()) return wrap.innerHTML = `<div class="empty">Această secțiune este disponibilă doar pentru admin.</div>`;
  const reports = buildEmailReports();
  if (!reports.length) return wrap.innerHTML = `<div class="empty">Nu există useri cărora să le trimitem email.</div>`;
  wrap.innerHTML = reports.map(r => `<article class="email-preview-card"><strong>${escapeHtml(r.name)} · ${escapeHtml(r.to)}</strong><span>Locul ${r.rank} · ${r.dailyPoints}p în selecție · ${r.total}p total · ${r.matches} meciuri incluse</span><details><summary>Vezi text email</summary><pre>${escapeHtml(r.text)}</pre></details></article>`).join('');
}
async function sendDailyEmails() {
  if (!isAdminUser()) return toast('Doar adminul poate trimite emailuri.');
  const reports = buildEmailReports();
  if (!reports.length) return toast('Nu există useri pentru trimitere.');
  const matchesCount = selectedEmailMatches().length;
  if (!matchesCount) {
    const okNoMatches = confirm('Nu există meciuri cu rezultat pentru selecția curentă. Trimiți totuși emailurile?');
    if (!okNoMatches) return;
  }
  const ok = confirm(`Trimiți ${reports.length} emailuri?`);
  if (!ok) return;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/send-daily-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin, reports })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Trimiterea emailurilor a eșuat.');
    toast(`Emailuri trimise: ${data.sent}/${reports.length}.`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Nu am putut trimite emailurile.');
  }
}

function renderLeaderboard() {
  const rows = computeLeaderboardRows();
  const admin = isAdminUser();
  const list = $('leaderboardCards');
  if (!rows.length) return list.innerHTML = `<div class="empty">Nu există useri încă.</div>`;
  list.innerHTML = rows.map((r) => {
    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`;
    const removeButton = admin ? `<button class="delete-user" data-delete-email="${r.email}" title="Șterge userul ${r.name}" aria-label="Șterge userul ${r.name}">×</button>` : '';
    const adminEmail = admin ? `<span class="leaderboard-email">${r.email}</span>` : '';
    return `<article class="leaderboard-card ${r.rank <= 3 ? 'podium' : ''}">
      <div class="rank-badge">${medal}</div>
      <div class="leaderboard-user"><strong>${r.name}</strong>${adminEmail}<span>${r.exact} scoruri exacte · ${r.winner} pronosticuri corecte</span></div>
      <div class="leaderboard-points"><strong>${r.total}p</strong><span>Total</span></div>${removeButton}
    </article>`;
  }).join('');
  document.querySelectorAll('[data-delete-email]').forEach(btn => btn.addEventListener('click', () => deleteUser(btn.dataset.deleteEmail)));
}

function renderAdminScores() {
  const wrap = $('adminScoresList');
  if (!wrap) return;
  if (!isAdminUser()) return wrap.innerHTML = `<div class="empty">Această secțiune este disponibilă doar pentru admin.</div>`;
  const overrides = getResultOverrides();
  wrap.innerHTML = MATCHES.map(m => {
    const current = overrides[m.id] || {};
    const realMatch = effectiveMatch(m);
    const stageLabels = { 'Round of 32': 'Eliminatorii · Șaisprezecimi', 'Round of 16': 'Eliminatorii · Optimi', 'Quarterfinals': 'Eliminatorii · Sferturi', 'Semifinals': 'Eliminatorii · Semifinale', 'Third place play-off': 'Eliminatorii · Finala mică', 'Final': 'Eliminatorii · Finala' };
    const groupLabel = isGroup(m) ? `Grupa ${m.group}` : (stageLabels[m.stage] || `Eliminatorii · ${m.stage}`);
    const sourceBadge = realMatch.resultSource === 'admin' ? '<span class="admin-score-badge">scor online</span>' : '';
    return `<article class="admin-score-row">
      <div class="admin-match-info"><strong>${matchTitle(m)}</strong><span>${groupLabel} • ${formatRoDate(m)} RO ${sourceBadge}</span></div>
      <div class="admin-score-inputs">
        <label>${teamLabel(m.home)}<input type="number" min="0" max="20" data-admin-score="${m.id}" data-side="home" value="${current.home ?? ''}" placeholder="—"></label>
        <label>${teamLabel(m.away)}<input type="number" min="0" max="20" data-admin-score="${m.id}" data-side="away" value="${current.away ?? ''}" placeholder="—"></label>
      </div>
    </article>`;
  }).join('');
}

async function saveAdminScores() {
  if (!isAdminUser()) return toast('Doar adminul poate modifica scorurile.');
  const overrides = {};
  document.querySelectorAll('[data-admin-score]').forEach(input => {
    const id = input.dataset.adminScore;
    const side = input.dataset.side;
    overrides[id] = overrides[id] || {};
    if (input.value !== '') overrides[id][side] = Number(input.value);
  });
  Object.keys(overrides).forEach(id => {
    if (overrides[id].home == null || overrides[id].away == null) delete overrides[id];
  });
  try {
    if (onlineMode) {
      const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
      if (!pin) return;
      sessionStorage.setItem('wc2026_admin_pin', pin);
      const rows = Object.entries(overrides).map(([match_id, v]) => ({ match_id, home: v.home, away: v.away }));
      const { data, error } = await supabaseClient.rpc('wc2026_admin_replace_results', {
        admin_email: currentUser.email,
        admin_pin: pin,
        payload: rows
      });
      if (error) throw error;
      if (data !== true) throw new Error('PIN admin invalid.');
    } else {
      saveLocalResults(overrides);
    }
    await refreshData();
    toast('Scorurile au fost salvate. Clasamentele s-au recalculat.');
    renderAll();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Nu am putut salva scorurile.');
  }
}

async function clearAdminScores() {
  if (!isAdminUser()) return;
  const ok = confirm('Ștergi toate scorurile introduse manual?');
  if (!ok) return;
  try {
    if (onlineMode) {
      const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
      if (!pin) return;
      sessionStorage.setItem('wc2026_admin_pin', pin);
      const { data, error } = await supabaseClient.rpc('wc2026_admin_replace_results', {
        admin_email: currentUser.email,
        admin_pin: pin,
        payload: []
      });
      if (error) throw error;
      if (data !== true) throw new Error('PIN admin invalid.');
    } else {
      localStorage.removeItem(STORAGE.resultOverrides);
    }
    await refreshData();
    toast('Scorurile au fost resetate.');
    renderAll();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Nu am putut reseta scorurile.');
  }
}

const saveAdminScoresBtn = $('saveAdminScores');
if (saveAdminScoresBtn) saveAdminScoresBtn.addEventListener('click', saveAdminScores);
const clearAdminScoresBtn = $('clearAdminScores');
if (clearAdminScoresBtn) clearAdminScoresBtn.addEventListener('click', clearAdminScores);
const previewDailyEmailsBtn = $('previewDailyEmails');
if (previewDailyEmailsBtn) previewDailyEmailsBtn.addEventListener('click', renderEmailPreview);
const sendDailyEmailsBtn = $('sendDailyEmails');
if (sendDailyEmailsBtn) sendDailyEmailsBtn.addEventListener('click', sendDailyEmails);
const emailReportDateInput = $('emailReportDate');
if (emailReportDateInput && !emailReportDateInput.value) emailReportDateInput.value = todayRoKey();
const emailIncludeAllResultsInput = $('emailIncludeAllResults');
if (emailIncludeAllResultsInput) emailIncludeAllResultsInput.addEventListener('change', renderEmailPreview);

function renderAll() { renderPredictions(); renderResults(); renderGroups(); renderLeaderboard(); renderAdminScores(); renderEmailPreview(); }

(async function init(){
  initSupabase();
  setStorageModeLabel();
  try {
    await refreshData();
    currentUser = JSON.parse(localStorage.getItem(STORAGE.current) || 'null');
    if (currentUser && onlineMode) {
      const fresh = usersCache.find(u => normalize(u.email) === normalize(currentUser.email));
      if (fresh) currentUser = { id: fresh.id, name: fresh.name, username: fresh.name, email: fresh.email, role: fresh.role };
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Nu am putut inițializa aplicația.');
    loadLocalData();
  }
  if (currentUser) await showApp(); else showLanding();
})();
