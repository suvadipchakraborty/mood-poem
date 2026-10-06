'use strict';

/* ==========================================================
   Mood Poem – app logic (vanilla ES6+, no build step)
   ========================================================== */

const APP_URL = 'https://mood-poem.suvadipchakraborty.workers.dev';
const API_BASE = 'https://poetrydb.org';
const FETCH_TIMEOUT_MS = 20000;

// Card readability: prefer poems that fit comfortably on one card.
const PREFERRED_MAX_LINES = 48;
const ABSOLUTE_MAX_LINES = 90;
const MIN_LINES = 4;

/* ----------------------------------------------------------
   1. Matching engine: UI selection -> search keywords
   The first keyword is tried at random with the others, so
   each tap can lead somewhere new. Edit freely.
   ---------------------------------------------------------- */
const MOOD_MAP = {
  // Moods
  Romantic:   { group: 'moods',   emoji: '🌹', keywords: ['love', 'beloved'] },
  Melancholy: { group: 'moods',   emoji: '🥀', keywords: ['tears', 'sorrow'] },
  Hopeful:    { group: 'moods',   emoji: '🌱', keywords: ['hope', 'dawn'] },
  Furious:    { group: 'moods',   emoji: '🔥', keywords: ['rage', 'fury'] },
  Joyful:     { group: 'moods',   emoji: '🌼', keywords: ['smile', 'laughter'] },
  Anxious:    { group: 'moods',   emoji: '🌀', keywords: ['shadow', 'fear'] },
  // Weather
  Rainy:      { group: 'weather', emoji: '🌧️', keywords: ['rain'] },
  Midnight:   { group: 'weather', emoji: '🌙', keywords: ['midnight', 'moon'] },
  Sunny:      { group: 'weather', emoji: '☀️', keywords: ['sunshine', 'sun'] },
  Storm:      { group: 'weather', emoji: '⛈️', keywords: ['storm', 'thunder'] }
};

/* ----------------------------------------------------------
   2. DOM references
   ---------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const els = {
  views: { muse: $('view-muse'), about: $('view-about') },
  tabs: { muse: $('tab-muse'), about: $('tab-about') },
  states: {
    select: $('state-select'),
    loading: $('state-loading'),
    poem: $('state-poem'),
    error: $('state-error')
  },
  gridMoods: $('grid-moods'),
  gridWeather: $('grid-weather'),
  loadingText: $('loading-text'),
  title: $('poem-title'),
  author: $('poem-author'),
  verse: $('poem-verse'),
  match: $('poem-match'),
  btnAnother: $('btn-another'),
  btnShare: $('btn-share'),
  btnChange: $('btn-change'),
  btnRetry: $('btn-retry'),
  btnErrorBack: $('btn-error-back'),
  errorTitle: $('error-title'),
  errorText: $('error-text'),
  btnInstall: $('btn-install'),
  installLabel: $('install-label'),
  installHint: $('install-hint'),
  toast: $('toast')
};

const state = {
  mood: null,       // selected label, e.g. "Rainy"
  poem: null,       // currently displayed poem
  keyword: null,    // keyword that produced it
  requestId: 0      // guards against out-of-order responses
};

/* ----------------------------------------------------------
   3. Helpers
   ---------------------------------------------------------- */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const poemKey = (p) => `${p.title}|${p.author}`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const keywordRegex = (keyword, flags = 'i') =>
  new RegExp(`\\b${escapeRegExp(keyword)}\\w*`, flags);

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
}

/* ----------------------------------------------------------
   4. PoetryDB: fetch + pick one poem
   ---------------------------------------------------------- */
const poemCache = new Map(); // keyword -> poems[] (so "Find another" is instant)

