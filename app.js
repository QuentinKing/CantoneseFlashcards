// Cantonese Flashcards - plain JavaScript, no build step.
// Card data lives in cards.txt; study stats are stored on the device (localStorage).

const STATS_KEY = 'cantoneseFlashcards.stats.v1';

const MODES = {
  'en-jy': { front: 'en', back: 'jy', label: 'English → Jyutping + audio' },
  'en-zh': { front: 'en', back: 'zh', label: 'English → Character' },
  'zh-en': { front: 'zh', back: 'en', label: 'Character → English' },
  'jy-en': { front: 'jy', back: 'en', label: 'Jyutping + audio → English' },
};
const SIDE_NAMES = { en: 'English', zh: 'Character', jy: 'Jyutping' };

let cards = [];
let session = null; // { mode, queue, index, flipped, right, wrong }

const $ = (id) => document.getElementById(id);

// ---------- Data loading ----------

// Splits one CSV line, honouring "double quoted, fields".
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCards(text) {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map(parseCsvLine)
    .filter((f) => f.length >= 3 && f[0] && f[1])
    .map(([en, zh, jy, audio = '']) => ({
      id: `${zh}|${en}`,
      en, zh, jy,
      audio: audio.split(/\s+/).filter(Boolean),
    }));
}

async function loadCards() {
  try {
    const res = await fetch('cards.txt', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cards = parseCards(await res.text());
    $('card-count').textContent = `${cards.length} cards in deck`;
  } catch (err) {
    $('card-count').textContent = 'No cards loaded';
    const e = $('load-error');
    e.textContent = `Could not load cards.txt (${err.message}). Open the app through a web server (run start-windows.bat), not by double-clicking index.html.`;
    e.classList.remove('hidden');
  }
}

// ---------- Stats ----------

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; }
  catch { return {}; }
}
function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* storage unavailable */ }
}
function recordResult(card, mode, correct) {
  const stats = loadStats();
  const s = stats[card.id] || { right: 0, total: 0, modes: {} };
  s.total++; if (correct) s.right++;
  const m = s.modes[mode] || { right: 0, total: 0 };
  m.total++; if (correct) m.right++;
  s.modes[mode] = m;
  stats[card.id] = s;
  saveStats(stats);
}
const accuracy = (s) => (s && s.total ? s.right / s.total : null);

// ---------- Audio ----------
//
// Local recordings (audio/*.wav, same site as the app) play through the Web Audio API:
// the file is fetched and decoded by the app, so it works offline from the cache and
// avoids iOS Safari's fussy <audio> element. Links to other websites still use <audio>.
// iOS only allows sound to start from a tap, so the audio engine is "unlocked" on every tap.

// If a recording hasn't started within this time (weak/no signal),
// give up on it and use the device's Cantonese text-to-speech voice instead.
const AUDIO_TIMEOUT_MS = 2000;

let audioCtx = null;
let currentAudio = null;   // <audio> element for external links
let currentSources = [];   // Web Audio sources for local files
let audioTimer = null;
let playToken = 0; // bumps on every play/stop so stale callbacks are ignored
const bufferCache = new Map(); // url -> Promise<AudioBuffer>

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

function unlockAudio() {
  // Play through the speaker even when the iPhone's silent switch is on (Safari 16.4+).
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
  const ctx = getAudioCtx();
  if (!ctx || ctx.state === 'running') return;
  ctx.resume().catch(() => {});
  // Older iOS also needs a sound started inside the tap; a 1-sample silent buffer does it.
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
}
['touchend', 'click', 'keydown'].forEach((t) => document.addEventListener(t, unlockAudio, { capture: true, passive: true }));

const isLocalUrl = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } };

function loadBuffer(url) {
  if (!bufferCache.has(url)) {
    const ctx = getAudioCtx();
    const p = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      // Callback form of decodeAudioData works on older Safari too.
      .then((data) => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)));
    p.catch(() => bufferCache.delete(url)); // allow a retry later
    bufferCache.set(url, p);
  }
  return bufferCache.get(url);
}

// Starts downloading/decoding a card's audio so the tap plays instantly.
function preloadCard(card) {
  if (card && card.audio.length && getAudioCtx() && card.audio.every(isLocalUrl)) {
    card.audio.forEach((u) => loadBuffer(u).catch(() => {}));
  }
}

