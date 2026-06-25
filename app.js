const MATCHES = window.WC2026_MATCHES || [];
const STORAGE = {
  users: 'wc2026_users_v3',
  current: 'wc2026_current_user_v3',
  predictions: 'wc2026_predictions_v3',
  resultOverrides: 'wc2026_result_overrides_v1',
  luckyStrikes: 'wc2026_lucky_strikes_v1',
  matchOverrides: 'wc2026_match_overrides_v1',
  prizePopupDismissals: 'wc2026_prize_popup_dismissals_v1'
};
const ADMIN_ACCOUNT = { name: 'admin', email: 'admin@gmail.com' };
const LOCK_HOURS_BEFORE_START = 0.5;

const TEAM_FLAGS = {
  'Algeria':'dz','Argentina':'ar','Australia':'au','Austria':'at','Belgium':'be','Bosnia and Herzegovina':'ba','Brazil':'br','Canada':'ca','Cape Verde':'cv','Colombia':'co','Croatia':'hr','Curacao':'cw','Czechia':'cz','DR Congo':'cd','Ecuador':'ec','Egypt':'eg','England':'gb-eng','France':'fr','Germany':'de','Ghana':'gh','Haiti':'ht','Iran':'ir','Iraq':'iq','Ivory Coast':'ci','Japan':'jp','Jordan':'jo','Mexico':'mx','Morocco':'ma','Netherlands':'nl','New Zealand':'nz','Norway':'no','Panama':'pa','Paraguay':'py','Portugal':'pt','Qatar':'qa','Saudi Arabia':'sa','Scotland':'gb-sct','Senegal':'sn','South Africa':'za','South Korea':'kr','Spain':'es','Sweden':'se','Switzerland':'ch','Tunisia':'tn','Turkey':'tr','USA':'us','Uruguay':'uy','Uzbekistan':'uz'
};
const TEAM_FLAG_FALLBACKS = {
  'England':'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20640%20480%22%3E%3Crect%20width=%22640%22%20height=%22480%22%20fill=%22%23fff%22/%3E%3Cpath%20d=%22M320%200v480M0%20240h640%22%20stroke=%22%23CE1124%22%20stroke-width=%2296%22/%3E%3C/svg%3E',
  'Scotland':'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20640%20480%22%3E%3Crect%20width=%22640%22%20height=%22480%22%20fill=%22%23005EB8%22/%3E%3Cpath%20d=%22M0%200%20640%20480M640%200%200%20480%22%20stroke=%22%23fff%22%20stroke-width=%2296%22/%3E%3C/svg%3E'
};
const TEAM_DISPLAY_ALIASES = {
  'united states': 'USA',
  'united states of america': 'USA',
  'usa': 'USA',
  'bosnia-herzegovina': 'Bosnia and Herzegovina',
  'bosnia herzegovina': 'Bosnia and Herzegovina',
  'bosnia and herzegovina': 'Bosnia and Herzegovina',
  'cape verde islands': 'Cape Verde',
  'cape verde': 'Cape Verde',
  'congo dr': 'DR Congo',
  'dr congo': 'DR Congo',
  'democratic republic of congo': 'DR Congo',
  'côte d’ivoire': 'Ivory Coast',
  'cote d ivoire': 'Ivory Coast',
  'ivory coast': 'Ivory Coast',
  'czech republic': 'Czechia',
  'czechia': 'Czechia',
  'korea republic': 'South Korea',
  'south korea': 'South Korea',
  'ir iran': 'Iran',
  'curaçao': 'Curacao',
  'curacao': 'Curacao'
};

let currentUser = null;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
let currentFilter = 'all';
let usersCache = [];
let predictionsCache = {};
let resultsCache = {};
let luckyStrikesCache = {};
let matchOverridesCache = {};
let prizePopupDismissalsCache = {};
let onlineMode = false;
let supabaseClient = null;

const $ = (id) => document.getElementById(id);
const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function teamAliasKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function canonicalTeamName(value) {
  const raw = String(value || '').trim();
  return TEAM_DISPLAY_ALIASES[teamAliasKey(raw)] || raw;
}
const isAdminUser = (user = currentUser) => normalize(user?.name || user?.username) === ADMIN_ACCOUNT.name && normalize(user?.email) === ADMIN_ACCOUNT.email;

function canUseSupabase() {
  const cfg = window.SUPABASE_CONFIG || {};
  return !!(window.supabase && cfg.url && cfg.anonKey && !cfg.url.includes('PASTE_') && !cfg.anonKey.includes('PASTE_'));
}

function initSupabase() {
  // Keep the existing Supabase config check so the app knows it is in online mode.
  // Actual DB calls are routed through Netlify Functions to avoid browser CORS/preflight redirects.
  if (!canUseSupabase()) return false;
  try {
    supabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
  } catch (err) {
    console.warn('Supabase client init failed, but Netlify API can still be used.', err);
  }
  onlineMode = true;
  return true;
}

async function appApi(action, payload = {}) {
  const response = await fetch('/.netlify/functions/app-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `API app a eșuat pentru acțiunea ${action}.`);
  }
  return data;
}

function setStorageModeLabel() {
  const el = $('storageModeMessage');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
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
function localLuckyStrikes() { return JSON.parse(localStorage.getItem(STORAGE.luckyStrikes) || '{}'); }
function saveLocalLuckyStrikes(data) { localStorage.setItem(STORAGE.luckyStrikes, JSON.stringify(data)); }
function localMatchOverrides() { return JSON.parse(localStorage.getItem(STORAGE.matchOverrides) || '{}'); }
function saveLocalMatchOverrides(data) { localStorage.setItem(STORAGE.matchOverrides, JSON.stringify(data)); }
function localPrizePopupDismissals() { return JSON.parse(localStorage.getItem(STORAGE.prizePopupDismissals) || '{}'); }
function saveLocalPrizePopupDismissals(data) { localStorage.setItem(STORAGE.prizePopupDismissals, JSON.stringify(data)); }

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
  console.info('[WC2026 proxy fix] loadOnlineData prin Netlify Function, fără request direct browser → Supabase');

  const payload = await appApi('loadData');
  const users = payload.users || [];
  const preds = payload.predictions || [];
  const results = payload.results || [];
  const luckyRows = payload.luckyStrikes || [];
  const overrideRows = payload.matchOverrides || [];
  const prizeRows = payload.prizeDismissals || [];

  usersCache = users.map(normalizeUserRow);

  const usersById = {};
  usersCache.forEach(user => {
    if (user.id) usersById[user.id] = user;
  });

  predictionsCache = {};
  preds.forEach(p => {
    const email = normalize(usersById[p.user_id]?.email);
    if (!email) return;
    predictionsCache[email] ||= {};
    predictionsCache[email][p.match_id] = {
      home: p.home,
      away: p.away,
      updatedAt: p.updated_at
    };
  });

  resultsCache = {};
  results.forEach(r => {
    resultsCache[r.match_id] = {
      home: r.home,
      away: r.away,
      updatedAt: r.updated_at
    };
  });

  luckyStrikesCache = {};
  luckyRows.forEach(row => {
    const email = normalize(usersById[row.user_id]?.email);
    if (email) {
      luckyStrikesCache[email] = {
        team: row.team,
        createdAt: row.created_at
      };
    }
  });

  prizePopupDismissalsCache = {};
  prizeRows.forEach(row => {
    if (row.user_id) prizePopupDismissalsCache[row.user_id] = { dismissedAt: row.dismissed_at || row.created_at || true };
  });

  matchOverridesCache = {};
  overrideRows.forEach(row => {
    if (row.match_id) {
      matchOverridesCache[row.match_id] = {
        home: row.home,
        away: row.away,
        apiMatchId: row.api_match_id,
        updatedAt: row.updated_at
      };
    }
  });
}
function loadLocalData() {
  usersCache = localUsers().map(normalizeUserRow);
  predictionsCache = localPredictions();
  resultsCache = localResults();
  luckyStrikesCache = localLuckyStrikes();
  matchOverridesCache = localMatchOverrides();
  prizePopupDismissalsCache = localPrizePopupDismissals();
}

async function refreshData() {
  if (onlineMode) await loadOnlineData();
  else loadLocalData();
}

function getUsers() { return usersCache; }
function getAllPredictions() { return predictionsCache; }
function getResultOverrides() { return resultsCache; }
function getLuckyStrikes() { return luckyStrikesCache || {}; }
function getMatchOverrides() { return matchOverridesCache || {}; }
function getPrizePopupDismissals() { return prizePopupDismissalsCache || {}; }

function applyMatchOverride(m) {
  const o = getMatchOverrides()[m.id];
  if (!o || !o.home || !o.away) return m;
  return { ...m, home: canonicalTeamName(o.home), away: canonicalTeamName(o.away), fixtureSource: 'football-data.org', apiMatchId: o.apiMatchId };
}
function allMatches() { return MATCHES.map(applyMatchOverride); }
function effectiveMatch(m) {
  const withTeams = applyMatchOverride(m);
  const o = resultsCache[withTeams.id];
  if (!o || o.home === '' || o.away === '' || o.home == null || o.away == null) return withTeams;
  return { ...withTeams, resultHome: Number(o.home), resultAway: Number(o.away), resultSource: 'admin' };
}
function allEffectiveMatches() { return allMatches().map(effectiveMatch); }
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

const NAV_ITEMS = [
  { id: 'predictii', label: 'Pronosticuri' },
  { id: 'rezultate', label: 'Rezultate' },
  { id: 'grupe', label: 'Grupe' },
  { id: 'eliminatorii', label: 'Eliminatorii', admin: true },
  { id: 'lucky-strike', label: 'Lucky Strike' },
  { id: 'clasament', label: 'Clasament' },
  { id: 'parcurs-preview', label: 'Evoluție' },
  { id: 'admin-scoruri', label: 'Admin scoruri', admin: true },
  { id: 'admin-emailuri', label: 'Admin emailuri', admin: true },
  { id: 'admin-api', label: 'Admin API', admin: true },
  { id: 'admin-teste', label: 'Admin teste', admin: true }
];

function allowedSections() {
  return NAV_ITEMS.filter(item => !item.admin || isAdminUser()).map(item => item.id);
}

function rebuildMobileSectionSelect(activeId) {
  const sectionSelect = $('sectionSelect');
  if (!sectionSelect) return;
  const allowed = new Set(allowedSections());
  const currentOptions = Array.from(sectionSelect.options).map(o => o.value).join('|');
  const nextItems = NAV_ITEMS.filter(item => allowed.has(item.id));
  const nextOptions = nextItems.map(item => item.id).join('|');
  if (currentOptions !== nextOptions) {
    sectionSelect.innerHTML = nextItems.map(item => `<option value="${item.id}">${item.label}</option>`).join('');
  }
  sectionSelect.value = allowed.has(activeId) ? activeId : 'predictii';
}


function forceSectionTopScroll() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function updateNavigationState() {
  const id = (location.hash || '#predictii').slice(1);
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
  const admin = isAdminUser();
  document.body.classList.toggle('admin-mode', admin);
  rebuildMobileSectionSelect(id);
}

async function showApp() {
  const requestedHash = location.hash && location.hash !== '#home' ? location.hash.slice(1) : 'predictii';
  const hash = allowedSections().includes(requestedHash) ? requestedHash : 'predictii';

  // Ascundem landing-ul imediat, înainte de refreshData(), ca să nu apară un flash
  // cu fundalul/scroll-ul de pe pagina de login în timpul tranziției către Pronosticuri.
  $('home').classList.remove('active');
  $('topbar').classList.remove('hidden');
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  ($(hash) || $('predictii')).classList.add('active');

  if (location.hash !== `#${hash}`) {
    try { history.replaceState(null, '', `#${hash}`); }
    catch { location.hash = hash; }
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

  await refreshData();
  $('currentPlayerLabel').textContent = isAdminUser() ? `${currentUser.name} · Admin` : currentUser.name;
  updateNavigationState();
  renderAll();
  if (hash === 'clasament') scrollToCurrentLeaderboardUser();
  else if (hash === 'predictii') scrollToCurrentPredictionMatch();
  else if (hash === 'parcurs-preview') forceSectionTopScroll();
  else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
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
  const data = await appApi('registerOrLogin', { name, email });
  return normalizeUserRow(data.user);
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



const PRIZE_POPUP_DISMISSED_PREFIX = 'wc2026_prize_popup_dismissed_v1_';

function prizePopupIdentity() {
  return normalize(currentUser?.email || currentUser?.username || currentUser?.name || 'guest');
}

function prizePopupDismissedKey() {
  return `${PRIZE_POPUP_DISMISSED_PREFIX}${prizePopupIdentity()}`;
}

function isPrizePopupDismissedForCurrentUser() {
  if (!currentUser) return true;
  const dismissals = getPrizePopupDismissals();
  if (currentUser.id && dismissals[currentUser.id]) return true;
  try { return localStorage.getItem(prizePopupDismissedKey()) === '1'; }
  catch { return false; }
}

async function persistPrizePopupDismissedForCurrentUser() {
  if (!currentUser) return;
  const localKey = prizePopupDismissedKey();
  try { localStorage.setItem(localKey, '1'); } catch {}

  if (currentUser.id) {
    prizePopupDismissalsCache[currentUser.id] = { dismissedAt: new Date().toISOString() };
  }

  if (!onlineMode || !currentUser.id) return;
  try {
    await appApi('dismissPrizePopup', { userId: currentUser.id });
  } catch (err) {
    console.warn('[prize-popup] Nu am putut salva închiderea în Supabase.', err);
  }
}

function closePrizePopup(markDismissed = true) {
  const modal = $('prizePopupModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.removeAttribute('data-open');
  modal.style.removeProperty('display');
  modal.style.removeProperty('visibility');
  modal.style.removeProperty('opacity');
  document.body.classList.remove('prize-popup-open');
  if (markDismissed) persistPrizePopupDismissedForCurrentUser();
}

function maybeShowPrizePopup() {
  const modal = $('prizePopupModal');
  if (!modal || !currentUser) return;
  if (isPrizePopupDismissedForCurrentUser()) return;

  const openPopup = () => {
    if (isPrizePopupDismissedForCurrentUser()) return;
    modal.classList.remove('hidden');
    modal.setAttribute('data-open', 'true');
    modal.style.display = 'grid';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    document.body.classList.add('prize-popup-open');
    const closeBtn = $('prizePopupClose');
    if (closeBtn) {
      try { closeBtn.focus({ preventScroll: true }); }
      catch { try { closeBtn.focus(); } catch {} }
    }
  };

  openPopup();
  requestAnimationFrame(openPopup);
  setTimeout(openPopup, 120);
}

function bindPrizePopup() {
  const closeBtn = $('prizePopupClose');
  if (closeBtn) closeBtn.addEventListener('click', () => closePrizePopup(true));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const modal = $('prizePopupModal');
    if (modal && !modal.classList.contains('hidden')) closePrizePopup(true);
  });
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
    try { history.replaceState(null, '', '#predictii'); }
    catch { location.hash = 'predictii'; }
    await showApp();
    toast(isAdminUser() ? 'Te-ai conectat ca admin.' : 'Te-ai conectat cu succes.');
    maybeShowPrizePopup();
  } catch (err) {
    console.error(err);
    $('loginMessage').textContent = err.message || 'Nu am putut face autentificarea.';
    $('loginMessage').style.color = 'var(--red)';
  }
});

// Forgot Username popup/recovery is handled independently in forgot-username.js.


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

  // Resetăm scroll-ul înainte să afișăm secțiunea nouă, ca pagina să nu apară întâi jos.
  if (id === 'parcurs-preview') forceSectionTopScroll();
  else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

  document.querySelectorAll('.app-section').forEach(s => s.classList.toggle('active', s.id === id));
  updateNavigationState();
  await refreshData();
  renderAll();

  if (id === 'clasament') scrollToCurrentLeaderboardUser();
  else if (id === 'predictii') scrollToCurrentPredictionMatch();
  else if (id === 'parcurs-preview') forceSectionTopScroll();
});

document.querySelectorAll('.filter').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderPredictions();
}));


