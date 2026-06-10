const MATCHES = window.WC2026_MATCHES || [];
const STORAGE = {
  users: 'wc2026_users_v3',
  current: 'wc2026_current_user_v3',
  predictions: 'wc2026_predictions_v3',
  resultOverrides: 'wc2026_result_overrides_v1'
};
const ADMIN_ACCOUNT = { name: 'admin', email: 'admin@gmail.com' };
const LOCK_HOURS_BEFORE_START = 2;

const TEAM_FLAGS = {
  'Algeria':'dz','Argentina':'ar','Australia':'au','Austria':'at','Belgium':'be','Bosnia and Herzegovina':'ba','Brazil':'br','Canada':'ca','Cape Verde':'cv','Colombia':'co','Croatia':'hr','Curacao':'cw','Czechia':'cz','DR Congo':'cd','Ecuador':'ec','Egypt':'eg','England':'gb-eng','France':'fr','Germany':'de','Ghana':'gh','Haiti':'ht','Iran':'ir','Iraq':'iq','Ivory Coast':'ci','Japan':'jp','Jordan':'jo','Mexico':'mx','Morocco':'ma','Netherlands':'nl','New Zealand':'nz','Norway':'no','Panama':'pa','Paraguay':'py','Portugal':'pt','Qatar':'qa','Saudi Arabia':'sa','Scotland':'gb-sct','Senegal':'sn','South Africa':'za','South Korea':'kr','Spain':'es','Sweden':'se','Switzerland':'ch','Tunisia':'tn','Turkey':'tr','USA':'us','Uruguay':'uy','Uzbekistan':'uz'
};
const TEAM_FLAG_FALLBACKS = {
  'England':'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f4-e0067-e0062-e0065-e006e-e0067-e007f.svg',
  'Scotland':'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20640%20480%22%3E%3Crect%20width=%22640%22%20height=%22480%22%20fill=%22%23005EB8%22/%3E%3Cpath%20d=%22M0%200%20640%20480M640%200%200%20480%22%20stroke=%22%23fff%22%20stroke-width=%2296%22/%3E%3C/svg%3E'
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
  // Acceptă emailuri personale și corporate, de exemplu:
  // nume@gmail.com, nume@yahoo.ro, prenume.nume@dxc.com, user@company.co.uk
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
    $('loginMessage').textContent = 'Te rog introdu un email valid, de forma exemplu@gmail.com, exemplu@email.ro sau nume@companie.com.';
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
  const primary = TEAM_FLAG_FALLBACKS[team] || `https://flagcdn.com/${code}.svg`;
  const fallback = `https://flagcdn.com/w80/${code}.png`;
  return `<img class="flag-img" src="${primary}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'"><span class="sr-only">${safeTeam}</span>`;
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
function formatEmailReportDate(dateKey) {
  if (!dateKey) return '';
  const parts = String(dateKey).split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
function buildEmailReports() {
  const { includeAll, selectedDate, selectedMatches, cumulativeMatches } = getEmailMatchScopes();
  const ranked = computeLeaderboardRows(cumulativeMatches);
  const all = getAllPredictions();
  const siteUrl = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : '';
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
        label: `${m.home} vs ${m.away}`,
        result: `${real.resultHome}-${real.resultAway}`,
        prediction: pred ? `${pred.home ?? '—'}-${pred.away ?? '—'}` : '—',
        points: sc.points,
        type: sc.type
      };
    });
    const reportDateLabel = formatEmailReportDate(selectedDate);
    const periodLabel = includeAll ? 'cu rezultat salvat' : 'din ' + reportDateLabel;
    const totalLabel = includeAll ? 'Puncte totale' : `Puncte totale până la data ${reportDateLabel}`;
    const rankLabel = includeAll ? 'Poziția ta în clasament' : `Poziția ta în clasament la data ${reportDateLabel}`;
    const subject = `🏆 Rezumat pronosticuri Cupa Mondială 2026 - ${selectedDate}`;
    const text = `Salut, ${u.name}!\n\n🏆 Cupa Mondială 2026\n📅 Rezultatele tale pentru meciurile ${periodLabel}\n\n🎯 Puncte câștigate în selecție: ${dailyPoints}p\n✅ Scoruri exacte: ${dailyExact}\n🟡 Pronosticuri corecte: ${dailyWinner}\n🏅 ${totalLabel}: ${u.total}p\n📊 ${rankLabel}: locul ${u.rank}\n\n⚽ Rezultate:\n${items.length ? items.map(i => `#${i.matchNo} ${i.label} | Rezultat: ${i.result} | Pronostic: ${i.prediction} | ${i.points}p`).join('\n') : 'Nu există rezultate pentru selecția curentă.'}\n\nContinuă pronosticurile pentru următoarele meciuri! 🔥`;
    const rows = items.map(i => {
      const badgeBg = i.type === 'exact' ? '#dcfce7' : i.type === 'winner' ? '#fef3c7' : '#fee2e2';
      const badgeColor = i.type === 'exact' ? '#166534' : i.type === 'winner' ? '#92400e' : '#991b1b';
      const badgeText = i.type === 'exact' ? 'Scor exact' : i.type === 'winner' ? 'Pronostic corect' : 'Pronostic gresit';
      return `<tr><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#0f172a">#${i.matchNo} ${escapeHtml(i.label)}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155">${i.result}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155">${i.prediction}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right"><span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-weight:800;white-space:nowrap">${i.points}p · ${badgeText}</span></td></tr>`;
    }).join('');
    const html = `<div style="margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2ff;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.14)"><tr><td style="padding:30px 26px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 52%,#7c3aed 100%);color:#fff"><div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.85">Cupa Mondială 2026</div><h1 style="margin:10px 0 0;font-size:28px;line-height:1.15">🏆 Salut, ${escapeHtml(u.name)}!</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.6;opacity:.9">Rezultatele tale pentru meciurile ${escapeHtml(periodLabel)}.</p></td></tr><tr><td style="padding:22px 24px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="width:50%;padding:8px"><div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">🎯 Puncte selecție</div><div style="font-size:30px;font-weight:900;color:#1d4ed8;margin-top:4px">${dailyPoints}p</div></div></td><td style="width:50%;padding:8px"><div style="border:1px solid #ede9fe;background:#f5f3ff;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">📊 Loc în clasament</div><div style="font-size:30px;font-weight:900;color:#6d28d9;margin-top:4px">#${u.rank}</div></div></td></tr><tr><td style="width:50%;padding:8px"><div style="border:1px solid #dcfce7;background:#f0fdf4;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">✅ Scoruri exacte</div><div style="font-size:26px;font-weight:900;color:#15803d;margin-top:4px">${dailyExact}</div></div></td><td style="width:50%;padding:8px"><div style="border:1px solid #fef3c7;background:#fffbeb;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">🟡 Pronosticuri corecte</div><div style="font-size:26px;font-weight:900;color:#b45309;margin-top:4px">${dailyWinner}</div></div></td></tr></table></td></tr><tr><td style="padding:8px 32px 22px"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:16px"><div style="font-size:14px;color:#475569;font-weight:800">🏅 ${escapeHtml(totalLabel)}</div><div style="font-size:24px;font-weight:900;color:#0f172a;margin-top:4px">${u.total}p</div><div style="font-size:13px;color:#64748b;margin-top:4px">${escapeHtml(rankLabel)}: locul ${u.rank}</div></div></td></tr>${items.length ? `<tr><td style="padding:0 32px 26px"><h2 style="font-size:18px;margin:0 0 12px;color:#0f172a">⚽ Rezultate</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><thead><tr style="background:#f8fafc"><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Meci</th><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Rezultat</th><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Pronostic</th><th align="right" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Puncte</th></tr></thead><tbody>${rows}</tbody></table></td></tr>` : `<tr><td style="padding:0 32px 26px"><div style="padding:16px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-weight:700">Nu există rezultate pentru selecția curentă.</div></td></tr>`}<tr><td align="center" style="padding:0 32px 30px">${siteUrl ? `<a href="${escapeHtml(siteUrl)}" style="display:inline-block;text-decoration:none;background:#0f172a;color:#ffffff;border-radius:999px;padding:13px 22px;font-weight:900">Vezi clasamentul</a>` : ''}<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6">Continuă pronosticurile pentru următoarele meciuri! 🔥</p></td></tr></table><p style="max-width:640px;margin:14px auto 0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center">Email trimis automat de Cupa Mondială 2026 Predictor.</p></td></tr></table></div>`;
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
    const okNoMatches = confirm('Nu există rezultate pentru selecția curentă. Trimiți totuși emailurile?');
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