function playCard(card) {
  stopAudio();
  if (!card.audio.length) return speak(card);
  const local = card.audio.every(isLocalUrl);
  if (!local && navigator.onLine === false) return speak(card);

  const token = ++playToken;
  const fallback = () => {
    if (token !== playToken) return;
    stopAudio();
    speak(card);
  };
  audioTimer = setTimeout(fallback, AUDIO_TIMEOUT_MS);

  const ctx = getAudioCtx();
  if (local && ctx) {
    Promise.all(card.audio.map(loadBuffer)).then((buffers) => {
      if (token !== playToken) return;
      clearTimeout(audioTimer);
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      let t = ctx.currentTime + 0.03;
      currentSources = buffers.map((buf) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(t);
        t += buf.duration;
        return src;
      });
    }, fallback);
    return;
  }

  // External links: chain <audio> elements, one per URL.
  let i = 0;
  const playNext = () => {
    if (token !== playToken || i >= card.audio.length) return;
    const a = new Audio(card.audio[i++]);
    currentAudio = a;
    clearTimeout(audioTimer);
    audioTimer = setTimeout(fallback, AUDIO_TIMEOUT_MS);
    a.onplaying = () => clearTimeout(audioTimer);
    a.onended = playNext;
    a.onerror = fallback; // broken link or no connection
    a.play().catch(() => {}); // a real failure still fires onerror or the timeout
  };
  playNext();
}
function speak(card) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(card.zh);
  u.lang = 'zh-HK';
  const voice = speechSynthesis.getVoices().find((v) => /zh[-_]HK|yue/i.test(v.lang));
  if (voice) u.voice = voice;
  u.rate = 0.8;
  speechSynthesis.speak(u);
}
function stopAudio() {
  playToken++;
  clearTimeout(audioTimer);
  if (currentAudio) { currentAudio.onended = null; currentAudio.onerror = null; currentAudio.pause(); currentAudio = null; }
  currentSources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
  currentSources = [];
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ---------- Rendering ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function playButton(card) {
  const b = el('button', 'play' + (card.audio.length ? '' : ' tts'), card.audio.length ? '🔊 Play' : '🔊 Play (TTS)');
  b.addEventListener('click', (ev) => { ev.stopPropagation(); playCard(card); });
  return b;
}

// Builds the main content for one side of a card.
function renderSide(card, side, small = false) {
  const frag = document.createDocumentFragment();
  const s = small ? ' small' : '';
  if (side === 'en') frag.append(el('div', 'en' + s, card.en));
  if (side === 'zh') frag.append(el('div', 'zh' + s, card.zh));
  if (side === 'jy') {
    frag.append(el('div', 'jy' + s, card.jy));
    frag.append(playButton(card));
  }
  return frag;
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  window.scrollTo(0, 0);
}

function renderCard() {
  const { mode, queue, index, flipped } = session;
  const card = queue[index];
  const m = MODES[mode];
  const content = $('card-content');
  content.replaceChildren();
  preloadCard(card);
  preloadCard(queue[index + 1]);

  $('progress').textContent = `${index + 1} / ${queue.length}`;
  $('score').textContent = `✓${session.right} ✗${session.wrong}`;

  if (!flipped) {
    $('side-label').textContent = SIDE_NAMES[m.front];
    content.append(renderSide(card, m.front));
    $('flip-hint').classList.remove('hidden');
    $('answer-btns').classList.add('hidden');
  } else {
    $('side-label').textContent = 'Answer';
    content.append(renderSide(card, m.back));
    content.append(el('hr', 'divider'));
    // Show the remaining info small so every flip teaches the full card.
    for (const side of ['zh', 'jy', 'en']) {
      if (side !== m.back) content.append(renderSide(card, side, true));
    }
    $('flip-hint').classList.add('hidden');
    $('answer-btns').classList.remove('hidden');
  }
}

// ---------- Study flow ----------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSession(mode) {
  if (!cards.length) return;
  let queue = shuffle(cards);
  if ($('weak-first').checked) {
    const stats = loadStats();
    // Unstudied cards count as 0% so they come first too; shuffle keeps ties random.
    queue.sort((a, b) => (accuracy(stats[a.id]) ?? -1) - (accuracy(stats[b.id]) ?? -1));
  }
  session = { mode, queue, index: 0, flipped: false, right: 0, wrong: 0 };
  showScreen('study');
  renderCard();
  if (MODES[mode].front === 'jy') playCard(queue[0]);
}