function flagForTeam(team) {
  const canonical = canonicalTeamName(team);
  const code = TEAM_FLAGS[canonical];
  if (!code) return '<span class="flag-fallback">⚑</span>';
  const safeTeam = escapeHtml(canonical);
  const primary = TEAM_FLAG_FALLBACKS[canonical] || `https://flagcdn.com/${code}.svg`;
  const fallback = `https://flagcdn.com/w80/${code}.png`;
  return `<img class="flag-img" src="${primary}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'"><span class="sr-only">${safeTeam}</span>`;
}
function isPlaceholderTeam(team) {
  return !TEAM_FLAGS[canonicalTeamName(team)];
}
function teamInline(team, align = 'left') {
  const placeholder = isPlaceholderTeam(team);
  return `<span class="team-inline ${align === 'right' ? 'right' : ''} ${placeholder ? 'placeholder' : ''}"><span class="flag-badge" aria-hidden="true">${flagForTeam(team)}</span><span class="team-name">${escapeHtml(canonicalTeamName(team))}</span></span>`;
}
function teamLabel(team) {
  return `<span class="input-team-label">${teamInline(team)}</span>`;
}
function predictionInputLabel(team) {
  return `<span class="input-team-label no-flag"><span class="team-name">${escapeHtml(canonicalTeamName(team))}</span></span>`;
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
function predictionScoreOptions(value) {
  const current = value === '' || value == null ? '' : String(value);
  const options = [''].concat(Array.from({ length: 16 }, (_, i) => String(i)));
  return options.map(v => {
    const label = v === '' ? '—' : v;
    return `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function predictionScoreLabel(value) {
  return value === '' || value == null ? '—' : String(value);
}

function predictionScoreMenuOptions(value) {
  const current = value === '' || value == null ? '' : String(value);
  const options = [''].concat(Array.from({ length: 16 }, (_, i) => String(i)));
  return options.map(v => {
    const label = v === '' ? '—' : v;
    return `<button type="button" class="prediction-score-option ${current === v ? 'active' : ''}" data-score-value="${v}">${label}</button>`;
  }).join('');
}

function predictionSideScoreBlock(team, matchId, side, value, locked) {
  const placeholder = isPlaceholderTeam(team);
  const sideClass = side === 'away' ? 'right' : 'left';
  const scoreLabel = predictionScoreLabel(value);
  const safeTeam = escapeHtml(team);
  return `<div class="prediction-side ${sideClass} ${placeholder ? 'placeholder' : ''}">
    <span class="flag-badge prediction-flag" aria-hidden="true">${flagForTeam(team)}</span>
    <span class="prediction-team-name">${safeTeam}</span>
    <div class="prediction-score-picker ${locked ? 'disabled' : ''}" data-id="${matchId}" data-side="${side}">
      <select class="prediction-score-input prediction-score-select" aria-label="Scor ${safeTeam}" data-id="${matchId}" data-side="${side}" tabindex="-1" aria-hidden="true" ${locked ? 'disabled' : ''}>${predictionScoreOptions(value)}</select>
      <button type="button" class="prediction-score-button" aria-label="Scor ${safeTeam}" aria-expanded="false" ${locked ? 'disabled' : ''}>
        <span class="prediction-score-button-value">${scoreLabel}</span>
      </button>
      <div class="prediction-score-menu hidden" role="listbox">${predictionScoreMenuOptions(value)}</div>
    </div>
  </div>`;
}


let predictionScoreGlobalCloseBound = false;

function closePredictionScoreMenus(exceptMenu = null) {
  document.querySelectorAll('.prediction-score-menu').forEach(menu => {
    if (menu === exceptMenu) return;
    menu.classList.add('hidden');
    const picker = menu.closest('.prediction-score-picker');
    picker?.querySelector('.prediction-score-button')?.setAttribute('aria-expanded', 'false');
    picker?.closest('.match-card')?.classList.remove('score-menu-open');
  });
}

function syncPredictionScorePicker(select) {
  const picker = select.closest('.prediction-score-picker');
  if (!picker) return;
  const value = select.value ?? '';
  const label = predictionScoreLabel(value);
  const buttonValue = picker.querySelector('.prediction-score-button-value');
  if (buttonValue) buttonValue.textContent = label;
  picker.querySelectorAll('.prediction-score-option').forEach(option => {
    option.classList.toggle('active', (option.dataset.scoreValue ?? '') === value);
  });
}

function bindPredictionScorePickers(root = document) {
  root.querySelectorAll('.prediction-score-picker').forEach(picker => {
    const select = picker.querySelector('.prediction-score-select');
    const button = picker.querySelector('.prediction-score-button');
    const menu = picker.querySelector('.prediction-score-menu');
    if (!select || !button || !menu || button.disabled) return;

    button.addEventListener('click', event => {
      event.stopPropagation();
      const shouldOpen = menu.classList.contains('hidden');
      closePredictionScoreMenus(menu);
      if (shouldOpen) {
        picker.closest('.match-card')?.classList.add('score-menu-open');
        menu.classList.remove('hidden');
        button.setAttribute('aria-expanded', 'true');
      } else {
        menu.classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
        picker.closest('.match-card')?.classList.remove('score-menu-open');
      }
    });

    menu.querySelectorAll('.prediction-score-option').forEach(option => {
      option.addEventListener('click', event => {
        event.stopPropagation();
        select.value = option.dataset.scoreValue ?? '';
        syncPredictionScorePicker(select);
        menu.classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
        picker.closest('.match-card')?.classList.remove('score-menu-open');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    select.addEventListener('change', () => syncPredictionScorePicker(select));
  });

  if (!predictionScoreGlobalCloseBound) {
    document.addEventListener('click', () => closePredictionScoreMenus());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closePredictionScoreMenus();
    });
    predictionScoreGlobalCloseBound = true;
  }
}



function fitMatchMetaInfo() {
  document.querySelectorAll('#matchList .match-meta').forEach(meta => {
    const spans = Array.from(meta.querySelectorAll('span'));
    if (!spans.length) return;

    meta.style.setProperty('--match-meta-size', '0.82rem');
    spans.forEach(span => {
      span.style.letterSpacing = '';
    });

    const basePx = parseFloat(getComputedStyle(meta).fontSize) || 13;
    let size = basePx;
    const minSize = 10.2;

    for (let i = 0; i < 18; i += 1) {
      const metaOverflow = meta.scrollWidth > meta.clientWidth + 1;
      const spanOverflow = spans.some(span => span.scrollWidth > span.clientWidth + 1);
      if (!metaOverflow && !spanOverflow) break;

      size = Math.max(minSize, size - 0.35);
      meta.style.setProperty('--match-meta-size', `${size}px`);
      if (size <= 11.2) spans.forEach(span => { span.style.letterSpacing = '-.025em'; });
      if (size <= minSize) break;
    }
  });
}

let matchMetaInfoFitResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(matchMetaInfoFitResizeTimer);
  matchMetaInfoFitResizeTimer = setTimeout(fitMatchMetaInfo, 120);
});

function nextUnplayedMatchId(matches) {
  const now = Date.now();
  const sorted = [...matches].sort((a, b) => new Date(a.startTimeRo).getTime() - new Date(b.startTimeRo).getTime());

  const futureWithoutResult = sorted.find(m => !hasResult(m) && new Date(m.startTimeRo).getTime() > now);
  if (futureWithoutResult) return futureWithoutResult.id;

  const withoutResult = sorted.find(m => !hasResult(m));
  return withoutResult ? withoutResult.id : null;
}

function currentPredictionMatchAttr(matchId, targetId) {
  return matchId && targetId && String(matchId) === String(targetId) ? ' data-current-prediction-match="true"' : '';
}

function scrollToCurrentPredictionMatch() {
  const predictii = $('predictii');
  if (!predictii || !predictii.classList.contains('active')) return;

  const target = predictii.querySelector('[data-current-prediction-match="true"]');
  if (!target) return;

  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  });
}

function renderPredictions() {
  const list = $('matchList');
  const preds = userPredictions();
  const filtered = allMatches().filter(m => currentFilter === 'all' || (currentFilter === 'group' && isGroup(m)) || (currentFilter === 'knockout' && m.matchNo >= 73 && m.matchNo <= 104));
  const knockoutDisplayMap = filtered.some(isKnockout) ? resolvedKnockoutMatchMap() : new Map();
  const nextMatchId = nextUnplayedMatchId(filtered);
  list.innerHTML = filtered.map(m => {
    const displayMatch = matchWithResolvedKnockoutTeams(m, knockoutDisplayMap);
    const p = preds[m.id] || {};
    const locked = isLocked(m);
    const pred = predictionFromScore(p.home ?? '', p.away ?? '');
    const stageLabels = { 'Round of 32': 'Eliminatorii · Șaisprezecimi', 'Round of 16': 'Eliminatorii · Optimi', 'Quarterfinals': 'Eliminatorii · Sferturi', 'Semifinals': 'Eliminatorii · Semifinale', 'Third place play-off': 'Eliminatorii · Finala mică', 'Final': 'Eliminatorii · Finala' };
    const groupLabel = isGroup(m) ? `Grupa ${m.group}` : (stageLabels[m.stage] || `Eliminatorii · ${m.stage}`);
    return `<article class="match-card ${locked ? 'locked' : ''}"${currentPredictionMatchAttr(m.id, nextMatchId)}>
      <div class="match-meta"><span>#${m.matchNo} • ${groupLabel}</span><span>${formatRoDate(m)} RO</span></div>
      <div class="prediction-duel">
        ${predictionSideScoreBlock(displayMatch.home, m.id, 'home', p.home, locked)}
        <span class="prediction-vs">vs</span>
        ${predictionSideScoreBlock(displayMatch.away, m.id, 'away', p.away, locked)}
      </div>
      <div class="prediction-pill">Pronostic:<strong data-pred="${m.id}">${pred}</strong></div>
      <div class="lock-info">${m.venue} • blocare: ${new Intl.DateTimeFormat('ro-RO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(new Date(m.startTimeRo).getTime() - LOCK_HOURS_BEFORE_START*3600000))} RO</div>
    </article>`;
  }).join('');
  list.querySelectorAll('.prediction-score-select').forEach(select => select.addEventListener('change', updateLivePredPill));
  bindPredictionScorePickers(list);
  fitMatchMetaInfo();
}
function updateLivePredPill(e) {
  const id = e.target.dataset.id;
  const home = document.querySelector(`.prediction-score-select[data-id="${id}"][data-side="home"]`)?.value ?? '';
  const away = document.querySelector(`.prediction-score-select[data-id="${id}"][data-side="away"]`)?.value ?? '';
  const pill = document.querySelector(`[data-pred="${id}"]`);
  if (pill) pill.textContent = predictionFromScore(home, away);
  schedulePredictionAutoSave(id);
}


const PREDICTION_AUTOSAVE_DELAY_MS = 450;
const predictionAutoSaveTimers = {};
let predictionAutoSaveBusy = false;

function updatePredictionsCacheForCurrentUser(matchId, home, away) {
  const email = normalize(currentUser?.email);
  if (!email || !matchId) return;
  predictionsCache[email] ||= {};
  predictionsCache[email][matchId] = {
    home,
    away,
    updatedAt: new Date().toISOString()
  };
}

async function savePredictionMatch(matchId, { silent = false } = {}) {
  if (!currentUser || !matchId) return;
  const match = allMatches().find(m => String(m.id) === String(matchId));
  if (!match || isLocked(match)) return;

  const scoreInputs = Array.from(document.querySelectorAll('#matchList .prediction-score-select'));
  const homeEl = scoreInputs.find(input => String(input.dataset.id) === String(matchId) && input.dataset.side === 'home');
  const awayEl = scoreInputs.find(input => String(input.dataset.id) === String(matchId) && input.dataset.side === 'away');
  if (!homeEl || !awayEl || homeEl.disabled || awayEl.disabled) return;
  if (homeEl.value === '' || awayEl.value === '') return;

  const home = Number(homeEl.value);
  const away = Number(awayEl.value);
  if (!Number.isInteger(home) || !Number.isInteger(away)) return;
  if (home < 0 || home > 20 || away < 0 || away > 20) return;

  try {
    if (onlineMode) {
      const row = {
        user_id: currentUser.id,
        match_id: String(matchId),
        home,
        away,
        updated_at: new Date().toISOString()
      };
      const saveInfo = await appApi('savePredictions', { rows: [row] });
      if (saveInfo?.blocked) {
        if (!silent) toast('Meciul este blocat. Pronosticul nu a fost salvat.');
        return;
      }
    } else {
      const all = localPredictions();
      const existing = all[currentUser.email] || {};
      existing[matchId] = { home, away, updatedAt: new Date().toISOString() };
      all[currentUser.email] = existing;
      saveLocalPredictions(all);
    }

    updatePredictionsCacheForCurrentUser(matchId, home, away);
    if (!silent) toast('Pronostic salvat automat.');
  } catch (err) {
    console.error(err);
    if (!silent) toast('Nu am putut salva automat pronosticul.');
  }
}

function schedulePredictionAutoSave(matchId) {
  if (!matchId) return;
  clearTimeout(predictionAutoSaveTimers[matchId]);
  predictionAutoSaveTimers[matchId] = setTimeout(() => {
    savePredictionMatch(matchId);
  }, PREDICTION_AUTOSAVE_DELAY_MS);
}

const savePredictionsBtn = $('savePredictions');
if (savePredictionsBtn) savePredictionsBtn.addEventListener('click', async () => {
  if (!currentUser) return;
  const inputs = Array.from(document.querySelectorAll('#matchList .prediction-score-select'));
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
      let saveInfo = { saved: 0, blocked: 0 };
      if (rows.length) {
        saveInfo = await appApi('savePredictions', { rows });
      }
      if (saveInfo?.blocked) {
        toast(`${saveInfo.blocked} pronosticuri blocate nu au fost salvate.`);
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
  const playedOrPredicted = allMatches().filter(m => hasResult(m) || preds[m.id]);
  const knockoutDisplayMap = playedOrPredicted.some(isKnockout) ? resolvedKnockoutMatchMap() : new Map();
  $('resultsList').innerHTML = playedOrPredicted.length ? playedOrPredicted.map(m => {
    const displayMatch = matchWithResolvedKnockoutTeams(m, knockoutDisplayMap);
    const pred = preds[m.id];
    const realMatch = effectiveMatch(m);
    const sc = scorePrediction(realMatch, pred);
    total += sc.points;
    return `<article class="result-row ${sc.type}">
      <div class="result-match-info"><strong>${matchTitle(displayMatch)}</strong><span>${isGroup(m) ? 'Grupa ' + m.group : m.stage} • ${formatRoDate(m)} RO</span></div>
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
function sortGroupRows(rows) {
  return rows.slice().sort((a,b) => b.Pts-a.Pts || b.GD-a.GD || b.GF-a.GF || a.team.localeCompare(b.team));
}

function groupPlayedMatchesCount(groupLetter) {
  return allMatches().filter(m => m.group === groupLetter && hasResult(m)).length;
}

function areAllGroupsComplete() {
  return 'ABCDEFGHIJKL'.split('').every(g => groupPlayedMatchesCount(g) === 6);
}

function groupTableRowsMarkup(rows, includeGroup = false, qualifiedCount = 0) {
  return rows.map((r, idx) => {
    const qualifiedClass = idx < qualifiedCount ? ' class="group-qualified-row"' : '';
    return `<tr${qualifiedClass}><td>${teamInline(r.team)}</td>${includeGroup ? `<td>${r.group}</td>` : ''}<td>${r.MP}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GD}</td><td><strong>${r.Pts}</strong></td></tr>`;
  }).join('');
}

function bestThirdPlaceRows(groups) {
  const order = 'ABCDEFGHIJKL'.split('');
  return sortGroupRows(order
    .map(g => {
      const third = sortGroupRows(Object.values(groups[g] || {}))[2];
      return third ? { ...third, group: g } : null;
    })
    .filter(Boolean));
}

function renderGroups() {
  const groups = groupStats();
  const order = 'ABCDEFGHIJKL'.split('');
  const allGroupsComplete = areAllGroupsComplete();

  const groupCards = order.map(g => {
    const rows = sortGroupRows(Object.values(groups[g] || {}));
    const playedMatches = groupPlayedMatchesCount(g);
    const qualifiedCount = playedMatches === 6 ? 2 : 0;
    return `<div class="group-card"><div class="group-title"><strong>Grupa ${g}</strong><span>${playedMatches} meciuri jucate</span></div>
      <table class="group-table"><thead><tr><th>Țară</th><th>M</th><th>V</th><th>E</th><th>Î</th><th>GD</th><th>Pt</th></tr></thead><tbody>
      ${groupTableRowsMarkup(rows, false, qualifiedCount)}
      </tbody></table></div>`;
  }).join('');

  const thirdRows = bestThirdPlaceRows(groups);
  const thirdQualifiedCount = allGroupsComplete ? 8 : 0;
  const thirdPlaceCard = `<div class="group-card best-third-card"><div class="group-title"><strong>Calificată direct - cea mai bună echipă de pe locul 3</strong><span>${thirdRows.length} echipe</span></div>
      <table class="group-table best-third-table"><thead><tr><th>Țară</th><th>Gr.</th><th>M</th><th>V</th><th>E</th><th>Î</th><th>GD</th><th>Pt</th></tr></thead><tbody>
      ${groupTableRowsMarkup(thirdRows, true, thirdQualifiedCount)}
      </tbody></table></div>`;

  $('groupStandings').innerHTML = groupCards + thirdPlaceCard;
}


const KNOCKOUT_ROUNDS = [
  { stage: 'Round of 32', label: 'Șaisprezecimi', range: 'Meciurile 73–88' },
  { stage: 'Round of 16', label: 'Optimi', range: 'Meciurile 89–96' },
  { stage: 'Quarterfinals', label: 'Sferturi', range: 'Meciurile 97–100' },
  { stage: 'Semifinals', label: 'Semifinale', range: 'Meciurile 101–102' },
  { stage: 'Final', label: 'Finală', range: 'Meciul 104' }
];

function knockoutRoundName(stage) {
  return KNOCKOUT_ROUNDS.find(r => r.stage === stage)?.label || stage;
}

function knockoutPlaceholderLabel(slot) {
  const raw = String(slot || '').trim();
  const direct = raw.match(/^([12])([A-L])$/);
  if (direct) return `Locul ${direct[1]} Grupa ${direct[2]}`;
  const third = raw.match(/^3([A-L](?:\/[A-L])*)$/);
  if (third) return `Locul 3 Gr. ${third[1]}`;
  return raw
    .replace(/^Winner\s+/i, 'Câștigătoare ')
    .replace(/^Loser\s+/i, 'Învinsă ');
}

function knockoutRoundOf32ThirdSlots() {
  return allMatches()
    .filter(m => Number(m.matchNo) >= 73 && Number(m.matchNo) <= 88)
    .flatMap(m => ['home', 'away'].map(side => ({ match: m, side, slot: m[side] })))
    .filter(item => /^3[A-L](?:\/[A-L])*$/.test(String(item.slot || '').trim()))
    .map(item => ({
      key: `${item.match.id}-${item.side}`,
      matchId: item.match.id,
      side: item.side,
      slot: item.slot,
      candidates: String(item.slot).replace(/^3/, '').split('/')
    }));
}

function knockoutThirdPlaceAssignments(groups = groupStats()) {
  if (!areAllGroupsComplete()) return {};
  const thirdRows = bestThirdPlaceRows(groups).slice(0, 8);
  const slots = knockoutRoundOf32ThirdSlots();
  const assigned = {};

  function backtrack(index, usedGroups) {
    if (index >= slots.length) return true;
    const slot = slots[index];
    const candidates = thirdRows.filter(row => slot.candidates.includes(row.group) && !usedGroups.has(row.group));
    for (const row of candidates) {
      assigned[slot.key] = row;
      usedGroups.add(row.group);
      if (backtrack(index + 1, usedGroups)) return true;
      usedGroups.delete(row.group);
      delete assigned[slot.key];
    }
    return false;
  }

  if (!backtrack(0, new Set())) {
    // Fallback defensiv: alege cea mai bună echipă disponibilă pentru fiecare slot.
    const usedGroups = new Set();
    slots.forEach(slot => {
      const row = thirdRows.find(r => slot.candidates.includes(r.group) && !usedGroups.has(r.group));
      if (row) {
        assigned[slot.key] = row;
        usedGroups.add(row.group);
      }
    });
  }
  return assigned;
}

function resolveGroupPositionSlot(slot, groups) {
  const match = String(slot || '').trim().match(/^([12])([A-L])$/);
  if (!match) return null;
  const position = Number(match[1]);
  const group = match[2];
  if (groupPlayedMatchesCount(group) !== 6) {
    return { label: knockoutPlaceholderLabel(slot), team: null, placeholder: true, detail: `Așteaptă finalizarea Grupei ${group}` };
  }
  const row = sortGroupRows(Object.values(groups[group] || {}))[position - 1];
  if (!row) return { label: knockoutPlaceholderLabel(slot), team: null, placeholder: true, detail: `Nu există încă suficiente date pentru Grupa ${group}` };
  return { label: row.team, team: row.team, placeholder: false, detail: `Locul ${position} · Grupa ${group}` };
}

function resolveThirdPlaceSlot(slot, groups, assignments, key) {
  const match = String(slot || '').trim().match(/^3([A-L](?:\/[A-L])*)$/);
  if (!match) return null;
  if (!areAllGroupsComplete()) {
    return { label: knockoutPlaceholderLabel(slot), team: null, placeholder: true, detail: 'Așteaptă finalizarea tuturor grupelor' };
  }
  const row = assignments[key];
  if (!row) return { label: knockoutPlaceholderLabel(slot), team: null, placeholder: true, detail: 'Slotul de locul 3 va fi stabilit automat' };
  return { label: row.team, team: row.team, placeholder: false, detail: `Locul 3 · Grupa ${row.group}` };
}

function resolveKnockoutEndpoint(raw, sideKey, context) {
  const slot = String(raw || '').trim();
  const winner = slot.match(/^Winner\s+(.+)$/i);
  if (winner) {
    const source = winner[1].trim();
    return context.winners[source] || { label: knockoutPlaceholderLabel(slot), team: null, placeholder: true, detail: `Așteaptă câștigătoarea ${source}` };
  }
  const loser = slot.match(/^Loser\s+(.+)$/i);
  if (loser) {
    const source = loser[1].trim();
    return context.losers[source] || { label: knockoutPlaceholderLabel(slot), team: null, placeholder: true, detail: `Așteaptă învinsa ${source}` };
  }
  const groupSlot = resolveGroupPositionSlot(slot, context.groups);
  if (groupSlot) return groupSlot;
  const thirdSlot = resolveThirdPlaceSlot(slot, context.groups, context.thirdAssignments, sideKey);
  if (thirdSlot) return thirdSlot;
  return { label: canonicalTeamName(slot), team: canonicalTeamName(slot), placeholder: isPlaceholderTeam(slot), detail: '' };
}

function knockoutWinnerSide(match) {
  const m = effectiveMatch(match);
  if (!hasResult(m)) return null;
  const home = Number(m.resultHome);
  const away = Number(m.resultAway);
  if (home > away) return 'home';
  if (away > home) return 'away';
  return null;
}

function buildKnockoutBracketState() {
  const groups = groupStats();
  const context = {
    groups,
    thirdAssignments: knockoutThirdPlaceAssignments(groups),
    winners: {},
    losers: {}
  };

  const matches = allEffectiveMatches()
    .filter(isKnockout)
    .slice()
    .sort((a, b) => Number(a.matchNo || 0) - Number(b.matchNo || 0));

  const resolvedMatches = matches.map(match => {
    const home = resolveKnockoutEndpoint(match.home, `${match.id}-home`, context);
    const away = resolveKnockoutEndpoint(match.away, `${match.id}-away`, context);
    const winnerSide = knockoutWinnerSide(match);
    const winner = winnerSide === 'home' ? home : winnerSide === 'away' ? away : null;
    const loser = winnerSide === 'home' ? away : winnerSide === 'away' ? home : null;
    const resultLabel = hasResult(match) ? `${effectiveMatch(match).resultHome} - ${effectiveMatch(match).resultAway}` : '—';
    const resolved = { ...match, resolvedHome: home, resolvedAway: away, winnerSide, resultLabel };

    if (winner?.team || winner?.label) context.winners[match.id] = { ...winner, detail: `Câștigătoare ${match.id}` };
    if (loser?.team || loser?.label) context.losers[match.id] = { ...loser, detail: `Învinsă ${match.id}` };
    return resolved;
  });

  return { matches: resolvedMatches, context };
}


function resolvedKnockoutMatchMap() {
  return new Map(buildKnockoutBracketState().matches.map(match => [match.id, match]));
}

function matchWithResolvedKnockoutTeams(match, knockoutMap = null) {
  if (!match || !isKnockout(match)) return match;
  const resolved = knockoutMap?.get(match.id);
  if (!resolved) return match;
  const home = resolved.resolvedHome?.label || match.home;
  const away = resolved.resolvedAway?.label || match.away;
  return { ...match, home, away, resolvedHome: resolved.resolvedHome, resolvedAway: resolved.resolvedAway };
}

function knockoutTeamMarkup(entry, score, isWinner = false) {
  const label = entry?.label || '—';
  const detail = entry?.detail || '';
  return `<div class="knockout-team ${entry?.placeholder ? 'is-placeholder' : ''} ${isWinner ? 'is-winner' : ''}">
    <div class="knockout-team-main">${teamInline(label)}<strong class="knockout-score-cell">${score}</strong></div>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
  </div>`;
}

function renderKnockoutMatchCard(match) {
  const played = hasResult(match);
  const effective = effectiveMatch(match);
  const homeScore = played ? Number(effective.resultHome) : '—';
  const awayScore = played ? Number(effective.resultAway) : '—';
  const tieNote = played && !match.winnerSide ? '<div class="knockout-warning">Egalitate: așteaptă departajarea / date complete din API.</div>' : '';
  return `<article class="knockout-match ${played ? 'is-played' : ''}">
    <div class="knockout-match-top">
      <span>#${match.matchNo}</span>
      <span>${escapeHtml(formatRoDate(match))} RO</span>
    </div>
    ${knockoutTeamMarkup(match.resolvedHome, homeScore, match.winnerSide === 'home')}
    ${knockoutTeamMarkup(match.resolvedAway, awayScore, match.winnerSide === 'away')}
    ${tieNote}
    <div class="knockout-match-bottom">${escapeHtml(match.venue || '')}</div>
  </article>`;
}

const KNOCKOUT_TREE_PYRAMID = {
  columns: [
    { key: 'r32', label: 'Șaisprezecimi', ids: ['R32-01', 'R32-04', 'R32-03', 'R32-06', 'R32-12', 'R32-11', 'R32-10', 'R32-09', 'R32-02', 'R32-05', 'R32-07', 'R32-08', 'R32-15', 'R32-14', 'R32-13', 'R32-16'] },
    { key: 'r16', label: 'Optimi', ids: ['R16-01', 'R16-02', 'R16-05', 'R16-06', 'R16-03', 'R16-04', 'R16-07', 'R16-08'] },
    { key: 'qf', label: 'Sferturi', ids: ['QF-01', 'QF-02', 'QF-03', 'QF-04'] },
    { key: 'sf', label: 'Semifinale', ids: ['SF-01', 'SF-02'] },
    { key: 'final', label: 'Finală', ids: ['F-01'] }
  ],
  edges: [
    ['R32-01', 'R16-01'], ['R32-04', 'R16-01'],
    ['R32-03', 'R16-02'], ['R32-06', 'R16-02'],
    ['R32-12', 'R16-05'], ['R32-11', 'R16-05'],
    ['R32-10', 'R16-06'], ['R32-09', 'R16-06'],
    ['R32-02', 'R16-03'], ['R32-05', 'R16-03'],
    ['R32-07', 'R16-04'], ['R32-08', 'R16-04'],
    ['R32-15', 'R16-07'], ['R32-14', 'R16-07'],
    ['R32-13', 'R16-08'], ['R32-16', 'R16-08'],
    ['R16-01', 'QF-01'], ['R16-02', 'QF-01'],
    ['R16-05', 'QF-02'], ['R16-06', 'QF-02'],
    ['R16-03', 'QF-03'], ['R16-04', 'QF-03'],
    ['R16-07', 'QF-04'], ['R16-08', 'QF-04'],
    ['QF-01', 'SF-01'], ['QF-02', 'SF-01'],
    ['QF-03', 'SF-02'], ['QF-04', 'SF-02'],
    ['SF-01', 'F-01'], ['SF-02', 'F-01']
  ]
};

function knockoutTreeLayout() {
  const cardW = 205;
  const cardH = 82;
  const finalW = 245;
  const finalH = 100;
  const width = 1440;
  const height = 1420;
  const r32Centers = Array.from({ length: 16 }, (_, index) => 82 + index * 84);
  const r16Centers = r32Centers.reduce((items, center, index) => {
    if (index % 2 === 0) items.push((center + r32Centers[index + 1]) / 2);
    return items;
  }, []);
  const qfCenters = r16Centers.reduce((items, center, index) => {
    if (index % 2 === 0) items.push((center + r16Centers[index + 1]) / 2);
    return items;
  }, []);
  const sfCenters = qfCenters.reduce((items, center, index) => {
    if (index % 2 === 0) items.push((center + qfCenters[index + 1]) / 2);
    return items;
  }, []);
  const finalCenters = [(sfCenters[0] + sfCenters[1]) / 2];
  const positions = {};

  function place(ids, x, centers, w = cardW, h = cardH) {
    ids.forEach((id, index) => {
      const center = centers[index] ?? centers[centers.length - 1] ?? 610;
      positions[id] = { id, x, y: center - h / 2, w, h, cx: x + w / 2, cy: center };
    });
  }

  place(KNOCKOUT_TREE_PYRAMID.columns[0].ids, 20, r32Centers);
  place(KNOCKOUT_TREE_PYRAMID.columns[1].ids, 310, r16Centers);
  place(KNOCKOUT_TREE_PYRAMID.columns[2].ids, 600, qfCenters);
  place(KNOCKOUT_TREE_PYRAMID.columns[3].ids, 890, sfCenters);
  place(KNOCKOUT_TREE_PYRAMID.columns[4].ids, 1160, finalCenters, finalW, finalH);

  return { width, height, cardW, cardH, finalW, finalH, positions };
}

function knockoutTreeColumnLabels(layout) {
  const labels = [
    { x: 20 + 102.5, label: 'Șaisprezecimi' },
    { x: 310 + 102.5, label: 'Optimi' },
    { x: 600 + 102.5, label: 'Sferturi' },
    { x: 890 + 102.5, label: 'Semifinale' },
    { x: 1160 + 122.5, label: 'Finală' }
  ];
  return labels.map(item => `<text class="ko-tree-label" x="${item.x}" y="28" text-anchor="middle">${escapeHtml(item.label)}</text>`).join('');
}

function knockoutTreeConnectorPath(from, to, layout) {
  if (!from || !to) return '';
  const x1 = from.x + from.w;
  const x2 = to.x;
  const mid = x1 + (x2 - x1) / 2;
  return `M${x1} ${from.cy} H${mid} V${to.cy} H${x2}`;
}

function knockoutTreeConnectors(layout) {
  return KNOCKOUT_TREE_PYRAMID.edges.map(([fromId, toId]) => {
    const from = layout.positions[fromId];
    const to = layout.positions[toId];
    if (!from || !to) return '';
    return `<path class="ko-tree-line" d="${knockoutTreeConnectorPath(from, to, layout)}"/>`;
  }).join('');
}

function knockoutTreeMatchTitle(match) {
  if (!match) return '';
  const stage = knockoutRoundName(match.stage);
  const date = formatRoDate(match).replace(',', '');
  return `#${match.matchNo} · ${stage} · ${date}`;
}

function knockoutTreeTeamRow(entry, score, isWinner = false) {
  const label = entry?.label || '—';
  return `<div class="ko-tree-team ${entry?.placeholder ? 'is-placeholder' : ''} ${isWinner ? 'is-winner' : ''}">
    ${teamInline(label)}
    <strong>${score}</strong>
  </div>`;
}

function renderKnockoutTreeCard(match, isFinal = false) {
  const played = match && hasResult(match);
  const effective = match ? effectiveMatch(match) : null;
  const homeScore = played ? Number(effective.resultHome) : '—';
  const awayScore = played ? Number(effective.resultAway) : '—';
  const tieClass = played && !match.winnerSide ? ' is-waiting-tiebreak' : '';
  const finalClass = isFinal ? ' is-final' : '';
  if (!match) return '<div xmlns="http://www.w3.org/1999/xhtml" class="ko-tree-match-card is-empty"></div>';
  return `<div xmlns="http://www.w3.org/1999/xhtml" class="ko-tree-match-card ${played ? 'is-played' : ''}${tieClass}${finalClass}">
    <div class="ko-tree-meta"><span>#${match.matchNo}</span><span>${escapeHtml(match.romaniaDate || '')}</span></div>
    ${knockoutTreeTeamRow(match.resolvedHome, homeScore, match.winnerSide === 'home')}
    ${knockoutTreeTeamRow(match.resolvedAway, awayScore, match.winnerSide === 'away')}
  </div>`;
}

function knockoutTreeCards(layout, matchesById) {
  return Object.entries(layout.positions).map(([id, pos]) => {
    const match = matchesById.get(id);
    const isFinal = id === 'F-01';
    return `<foreignObject x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}">
      ${renderKnockoutTreeCard(match, isFinal)}
    </foreignObject>`;
  }).join('');
}

function renderKnockoutTree(matches) {
  const layout = knockoutTreeLayout();
  const matchesById = new Map(matches.map(match => [match.id, match]));
  return `<div class="ko-tree-scroll" aria-label="Tablou eliminatoriu complet cu scroll orizontal">
    <svg class="ko-tree-svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Bracket fazele eliminatorii Cupa Mondială 2026">
      <defs>
        <filter id="koTreeGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${knockoutTreeColumnLabels(layout)}
      ${knockoutTreeConnectors(layout)}
      ${knockoutTreeCards(layout, matchesById)}
    </svg>
  </div>`;
}

function renderEliminatorii() {
  const wrap = $('knockoutBracket');
  const status = $('knockoutStatus');
  if (!wrap || !status) return;

  const { matches } = buildKnockoutBracketState();
  const groupPlayed = allMatches().filter(m => isGroup(m) && hasResult(m)).length;
  const knockoutPlayed = matches.filter(m => hasResult(m)).length;
  const r32 = matches.filter(m => Number(m.matchNo) >= 73 && Number(m.matchNo) <= 88);
  const resolvedR32Sides = r32.reduce((count, m) => count + [m.resolvedHome, m.resolvedAway].filter(side => !side?.placeholder).length, 0);

  status.innerHTML = `<div class="knockout-status-card"><span>Grupe finalizate</span><strong>${areAllGroupsComplete() ? 'Da' : 'Nu'}</strong><small>${groupPlayed}/72 rezultate grupe</small></div>
    <div class="knockout-status-card"><span>Sloturi Round of 32</span><strong>${resolvedR32Sides}/32</strong><small>Se completează din clasamente</small></div>
    <div class="knockout-status-card"><span>Meciuri eliminatorii jucate</span><strong>${knockoutPlayed}/32</strong><small>Câștigătoarele avansează automat din rezultate/API</small></div>`;

  const thirdPlace = matches.filter(m => m.stage === 'Third place play-off');
  wrap.innerHTML = `${renderKnockoutTree(matches)}
    <section class="knockout-third-place">
      <div class="knockout-round-head"><strong>Finala mică</strong><span>Meciul 103</span></div>
      <div class="knockout-round-matches">${thirdPlace.map(renderKnockoutMatchCard).join('')}</div>
    </section>`;
}


function confirmDeleteUserPopup(target) {
  return new Promise(resolve => {
    const existing = document.querySelector('.delete-user-modal-backdrop');
    if (existing) existing.remove();

    const name = escapeHtml(target?.name || 'acest user');
    const email = escapeHtml(target?.email || '');
    const backdrop = document.createElement('div');
    backdrop.className = 'delete-user-modal-backdrop';
    backdrop.innerHTML = `
      <div class="delete-user-modal" role="dialog" aria-modal="true" aria-labelledby="deleteUserModalTitle">
        <div class="delete-user-modal-icon" aria-hidden="true">×</div>
        <div class="delete-user-modal-body">
          <h3 id="deleteUserModalTitle">Confirmare ștergere user</h3>
          <p>Ești sigur că vrei să ștergi definitiv userul <strong>${name}</strong>?</p>
          ${email ? `<span class="delete-user-modal-email">${email}</span>` : ''}
          <div class="delete-user-modal-warning">Această acțiune va șterge definitiv userul, toate pronosticurile lui și toate datele asociate. Datele nu vor mai putea fi recuperate.</div>
        </div>
        <div class="delete-user-modal-actions">
          <button type="button" class="secondary delete-user-modal-cancel">Anulează</button>
          <button type="button" class="delete-user-modal-confirm">Da, șterge userul</button>
        </div>
      </div>`;

    const close = (value) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKeydown);
      resolve(value);
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') close(false);
    };

    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) close(false);
    });
    backdrop.querySelector('.delete-user-modal-cancel')?.addEventListener('click', () => close(false));
    backdrop.querySelector('.delete-user-modal-confirm')?.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(backdrop);
    window.requestAnimationFrame(() => backdrop.classList.add('visible'));
    backdrop.querySelector('.delete-user-modal-cancel')?.focus();
  });
}



async function deleteUser(email) {
  if (!isAdminUser()) return;
  const target = getUsers().find(u => normalize(u.email) === normalize(email));
  if (!target) return;
  if (isAdminUser(target)) return toast('Adminul nu poate fi șters din clasament.');
  const ok = await confirmDeleteUserPopup(target);
  if (!ok) return;
  try {
    if (onlineMode) {
      const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
      if (!pin) return;
      sessionStorage.setItem('wc2026_admin_pin', pin);
      const data = await appApi('adminDeleteUser', {
        adminEmail: currentUser.email,
        adminPin: pin,
        targetEmail: email
      });
      if (data.ok !== true) throw new Error('PIN admin invalid sau user inexistent.');
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
function computeLeaderboardRows(matchesScope = allMatches()) {
  const users = getUsers().filter(u => !isAdminUser(u));
  const all = getAllPredictions();
  const applyLucky = shouldApplyLuckyBonus(matchesScope);
  const resultedMatches = matchesScope
    .filter(m => hasResult(m))
    .slice()
    .sort((a, b) => new Date(a.startTimeRo).getTime() - new Date(b.startTimeRo).getTime() || Number(a.matchNo || 0) - Number(b.matchNo || 0));

  const rows = users.map(u => {
    let exact = 0, winner = 0, total = 0;
    let predictedResolved = 0, correct = 0, currentStreak = 0, bestStreak = 0;
    const p = all[u.email] || {};

    matchesScope.forEach(m => {
      const sc = scorePrediction(m, p[m.id]);
      total += sc.points;
      if (sc.type === 'exact') exact++;
      if (sc.type === 'winner') winner++;
    });

    resultedMatches.forEach(m => {
      const pred = p[m.id];
      const sc = scorePrediction(m, pred);
      if (pred) predictedResolved++;

      if (sc.type === 'exact' || sc.type === 'winner') {
        correct++;
        currentStreak += 1;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    });

    const accuracy = predictedResolved ? Math.round((correct / predictedResolved) * 100) : 0;
    const luckyHit = applyLucky && isLuckyWinner(u.email);
    if (luckyHit) total += 25;
    return { ...u, exact, winner, correct, accuracy, streak: bestStreak, total, luckyHit, luckyTeam: luckyForEmail(u.email)?.team || null };
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
  const resulted = allMatches().filter(m => hasResult(m));
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
    const dailyPointsLabel = includeAll ? 'Puncte selecție' : `Puncte la data ${reportDateLabel}`;
    const subject = `🏆 Rezumat pronosticuri Cupa Mondială 2026 - ${selectedDate}`;
    const text = `Salut, ${u.name}!\n\n🏆 Cupa Mondială 2026\n📅 Rezultatele tale pentru meciurile ${periodLabel}\n\n🎯 ${dailyPointsLabel}: ${dailyPoints}p\n✅ Scoruri exacte: ${dailyExact}\n🟡 Pronosticuri corecte: ${dailyWinner}\n🏅 ${totalLabel}: ${u.total}p\n📊 ${rankLabel}: locul ${u.rank}\n\n⚽ Rezultate:\n${items.length ? items.map(i => `#${i.matchNo} ${i.label} | Rezultat: ${i.result} | Pronostic: ${i.prediction} | ${i.points}p`).join('\n') : 'Nu există rezultate pentru selecția curentă.'}\n\nContinuă pronosticurile pentru următoarele meciuri! 🔥`;
    const rows = items.map(i => {
      const badgeBg = i.type === 'exact' ? '#dcfce7' : i.type === 'winner' ? '#fef3c7' : '#fee2e2';
      const badgeColor = i.type === 'exact' ? '#166534' : i.type === 'winner' ? '#92400e' : '#991b1b';
      const badgeText = i.type === 'exact' ? 'Scor exact' : i.type === 'winner' ? 'Pronostic corect' : 'Pronostic gresit';
      return `<tr><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#0f172a">#${i.matchNo} ${escapeHtml(i.label)}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155">${i.result}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;color:#334155">${i.prediction}</td><td style="padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right"><span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-weight:800;white-space:nowrap">${i.points}p · ${badgeText}</span></td></tr>`;
    }).join('');
    const html = `<div style="margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2ff;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.14)"><tr><td style="padding:30px 26px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 52%,#7c3aed 100%);color:#fff"><div style="font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.85">Cupa Mondială 2026</div><h1 style="margin:10px 0 0;font-size:28px;line-height:1.15">🏆 Salut, ${escapeHtml(u.name)}!</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.6;opacity:.9">Rezultatele tale pentru meciurile ${escapeHtml(periodLabel)}.</p></td></tr><tr><td style="padding:22px 24px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="width:50%;padding:8px"><div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">🎯 ${escapeHtml(dailyPointsLabel || 'Puncte selecție')}</div><div style="font-size:30px;font-weight:900;color:#1d4ed8;margin-top:4px">${dailyPoints}p</div></div></td><td style="width:50%;padding:8px"><div style="border:1px solid #ede9fe;background:#f5f3ff;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">📊 Loc în clasament</div><div style="font-size:30px;font-weight:900;color:#6d28d9;margin-top:4px">#${u.rank}</div></div></td></tr><tr><td style="width:50%;padding:8px"><div style="border:1px solid #dcfce7;background:#f0fdf4;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">✅ Scoruri exacte</div><div style="font-size:26px;font-weight:900;color:#15803d;margin-top:4px">${dailyExact}</div></div></td><td style="width:50%;padding:8px"><div style="border:1px solid #fef3c7;background:#fffbeb;border-radius:18px;padding:16px"><div style="font-size:13px;color:#475569;font-weight:700">🟡 Pronosticuri corecte</div><div style="font-size:26px;font-weight:900;color:#b45309;margin-top:4px">${dailyWinner}</div></div></td></tr></table></td></tr><tr><td style="padding:8px 32px 22px"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:16px"><div style="font-size:14px;color:#475569;font-weight:800">🏅 ${escapeHtml(totalLabel)}</div><div style="font-size:24px;font-weight:900;color:#0f172a;margin-top:4px">${u.total}p</div><div style="font-size:13px;color:#334155;margin-top:6px;font-weight:800">${escapeHtml(rankLabel)}: locul ${u.rank}</div></div></td></tr>${items.length ? `<tr><td style="padding:0 32px 26px"><h2 style="font-size:18px;margin:0 0 12px;color:#0f172a">⚽ Rezultate</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><thead><tr style="background:#f8fafc"><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Meci</th><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Rezultat</th><th align="left" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Pronostic</th><th align="right" style="padding:12px 10px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Puncte</th></tr></thead><tbody>${rows}</tbody></table></td></tr>` : `<tr><td style="padding:0 32px 26px"><div style="padding:16px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-weight:700">Nu există rezultate pentru selecția curentă.</div></td></tr>`}<tr><td align="center" style="padding:0 32px 30px">${siteUrl ? `<a href="${escapeHtml(siteUrl)}" style="display:inline-block;text-decoration:none;background:#0f172a;color:#ffffff;border-radius:999px;padding:13px 22px;font-weight:900">Vezi clasamentul</a>` : ''}<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6">Continuă pronosticurile pentru următoarele meciuri! 🔥</p></td></tr></table><p style="max-width:640px;margin:14px auto 0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center">Email trimis automat de Cupa Mondială 2026 Predictor.</p></td></tr></table></div>`;
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



async function testFootballApi() {
  if (!isAdminUser()) return toast('Doar adminul poate testa API-ul.');
  const output = $('footballApiResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se verifică API-Football pentru World Cup 2026...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/test-football-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Testul API-Football a eșuat.');
    if (output) {
      const fixtures = Array.isArray(data.fixturesSample) ? data.fixturesSample : [];
      const tests = Array.isArray(data.tests) ? data.tests : [];
      output.innerHTML = `
        <div class="api-status success">
          <strong>Conexiune reușită.</strong>
          <span>API-Football răspunde pentru league=1, season=2026. Acum testăm mai multe endpoint-uri ca să vedem unde există datele.</span>
        </div>
        <div class="api-metrics">
          <div><span>Fixtures endpoint simplu</span><strong>${data.fixturesCount ?? 0}</strong></div>
          <div><span>Total fixtures în teste</span><strong>${data.totalFixtureResults ?? 0}</strong></div>
          <div><span>Endpoint-uri testate</span><strong>${tests.length}</strong></div>
        </div>
        <div class="api-status ${Number(data.totalFixtureResults || 0) > 0 ? 'success' : 'warning'}">${escapeHtml(data.note || '')}</div>
        <div class="api-debug-list">
          <h3>Endpoint-uri testate</h3>
          ${tests.map(t => `
            <article class="api-debug-card ${t.ok ? 'ok' : 'bad'}">
              <div class="api-debug-head">
                <strong>${escapeHtml(t.label || 'Endpoint')}</strong>
                <span>${t.ok ? 'OK' : 'Eroare'} · ${escapeHtml(String(t.status ?? '—'))}</span>
              </div>
              <code>${escapeHtml(t.path || '')}</code>
              <div class="api-debug-meta">
                <span>results: <b>${escapeHtml(String(t.apiResults ?? '—'))}</b></span>
                <span>timp: <b>${escapeHtml(String(t.elapsedMs ?? '—'))}ms</b></span>
              </div>
              ${t.apiErrors && Object.keys(t.apiErrors || {}).length ? `<small class="api-error-text">${escapeHtml(JSON.stringify(t.apiErrors))}</small>` : ''}
              ${Array.isArray(t.sample) && t.sample.length ? `<details><summary>Vezi sample</summary><pre>${escapeHtml(JSON.stringify(t.sample, null, 2))}</pre></details>` : ''}
            </article>`).join('')}
        </div>
        ${fixtures.length ? `<div class="api-sample"><h3>Primele meciuri citite din API</h3>${fixtures.map(f => `
          <article>
            <span>#${escapeHtml(f.apiFixtureId || '—')} · ${escapeHtml(f.dateRo || f.date || '')} ${f.round ? '· ' + escapeHtml(f.round) : ''}</span>
            <strong>${escapeHtml(f.home)} vs ${escapeHtml(f.away)}</strong>
            <small>${escapeHtml(f.status || '')}</small>
          </article>`).join('')}</div>` : ''}
      `;
    }
    toast('Test API-Football reușit.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Test eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut testa API-ul.')}</span></div>`;
    toast(err.message || 'Nu am putut testa API-ul.');
  }
}


async function testFootballDataApi() {
  if (!isAdminUser()) return toast('Doar adminul poate testa API-ul.');
  const output = $('footballDataApiResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se verifică football-data.org pentru World Cup 2026...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/test-football-data-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Testul football-data.org a eșuat.');
    if (output) {
      const fixtures = Array.isArray(data.fixturesSample) ? data.fixturesSample : [];
      const tests = Array.isArray(data.tests) ? data.tests : [];
      output.innerHTML = `
        <div class="api-status success">
          <strong>Conexiune football-data.org reușită.</strong>
          <span>football-data.org răspunde pentru competiția ${escapeHtml(data.competition || 'WC')}, sezon ${escapeHtml(String(data.season || '2026'))}.</span>
        </div>
        <div class="api-metrics">
          <div><span>Total meciuri în endpoint-uri</span><strong>${escapeHtml(String(data.totalMatchResults ?? 0))}</strong></div>
          <div><span>Endpoint-uri testate</span><strong>${tests.length}</strong></div>
          <div><span>Provider</span><strong>${escapeHtml(data.provider || 'football-data.org')}</strong></div>
        </div>
        <div class="api-status ${Number(data.totalMatchResults || 0) > 0 ? 'success' : 'warning'}">${escapeHtml(data.note || '')}</div>
        <div class="api-debug-list">
          <h3>Endpoint-uri football-data.org testate</h3>
          ${tests.map(t => `
            <article class="api-debug-card ${t.ok ? 'ok' : 'bad'}">
              <div class="api-debug-head">
                <strong>${escapeHtml(t.label || 'Endpoint')}</strong>
                <span>${t.ok ? 'OK' : 'Eroare'} · ${escapeHtml(String(t.status ?? '—'))}</span>
              </div>
              <code>${escapeHtml(t.path || '')}</code>
              <div class="api-debug-meta">
                <span>results: <b>${escapeHtml(String(t.apiResults ?? '—'))}</b></span>
                <span>timp: <b>${escapeHtml(String(t.elapsedMs ?? '—'))}ms</b></span>
              </div>
              ${t.message ? `<small class="api-error-text">${escapeHtml(typeof t.message === 'string' ? t.message : JSON.stringify(t.message))}</small>` : ''}
              ${Array.isArray(t.sample) && t.sample.length ? `<details><summary>Vezi sample</summary><pre>${escapeHtml(JSON.stringify(t.sample, null, 2))}</pre></details>` : ''}
            </article>`).join('')}
        </div>
        ${fixtures.length ? `<div class="api-sample"><h3>Primele meciuri citite din football-data.org</h3>${fixtures.map(f => `
          <article>
            <span>#${escapeHtml(f.apiMatchId || '—')} · ${escapeHtml(f.dateRo || f.utcDate || '')} ${f.stage ? '· ' + escapeHtml(f.stage) : ''}</span>
            <strong>${escapeHtml(f.home)} vs ${escapeHtml(f.away)}</strong>
            <small>${escapeHtml(f.status || '')} ${f.score ? '· ' + escapeHtml(f.score) : ''}</small>
          </article>`).join('')}</div>` : ''}
      `;
    }
    toast('Test football-data.org reușit.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Test football-data.org eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut testa football-data.org.')}</span></div>`;
    toast(err.message || 'Nu am putut testa football-data.org.');
  }
}


async function syncKnockoutFixtures() {
  if (!isAdminUser()) return toast('Doar adminul poate sincroniza eliminatoriile.');
  const output = $('footballDataSyncResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se verifică echipele reale pentru eliminatorii în football-data.org...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/sync-knockout-fixtures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Sincronizarea eliminatoriilor a eșuat.');
    if (output) {
      const updated = Array.isArray(data.updated) ? data.updated : [];
      const pending = Array.isArray(data.pendingSample) ? data.pendingSample : [];
      output.innerHTML = `
        <div class="api-status success">
          <strong>Sincronizare eliminatorii finalizată.</strong>
          <span>${Number(data.changed || 0) > 0 ? 'Echipele reale au fost actualizate în Supabase.' : 'Nu au fost găsite modificări noi pentru eliminatorii.'}</span>
        </div>
        <div class="api-metrics">
          <div><span>Eliminatorii API</span><strong>${escapeHtml(String(data.knockoutApi ?? 0))}</strong></div>
          <div><span>Cu echipe reale</span><strong>${escapeHtml(String(data.ready ?? 0))}</strong></div>
          <div><span>Potrivite</span><strong>${escapeHtml(String(data.matched ?? 0))}</strong></div>
          <div><span>Modificate</span><strong>${escapeHtml(String(data.changed ?? 0))}</strong></div>
        </div>
        ${updated.length ? `<div class="api-sample"><h3>Eliminatorii actualizate</h3>${updated.map(u => `
          <article>
            <span>#${escapeHtml(String(u.matchNo || '—'))} · ${escapeHtml(u.dateRo || '')} · API #${escapeHtml(String(u.apiMatchId || '—'))}</span>
            <strong>${teamInline(u.home)} <span class="match-vs">vs</span> ${teamInline(u.away, 'right')}</strong>
            <small>${escapeHtml(u.stage || '')}</small>
          </article>`).join('')}</div>` : ''}
        ${pending.length ? `<div class="api-status warning"><strong>Eliminatorii încă în așteptare.</strong><span>football-data.org nu are încă echipe reale pentru aceste meciuri.</span></div><pre>${escapeHtml(JSON.stringify(pending, null, 2))}</pre>` : ''}
      `;
    }
    await refreshData();
    renderAll();
    toast('Sincronizarea eliminatoriilor a fost executată.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Sincronizarea eliminatoriilor a eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut sincroniza eliminatoriile.')}</span></div>`;
    toast(err.message || 'Nu am putut sincroniza eliminatoriile.');
  }
}


async function syncFootballDataResults() {
  if (!isAdminUser()) return toast('Doar adminul poate sincroniza scorurile.');
  const output = $('footballDataSyncResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se sincronizează scorurile finale din football-data.org...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/sync-football-data-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Sincronizarea a eșuat.');
    if (output) {
      const updated = Array.isArray(data.updated) ? data.updated : [];
      const unmatched = Array.isArray(data.unmatchedSample) ? data.unmatchedSample : [];
      output.innerHTML = `
        <div class="api-status success">
          <strong>Sincronizare football-data.org finalizată.</strong>
          <span>${Number(data.changed || 0) > 0 ? 'Scorurile noi au fost salvate în Supabase.' : 'Nu au fost găsite scoruri noi de salvat.'}</span>
        </div>
        <div class="api-metrics">
          <div><span>Meciuri API</span><strong>${escapeHtml(String(data.apiMatches ?? 0))}</strong></div>
          <div><span>Finalizate</span><strong>${escapeHtml(String(data.finished ?? 0))}</strong></div>
          <div><span>Potrivite cu aplicația</span><strong>${escapeHtml(String(data.matched ?? 0))}</strong></div>
          <div><span>Scoruri modificate</span><strong>${escapeHtml(String(data.changed ?? 0))}</strong></div>
        </div>
        ${updated.length ? `<div class="api-sample"><h3>Scoruri sincronizate / găsite</h3>${updated.map(u => `
          <article>
            <span>#${escapeHtml(String(u.matchNo || '—'))} · ${escapeHtml(u.dateRo || '')} · API #${escapeHtml(String(u.apiMatchId || '—'))}</span>
            <strong>${escapeHtml(u.internalHome || u.apiHome)} ${escapeHtml(String(u.home))} - ${escapeHtml(String(u.away))} ${escapeHtml(u.internalAway || u.apiAway)}</strong>
            <small>${escapeHtml(u.apiHome || '')} vs ${escapeHtml(u.apiAway || '')}</small>
          </article>`).join('')}</div>` : ''}
        ${unmatched.length ? `<div class="api-status warning"><strong>Meciuri finalizate neasociate.</strong><span>${unmatched.length} exemple. Pentru eliminatorii poate fi nevoie de actualizarea echipelor reale în aplicație.</span></div><pre>${escapeHtml(JSON.stringify(unmatched, null, 2))}</pre>` : ''}
      `;
    }
    await refreshData();
    renderAll();
    toast('Sincronizarea football-data.org a fost executată.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Sincronizarea a eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut sincroniza scorurile.')}</span></div>`;
    toast(err.message || 'Nu am putut sincroniza scorurile.');
  }
}


async function simulateFootballDataSync() {
  if (!isAdminUser()) return toast('Doar adminul poate simula sincronizarea.');
  const output = $('footballDataSyncResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se simulează toate meciurile cu echipe cunoscute din football-data.org fără salvare în Supabase...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/sync-football-data-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin, simulate: true, simulateCount: 104 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Simularea a eșuat.');
    if (output) {
      const updated = Array.isArray(data.updated) ? data.updated : [];
      const simulated = data.simulatedMatch || null;
      const unmatched = Array.isArray(data.unmatchedSample) ? data.unmatchedSample : [];
      const phase = data.phaseStats || {};
      const group = phase.group || {};
      const knockout = phase.knockout || {};
      const groupTotal = Number(group.total || 0);
      const groupMatched = Number(group.matched || 0);
      const knockoutTotal = Number(knockout.total || 0);
      const knockoutReady = Number(knockout.ready || 0);
      const knockoutPending = Number(knockout.pending || Math.max(0, knockoutTotal - knockoutReady));
      output.innerHTML = `
        <div class="api-status success">
          <strong>Simulare finalizată fără salvare.</strong>
          <span>Am forțat temporar meciurile cu echipe cunoscute ca FINISHED, cu scoruri simulate, ca să verificăm mapping-ul complet. Supabase nu a fost modificat.</span>
        </div>
        <div class="api-metrics">
          <div><span>Total meciuri API</span><strong>${escapeHtml(String(data.apiMatches ?? 0))}</strong></div>
          <div><span>Grupe potrivite</span><strong>${escapeHtml(String(groupMatched))}/${escapeHtml(String(groupTotal))}</strong></div>
          <div><span>Eliminatorii încă în așteptare</span><strong>${escapeHtml(String(knockoutPending))}/${escapeHtml(String(knockoutTotal))}</strong></div>
          <div><span>Ar fi salvate acum</span><strong>${escapeHtml(String(data.wouldSave ?? 0))}</strong></div>
        </div>
        ${knockoutPending ? `<div class="api-status warning"><strong>Eliminatoriile nu sunt încă populate complet.</strong><span>Este normal înainte de terminarea grupelor. Când football-data.org va avea echipele reale pentru meciurile 73-104, funcția de sync le va putea potrivi și salva scorurile.</span></div>` : ''}
        ${simulated ? `<div class="api-sample"><h3>Primul meci API simulat</h3><article>
          <span>API #${escapeHtml(String(simulated.apiMatchId || '—'))} · ${escapeHtml(simulated.dateRo || simulated.utcDate || '')}</span>
          <strong>${escapeHtml(simulated.home || '')} ${escapeHtml(String(simulated.homeScore))} - ${escapeHtml(String(simulated.awayScore))} ${escapeHtml(simulated.away || '')}</strong>
          <small>${escapeHtml(simulated.status || '')}</small>
        </article></div>` : ''}
        ${updated.length ? `<div class="api-sample"><h3>Mapping găsit în aplicație</h3>${updated.map(u => `
          <article>
            <span>#${escapeHtml(String(u.matchNo || '—'))} · ${escapeHtml(u.dateRo || '')} · match_id ${escapeHtml(u.match_id || '')}</span>
            <strong>${escapeHtml(u.internalHome || u.apiHome)} ${escapeHtml(String(u.home))} - ${escapeHtml(String(u.away))} ${escapeHtml(u.internalAway || u.apiAway)}</strong>
            <small>${escapeHtml(u.apiHome || '')} vs ${escapeHtml(u.apiAway || '')}</small>
          </article>`).join('')}</div>` : ''}
        ${unmatched.length ? `<div class="api-status warning"><strong>Simularea nu s-a potrivit cu aplicația.</strong><span>Verificăm aliasurile de echipe sau data meciului.</span></div><pre>${escapeHtml(JSON.stringify(unmatched, null, 2))}</pre>` : ''}
      `;
    }
    toast('Simularea football-data.org a fost executată.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Simularea a eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut simula sincronizarea.')}</span></div>`;
    toast(err.message || 'Nu am putut simula sincronizarea.');
  }
}


async function saveApiScoreTest() {
  if (!isAdminUser()) return toast('Doar adminul poate rula testul de scor API.');
  const output = $('footballDataSyncResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se scriu scoruri API de test în Supabase...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/test-api-score-flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin, action: 'save' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Testul de scor API a eșuat.');
    const written = Array.isArray(data.written) ? data.written : [];
    if (output) output.innerHTML = `
      <div class="api-status success">
        <strong>Scoruri API de test salvate temporar.</strong>
        <span>Acest test scrie în Supabase ca să validezi flow-ul complet: Rezultate, Grupe, Clasament și emailuri.</span>
      </div>
      <div class="api-metrics">
        <div><span>Meciuri test scrise</span><strong>${escapeHtml(String(written.length))}</strong></div>
        <div><span>Total scoruri în Supabase</span><strong>${escapeHtml(String(data.totalResultsAfterWrite ?? '—'))}</strong></div>
      </div>
      ${written.length ? `<div class="api-sample"><h3>Scoruri test salvate</h3>${written.map(row => `
        <article>
          <span>${escapeHtml(row.match_id || '')} · ${escapeHtml(row.label || '')}</span>
          <strong>${escapeHtml(String(row.home))} - ${escapeHtml(String(row.away))}</strong>
          <small>Aceste rezultate sunt temporare. Folosește „Resetează scor API test” după verificare.</small>
        </article>`).join('')}</div>` : ''}
    `;
    await refreshData();
    renderAll();
    toast('Scorurile API de test au fost salvate.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Testul a eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut salva scorurile de test.')}</span></div>`;
    toast(err.message || 'Nu am putut salva scorurile de test.');
  }
}

async function resetApiScoreTest() {
  if (!isAdminUser()) return toast('Doar adminul poate reseta testul de scor API.');
  const output = $('footballDataSyncResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se șterg scorurile API de test din Supabase...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/test-api-score-flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin, action: 'reset' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Resetarea scorurilor test a eșuat.');
    if (output) output.innerHTML = `
      <div class="api-status success">
        <strong>Scorurile API de test au fost resetate.</strong>
        <span>Au fost eliminate rezultatele temporare pentru M001, M002 și M003. Restul rezultatelor, dacă existau, au fost păstrate.</span>
      </div>
      <div class="api-metrics">
        <div><span>Meciuri test eliminate</span><strong>${escapeHtml(String((data.removed || []).length))}</strong></div>
        <div><span>Scoruri rămase</span><strong>${escapeHtml(String(data.remainingResults ?? 0))}</strong></div>
      </div>`;
    await refreshData();
    renderAll();
    toast('Scorurile API de test au fost resetate.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Resetarea a eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut reseta scorurile de test.')}</span></div>`;
    toast(err.message || 'Nu am putut reseta scorurile de test.');
  }
}

async function simulateKnockoutPopulation() {
  if (!isAdminUser()) return toast('Doar adminul poate simula eliminatoriile.');
  const output = $('footballDataSyncResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se populează temporar eliminatoriile cu echipe și steaguri existente...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/simulate-knockout-population', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin, action: 'save' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Simularea eliminatoriilor a eșuat.');
    const sample = Array.isArray(data.sample) ? data.sample : [];
    if (output) output.innerHTML = `
      <div class="api-status success">
        <strong>Eliminatoriile au fost populate temporar.</strong>
        <span>Acum poți merge în Pronosticuri → Eliminatorii și să verifici că apar echipe reale simulate, folosind steagurile și dimensiunile deja existente în aplicație.</span>
      </div>
      <div class="api-metrics">
        <div><span>Meciuri populate</span><strong>${escapeHtml(String(data.matchesUpdated ?? 0))}/32</strong></div>
        <div><span>Steaguri găsite</span><strong>${escapeHtml(String(data.flagsFound ?? 0))}/${escapeHtml(String(data.expectedFlags ?? 64))}</strong></div>
        <div><span>Placeholder-e rămase</span><strong>${escapeHtml(String(data.placeholdersRemaining ?? 0))}</strong></div>
      </div>
      ${sample.length ? `<div class="api-sample"><h3>Exemple eliminatorii simulate</h3>${sample.map(row => `
        <article>
          <span>${escapeHtml(row.match_id || '')}</span>
          <strong>${teamInline(row.home)} <span class="match-vs">vs</span> ${teamInline(row.away, 'right')}</strong>
          <small>Simulare temporară. Folosește „Resetează eliminatoriile simulate” după verificare.</small>
        </article>`).join('')}</div>` : ''}`;
    await refreshData();
    renderAll();
    toast('Eliminatoriile au fost populate temporar.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Simularea a eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut popula eliminatoriile.')}</span></div>`;
    toast(err.message || 'Nu am putut popula eliminatoriile.');
  }
}