async function testScheduledEmails() {
  if (!isAdminUser()) return toast('Doar adminul poate testa automatizarea.');
  const reportDate = $('emailReportDate')?.value;
  if (!reportDate) return toast('Selectează data pentru care vrei să testezi automatizarea.');
  const ok = confirm(`Simulezi automatizarea pentru data ${formatEmailReportDate(reportDate)}? Se vor trimite emailuri reale către userii eligibili, dar logul va fi marcat ca test și nu va bloca trimiterea automată oficială.`);
  if (!ok) return;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/scheduled-daily-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEmail: currentUser.email,
        adminPin: pin,
        reportDate,
        testMode: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || data.reason || 'Testul automatizării a eșuat.');
    if (data.skipped) {
      toast(data.reason || 'Automatizarea nu a trimis emailuri pentru această dată.');
    } else {
      toast(`Test automatizare: ${data.sent || 0} trimise, ${data.skippedDuplicate || 0} deja trimise, ${data.failed || 0} eșuate.`);
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Testul automatizării a eșuat.');
  }
}

async function scheduleScheduledEmailTest() {
  if (!isAdminUser()) return toast('Doar adminul poate programa testul automatizării.');
  const reportDate = $('emailReportDate')?.value;
  const runAtLocal = $('scheduledTestRunAt')?.value;
  if (!reportDate) return toast('Selectează data meciurilor pentru raport.');
  if (!runAtLocal) return toast('Selectează data și ora la care să pornească testul.');
  const runAtIso = `${runAtLocal}:00+03:00`;
  const runAtDate = new Date(runAtIso);
  if (Number.isNaN(runAtDate.getTime())) return toast('Data/ora testului nu este validă.');
  if (runAtDate.getTime() < Date.now() - 60 * 1000) {
    const okPast = confirm('Ora selectată pare să fie în trecut. Programezi totuși testul? Va porni la următoarea verificare Netlify.');
    if (!okPast) return;
  }
  const ok = confirm(`Programezi un test automat pentru ${formatEmailReportDate(reportDate)} la ${runAtLocal.replace('T', ' ')} ora României? Emailurile vor fi trimise real, o singură dată.`);
  if (!ok) return;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/schedule-email-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEmail: currentUser.email,
        adminPin: pin,
        reportDate,
        runAtIso
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Programarea testului a eșuat.');
    const status = $('scheduledTestStatus');
    if (status) status.textContent = `Test programat pentru ${data.runAtRo || runAtLocal.replace('T', ' ')} ora României. Netlify verifică periodic și îl va porni o singură dată.`;
    toast('Test automat programat.');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Programarea testului a eșuat.');
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
      <div class="admin-match-info">
        <strong>#${m.id} • ${groupLabel}</strong>
        <span>${formatRoDate(m)} RO ${sourceBadge}</span>
      </div>
      <div class="admin-score-board">
        <label class="admin-team-score admin-team-home">
          <span class="flag-badge admin-score-flag" aria-hidden="true">${flagForTeam(m.home)}</span>
          <span class="admin-team-name">${escapeHtml(m.home)}</span>
          <input type="number" min="0" max="20" data-admin-score="${m.id}" data-side="home" value="${current.home ?? ''}" placeholder="—" aria-label="Scor ${escapeHtml(m.home)}">
        </label>
        <div class="admin-score-middle">
          <span class="admin-vs">vs</span>
          <span class="admin-current-score">${realMatch.resultHome != null && realMatch.resultAway != null ? `${realMatch.resultHome} - ${realMatch.resultAway}` : 'scor real'}</span>
        </div>
        <label class="admin-team-score admin-team-away">
          <span class="flag-badge admin-score-flag" aria-hidden="true">${flagForTeam(m.away)}</span>
          <span class="admin-team-name">${escapeHtml(m.away)}</span>
          <input type="number" min="0" max="20" data-admin-score="${m.id}" data-side="away" value="${current.away ?? ''}" placeholder="—" aria-label="Scor ${escapeHtml(m.away)}">
        </label>
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
const testScheduledEmailsBtn = $('testScheduledEmails');
if (testScheduledEmailsBtn) testScheduledEmailsBtn.addEventListener('click', testScheduledEmails);
const scheduleScheduledEmailTestBtn = $('scheduleScheduledEmailTest');
if (scheduleScheduledEmailTestBtn) scheduleScheduledEmailTestBtn.addEventListener('click', scheduleScheduledEmailTest);
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