async function fetchPoems(keyword) {
  if (poemCache.has(keyword)) return poemCache.get(keyword);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Step 2: GET https://poetrydb.org/lines/{keyword}
    const res = await fetch(`${API_BASE}/lines/${encodeURIComponent(keyword)}`, {
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`PoetryDB responded with ${res.status}`);

    const data = await res.json();
    // When nothing matches, PoetryDB returns an object like { status: 404, reason: "Not found" }
    const poems = Array.isArray(data)
      ? data.filter((p) => p && p.title && p.author && Array.isArray(p.lines))
      : [];

    poemCache.set(keyword, poems);
    return poems;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Step 3: randomly select ONE poem from the API array.
 * Tiers keep results readable and genuinely on-theme:
 *   1. contains the keyword as a word + fits the card
 *   2. contains the keyword as a word + any reasonable length
 *   3. any poem that fits the card
 *   4. anything at all
 * The poem shown last time is skipped whenever there is a choice.
 */
function pickRandomPoem(poems, keyword, excludeKey = null) {
  if (!poems.length) return null;

  const re = keywordRegex(keyword);
  const lineCount = (p) => p.lines.length;
  const hasWord = (p) => re.test(p.lines.join(' '));
  const fits = (p) => lineCount(p) >= MIN_LINES && lineCount(p) <= PREFERRED_MAX_LINES;
  const okay = (p) => lineCount(p) >= MIN_LINES && lineCount(p) <= ABSOLUTE_MAX_LINES;

  const tiers = [
    poems.filter((p) => hasWord(p) && fits(p)),
    poems.filter((p) => hasWord(p) && okay(p)),
    poems.filter(fits),
    poems
  ];

  for (const tier of tiers) {
    const fresh = tier.filter((p) => poemKey(p) !== excludeKey);
    const pool = fresh.length ? fresh : tier;
    if (pool.length) return randomItem(pool);
  }
  return null;
}

/** Step 4: extract title, author, lines */
const extractPoem = ({ title, author, lines }) => ({ title, author, lines });

/* ----------------------------------------------------------
   5. Rendering
   ---------------------------------------------------------- */
function showState(name) {
  for (const [key, el] of Object.entries(els.states)) el.hidden = key !== name;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function buildLine(text, highlightRe) {
  const span = document.createElement('span');
  span.className = 'line';

  const indent = text.match(/^\s*/)[0].length;
  if (indent) span.style.setProperty('--indent', Math.min(indent, 12));

  const clean = text.trim();
  let last = 0;
  for (const m of clean.matchAll(highlightRe)) {
    if (m.index > last) span.append(document.createTextNode(clean.slice(last, m.index)));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    span.append(mark);
    last = m.index + m[0].length;
  }
  if (last < clean.length) span.append(document.createTextNode(clean.slice(last)));
  return span;
}

function buildStanzas(lines, keyword) {
  const highlightRe = keywordRegex(keyword, 'gi');
  const stanzas = [];
  let current = [];

  // PoetryDB marks stanza breaks with empty strings
  for (const raw of lines) {
    if (raw.trim() === '') {
      if (current.length) stanzas.push(current);
      current = [];
    } else {
      current.push(raw);
    }
  }
  if (current.length) stanzas.push(current);

  return stanzas.map((stanzaLines) => {
    const p = document.createElement('p');
    p.className = 'stanza';
    stanzaLines.forEach((l) => p.append(buildLine(l, highlightRe)));
    return p;
  });
}

function renderPoem(poem, keyword) {
  els.title.textContent = poem.title;
  els.author.textContent = `~ by ${poem.author}`;
  els.verse.replaceChildren(...buildStanzas(poem.lines, keyword));
  els.match.textContent = `Matched with the word “${keyword}”`;
}

function buildGrid() {
  for (const [label, cfg] of Object.entries(MOOD_MAP)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill';
    btn.dataset.mood = label;
    btn.setAttribute('aria-pressed', 'false');

    const emoji = document.createElement('span');
    emoji.className = 'pill-emoji';
    emoji.setAttribute('aria-hidden', 'true');
    emoji.textContent = cfg.emoji;

    btn.append(emoji, document.createTextNode(label));
    (cfg.group === 'moods' ? els.gridMoods : els.gridWeather).append(btn);
  }
}

function clearSelection() {
  document.querySelectorAll('.pill[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

/* ----------------------------------------------------------
   6. Main flow
   ---------------------------------------------------------- */
async function loadPoemForMood(label, { excludeCurrent = false } = {}) {
  const config = MOOD_MAP[label];
  if (!config) return;

  const requestId = ++state.requestId;
  state.mood = label;

  els.loadingText.textContent = `Searching the shelves for a poem that feels ${label.toLowerCase()}…`;
  showState('loading');

  const excludeKey = excludeCurrent && state.poem ? poemKey(state.poem) : null;

  try {
    // Step 1: grab the mapped keyword(s), in random order
    let chosen = null;
    let chosenKeyword = null;

    for (const keyword of shuffle(config.keywords)) {
      const poems = await fetchPoems(keyword);
      if (requestId !== state.requestId) return; // user moved on
      const poem = pickRandomPoem(poems, keyword, excludeKey);
      if (poem) { chosen = poem; chosenKeyword = keyword; break; }
    }

    if (!chosen) {
      showError('No poem matched that feeling this time', 'Try another mood or weather and we\'ll look again.', false);
      return;
    }

    state.poem = extractPoem(chosen);
    state.keyword = chosenKeyword;
    renderPoem(state.poem, state.keyword);
    showState('poem');
    els.title.focus({ preventScroll: true });
  } catch (err) {
    if (requestId !== state.requestId) return;
    console.error('[Mood Poem]', err);
    const offline = !navigator.onLine;
    const timedOut = err && err.name === 'AbortError';
    showError(
      'We couldn\'t fetch a poem',
      offline
        ? 'You appear to be offline. Reconnect to the internet and try again.'
        : timedOut
          ? 'The poetry library took too long to answer. Try again in a moment.'
          : 'The poetry library isn\'t responding right now. Try again in a moment.',
      true
    );
  }
}

function showError(title, text, canRetry) {
  els.errorTitle.textContent = title;
  els.errorText.textContent = text;
  els.btnRetry.hidden = !canRetry;
  showState('error');
}

function backToSelection() {
  state.requestId++; // cancel anything in flight
  clearSelection();
  showState('select');
}

/* ----------------------------------------------------------
   7. Sharing
   ---------------------------------------------------------- */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

async function sharePoem() {
  if (!state.poem) return;
  const { title, author } = state.poem;
  const text = `I just matched with "${title}" by ${author} on Mood Poem! Read it here: ${APP_URL}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Mood Poem', text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user closed the sheet
    }
  }
  const ok = await copyToClipboard(text);
  showToast(ok ? 'Copied to your clipboard' : 'Sharing isn\'t available on this device');
}

/* ----------------------------------------------------------
   8. Tabs (hash-based: #muse / #about)
   ---------------------------------------------------------- */
function setTab(name) {
  const tab = name === 'about' ? 'about' : 'muse';
  for (const key of Object.keys(els.views)) {
    els.views[key].hidden = key !== tab;
    if (key === tab) els.tabs[key].setAttribute('aria-current', 'page');
    else els.tabs[key].removeAttribute('aria-current');
  }
  document.title = tab === 'about'
    ? 'About – Mood Poem'
    : 'Mood Poem – a classic poem for exactly how you feel';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

const tabFromHash = () => (location.hash === '#about' ? 'about' : 'muse');

/* ----------------------------------------------------------
   9. PWA install
   ---------------------------------------------------------- */
let deferredInstallPrompt = null;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function updateInstallUI() {
  if (isStandalone()) {
    els.installLabel.textContent = 'App installed';
    els.btnInstall.disabled = true;
    els.installHint.hidden = true;
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  els.installLabel.textContent = 'App installed';
  els.btnInstall.disabled = true;
  els.installHint.hidden = true;
  showToast('Mood Poem is on your home screen');
});

async function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }
  // No native prompt available (iOS Safari, desktop Firefox, or already dismissed)
  els.installHint.textContent = isIOS()
    ? 'On iPhone or iPad, tap the Share icon in Safari, then choose Add to Home Screen.'
    : 'Open your browser menu and choose Install app or Add to Home Screen.';
  els.installHint.hidden = false;
}

/* ----------------------------------------------------------
   10. Wire up
   ---------------------------------------------------------- */
function init() {
  buildGrid();

  document.querySelector('#state-select').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    clearSelection();
    pill.setAttribute('aria-pressed', 'true');
    loadPoemForMood(pill.dataset.mood);
  });

  els.btnAnother.addEventListener('click', () => loadPoemForMood(state.mood, { excludeCurrent: true }));
  els.btnShare.addEventListener('click', sharePoem);
  els.btnChange.addEventListener('click', backToSelection);
  els.btnRetry.addEventListener('click', () => loadPoemForMood(state.mood, { excludeCurrent: true }));
  els.btnErrorBack.addEventListener('click', backToSelection);
  els.btnInstall.addEventListener('click', handleInstallClick);

  window.addEventListener('hashchange', () => setTab(tabFromHash()));
  setTab(tabFromHash());
  updateInstallUI();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) =>
        console.warn('[Mood Poem] Service worker registration failed:', err)
      );
    });
  }
}

init();