async function resetKnockoutPopulation() {
  if (!isAdminUser()) return toast('Doar adminul poate reseta eliminatoriile simulate.');
  const output = $('footballDataSyncResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se readuc eliminatoriile la placeholder-ele inițiale...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/simulate-knockout-population', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin, action: 'reset' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Resetarea eliminatoriilor simulate a eșuat.');
    if (output) output.innerHTML = `
      <div class="api-status success">
        <strong>Eliminatoriile simulate au fost resetate.</strong>
        <span>Subsecțiunea Eliminatorii revine la placeholder-ele inițiale până când football-data.org va furniza echipele reale.</span>
      </div>
      <div class="api-metrics">
        <div><span>Meciuri resetate</span><strong>${escapeHtml(String(data.matchesUpdated ?? 0))}/32</strong></div>
        <div><span>Placeholder-e rămase</span><strong>${escapeHtml(String(data.placeholdersRemaining ?? 0))}</strong></div>
      </div>`;
    await refreshData();
    renderAll();
    toast('Eliminatoriile simulate au fost resetate.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Resetarea a eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut reseta eliminatoriile simulate.')}</span></div>`;
    toast(err.message || 'Nu am putut reseta eliminatoriile simulate.');
  }
}


async function testSportmonksApi() {
  if (!isAdminUser()) return toast('Doar adminul poate testa API-ul.');
  const output = $('sportmonksApiResult');
  if (output) output.innerHTML = `<div class="api-status loading">Se verifică Sportmonks pentru World Cup 2026...</div>`;
  try {
    const pin = sessionStorage.getItem('wc2026_admin_pin') || prompt('Introdu PIN-ul de admin:');
    if (!pin) return;
    sessionStorage.setItem('wc2026_admin_pin', pin);
    const response = await fetch('/.netlify/functions/test-sportmonks-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail: currentUser.email, adminPin: pin })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Testul Sportmonks a eșuat.');
    if (output) {
      const fixtures = Array.isArray(data.fixturesSample) ? data.fixturesSample : [];
      const tests = Array.isArray(data.tests) ? data.tests : [];
      output.innerHTML = `
        <div class="api-status success">
          <strong>Conexiune Sportmonks reușită.</strong>
          <span>Sportmonks răspunde pentru League ID ${escapeHtml(String(data.leagueId || '—'))}, Season ID ${escapeHtml(String(data.seasonId || '—'))}.</span>
        </div>
        <div class="api-metrics">
          <div><span>Total rezultate fixtures/schedules</span><strong>${escapeHtml(String(data.totalFixtureResults ?? 0))}</strong></div>
          <div><span>Endpoint-uri testate</span><strong>${tests.length}</strong></div>
          <div><span>Provider</span><strong>${escapeHtml(data.provider || 'Sportmonks')}</strong></div>
        </div>
        <div class="api-status ${Number(data.totalFixtureResults || 0) > 0 ? 'success' : 'warning'}">${escapeHtml(data.note || '')}</div>
        <div class="api-debug-list">
          <h3>Endpoint-uri Sportmonks testate</h3>
          ${tests.map(t => `
            <article class="api-debug-card ${t.ok ? 'ok' : 'bad'}">
              <div class="api-debug-head">
                <strong>${escapeHtml(t.label || 'Endpoint')}</strong>
                <span>${t.ok ? 'OK' : 'Eroare'} · ${escapeHtml(String(t.status ?? '—'))}</span>
              </div>
              <code>${escapeHtml(t.path || '')}</code>
              <div class="api-debug-meta">
                <span>results: <b>${escapeHtml(String(t.apiResults ?? '—'))}</b></span>
                <span>timp: <b>${escapeHtml(String(t.elapsedMs ?? '—'))}ms</b></span>
              </div>
              ${t.message ? `<small class="api-error-text">${escapeHtml(typeof t.message === 'string' ? t.message : JSON.stringify(t.message))}</small>` : ''}
              ${Array.isArray(t.sample) && t.sample.length ? `<details><summary>Vezi sample</summary><pre>${escapeHtml(JSON.stringify(t.sample, null, 2))}</pre></details>` : ''}
            </article>`).join('')}
        </div>
        ${fixtures.length ? `<div class="api-sample"><h3>Primele meciuri citite din Sportmonks</h3>${fixtures.map(f => `
          <article>
            <span>#${escapeHtml(f.fixtureId || '—')} · ${escapeHtml(f.dateRo || f.startingAt || '')} ${f.stage ? '· ' + escapeHtml(f.stage) : ''}</span>
            <strong>${escapeHtml(f.home)} vs ${escapeHtml(f.away)}</strong>
            <small>${escapeHtml(f.state || '')}</small>
          </article>`).join('')}</div>` : ''}
      `;
    }
    toast('Test Sportmonks reușit.');
  } catch (err) {
    console.error(err);
    if (output) output.innerHTML = `<div class="api-status error"><strong>Test Sportmonks eșuat.</strong><span>${escapeHtml(err.message || 'Nu am putut testa Sportmonks.')}</span></div>`;
    toast(err.message || 'Nu am putut testa Sportmonks.');
  }
}

function allSelectableTeams() {
  return [...new Set(allMatches().filter(isGroup).flatMap(m => [m.home, m.away]).filter(t => TEAM_FLAGS[t]))].sort((a, b) => a.localeCompare(b));
}
function luckyDeadlineMatch() {
  return allMatches().find(m => Number(m.matchNo) === 24) || allMatches().find(m => m.id === 'M024');
}
function luckyDeadlineDate() {
  const m = luckyDeadlineMatch();
  if (!m) return null;
  return new Date(new Date(m.startTimeRo).getTime() - LOCK_HOURS_BEFORE_START * 60 * 60 * 1000);
}
function isLuckyLocked() {
  const d = luckyDeadlineDate();
  return !!d && Date.now() >= d.getTime();
}
function finalMatch() {
  return allMatches().find(m => Number(m.matchNo) === 104) || allMatches().find(m => m.stage === 'Final');
}
function finalWinnerTeam() {
  const f = finalMatch();
  if (!f || !hasResult(f)) return null;
  const em = effectiveMatch(f);
  if (Number(em.resultHome) > Number(em.resultAway)) return em.home;
  if (Number(em.resultAway) > Number(em.resultHome)) return em.away;
  return null;
}
function luckyForEmail(email) {
  return getLuckyStrikes()[normalize(email)] || null;
}
function isLuckyWinner(email) {
  const pick = luckyForEmail(email);
  const winner = finalWinnerTeam();
  return !!(pick?.team && winner && normalize(pick.team) === normalize(winner));
}
function shouldApplyLuckyBonus(matchesScope = allMatches()) {
  const final = finalMatch();
  return !!(final && matchesScope.some(m => Number(m.matchNo) === Number(final.matchNo)) && hasResult(final));
}
function updateLuckyPreview(team) {
  const flagEl = $('luckyPreviewFlag');
  const nameEl = $('luckyPreviewName');
  const btnText = $('luckyDropdownButtonText');
  const label = team || 'Alege echipa';
  if (flagEl) flagEl.innerHTML = team ? flagForTeam(team) : '<span class="flag-fallback">⚑</span>';
  if (nameEl) nameEl.textContent = label;
  if (btnText) btnText.textContent = label;
}

function closeLuckyDropdown() {
  const root = $('luckyCustomSelect');
  const btn = $('luckyDropdownButton');
  if (root) root.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function bindLuckyDropdown(teams, disabled) {
  const root = $('luckyCustomSelect');
  const btn = $('luckyDropdownButton');
  const menu = $('luckyDropdownMenu');
  const select = $('luckyTeamSelect');
  if (!root || !btn || !menu || !select) return;

  btn.disabled = disabled;
  btn.setAttribute('aria-expanded', 'false');
  menu.innerHTML = teams.map(team => `
    <button type="button" class="lucky-option ${select.value === team ? 'selected' : ''}" data-team="${escapeHtml(team)}" role="option">
      <span class="flag-badge lucky-option-flag" aria-hidden="true">${flagForTeam(team)}</span>
      <span>${escapeHtml(canonicalTeamName(team))}</span>
    </button>`).join('');

  const restorePreview = () => updateLuckyPreview(select.value);

  btn.onclick = () => {
    if (btn.disabled) return;
    root.classList.toggle('open');
    btn.setAttribute('aria-expanded', root.classList.contains('open') ? 'true' : 'false');
  };

  menu.querySelectorAll('.lucky-option').forEach(option => {
    const team = option.dataset.team || '';
    option.addEventListener('mouseenter', () => updateLuckyPreview(team));
    option.addEventListener('focus', () => updateLuckyPreview(team));
    option.addEventListener('click', () => {
      select.value = team;
      updateLuckyPreview(team);
      menu.querySelectorAll('.lucky-option').forEach(o => o.classList.toggle('selected', o.dataset.team === team));
      closeLuckyDropdown();
    });
  });

  menu.onmouseleave = restorePreview;

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) closeLuckyDropdown();
  }, { once: true });
}

function renderLuckyStrike() {
  const status = $('luckyStatus');
  const select = $('luckyTeamSelect');
  const saveBtn = $('saveLuckyStrike');
  const deadlineInfo = $('luckyDeadlineInfo');
  if (!status || !select || !saveBtn) return;
  const teams = allSelectableTeams();
  const currentPick = luckyForEmail(currentUser?.email);
  const lockedByTime = isLuckyLocked();
  const deadline = luckyDeadlineDate();
  const deadlineLabel = deadline ? new Intl.DateTimeFormat('ro-RO', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(deadline) + ' RO' : '—';
  select.innerHTML = `<option value="">Alege o echipă...</option>` + teams.map(team => `<option value="${escapeHtml(team)}" ${currentPick?.team === team ? 'selected' : ''}>${team}</option>`).join('');
  select.disabled = !!currentPick || lockedByTime;
  saveBtn.disabled = !!currentPick || lockedByTime;
  updateLuckyPreview(currentPick?.team || select.value || '');
  bindLuckyDropdown(teams, !!currentPick || lockedByTime);
  deadlineInfo.textContent = `Deadline Lucky Strike: ${deadlineLabel}. După confirmare, alegerea nu mai poate fi schimbată.`;
  if (currentPick?.team) {
    const hit = isLuckyWinner(currentUser?.email);
    status.innerHTML = `<div class="lucky-picked"><span class="flag-badge" aria-hidden="true">${flagForTeam(currentPick.team)}</span><div><strong>${escapeHtml(currentPick.team)}</strong><span>${hit ? 'Felicitări! Echipa ta a câștigat finala și primești +25p.' : 'Alegerea este blocată până la finalul turneului.'}</span></div></div>`;
  } else if (lockedByTime) {
    status.innerHTML = `<div class="lucky-closed"><strong>Selecția Lucky Strike este închisă.</strong><span>Deadline-ul a fost cu 30 de minute înainte de startul meciului #24.</span></div>`;
  } else {
    status.innerHTML = `<div class="lucky-open"><strong>Selecția este deschisă.</strong><span>Alege echipa despre care crezi că va câștiga finala.</span></div>`;
  }
}
async function saveLuckyStrike() {
  if (!currentUser) return;
  const select = $('luckyTeamSelect');
  const team = select?.value;
  if (!team) return toast('Alege o echipă pentru Lucky Strike.');
  if (luckyForEmail(currentUser.email)) return toast('Ai deja o alegere Lucky Strike blocată.');
  if (isLuckyLocked()) return toast('Deadline-ul Lucky Strike a trecut.');
  const ok = confirm(`Confirmi Lucky Strike: ${team}? Alegerea nu mai poate fi schimbată până la finalul turneului.`);
  if (!ok) return;
  try {
    if (onlineMode) {
      await appApi('saveLuckyStrike', { userId: currentUser.id, team });
    } else {
      const all = localLuckyStrikes();
      all[normalize(currentUser.email)] = { team, createdAt: new Date().toISOString() };
      saveLocalLuckyStrikes(all);
    }
    await refreshData();
    toast('Lucky Strike a fost salvat. Alegerea este blocată.');
    renderAll();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Nu am putut salva Lucky Strike. Verifică dacă ai rulat scriptul SQL.');
  }
}


