/* ═══════════════════════════════════════════════════════════════
   Service worker — precaches the entire app so it runs with zero
   connectivity. Cache-first for everything we ship; network only
   as a fallback for things we do not.

   Two rules this file exists to enforce:

   1. THE PRECACHE IS ATOMIC.
      Every entry is downloaded *before* a single byte is written to
      the cache, and one missing file rejects the install promise.
      A half-downloaded pack can never activate, can never be served
      to an offline reload, and can never be reported as "offline
      ready". If anything is missing the cache is not created at all.

   2. THE WORKER REPORTS THE TRUTH.
      The page can ask for the pack status at any moment and gets back
      the exact number of cached files plus the list of what is
      missing, so the UI can say "offline pack incomplete — N of M
      files" instead of guessing from a timer.
   ═══════════════════════════════════════════════════════════════ */
const VERSION = 'bts-lyrics-v12';
const CACHE_PREFIX = 'bts-lyrics';
const PACK_STATUS = 'bts:pack-status';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './fonts.css',
  './app.js',
  './beat.js',
  './data/lyrics.js',
  './data/timings.js',
  './sync.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './fonts/bigshouldersdisplay-400.woff2',
  './fonts/bigshouldersdisplay-600.woff2',
  './fonts/bigshouldersdisplay-700.woff2',
  './fonts/bigshouldersdisplay-800.woff2',
  './fonts/spectral-400.woff2',
  './fonts/spectral-400i.woff2',
  './fonts/spectral-500.woff2',
  './fonts/spectral-600.woff2',
  './fonts/spacemono-400.woff2',
  './fonts/spacemono-700.woff2'
];

/* The album art — one small SVG per release, drawn in code. */
const COVERS = [
    './covers/2-cool-4-skool.svg', './covers/arirang.svg', './covers/be.svg',
    './covers/bts-the-best.svg', './covers/butter.svg', './covers/dark-wild.svg',
    './covers/dynamite.svg', './covers/face-yourself.svg',
    './covers/love-yourself-answer.svg', './covers/love-yourself-her.svg',
    './covers/love-yourself-tear.svg', './covers/map-of-the-soul-7-the-journey.svg',
    './covers/map-of-the-soul-7.svg', './covers/map-of-the-soul-persona.svg',
    './covers/normal.svg', './covers/o-rul8-2.svg', './covers/permission-to-dance.svg',
    './covers/proof.svg', './covers/skool-luv-affair-special-addition.svg',
    './covers/skool-luv-affair.svg', './covers/take-two.svg',
    './covers/the-most-beautiful-moment-in-life-pt-1.svg',
    './covers/the-most-beautiful-moment-in-life-pt-2.svg',
    './covers/the-most-beautiful-moment-in-life-young-forever.svg', './covers/wake-up.svg',
    './covers/wings.svg', './covers/you-never-walk-alone.svg',
];
PRECACHE.push.apply(PRECACHE, COVERS);

/* ── helpers ──────────────────────────────────────────────── */
function abs(url) { return new URL(url, self.location.href).href; }

/* The two HTML entries are allowed to be documents; everything else
   must be the actual file. A host that rewrites unknown paths to the
   SPA shell (Netlify's catch-all does exactly that) answers a missing
   file with index.html and a 200 — this is what catches that. */
