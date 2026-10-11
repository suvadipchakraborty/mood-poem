'use strict';

/* ==========================================================
   Mood Poem – app logic (vanilla ES6+, no build step)
   ========================================================== */

const APP_URL = 'https://mood-poem.suvadipchakraborty.workers.dev';
const API_BASE = 'https://poetrydb.org';
const FETCH_TIMEOUT_MS = 10000;   // per attempt
const FETCH_ATTEMPTS = 2;         // tries per endpoint style

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`PoetryDB responded with ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPoems(keyword) {
  if (poemCache.has(keyword)) return poemCache.get(keyword);

  const kw = encodeURIComponent(keyword);
  // Lighter request first (only the fields we use), then the plain search.
  const urls = [
    `${API_BASE}/lines/${kw}/title,author,lines`,
    `${API_BASE}/lines/${kw}`
  ];

  let lastError = null;
  for (const url of urls) {
    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
      try {
        const data = await fetchJson(url);
        // When nothing matches, PoetryDB returns an object like { status: 404, reason: "Not found" }
        const poems = Array.isArray(data)
          ? data.filter((p) => p && p.title && p.author && Array.isArray(p.lines))
          : [];
        poemCache.set(keyword, poems);
        return poems;
      } catch (err) {
        lastError = err;
        if (!navigator.onLine) throw err;      // no point retrying offline
        await sleep(400 * (attempt + 1));
      }
    }
  }
  throw lastError || new Error('PoetryDB request failed');
}

/* ----------------------------------------------------------
   4b. Offline shelf: public-domain classics used when PoetryDB
   is down or slow, so the app always has a poem to show.
   ---------------------------------------------------------- */
const FALLBACK_POEMS = {
  Romantic: {
    title: 'Sonnet 18', author: 'William Shakespeare',
    lines: ['Shall I compare thee to a summer\'s day?', 'Thou art more lovely and more temperate:', 'Rough winds do shake the darling buds of May,', 'And summer\'s lease hath all too short a date;', 'Sometime too hot the eye of heaven shines,', 'And often is his gold complexion dimm\'d;', 'And every fair from fair sometime declines,', 'By chance or nature\'s changing course untrimm\'d;', 'But thy eternal summer shall not fade,', 'Nor lose possession of that fair thou ow\'st;', 'Nor shall death brag thou wander\'st in his shade,', 'When in eternal lines to time thou grow\'st:', 'So long as men can breathe or eyes can see,', 'So long lives this, and this gives life to thee.']
  },
  Melancholy: {
    title: 'Song', author: 'Christina Rossetti',
    lines: ['When I am dead, my dearest,', 'Sing no sad songs for me;', 'Plant thou no roses at my head,', 'Nor shady cypress tree:', 'Be the green grass above me', 'With showers and dewdrops wet;', 'And if thou wilt, remember,', 'And if thou wilt, forget.', '', 'I shall not see the shadows,', 'I shall not feel the rain;', 'I shall not hear the nightingale', 'Sing on, as if in pain:', 'And dreaming through the twilight', 'That doth not rise nor set,', 'Haply I may remember,', 'And haply may forget.']
  },
  Hopeful: {
    title: '"Hope" is the thing with feathers', author: 'Emily Dickinson',
    lines: ['"Hope" is the thing with feathers -', 'That perches in the soul -', 'And sings the tune without the words -', 'And never stops - at all -', '', 'And sweetest - in the Gale - is heard -', 'And sore must be the storm -', 'That could abash the little Bird', 'That kept so many warm -', '', 'I\'ve heard it in the chillest land -', 'And on the strangest Sea -', 'Yet - never - in Extremity,', 'It asked a crumb - of me.']
  },
  Furious: {
    title: 'A Poison Tree', author: 'William Blake',
    lines: ['I was angry with my friend;', 'I told my wrath, my wrath did end.', 'I was angry with my foe:', 'I told it not, my wrath did grow.', '', 'And I water\'d it in fears,', 'Night & morning with my tears;', 'And I sunned it with smiles,', 'And with soft deceitful wiles.', '', 'And it grew both day and night,', 'Till it bore an apple bright.', 'And my foe beheld it shine,', 'And he knew that it was mine,', '', 'And into my garden stole', 'When the night had veil\'d the pole;', 'In the morning glad I see', 'My foe outstretch\'d beneath the tree.']
  },
  Joyful: {
    title: 'I Wandered Lonely as a Cloud', author: 'William Wordsworth',
    lines: ['I wandered lonely as a cloud', 'That floats on high o\'er vales and hills,', 'When all at once I saw a crowd,', 'A host, of golden daffodils;', 'Beside the lake, beneath the trees,', 'Fluttering and dancing in the breeze.', '', 'Continuous as the stars that shine', 'And twinkle on the milky way,', 'They stretched in never-ending line', 'Along the margin of a bay:', 'Ten thousand saw I at a glance,', 'Tossing their heads in sprightly dance.', '', 'The waves beside them danced; but they', 'Out-did the sparkling waves in glee:', 'A poet could not but be gay,', 'In such a jocund company:', 'I gazed—and gazed—but little thought', 'What wealth the show to me had brought:', '', 'For oft, when on my couch I lie', 'In vacant or in pensive mood,', 'They flash upon that inward eye', 'Which is the bliss of solitude;', 'And then my heart with pleasure fills,', 'And dances with the daffodils.']
  },
  Anxious: {
    title: 'Sonnet 29', author: 'William Shakespeare',
    lines: ['When, in disgrace with fortune and men\'s eyes,', 'I all alone beweep my outcast state', 'And trouble deaf heaven with my bootless cries', 'And look upon myself and curse my fate,', 'Wishing me like to one more rich in hope,', 'Featured like him, like him with friends possess\'d,', 'Desiring this man\'s art and that man\'s scope,', 'With what I most enjoy contented least;', 'Yet in these thoughts myself almost despising,', 'Haply I think on thee, and then my state,', 'Like to the lark at break of day arising', 'From sullen earth, sings hymns at heaven\'s gate;', 'For thy sweet love remember\'d such wealth brings', 'That then I scorn to change my state with kings.']
  },
  Rainy: {
    title: 'Rain', author: 'Robert Louis Stevenson',
    lines: ['The rain is raining all around,', 'It falls on field and tree,', 'It rains on the umbrellas here,', 'And on the ships at sea.']
  },
  Midnight: {
    title: 'The Cloths of Heaven', author: 'W. B. Yeats',
    lines: ['Had I the heavens\' embroidered cloths,', 'Enwrought with golden and silver light,', 'The blue and the dim and the dark cloths', 'Of night and light and the half-light,', 'I would spread the cloths under your feet:', 'But I, being poor, have only my dreams;', 'I have spread my dreams under your feet;', 'Tread softly because you tread on my dreams.']
  },
  Sunny: {
    title: 'Ah! Sun-flower', author: 'William Blake',
    lines: ['Ah Sun-flower! weary of time,', 'Who countest the steps of the Sun;', 'Seeking after that sweet golden clime', 'Where the traveller\'s journey is done;', '', 'Where the Youth pined away with desire,', 'And the pale Virgin shrouded in snow,', 'Arise from their graves, and aspire', 'Where my Sun-flower wishes to go.']
  },
  Storm: {
    title: 'Sonnet 116', author: 'William Shakespeare',
    lines: ['Let me not to the marriage of true minds', 'Admit impediments. Love is not love', 'Which alters when it alteration finds,', 'Or bends with the remover to remove:', 'O no! it is an ever-fixed mark', 'That looks on tempests and is never shaken;', 'It is the star to every wandering bark,', 'Whose worth\'s unknown, although his height be taken.', 'Love\'s not Time\'s fool, though rosy lips and cheeks', 'Within his bending sickle\'s compass come;', 'Love alters not with his brief hours and weeks,', 'But bears it out even to the edge of doom.', 'If this be error and upon me proved,', 'I never writ, nor no man ever loved.']
  }
};

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

function renderPoem(poem, keyword, { fromShelf = false, mood = '' } = {}) {
  els.title.textContent = poem.title;
  els.author.textContent = `~ by ${poem.author}`;
  els.verse.replaceChildren(...buildStanzas(poem.lines, keyword));
  els.match.textContent = fromShelf
    ? `A classic from our own shelf for a ${mood.toLowerCase()} mood`
    : `Matched with the word “${keyword}”`;
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

  // Step 1: grab the mapped keyword(s), in random order
  let chosen = null;
  let chosenKeyword = null;

  for (const keyword of shuffle(config.keywords)) {
    try {
      const poems = await fetchPoems(keyword);
      if (requestId !== state.requestId) return; // user moved on
      const poem = pickRandomPoem(poems, keyword, excludeKey);
      if (poem) { chosen = poem; chosenKeyword = keyword; break; }
    } catch (err) {
      if (requestId !== state.requestId) return;
      console.warn('[Mood Poem] PoetryDB failed for', keyword, err);
    }
  }

  if (requestId !== state.requestId) return;

  let fromShelf = false;
  if (!chosen) {
    // PoetryDB is down, slow, or had nothing: use the built-in shelf
    const backup = FALLBACK_POEMS[label];
    if (backup) {
      chosen = backup;
      chosenKeyword = config.keywords[0];
      fromShelf = true;
    }
  }

  if (!chosen) {
    showError(
      'We couldn\'t fetch a poem',
      navigator.onLine
        ? 'The poetry library isn\'t responding right now. Try again in a moment.'
        : 'You appear to be offline. Reconnect to the internet and try again.',
      true
    );
    return;
  }

  state.poem = extractPoem(chosen);
  state.keyword = chosenKeyword;
  renderPoem(state.poem, state.keyword, { fromShelf, mood: label });
  showState('poem');
  els.title.focus({ preventScroll: true });
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