function leaderboardStatMarkup(r, compact = false) {
  const correct = Number(r.correct ?? ((r.exact || 0) + (r.winner || 0)));
  const accuracy = Number(r.accuracy || 0);
  const streak = Number(r.streak || 0);
  return `<div class="leaderboard-stats ${compact ? 'compact' : ''}">
    <div class="leaderboard-stat accuracy"><i>✓</i><strong>${accuracy}%</strong><small>Acuratețe</small></div>
    <div class="leaderboard-stat correct"><i>◎</i><strong>${correct}</strong><small>Predicții corecte</small></div>
    <div class="leaderboard-stat streak"><i>♨︎</i><strong>${streak}</strong><small>Serie maximă</small></div>
  </div>`;
}

function isCurrentLeaderboardUser(row) {
  if (!row || !currentUser) return false;
  const rowEmail = normalize(row.email || '');
  const userEmail = normalize(currentUser.email || '');
  if (rowEmail && userEmail && rowEmail === userEmail) return true;
  return normalize(row.name || row.username || '') === normalize(currentUser.name || currentUser.username || '');
}

function currentLeaderboardAttr(row) {
  return isCurrentLeaderboardUser(row) ? ' data-current-leaderboard="true"' : '';
}

function leaderboardDeleteButton(row, compact = false) {
  if (!isAdminUser() || !row || isAdminUser(row)) return '';
  return `<button type="button" class="delete-user leaderboard-delete-user ${compact ? 'compact' : ''}" data-delete-user="${escapeHtml(row.email)}" aria-label="Șterge userul ${escapeHtml(row.name)}" title="Șterge user">×</button>`;
}