function isHtmlEntry(url) { return url === './' || /\.html?(\?|#|$)/i.test(url); }

function isJsEntry(url) { return /\.js(\?|#|$)/i.test(url); }

function contentType(res) {
  try { return (res.headers.get('content-type') || '').toLowerCase(); }
  catch (e) { return ''; }
}

/* Only the headers we are allowed to keep when a body is re-wrapped.
   Content-Encoding and Content-Length describe the *compressed* body we
   received; the bytes we cache are already decoded, so copying them
   would make the browser try to inflate plain bytes. */
function cacheHeaders(res) {
  const out = new Headers();
  const type = res.headers.get('content-type');
  if (type) out.set('content-type', type);
  const mod = res.headers.get('last-modified');
  if (mod) out.set('last-modified', mod);
  return out;
}

/* Cheap sniff for "this is markup, not javascript" — done on the bytes
   we already downloaded, so no response has to be cloned. */
function isMarkup(buf) {
  try {
    const head = new TextDecoder('utf-8', { fatal: false })
      .decode(buf.slice(0, 64)).replace(/^[\s﻿]+/, '');
    return head.charAt(0) === '<';
  } catch (e) {
    return false;
  }
}

async function missingEntries(cache) {
  const keys = await cache.keys();
  const have = new Set();
  keys.forEach((r) => have.add(r.url));
  const missing = [];
  PRECACHE.forEach((url) => { if (!have.has(abs(url))) missing.push(url); });
  return missing;
}

/* ── the truth about the pack ─────────────────────────────── */
async function packStatus() {
  const names = await caches.keys();
  const ours = names.filter((n) => n.indexOf(CACHE_PREFIX) === 0);
  const name = ours.indexOf(VERSION) !== -1 ? VERSION : (ours[0] || null);

  const have = new Set();
  if (name) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    keys.forEach((r) => have.add(r.url));
  }

  const missing = [];
  let cached = 0;
  PRECACHE.forEach((url) => {
    if (have.has(abs(url))) cached++;
    else missing.push(url);
  });

  return {
    type: PACK_STATUS,
    version: VERSION,
    cache: name,
    expected: PRECACHE.slice(),
    expectedCount: PRECACHE.length,
    cachedCount: cached,
    cachedFiles: PRECACHE.filter(function (url) { return have.has(abs(url)); }),
    missing: missing,
    complete: cached === PRECACHE.length,
    controlling: !!self.registration && self.registration.active === self,
    at: Date.now()
  };
}

/* ── install: all or nothing ──────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(install());
});

/* How many files may be pulled at the same time.
   Some hosts (CDNs in front of a static bucket) drop the connection when
   a burst of parallel requests arrives from a service worker: 6 in
   flight is fine, 8 fails outright with "Failed to fetch". Asking for
   all 24 at once therefore loses the whole pack. Four at a time stays
   well under the limit and still installs in a couple of seconds. */
const FETCH_CONCURRENCY = 4;
/* A single request may not hang forever. */
const FETCH_TIMEOUT = 20000;
/* Give a flaky file a second chance before the install is called off. */
const FETCH_ATTEMPTS = 3;
/* The whole install gets a ceiling, so a wedged host cannot leave the
   worker stuck in "installing" for good. */
const INSTALL_DEADLINE = 120000;

/* Diagnostics: readable from the page (bts:diag) and from devtools. */
const diag = {
  version: VERSION, started: Date.now(), finished: 0,
  steps: [], error: null, complete: false, cached: 0
};
self.__BTS_SW_DIAG__ = diag;

/* Download one entry: fetch it, read it fully, hand back the bytes.
   The body is read straight away on purpose — an unread body keeps the
   socket open, and a host that limits connections would then stall the
   rest of the pack. */
async function fetchEntry(url) {
  const target = abs(url);
  let lastErr = null;

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const started = Date.now();
    let timer = null;
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT);
      const res = await fetch(new Request(target, {
        cache: 'reload',
        credentials: 'same-origin',
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined
      }));
      if (timer) clearTimeout(timer);
      timer = null;

      if (!res) throw new Error('no response');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (res.type === 'opaque') throw new Error('opaque response');

      /* A host that rewrites missing paths to the SPA shell answers with
         the HTML document and a 200. That is not the file we asked for. */
      if (!isHtmlEntry(url) && /^text\/html\b/.test(contentType(res))) {
        throw new Error('came back as the HTML shell, not the file');
      }

      const buf = await res.arrayBuffer();
      if (isJsEntry(url) && isMarkup(buf)) {
        throw new Error('came back as markup, not javascript');
      }

      diag.steps.push({ url: url, attempt: attempt, status: res.status,
                        bytes: buf.byteLength, ms: Date.now() - started, ok: true });
      return { url: url, target: target, buf: buf, headers: cacheHeaders(res) };
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastErr = err;
      diag.steps.push({ url: url, attempt: attempt, ok: false,
                        ms: Date.now() - started,
                        error: String((err && err.message) || err) });
      if (attempt < FETCH_ATTEMPTS) {
        /* back off a little before trying again */
        await new Promise(function (r) { setTimeout(r, 300 * attempt); });
      }
    }
  }
  throw new Error('precache: ' + url + ' failed after ' + FETCH_ATTEMPTS +
    ' attempts (' + ((lastErr && lastErr.message) || lastErr) + ')');
}