function flip() {
  if (!session || session.flipped) return;
  const card = $('card');
  card.classList.add('flipping');
  setTimeout(() => {
    session.flipped = true;
    renderCard();
    card.classList.remove('flipping');
    if (MODES[session.mode].back === 'jy') playCard(session.queue[session.index]);
  }, 180);
}

function answer(correct) {
  if (!session || !session.flipped) return;
  const card = session.queue[session.index];
  recordResult(card, session.mode, correct);
  correct ? session.right++ : session.wrong++;
  stopAudio();
  session.index++;
  session.flipped = false;
  if (session.index >= session.queue.length) return finishSession();
  renderCard();
  if (MODES[session.mode].front === 'jy') playCard(session.queue[session.index]);
}

function finishSession() {
  const { right, wrong } = session;
  const pct = Math.round((100 * right) / Math.max(1, right + wrong));
  $('done-summary').textContent = `${right} right · ${wrong} wrong · ${pct}%`;
  showScreen('done');
}

// ---------- Stats screen ----------

function renderStats() {
  const stats = loadStats();
  const sort = $('stats-sort').value;
  let list = cards.map((c, i) => ({ c, i, s: stats[c.id], acc: accuracy(stats[c.id]) }));
  if (sort === 'worst') list.sort((a, b) => (a.acc ?? 2) - (b.acc ?? 2));
  if (sort === 'best') list.sort((a, b) => (b.acc ?? -1) - (a.acc ?? -1));
  if (sort === 'most') list.sort((a, b) => (b.s?.total || 0) - (a.s?.total || 0));

  let totalRight = 0, totalAll = 0;
  for (const { s } of list) if (s) { totalRight += s.right; totalAll += s.total; }
  $('stats-overall').textContent = totalAll
    ? `Overall: ${Math.round((100 * totalRight) / totalAll)}% (${totalRight}/${totalAll} answers)`
    : 'No answers recorded yet.';

  const ul = $('stats-list');
  ul.replaceChildren();
  for (const { c, s, acc } of list) {
    const li = el('li');
    li.append(el('div', 's-zh', c.zh));
    const info = el('div', 's-info');
    info.append(el('div', 's-en', c.en), el('div', 's-jy', c.jy));
    li.append(info);
    const accEl = el('div', 's-acc', acc == null ? '—' : `${Math.round(acc * 100)}%`);
    accEl.append(el('span', 's-count', s ? `${s.right}/${s.total}` : 'not studied'));
    li.append(accEl);
    const bar = el('div', 'bar');
    const fill = el('div');
    fill.style.width = `${acc == null ? 0 : acc * 100}%`;
    bar.append(fill);
    li.append(bar);
    if (s && s.modes) {
      li.title = Object.entries(s.modes)
        .map(([k, m]) => `${MODES[k]?.label || k}: ${m.right}/${m.total}`)
        .join('\n');
    }
    ul.append(li);
  }
}

// ---------- Wiring ----------

document.querySelectorAll('.mode-btn').forEach((b) =>
  b.addEventListener('click', () => startSession(b.dataset.mode)));
$('card').addEventListener('click', flip);
$('right-btn').addEventListener('click', () => answer(true));
$('wrong-btn').addEventListener('click', () => answer(false));
$('quit-btn').addEventListener('click', () => { stopAudio(); showScreen('home'); });
$('again-btn').addEventListener('click', () => startSession(session.mode));
$('done-home-btn').addEventListener('click', () => showScreen('home'));
$('stats-btn').addEventListener('click', () => { renderStats(); showScreen('stats'); });
$('stats-back').addEventListener('click', () => showScreen('home'));
$('stats-sort').addEventListener('change', renderStats);
$('reset-btn').addEventListener('click', () => {
  if (confirm('Reset all stats? This cannot be undone.')) {
    try { localStorage.removeItem(STATS_KEY); } catch { /* ignore */ }
    renderStats();
  }
});

// Keyboard shortcuts for desktop testing: Space = flip, → / 1 = right, ← / 2 = wrong, P = play.
document.addEventListener('keydown', (e) => {
  if ($('study').classList.contains('hidden') || !session) return;
  if (e.key === ' ') { e.preventDefault(); flip(); }
  else if (e.key === 'ArrowRight' || e.key === '1') answer(true);
  else if (e.key === 'ArrowLeft' || e.key === '2') answer(false);
  else if (e.key.toLowerCase() === 'p') playCard(session.queue[session.index]);
});

if ('speechSynthesis' in window) speechSynthesis.getVoices(); // warm up voice list
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

loadCards();