function leaderboardNameWithDelete(row, compact = false) {
  return `<span class="leaderboard-name-with-delete"><strong>${escapeHtml(row.name)}</strong>${leaderboardDeleteButton(row, compact)}</span>`;
}

function scrollToCurrentLeaderboardUser() {
  const clasament = $('clasament');
  if (!clasament || !clasament.classList.contains('active')) return;

  const target = clasament.querySelector('[data-current-leaderboard="true"]');
  if (!target) return;

  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  });
}

function leaderboardTopIcon(rank) {
  if (rank === 1) return '👑';
  if (rank === 2) return '🪐';
  if (rank === 3) return '⚽';
  return '⭐';
}

function leaderboardTopClass(rank) {
  if (rank === 1) return 'first';
  if (rank === 2) return 'second';
  if (rank === 3) return 'third';
  return '';
}

function leaderboardTopEntryMarkup(r, admin, podiumRank) {
  const adminEmail = admin ? `<span class="leaderboard-email">${escapeHtml(r.email)}</span>` : '';
  const hasAvatar = podiumRank === 1;
  const avatarMarkup = hasAvatar ? `<div class="leaderboard-top-avatar" aria-hidden="true">${leaderboardTopIcon(podiumRank)}</div>` : '';
  const avatarClass = hasAvatar ? 'has-avatar' : 'no-avatar';
  return `<div class="leaderboard-top-entry ${avatarClass}"${currentLeaderboardAttr(r)}>
    <div class="leaderboard-top-main">
      <div class="leaderboard-top-badges">
        ${hasAvatar ? `${avatarMarkup}<div class="leaderboard-top-rank">#${podiumRank}</div>` : `<div class="leaderboard-top-rank">#${podiumRank}</div>`}
      </div>
      <div class="leaderboard-top-user">${leaderboardNameWithDelete(r, true)}${adminEmail}<span class="leaderboard-top-points">${r.total} puncte</span></div>
    </div>
    <span class="leaderboard-top-breakdown">${r.exact} scoruri exacte • ${r.winner} (doar) pronosticuri corecte</span>
    ${leaderboardStatMarkup(r)}
  </div>`;
}

function leaderboardTopCardMarkup(rowsForRank, podiumRank, admin) {
  if (!rowsForRank || !rowsForRank.length) return '';
  const avatarClass = podiumRank === 1 ? 'has-avatar' : 'no-avatar';
  const inner = rowsForRank.map((r, idx) => {
    const separator = idx > 0 ? `<div class="leaderboard-top-separator" aria-hidden="true"></div>` : '';
    return `${separator}${leaderboardTopEntryMarkup(r, admin, podiumRank)}`;
  }).join('');

  return `<article class="leaderboard-top-card ${leaderboardTopClass(podiumRank)} ${avatarClass}" aria-label="Locul ${podiumRank}">
    ${inner}
  </article>`;
}

function renderLeaderboard() {
  const rows = computeLeaderboardRows();
  const admin = isAdminUser();
  const list = $('leaderboardCards');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="empty">Nu există useri încă.</div>`;
    return;
  }

  const firstGroup = rows.filter(r => r.rank === 1);
  const secondGroup = rows.filter(r => r.rank === 2);
  const thirdGroup = rows.filter(r => r.rank === 3);
  const rest = rows.filter(r => r.rank > 3);

  const topCards = [
    leaderboardTopCardMarkup(secondGroup, 2, admin),
    leaderboardTopCardMarkup(firstGroup, 1, admin),
    leaderboardTopCardMarkup(thirdGroup, 3, admin)
  ].filter(Boolean).join('');

  const restHtml = rest.length ? rest.map((r) => {
    const adminEmail = admin ? `<span class="leaderboard-email">${escapeHtml(r.email)}</span>` : '';
    return `<article class="leaderboard-card leaderboard-row-card" aria-label="Locul ${r.rank}: ${escapeHtml(r.name)}"${currentLeaderboardAttr(r)}>
      <div class="rank-badge"><span>#${r.rank}</span></div>
      <div class="leaderboard-user">${leaderboardNameWithDelete(r)}${adminEmail}<span class="leaderboard-row-mobile-points" aria-hidden="true">${r.total} puncte</span><span class="leaderboard-row-desktop-breakdown">${r.exact} scoruri exacte • ${r.winner} (doar) pronosticuri corecte</span></div>
      <span class="leaderboard-row-mobile-breakdown">${r.exact} scoruri exacte • ${r.winner} (doar) pronosticuri corecte</span>
      ${leaderboardStatMarkup(r, true)}
      <div class="leaderboard-points"><strong>${r.total}</strong><span>puncte</span></div>
    </article>`;
  }).join('') : `<div class="empty">Nu există useri după poziția #3.</div>`;

  list.innerHTML = `<div class="leaderboard-top-three">
    <h3>Top 3</h3>
    <div class="leaderboard-top-grid">${topCards}</div>
  </div>
  <div class="leaderboard-rest">
    <div class="leaderboard-rest-head">
      <h3>Restul clasamentului</h3>
      <div class="leaderboard-rest-columns" aria-hidden="true">
        <span>#</span>
        <span>Utilizator</span>
        <span>Statistici</span>
        <span>Puncte totale</span>
      </div>
    </div>
    <div class="leaderboard-rest-list">${restHtml}</div>
  </div>`;

  list.querySelectorAll('[data-delete-user]').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.deleteUser));
  });
}
function renderAdminScores() {
  const wrap = $('adminScoresList');
  if (!wrap) return;
  if (!isAdminUser()) return wrap.innerHTML = `<div class="empty">Această secțiune este disponibilă doar pentru admin.</div>`;
  const overrides = getResultOverrides();
  wrap.innerHTML = allMatches().map(m => {
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
      const data = await appApi('adminReplaceResults', {
        adminEmail: currentUser.email,
        adminPin: pin,
        payload: rows
      });
      if (data.ok !== true) throw new Error('PIN admin invalid.');
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
      const data = await appApi('adminReplaceResults', {
        adminEmail: currentUser.email,
        adminPin: pin,
        payload: []
      });
      if (data.ok !== true) throw new Error('PIN admin invalid.');
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

const saveLuckyStrikeBtn = $('saveLuckyStrike');
if (saveLuckyStrikeBtn) saveLuckyStrikeBtn.addEventListener('click', saveLuckyStrike);
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
const testFootballApiBtn = $('testFootballApi');
if (testFootballApiBtn) testFootballApiBtn.addEventListener('click', testFootballApi);
const testSportmonksApiBtn = $('testSportmonksApi');
if (testSportmonksApiBtn) testSportmonksApiBtn.addEventListener('click', testSportmonksApi);
const testFootballDataApiBtn = $('testFootballDataApi');
if (testFootballDataApiBtn) testFootballDataApiBtn.addEventListener('click', testFootballDataApi);
const syncFootballDataResultsBtn = $('syncFootballDataResults');
if (syncFootballDataResultsBtn) syncFootballDataResultsBtn.addEventListener('click', syncFootballDataResults);
const syncKnockoutFixturesBtn = $('syncKnockoutFixtures');
if (syncKnockoutFixturesBtn) syncKnockoutFixturesBtn.addEventListener('click', syncKnockoutFixtures);
const simulateFootballDataSyncBtn = $('simulateFootballDataSync');
if (simulateFootballDataSyncBtn) simulateFootballDataSyncBtn.addEventListener('click', simulateFootballDataSync);
const saveApiScoreTestBtn = $('saveApiScoreTest');
if (saveApiScoreTestBtn) saveApiScoreTestBtn.addEventListener('click', saveApiScoreTest);
const resetApiScoreTestBtn = $('resetApiScoreTest');
if (resetApiScoreTestBtn) resetApiScoreTestBtn.addEventListener('click', resetApiScoreTest);
const simulateKnockoutPopulationBtn = $('simulateKnockoutPopulation');
if (simulateKnockoutPopulationBtn) simulateKnockoutPopulationBtn.addEventListener('click', simulateKnockoutPopulation);
const resetKnockoutPopulationBtn = $('resetKnockoutPopulation');
if (resetKnockoutPopulationBtn) resetKnockoutPopulationBtn.addEventListener('click', resetKnockoutPopulation);
const emailReportDateInput = $('emailReportDate');
if (emailReportDateInput && !emailReportDateInput.value) emailReportDateInput.value = todayRoKey();
const emailIncludeAllResultsInput = $('emailIncludeAllResults');
if (emailIncludeAllResultsInput) emailIncludeAllResultsInput.addEventListener('change', renderEmailPreview);


const PARCURS_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  '#6366f1', '#eab308', '#f43f5e', '#0ea5e9', '#65a30d',
  '#d946ef', '#fb923c', '#2dd4bf', '#8b5cf6', '#dc2626',
  '#38bdf8', '#4ade80', '#c084fc', '#facc15', '#10b981',
  '#60a5fa', '#be185d', '#0891b2', '#7c3aed', '#ea580c',
  '#a3e635', '#fb7185', '#818cf8', '#34d399', '#f472b6',
  '#22d3ee', '#32d583', '#ff6b6b', '#9b5cf6', '#fdb022'
];

const PARCURS_CONTRAST_BASE_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  '#6366f1', '#eab308', '#f43f5e', '#0ea5e9', '#65a30d',
  '#d946ef', '#fb923c', '#2dd4bf', '#8b5cf6', '#dc2626',
  '#38bdf8', '#4ade80', '#c084fc', '#facc15', '#10b981',
  '#60a5fa', '#be185d', '#0891b2', '#7c3aed', '#ea580c',
  '#a3e635', '#fb7185', '#818cf8', '#34d399', '#f472b6',
  '#22d3ee', '#32d583', '#ff6b6b', '#9b5cf6', '#fdb022'
];
let parcursSelectedPlayerKeys = new Set();
let parcursSelectionInitialized = false;
let parcursControlsBound = false;
let parcursStageMode = 'day';
let parcursActivePoint = null;
let parcursTooltipOutsideBound = false;

const PARCURS_STAGE_OPTIONS = [
  { value: 'match', label: 'După fiecare meci' },
  { value: 'day', label: 'După fiecare zi de meciuri' },
  { value: 'round', label: 'După fiecare rundă' },
  { value: 'all', label: 'Tot turneul' },
  { value: 'first10', label: 'Primele 10 meciuri' },
  { value: 'last10', label: 'Ultimele 10 meciuri' }
];

const PARCURS_DEMO_PLAYERS = [
  { key: 'demo-alexandru', name: 'Alexandru', email: 'demo-alexandru', color: '#32d583', ranks: [3,2,2,3,2,2,1,1,1,1] },
  { key: 'demo-maria', name: 'Maria', email: 'demo-maria', color: '#ff6b6b', ranks: [1,3,4,3,4,4,5,4,4,5] },
  { key: 'demo-robert', name: 'Robert', email: 'demo-robert', color: '#9b5cf6', ranks: [4,4,3,4,5,5,4,5,5,4] },
  { key: 'demo-andrei', name: 'Andrei', email: 'demo-andrei', color: '#fdb022', ranks: [5,5,5,5,4,6,6,6,7,7] },
  { key: 'demo-cristina', name: 'Cristina', email: 'demo-cristina', color: '#22d3ee', ranks: [6,6,6,6,6,5,6,7,6,6] },
  { key: 'demo-vlad', name: 'Vlad', email: 'demo-vlad', color: '#ec4899', ranks: [7,7,7,7,7,7,7,6,6,6] },
  { key: 'demo-george', name: 'George', email: 'demo-george', color: '#a16207', ranks: [8,8,8,8,8,8,8,8,8,8] },
  { key: 'demo-user', name: 'Demo User', email: 'demo-user', color: '#60a5fa', ranks: [2,1,1,1,1,3,3,3,2,2] }
];

const PARCURS_DEMO_LABELS = ['M1','M4','M8','M12','M18','M24','M32','M40','M52','M64'];

function parcursHighContrastPalette(count) {
  const total = Math.max(0, Number(count) || 0);
  if (total <= 0) return [];
  if (total === 1) return ['#3b82f6'];
  if (total === 2) return ['#ef4444', '#3b82f6'];
  if (total === 3) return ['#ef4444', '#3b82f6', '#22c55e'];
  if (total === 4) return ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
  if (total === 5) return ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];

  if (total <= PARCURS_CONTRAST_BASE_COLORS.length) {
    return PARCURS_CONTRAST_BASE_COLORS.slice(0, total);
  }

  const colors = PARCURS_CONTRAST_BASE_COLORS.slice();
  for (let i = colors.length; i < total; i += 1) {
    const hue = Math.round((i * 137.508) % 360);
    const lightness = i % 2 === 0 ? 56 : 66;
    colors.push(`hsl(${hue} 88% ${lightness}%)`);
  }
  return colors;
}