async function install() {
  /* The whole install gets a ceiling, so a wedged host cannot leave the
     worker stuck in "installing" for good. */
  const deadline = new Promise(function (_, reject) {
    setTimeout(function () {
      reject(new Error('precache: install exceeded ' + INSTALL_DEADLINE + 'ms'));
    }, INSTALL_DEADLINE);
  });

  try {
    await Promise.race([precacheAll(), deadline]);
    diag.complete = true;
    diag.cached = PRECACHE.length;
    diag.finished = Date.now();
    await self.skipWaiting();
  } catch (err) {
    diag.error = String((err && err.message) || err);
    diag.finished = Date.now();
    /* never leave a half-written cache behind */
    try { await caches.delete(VERSION); } catch (e) {}
    throw err;
  }
}

async function precacheAll() {
  /* 1 — download everything first, a few files at a time. Nothing
         touches the cache until every single entry has arrived, so a
         failed install cannot leave a half-populated cache behind. */
  const fetched = [];
  for (let i = 0; i < PRECACHE.length; i += FETCH_CONCURRENCY) {
    const batch = PRECACHE.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(fetchEntry));
    results.forEach(function (r) { fetched.push(r); });
  }

  /* 2 — everything is in hand: write it in one go. */
  const cache = await caches.open(VERSION);
  try {
    await Promise.all(fetched.map(function (f) {
      return cache.put(f.target, new Response(f.buf, {
        status: 200, headers: f.headers
      }));
    }));
  } catch (err) {
    await caches.delete(VERSION);
    throw err;
  }

  /* 3 — verify the cache really holds every entry before activating. */
  const missing = await missingEntries(cache);
  if (missing.length) {
    await caches.delete(VERSION);
    throw new Error('precache: cache is missing ' + missing.length + ' of ' +
      PRECACHE.length + ' entries: ' + missing.join(', '));
  }
  return fetched.length;
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* drop our own older caches only — never anyone else's */
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== VERSION)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
    const status = await packStatus();
    const windows = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    windows.forEach((c) => { try { c.postMessage(status); } catch (e) { /* gone */ } });
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'skipWaiting' || (data && data.type === 'bts:skip-waiting')) {
    self.skipWaiting();
    return;
  }
  if (!data || (data.type !== 'bts:status' && data.type !== 'bts:audit' &&
                data.type !== 'bts:diag' && data !== 'status')) return;

  const port = event.ports && event.ports[0];
  event.waitUntil(packStatus().then(function (status) {
    if (data.type === 'bts:diag' || data === 'diag') {
      status.diag = diag;
    }
    try {
      if (port) port.postMessage(status);
      else if (event.source) event.source.postMessage(status);
    } catch (e) { /* page went away */ }
  }));
});

/* ── fetch ────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });

    if (cached) {
      // Stale-while-revalidate: answer instantly from the cache (a venue network
      // is useless for waiting), and quietly refresh in the background.
      revalidate(cache, req);
      return cached;
    }

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      // Offline and not cached: fall back to the shell for navigations.
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});

async function revalidate(cache, req) {
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok && res.type === 'basic') await cache.put(req, res);
  } catch (err) {
    /* offline — keep the cached copy */
  }
}