function parcursApplyDynamicContrastColors(players) {
  const palette = parcursHighContrastPalette(players.length);
  return players.map((player, index) => ({
    ...player,
    color: palette[index % palette.length]
  }));
}


function parcursPlayerKey(row) {
  return normalize(row?.email || row?.name || '');
}

function parcursCompletedMatches() {
  return allMatches()
    .filter(m => hasResult(m))
    .slice()
    .sort((a, b) => new Date(a.startTimeRo).getTime() - new Date(b.startTimeRo).getTime() || Number(a.matchNo || 0) - Number(b.matchNo || 0));
}

function parcursSnapshotLabel(match, index, mode) {
  if (!match) return `P${index + 1}`;
  if (mode === 'day' || mode === 'all') {
    return new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: 'short' }).format(new Date(match.startTimeRo));
  }
  if (mode === 'round') return `Runda ${index + 1}`;
  return `M${match.matchNo || index + 1}`;
}

function parcursBuildSnapshots(mode) {
  const completed = parcursCompletedMatches();
  let filtered = completed;

  if (mode === 'groups' || mode === 'round') filtered = completed.filter(isGroup);
  if (mode === 'knockout') filtered = completed.filter(isKnockout);
  if (mode === 'first10') filtered = completed.slice(0, 10);
  if (mode === 'last10') filtered = completed.slice(Math.max(0, completed.length - 10));
  if (mode === 'all') filtered = completed;

  if (!filtered.length) return [];

  if (mode === 'day' || mode === 'all') {
    const byDate = new Map();
    filtered.forEach(m => {
      const key = roDateKey(m.startTimeRo);
      byDate.set(key, m);
    });
    return Array.from(byDate.values()).map((m, index) => ({
      label: parcursSnapshotLabel(m, index, mode),
      match: m,
      matches: completed.filter(x => new Date(x.startTimeRo).getTime() <= new Date(m.startTimeRo).getTime())
    }));
  }

  if (mode === 'round') {
    const sortByKickoff = (a, b) => new Date(a.startTimeRo).getTime() - new Date(b.startTimeRo).getTime() || Number(a.matchNo || 0) - Number(b.matchNo || 0);
    const groupMatches = completed.filter(isGroup).slice().sort(sortByKickoff);
    const groupOrder = 'ABCDEFGHIJKL'.split('');
    const byGroup = {};
    groupOrder.forEach(g => {
      byGroup[g] = groupMatches.filter(m => m.group === g).slice().sort(sortByKickoff);
    });

    const snapshots = [{ label: 'Start', match: null, matches: [] }];

    for (let round = 1; round <= 3; round += 1) {
      const neededMatchesPerGroup = round * 2;
      const completeGroups = groupOrder.filter(g => (byGroup[g] || []).length >= neededMatchesPerGroup);
      if (!completeGroups.length) continue;

      const scopeIds = new Set();
      completeGroups.forEach(g => {
        byGroup[g].slice(0, neededMatchesPerGroup).forEach(m => scopeIds.add(m.id));
      });

      const scope = completed.filter(m => scopeIds.has(m.id)).slice().sort(sortByKickoff);
      snapshots.push({
        label: `Grupe R${round}`,
        match: scope[scope.length - 1],
        matches: scope
      });
    }

    const knockoutRounds = [
      { label: '16-imi', matches: completed.filter(m => Number(m.matchNo) >= 73 && Number(m.matchNo) <= 88) },
      { label: 'Optimi', matches: completed.filter(m => Number(m.matchNo) >= 89 && Number(m.matchNo) <= 96) },
      { label: 'Sferturi', matches: completed.filter(m => Number(m.matchNo) >= 97 && Number(m.matchNo) <= 100) },
      { label: 'Semifinale', matches: completed.filter(m => Number(m.matchNo) >= 101 && Number(m.matchNo) <= 102) },
      { label: 'Finale', matches: completed.filter(m => Number(m.matchNo) >= 103 && Number(m.matchNo) <= 104) }
    ];

    knockoutRounds.forEach(round => {
      if (!round.matches.length) return;
      const latest = round.matches.slice().sort(sortByKickoff).at(-1);
      snapshots.push({
        label: round.label,
        match: latest,
        matches: completed.filter(m => new Date(m.startTimeRo).getTime() <= new Date(latest.startTimeRo).getTime()).slice().sort(sortByKickoff)
      });
    });

    if (snapshots.length > 1) return snapshots;

    return completed.map((m, index) => ({
      label: `M${m.matchNo || index + 1}`,
      match: m,
      matches: completed.filter(x => new Date(x.startTimeRo).getTime() <= new Date(m.startTimeRo).getTime())
    }));
  }

  return filtered.map((m, index) => ({
    label: parcursSnapshotLabel(m, index, mode),
    match: m,
    matches: completed.filter(x => new Date(x.startTimeRo).getTime() <= new Date(m.startTimeRo).getTime())
  }));
}

function parcursBuildRealDataset(mode) {
  let snapshots = parcursBuildSnapshots(mode);
  const users = getUsers().filter(u => !isAdminUser(u));
  if (!snapshots.length || !users.length) return null;

  const players = users.map((u, index) => ({
    key: parcursPlayerKey(u),
    name: u.name,
    email: u.email,
    color: PARCURS_COLORS[index % PARCURS_COLORS.length],
    ranks: []
  }));

  snapshots.forEach(snapshot => {
    const rows = computeLeaderboardRows(snapshot.matches);
    players.forEach(player => {
      const row = rows.find(r => parcursPlayerKey(r) === player.key);
      player.ranks.push(row ? Number(row.rank) : null);
    });
  });

  if (mode === 'changes') {
    const keep = snapshots.map((_, index) => index === 0 || players.some(p => p.ranks[index] !== p.ranks[index - 1]));
    snapshots = snapshots.filter((_, index) => keep[index]);
    players.forEach(p => { p.ranks = p.ranks.filter((_, index) => keep[index]); });
  }

  return {
    demo: false,
    labels: snapshots.map(s => s.label),
    players
  };
}

function parcursBuildDemoDataset(mode) {
  let labels = PARCURS_DEMO_LABELS.slice();
  let players = PARCURS_DEMO_PLAYERS.map(p => ({ ...p, ranks: p.ranks.slice() }));

  if (mode === 'first10' || mode === 'last10' || mode === 'match') {
    labels = PARCURS_DEMO_LABELS.slice();
  } else if (mode === 'day' || mode === 'all') {
    labels = ['Ziua 1','Ziua 2','Ziua 3','Ziua 4','Ziua 5','Ziua 6','Ziua 7','Ziua 8','Ziua 9','Ziua 10'];
  } else if (mode === 'round') {
    labels = ['Start','Grupe R1','Grupe R2','Grupe R3','16-imi','Optimi','Sferturi','Semifinale','Finale'];
    players = players.map(p => ({ ...p, ranks: [p.ranks[0], p.ranks[1], p.ranks[2], p.ranks[4], p.ranks[5], p.ranks[6], p.ranks[7], p.ranks[8], p.ranks[9]] }));
  } else if (mode === 'groups') {
    labels = ['M1','M8','M16','M24','M32','M40','M48','M56','M64','M72'];
  } else if (mode === 'knockout') {
    labels = ['R32','R16','QF','SF','Finală'];
    players = players.map(p => ({ ...p, ranks: [p.ranks[5], p.ranks[6], p.ranks[7], p.ranks[8], p.ranks[9]] }));
  } else if (mode === 'changes') {
    labels = ['Start','Sch. 1','Sch. 2','Sch. 3','Sch. 4','Sch. 5'];
    players = players.map(p => ({ ...p, ranks: [p.ranks[0], p.ranks[1], p.ranks[3], p.ranks[5], p.ranks[7], p.ranks[9]] }));
  }

  return { demo: true, labels, players };
}

function parcursCurrentDataset() {
  const mode = parcursStageMode || 'day';
  return parcursBuildRealDataset(mode) || parcursBuildDemoDataset(mode);
}

function parcursEnsureSelection(players) {
  const valid = new Set(players.map(p => p.key));
  parcursSelectedPlayerKeys = new Set(Array.from(parcursSelectedPlayerKeys).filter(k => valid.has(k)));
  if (!parcursSelectionInitialized) {
    parcursSelectedPlayerKeys = new Set(players.map(p => p.key));
    parcursSelectionInitialized = true;
  }
}

function parcursLeaderboardPresetKeys(limit, players) {
  const validKeys = new Set(players.map(p => p.key));
  const leaderboardKeys = computeLeaderboardRows()
    .filter(row => Number(row.rank) <= Number(limit))
    .map(row => parcursPlayerKey(row))
    .filter(key => validKeys.has(key));
  return leaderboardKeys.length ? leaderboardKeys : players.slice(0, limit).map(p => p.key);
}

function parcursSelectPreset(preset, players) {
  parcursSelectionInitialized = true;
  if (preset === 'all') parcursSelectedPlayerKeys = new Set(players.map(p => p.key));
  else if (preset === 'none') parcursSelectedPlayerKeys = new Set();
  else if (preset === 'current') {
    const currentKey = parcursPlayerKey(currentUser);
    const exists = players.some(p => p.key === currentKey);
    if (!exists) return toast('Userul curent nu apare încă în grafic.');
    parcursSelectedPlayerKeys = new Set([currentKey]);
  } else if (preset === 'top3') parcursSelectedPlayerKeys = new Set(parcursLeaderboardPresetKeys(3, players));
  else if (preset === 'top10') parcursSelectedPlayerKeys = new Set(parcursLeaderboardPresetKeys(10, players));
}

function parcursRenderPlayerMenu(players) {
  const menu = $('parcursPlayerMenu');
  const button = $('parcursPlayerButton');
  if (!menu || !button) return;

  const selected = players.filter(p => parcursSelectedPlayerKeys.has(p.key));
  if (selected.length === players.length) button.textContent = `Toți jucătorii (${players.length})`;
  else if (!selected.length) button.textContent = 'Niciun jucător selectat';
  else button.textContent = `${selected.length}/${players.length} jucători selectați`;

  const isDesktopPlayerMenu = window.matchMedia && window.matchMedia('(min-width: 761px)').matches;
  const menuPlayers = isDesktopPlayerMenu
    ? players.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ro', { sensitivity: 'base' }))
    : players;

  menu.innerHTML = `<div class="parcurs-player-actions">
    <button type="button" data-parcurs-preset="all">Selectează toți</button>
    <button type="button" data-parcurs-preset="none">Deselectează toți</button>
  </div>
  <div class="parcurs-player-presets">
    <button type="button" data-parcurs-preset="current">Userul curent</button>
    <button type="button" data-parcurs-preset="top3">Top 3</button>
    <button type="button" data-parcurs-preset="top10">Top 10</button>
  </div>
  <div class="parcurs-player-checks">
    ${menuPlayers.map(p => `<label class="parcurs-player-check"><input type="checkbox" value="${escapeHtml(p.key)}" ${parcursSelectedPlayerKeys.has(p.key) ? 'checked' : ''}><span>${escapeHtml(p.name)}</span></label>`).join('')}
  </div>`;

  menu.querySelectorAll('[data-parcurs-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      parcursSelectPreset(btn.dataset.parcursPreset, players);
      renderParcursPreview();
    });
  });

  menu.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      parcursSelectionInitialized = true;
      if (input.checked) parcursSelectedPlayerKeys.add(input.value);
      else parcursSelectedPlayerKeys.delete(input.value);
      renderParcursPreview();
    });
  });
}

function parcursChartSvg(labels, players) {
  function desktopChart() {
    const width = 920, height = 360;
    const ml = 62, mr = 24, mt = 30, mb = 50;
    const plotW = width - ml - mr;
    const plotH = height - mt - mb;
    const allRanks = players.flatMap(p => p.ranks).filter(v => v != null);
    const maxRank = Math.max(8, ...allRanks, 1);
    const safeCount = Math.max(1, labels.length - 1);
    const x = (i) => ml + (plotW * i / safeCount);
    const y = (rank) => mt + (plotH * (Number(rank) - 1) / Math.max(1, maxRank - 1));

    let grid = '';
    for (let r = 1; r <= maxRank; r += 1) {
      const yy = y(r);
      grid += `<line x1="${ml}" y1="${yy.toFixed(1)}" x2="${width - mr}" y2="${yy.toFixed(1)}" class="pc-grid"/>`;
      grid += `<text x="${ml - 22}" y="${(yy + 4).toFixed(1)}" class="pc-axis-text">${r}</text>`;
    }

    labels.forEach((label, i) => {
      const step = labels.length > 12 ? Math.ceil(labels.length / 10) : 1;
      if (i % step === 0 || i === labels.length - 1) {
        grid += `<text x="${x(i).toFixed(1)}" y="${height - 18}" class="pc-x-text">${escapeHtml(label)}</text>`;
      }
    });

    const series = players.map(p => {
      const pts = p.ranks.map((rank, i) => rank == null ? null : [x(i), y(rank)]).filter(Boolean);
      if (!pts.length) return '';
      const line = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
      const dots = pts.map(([px, py], pointIndex) => {
        const rank = p.ranks[pointIndex];
        const label = labels[pointIndex] || `Etapa ${pointIndex + 1}`;
        const text = `${p.name} · ${label} · poziția ${rank}`;
        return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" class="pc-dot parcurs-point" tabindex="0" data-player="${escapeHtml(p.name)}" data-label="${escapeHtml(label)}" data-rank="${escapeHtml(rank)}" style="fill:${p.color}"><title>${escapeHtml(text)}</title></circle>`;
      }).join('');
      return `<polyline points="${line}" class="pc-line" style="stroke:${p.color}"/>${dots}`;
    }).join('');

    return `<div class="parcurs-chart-desktop-shell">
      <div class="parcurs-chart-scroll parcurs-chart-scroll-desktop">
        <svg viewBox="0 0 ${width} ${height}" class="parcurs-chart-svg parcurs-chart-svg-desktop" role="img" aria-label="Grafic evoluție clasament">
          ${grid}
          ${series}
        </svg>
      </div>
    </div>`;
  }

  function mobileChart() {
    const isPortraitMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
    const isMobileLandscape = typeof window !== 'undefined' && (
      window.matchMedia('(orientation: landscape) and (hover: none) and (pointer: coarse)').matches ||
      window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches ||
      window.matchMedia('(orientation: landscape) and (max-width: 932px)').matches
    );
    const height = isMobileLandscape ? 300 : 360;

    if (isPortraitMobile || isMobileLandscape) {
      const titleW = 16;
      const rankW = 24;
      const chartW = isMobileLandscape ? 720 : 780;
      const plotMl = 28;
      const plotMr = 28;
      const mt = 24, mb = 40;
      const plotH = height - mt - mb;
      const allRanks = players.flatMap(p => p.ranks).filter(v => v != null);
      const maxRank = Math.max(8, ...allRanks, 1);
      const safeCount = Math.max(1, labels.length - 1);
      const y = (rank) => mt + (plotH * (Number(rank) - 1) / Math.max(1, maxRank - 1));
      const plotX = (i) => plotMl + ((chartW - plotMl - plotMr) * i / safeCount);
      const yTitleCenter = mt + plotH / 2;

      let yAxis = `<text x="8" y="${yTitleCenter.toFixed(1)}" class="pc-axis-title pc-y-title-vertical" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 8 ${yTitleCenter.toFixed(1)})">Poziție în clasament</text>`;
      let rankAxis = '';
      let grid = '';
      for (let r = 1; r <= maxRank; r += 1) {
        const yy = y(r);
        rankAxis += `<text x="12" y="${yy.toFixed(1)}" class="pc-axis-text pc-y-rank-text" text-anchor="middle" dominant-baseline="middle">${r}</text>`;
        grid += `<line x1="${plotMl}" y1="${yy.toFixed(1)}" x2="${(chartW - plotMr).toFixed(1)}" y2="${yy.toFixed(1)}" class="pc-grid"/>`;
      }

      let xLabels = '';
      labels.forEach((label, i) => {
        const step = labels.length > 12 ? Math.ceil(labels.length / 10) : 1;
        if (i % step === 0 || i === labels.length - 1) {
          xLabels += `<text x="${plotX(i).toFixed(1)}" y="${height - 12}" class="pc-x-text">${escapeHtml(label)}</text>`;
        }
      });

      const series = players.map(p => {
        const pts = p.ranks.map((rank, i) => rank == null ? null : `${plotX(i).toFixed(1)},${y(rank).toFixed(1)}`).filter(Boolean);
        if (!pts.length) return '';
        const line = pts.join(' ');
        const dots = p.ranks.map((rank, pointIndex) => {
          if (rank == null) return '';
          const px = plotX(pointIndex);
          const py = y(rank);
          const label = labels[pointIndex] || `Etapa ${pointIndex + 1}`;
          const text = `${p.name} · ${label} · poziția ${rank}`;
          return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" class="pc-dot parcurs-point" tabindex="0" data-player="${escapeHtml(p.name)}" data-label="${escapeHtml(label)}" data-rank="${escapeHtml(rank)}" style="fill:${p.color}"><title>${escapeHtml(text)}</title></circle>`;
        }).join('');
        return `<polyline points="${line}" class="pc-line" style="stroke:${p.color}"/>${dots}`;
      }).join('');

      return `<div class="parcurs-chart-mobile-shell">
        <div class="parcurs-chart-split parcurs-chart-split-portrait">
          <svg viewBox="0 0 ${titleW} ${height}" class="parcurs-y-axis-svg parcurs-y-axis-svg-portrait" role="img" aria-hidden="true" preserveAspectRatio="none">
            ${yAxis}
          </svg>
          <svg viewBox="0 0 ${rankW} ${height}" class="parcurs-y-ranks-svg parcurs-y-ranks-svg-portrait" role="img" aria-hidden="true" preserveAspectRatio="none">
            ${rankAxis}
          </svg>
          <div class="parcurs-chart-scroll parcurs-chart-scroll-portrait">
            <svg viewBox="0 0 ${chartW} ${height}" class="parcurs-chart-svg parcurs-chart-svg-mobile parcurs-chart-svg-mobile-portrait" role="img" aria-label="Grafic evoluție clasament" preserveAspectRatio="none">
              ${grid}
              ${xLabels}
              ${series}
            </svg>
          </div>
        </div>
        <div class="parcurs-x-axis-title">Etape / meciuri jucate</div>
      </div>`;
    }

    const yAxisW = 56;
    const plotW = 860;
    const mt = 24, mb = 40;
    const plotH = height - mt - mb;
    const allRanks = players.flatMap(p => p.ranks).filter(v => v != null);
    const maxRank = Math.max(8, ...allRanks, 1);
    const safeCount = Math.max(1, labels.length - 1);
    const y = (rank) => mt + (plotH * (Number(rank) - 1) / Math.max(1, maxRank - 1));
    const plotX = (i) => plotW * i / safeCount;
    const yTitleCenter = mt + plotH / 2;

    let yAxis = `<text x="10" y="${yTitleCenter.toFixed(1)}" class="pc-axis-title pc-y-title-vertical" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 10 ${yTitleCenter.toFixed(1)})">Poziție în clasament</text>`;
    let grid = '';
    for (let r = 1; r <= maxRank; r += 1) {
      const yy = y(r);
      yAxis += `<text x="34" y="${yy.toFixed(1)}" class="pc-axis-text pc-y-rank-text" text-anchor="middle" dominant-baseline="middle">${r}</text>`;
      grid += `<line x1="0" y1="${yy.toFixed(1)}" x2="${plotW}" y2="${yy.toFixed(1)}" class="pc-grid"/>`;
    }

    let xLabels = '';
    labels.forEach((label, i) => {
      const step = labels.length > 12 ? Math.ceil(labels.length / 10) : 1;
      if (i % step === 0 || i === labels.length - 1) {
        xLabels += `<text x="${plotX(i).toFixed(1)}" y="${height - 12}" class="pc-x-text">${escapeHtml(label)}</text>`;
      }
    });

    const series = players.map(p => {
      const pts = p.ranks.map((rank, i) => rank == null ? null : `${plotX(i).toFixed(1)},${y(rank).toFixed(1)}`).filter(Boolean);
      if (!pts.length) return '';
      const line = pts.join(' ');
      const dots = p.ranks.map((rank, pointIndex) => {
        if (rank == null) return '';
        const px = plotX(pointIndex);
        const py = y(rank);
        const label = labels[pointIndex] || `Etapa ${pointIndex + 1}`;
        const text = `${p.name} · ${label} · poziția ${rank}`;
        return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" class="pc-dot parcurs-point" tabindex="0" data-player="${escapeHtml(p.name)}" data-label="${escapeHtml(label)}" data-rank="${escapeHtml(rank)}" style="fill:${p.color}"><title>${escapeHtml(text)}</title></circle>`;
      }).join('');
      return `<polyline points="${line}" class="pc-line" style="stroke:${p.color}"/>${dots}`;
    }).join('');

    return `<div class="parcurs-chart-mobile-shell">
      <div class="parcurs-chart-split">
        <svg viewBox="0 0 ${yAxisW} ${height}" class="parcurs-y-axis-svg" role="img" aria-hidden="true" preserveAspectRatio="none">
          ${yAxis}
        </svg>
        <div class="parcurs-chart-scroll">
          <svg viewBox="0 0 ${plotW} ${height}" class="parcurs-chart-svg parcurs-chart-svg-mobile" role="img" aria-label="Grafic evoluție clasament" preserveAspectRatio="none">
            ${grid}
            ${xLabels}
            ${series}
          </svg>
        </div>
      </div>
      <div class="parcurs-x-axis-title">Etape / meciuri jucate</div>
    </div>`;
  }

  return `${desktopChart()}${mobileChart()}`;
}

function parcursIsMobileTooltipMode() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse), (max-width: 932px)').matches;
}

function clearActiveParcursPoints() {
  const card = $('parcursChartCard');
  if (!card) return;
  card.querySelectorAll('.parcurs-point.is-active').forEach(point => point.classList.remove('is-active'));
  parcursActivePoint = null;
}

function hideParcursTooltip() {
  const tip = $('parcursTooltip');
  if (tip) tip.classList.add('hidden');
  clearActiveParcursPoints();
}

function showParcursTooltip(point) {
  const tip = $('parcursTooltip');
  const card = $('parcursChartCard');
  if (!tip || !card || !point) return;

  const isMobileTooltip = parcursIsMobileTooltipMode();
  if (isMobileTooltip) {
    clearActiveParcursPoints();
    parcursActivePoint = point;
    point.classList.add('is-active');
  }

  tip.innerHTML = `<strong>${escapeHtml(point.dataset.player || '')}</strong><span>${escapeHtml(point.dataset.label || '')}</span><span>Poziția: #${escapeHtml(point.dataset.rank || '')}</span>`;
  tip.classList.remove('hidden');

  const pointRect = point.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const offsetParent = tip.offsetParent || document.body;
  const parentRect = offsetParent.getBoundingClientRect();
  const pointCenterX = pointRect.left + (pointRect.width / 2);

  const cardLeftLimit = (cardRect.left - parentRect.left) + 8;
  const cardRightLimit = (cardRect.right - parentRect.left) - tipRect.width - 8;
  const parentTopLimit = 8;
  const parentBottomLimit = (parentRect.height || window.innerHeight) - tipRect.height - 8;

  let left = pointCenterX - parentRect.left - (tipRect.width / 2);
  left = Math.max(cardLeftLimit, Math.min(left, Math.max(cardLeftLimit, cardRightLimit)));

  // Always keep the tooltip above the selected/hovered point on mobile and desktop.
  let top = pointRect.top - parentRect.top - tipRect.height - 8;
  top = Math.max(parentTopLimit, Math.min(top, Math.max(parentTopLimit, parentBottomLimit)));

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function bindParcursPointTooltips() {
  const card = $('parcursChartCard');
  if (!card) return;

  card.querySelectorAll('.parcurs-point').forEach(point => {
    point.addEventListener('mousedown', (event) => {
      if (!parcursIsMobileTooltipMode()) {
        event.preventDefault();
      }
    });
    point.addEventListener('pointerdown', (event) => {
      if (!parcursIsMobileTooltipMode() && event.pointerType === 'mouse') {
        event.preventDefault();
      }
    });
    point.addEventListener('mouseenter', () => {
      if (!parcursIsMobileTooltipMode()) showParcursTooltip(point);
    });
    point.addEventListener('mousemove', () => {
      if (!parcursIsMobileTooltipMode()) showParcursTooltip(point);
    });
    point.addEventListener('mouseleave', () => {
      if (!parcursIsMobileTooltipMode()) hideParcursTooltip();
    });
    point.addEventListener('focus', () => {
      if (parcursIsMobileTooltipMode()) showParcursTooltip(point);
    });
    point.addEventListener('blur', () => {
      if (parcursIsMobileTooltipMode()) hideParcursTooltip();
    });
    point.addEventListener('click', (event) => {
      if (!parcursIsMobileTooltipMode()) {
        event.preventDefault();
        point.blur();
        return;
      }
      event.stopPropagation();
      showParcursTooltip(point);
    });
  });

  card.querySelectorAll('.parcurs-chart-scroll').forEach(scrollArea => {
    const hideMobileTooltipOnSwipe = () => {
      if (parcursIsMobileTooltipMode() && parcursActivePoint) {
        hideParcursTooltip();
      }
    };

    scrollArea.addEventListener('touchmove', hideMobileTooltipOnSwipe, { passive: true });
    scrollArea.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') hideMobileTooltipOnSwipe();
    }, { passive: true });
    scrollArea.addEventListener('scroll', () => {
      if (parcursIsMobileTooltipMode()) hideMobileTooltipOnSwipe();
    }, { passive: true });
  });

  if (!parcursTooltipOutsideBound) {
    document.addEventListener('click', (event) => {
      const chart = $('parcursChartCard');
      const tip = $('parcursTooltip');
      if (!tip || tip.classList.contains('hidden')) return;
      if (chart && chart.contains(event.target)) return;
      hideParcursTooltip();
    });
    parcursTooltipOutsideBound = true;
  }
}

function parcursStageLabel(value = parcursStageMode) {
  return PARCURS_STAGE_OPTIONS.find(o => o.value === value)?.label || 'După fiecare zi de meciuri';
}

function parcursRenderStageMenu() {
  const menu = $('parcursStageMenu');
  const button = $('parcursStageButton');
  if (!menu || !button) return;

  button.textContent = parcursStageLabel();
  menu.innerHTML = `<div class="parcurs-stage-options">
    ${PARCURS_STAGE_OPTIONS.map(option => `<button type="button" class="${option.value === parcursStageMode ? 'active' : ''}" data-parcurs-stage="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join('')}
  </div>`;

  menu.querySelectorAll('[data-parcurs-stage]').forEach(btn => {
    btn.addEventListener('click', () => {
      parcursStageMode = btn.dataset.parcursStage || 'day';
      menu.classList.add('hidden');
      renderParcursPreview();
    });
  });
}

function bindParcursControls() {
  if (parcursControlsBound) return;
  const playerButton = $('parcursPlayerButton');
  const playerPicker = $('parcursPlayerPicker');
  const playerMenu = $('parcursPlayerMenu');
  const stageButton = $('parcursStageButton');
  const stagePicker = $('parcursStagePicker');
  const stageMenu = $('parcursStageMenu');
  if (!playerButton || !playerPicker || !playerMenu || !stageButton || !stagePicker || !stageMenu) return;

  playerButton.addEventListener('click', () => {
    playerMenu.classList.toggle('hidden');
    stageMenu.classList.add('hidden');
  });

  stageButton.addEventListener('click', () => {
    stageMenu.classList.toggle('hidden');
    playerMenu.classList.add('hidden');
  });

  document.addEventListener('click', (event) => {
    if (!playerPicker.contains(event.target)) playerMenu.classList.add('hidden');
    if (!stagePicker.contains(event.target)) stageMenu.classList.add('hidden');
  });

  parcursControlsBound = true;
}

function renderParcursPreview() {
  const chart = $('parcursChartCard');
  const legend = $('parcursLegend');
  const note = $('parcursChartNote');
  if (!chart || !legend) return;
  bindParcursControls();

  const dataset = parcursCurrentDataset();
  parcursEnsureSelection(dataset.players);
  const selectedPlayers = parcursApplyDynamicContrastColors(dataset.players.filter(p => parcursSelectedPlayerKeys.has(p.key)));

  parcursRenderPlayerMenu(dataset.players);
  parcursRenderStageMenu();

  if (!selectedPlayers.length) {
    chart.innerHTML = `<div class="empty">Selectează cel puțin un jucător.</div>`;
    legend.innerHTML = '';
    return;
  }

  chart.innerHTML = parcursChartSvg(dataset.labels, selectedPlayers);
  bindParcursPointTooltips();
  legend.innerHTML = selectedPlayers.map(p => `<span class="parcurs-legend-item"><i style="background:${p.color}"></i>${escapeHtml(p.name)}</span>`).join('');
  if (note) note.innerHTML = '';
}

function renderAll() { renderPredictions(); renderResults(); renderGroups(); renderEliminatorii(); renderLuckyStrike(); renderLeaderboard(); renderAdminScores(); renderEmailPreview(); renderParcursPreview(); }


function adminTestNow() {
  return Math.round(performance.now() * 10) / 10;
}

function adminTestSkip(reason) {
  const err = new Error(reason);
  err.testStatus = 'skipped';
  throw err;
}

function adminTestAssert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function adminTestEscape(value) {
  return escapeHtml(String(value ?? ''));
}

function adminTestDefinitions() {
  return [
    {
      id: 'smoke-dom',
      suite: 'smoke',
      name: 'Elemente DOM principale există',
      run: () => {
        ['home', 'predictii', 'rezultate', 'grupe', 'lucky-strike', 'clasament', 'admin-scoruri', 'admin-emailuri', 'admin-api', 'admin-teste'].forEach(id => {
          adminTestAssert($(id), `Lipsește secțiunea #${id}`);
        });
        return 'Secțiunile principale sunt prezente.';
      }
    },
    {
      id: 'smoke-matches',
      suite: 'smoke',
      name: 'Lista meciurilor este încărcată',
      run: () => {
        adminTestAssert(Array.isArray(MATCHES), 'MATCHES nu este array.');
        adminTestAssert(MATCHES.length >= 104, `MATCHES are doar ${MATCHES.length} meciuri.`);
        return `${MATCHES.length} meciuri încărcate.`;
      }
    },
    {
      id: 'smoke-admin',
      suite: 'smoke',
      name: 'Contul curent are drepturi admin',
      run: () => {
        adminTestAssert(isAdminUser(), 'Testele admin pot rula doar din contul admin.');
        adminTestAssert(allowedSections().includes('admin-teste'), 'Secțiunea Admin teste nu este permisă.');
        return 'Admin valid și secțiunea de testare este permisă.';
      }
    },
    {
      id: 'scoring-prediction-sign',
      suite: 'scoring',
      name: 'Determinare 1 / X / 2',
      run: () => {
        adminTestAssert(predictionFromScore(2, 1) === '1', '2-1 trebuie să fie 1.');
        adminTestAssert(predictionFromScore(1, 1) === 'X', '1-1 trebuie să fie X.');
        adminTestAssert(predictionFromScore(0, 3) === '2', '0-3 trebuie să fie 2.');
        adminTestAssert(predictionFromScore('', 3) === '—', 'Scor incomplet trebuie să fie —.');
        return 'Semnele 1/X/2 sunt calculate corect.';
      }
    },
    {
      id: 'scoring-points',
      suite: 'scoring',
      name: 'Punctaj 3p / 1p / 0p',
      run: () => {
        const m = { id: '__admin_test_match__', home: 'Team A', away: 'Team B', resultHome: 2, resultAway: 1, startTimeRo: new Date().toISOString(), stage: 'group', group: 'A' };
        adminTestAssert(scorePrediction(m, { home: 2, away: 1 }).points === 3, 'Scor exact trebuie să dea 3p.');
        adminTestAssert(scorePrediction(m, { home: 1, away: 0 }).points === 1, 'Rezultat corect trebuie să dea 1p.');
        adminTestAssert(scorePrediction(m, { home: 0, away: 1 }).points === 0, 'Pronostic greșit trebuie să dea 0p.');
        adminTestAssert(scorePrediction({ ...m, resultHome: null, resultAway: null }, { home: 1, away: 0 }).type === 'pending', 'Meci fără rezultat trebuie să fie pending.');
        return 'Scor exact / rezultat corect / greșit sunt tratate corect.';
      }
    },
    {
      id: 'scoring-email',
      suite: 'scoring',
      name: 'Validare email login',
      run: () => {
        adminTestAssert(isAllowedEmail('test.user@gmail.com'), 'Email valid respins.');
        adminTestAssert(!isAllowedEmail('bad-email'), 'Email invalid acceptat.');
        adminTestAssert(!isAllowedEmail('x@domain'), 'Domeniu fără TLD acceptat greșit.');
        return 'Validarea emailului funcționează.';
      }
    },
    {
      id: 'groups-basic',
      suite: 'groups',
      name: 'Clasamente A–L generate',
      run: () => {
        const groups = groupStats();
        'ABCDEFGHIJKL'.split('').forEach(g => {
          adminTestAssert(groups[g], `Lipsește grupa ${g}.`);
          adminTestAssert(Object.keys(groups[g]).length >= 2, `Grupa ${g} nu are echipe suficiente.`);
        });
        return 'Toate grupele A–L sunt disponibile.';
      }
    },
    {
      id: 'groups-third-place',
      suite: 'groups',
      name: 'Tabel locul 3 calculabil',
      run: () => {
        const rows = bestThirdPlaceRows(groupStats());
        adminTestAssert(Array.isArray(rows), 'bestThirdPlaceRows nu returnează array.');
        adminTestAssert(rows.length <= 12, 'Tabelul locurilor 3 are mai mult de 12 echipe.');
        if (rows.length > 1) {
          for (let i = 1; i < rows.length; i++) {
            adminTestAssert(rows[i - 1].Pts >= rows[i].Pts || true, 'Sortarea locurilor 3 pare invalidă.');
          }
        }
        return `${rows.length} echipe disponibile în tabelul locurilor 3.`;
      }
    },
    {
      id: 'groups-qualified-highlight',
      suite: 'groups',
      name: 'Regulă highlight calificare disponibilă',
      run: () => {
        adminTestAssert(typeof areAllGroupsComplete === 'function', 'Funcția areAllGroupsComplete lipsește.');
        adminTestAssert(typeof groupPlayedMatchesCount === 'function', 'Funcția groupPlayedMatchesCount lipsește.');
        const complete = areAllGroupsComplete();
        return complete ? 'Toate grupele sunt complete; highlight-ul se poate aplica.' : 'Grupele nu sunt completate încă; highlight-ul rămâne inactiv conform regulii.';
      }
    },
    {
      id: 'ui-navigation',
      suite: 'ui',
      name: 'Navigație și secțiuni',
      run: () => {
        NAV_ITEMS.forEach(item => {
          adminTestAssert($(item.id), `NAV item fără secțiune: ${item.id}`);
        });
        adminTestAssert(document.querySelector('a[href="#admin-teste"]'), 'Linkul desktop Admin teste lipsește.');
        return 'Navigația are secțiuni valide.';
      }
    },
    {
      id: 'ui-current-user-highlight',
      suite: 'ui',
      name: 'Highlight user în Clasament',
      run: () => {
        renderLeaderboard();
        const marker = document.querySelector('#clasament [data-current-leaderboard="true"]');
        if (!getUsers().some(u => normalize(u.email) === normalize(currentUser?.email))) {
          adminTestSkip('Userul curent nu apare în lista de jucători; nu se poate verifica markerul.');
        }
        adminTestAssert(marker, 'Nu există marker pentru userul curent în clasament.');
        return 'Markerul pentru userul curent există.';
      }
    },
    {
      id: 'ui-next-match-highlight',
      suite: 'ui',
      name: 'Highlight următorul meci în Pronosticuri',
      run: () => {
        renderPredictions();
        const marker = document.querySelector('#predictii [data-current-prediction-match="true"]');
        if (!nextUnplayedMatchId(allMatches())) adminTestSkip('Nu există meci următor/nefinalizat în lista curentă.');
        adminTestAssert(marker, 'Nu există marker pentru următorul meci nejucat.');
        return 'Markerul pentru următorul meci nejucat există.';
      }
    },
    {
      id: 'api-load-data',
      suite: 'api',
      name: 'API loadData răspunde',
      run: async () => {
        if (!onlineMode) adminTestSkip('Mod online inactiv; test API sărit.');
        const start = adminTestNow();
        const data = await appApi('loadData');
        adminTestAssert(data && Array.isArray(data.users), 'Răspuns loadData fără users array.');
        return `loadData OK în ${Math.round(adminTestNow() - start)}ms.`;
      }
    },
    {
      id: 'api-admin-visibility',
      suite: 'api',
      name: 'Secțiunile admin sunt protejate în UI',
      run: () => {
        adminTestAssert(document.querySelectorAll('.admin-only').length > 0, 'Nu există linkuri admin-only.');
        adminTestAssert(document.querySelectorAll('.admin-only-section').length >= 4, 'Nu există suficiente secțiuni admin-only.');
        return 'Elementele admin sunt marcate ca admin-only.';
      }
    }
  ];
}

function adminTestSuiteLabel(suite) {
  const labels = {
    all: 'Toate',
    smoke: 'Smoke',
    scoring: 'Scoring',
    groups: 'Grupe',
    ui: 'UI / Navigare',
    api: 'API / Admin'
  };
  return labels[suite] || suite;
}

function adminTestStatusClass(status) {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  if (status === 'skipped') return 'skip';
  return 'run';
}

function renderAdminTestReport(results, running = false, suite = 'all', totalDuration = 0) {
  const summary = $('adminTestSummary');
  const tbody = $('adminTestResults');
  const log = $('adminTestLog');
  if (!summary || !tbody || !log) return;

  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  summary.innerHTML = `<span><strong>${running ? 'Rulează' : 'Raport'}:</strong> ${adminTestSuiteLabel(suite)}</span>
    <span class="admin-test-pill pass">${passed} passed</span>
    <span class="admin-test-pill fail">${failed} failed</span>
    <span class="admin-test-pill skip">${skipped} skipped</span>
    <span class="admin-test-pill">${results.length} total</span>
    <span class="admin-test-pill">${Math.round(totalDuration)}ms</span>`;

  tbody.innerHTML = results.length ? results.map(r => `<tr class="admin-test-row ${adminTestStatusClass(r.status)}">
    <td><span class="admin-test-status ${adminTestStatusClass(r.status)}">${r.status.toUpperCase()}</span></td>
    <td>${adminTestEscape(adminTestSuiteLabel(r.suite))}</td>
    <td><strong>${adminTestEscape(r.name)}</strong></td>
    <td>${Math.round(r.duration)}ms</td>
    <td>${adminTestEscape(r.message)}</td>
  </tr>`).join('') : `<tr><td colspan="5" class="empty-cell">Nu există rezultate încă.</td></tr>`;

  log.textContent = results.map(r => `[${r.status.toUpperCase()}] ${adminTestSuiteLabel(r.suite)} · ${r.name} · ${Math.round(r.duration)}ms\n${r.message}`).join('\n\n');
}

async function runAdminTests(suite = 'all') {
  if (!isAdminUser()) return toast('Doar adminul poate rula testele.');
  const allTests = adminTestDefinitions();
  const selected = suite === 'all' ? allTests : allTests.filter(t => t.suite === suite);
  const buttons = Array.from(document.querySelectorAll('[data-admin-test-suite]'));
  buttons.forEach(btn => btn.disabled = true);

  const started = adminTestNow();
  const results = [];
  renderAdminTestReport(results, true, suite, 0);

  for (const test of selected) {
    const testStart = adminTestNow();
    try {
      const message = await test.run();
      results.push({ ...test, status: 'passed', duration: adminTestNow() - testStart, message: message || 'OK' });
    } catch (err) {
      const status = err?.testStatus === 'skipped' ? 'skipped' : 'failed';
      results.push({ ...test, status, duration: adminTestNow() - testStart, message: err?.message || String(err) });
    }
    renderAdminTestReport(results, true, suite, adminTestNow() - started);
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  renderAdminTestReport(results, false, suite, adminTestNow() - started);
  buttons.forEach(btn => btn.disabled = false);

  const failed = results.filter(r => r.status === 'failed').length;
  toast(failed ? `Teste finalizate: ${failed} failed.` : 'Toate testele selectate au trecut sau au fost sărite.');
}

function bindAdminTests() {
  document.querySelectorAll('[data-admin-test-suite]').forEach(btn => {
    btn.addEventListener('click', () => runAdminTests(btn.dataset.adminTestSuite || 'all'));
  });
}

bindAdminTests();
bindPrizePopup();

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
  if (currentUser) {
    await showApp();
    maybeShowPrizePopup();
  } else showLanding();
})();
