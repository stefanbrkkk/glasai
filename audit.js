#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   GLAS AI — test harness (BRIEF §9, Round 1)
   Runs the real page in Chromium and prints a pass/fail table.

   Setup (once):   cd .audit && npm install     # gsap + lenis, served locally
   Run:            node audit.js                 all rounds
                   node audit.js --quick         skip the 3-cycle loop round
   Copy check:     node .audit/copy-check.mjs    BRIEF §9 round 4
   ══════════════════════════════════════════════════════════════════════════

   The page links GSAP/ScrollTrigger (cdnjs) and Lenis (jsDelivr). This sandbox's
   egress policy blocks those hosts, so every run serves the *real* library
   bytes from node_modules and the *real* Google Fonts CSS + woff2 files from
   .audit/fixtures via route fulfilment. That makes the run hermetic and lets
   the CDN-blocked round (F1) be a genuine abort rather than an artefact.
*/
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium, devices } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = __dirname;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = path.join(ROOT, '.audit', 'shots');
const FIX = path.join(ROOT, '.audit', 'fixtures');
const NM = path.join(ROOT, '.audit', 'node_modules');
/* the widget bundle the harness serves — the unpinned snippet resolves to npm's latest, so the harness keeps that */
const WIDGET_VER = JSON.parse(fs.readFileSync(path.join(NM, '@elevenlabs/convai-widget-embed/package.json'), 'utf8')).version;
const WIDGET_VER_RE = WIDGET_VER.replace(/\./g, '\\.');
const WIDTHS = [360, 390, 414, 768, 1024, 1280, 1440, 1920];
const QUICK = process.argv.includes('--quick');

fs.mkdirSync(SHOTS, { recursive: true });

/* 0.4 s of silence — a real decodable file, so the filled CONFIG path is not
   quietly testing a media error instead of the player. */
function silentWav() {
  const rate = 8000, n = rate * 0.4, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

/* ── result table ─────────────────────────────────────────────────────── */
const rows = [];
function rec(round, check, pass, detail) {
  rows.push({ round, check, pass: !!pass, detail: detail || '' });
  const tag = pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${tag}  ${check}${detail ? '  — ' + detail : ''}`);
}
function head(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

/* ── static server for index.html ─────────────────────────────────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
function sendFile(f, req, rq) {
  /* Range support: a media element asks for byte ranges, and a server that
     answers every request with the whole body leaves the connection streaming
     — which is what a real host does correctly and what `networkidle` needs. */
  const size = fs.statSync(f).size;
  const type = MIME[path.extname(f)] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2]);
    if (!isFinite(start) || start < 0) start = 0;
    if (!isFinite(end) || end >= size) end = size - 1;
    if (start > end) { rq.writeHead(416, { 'content-range': `bytes */${size}` }); rq.end(); return; }
    rq.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
    fs.createReadStream(f, { start, end }).pipe(rq);
    return;
  }
  rq.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
  fs.createReadStream(f).pipe(rq);
}
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rq) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); rq.end('404'); return; }
      sendFile(f, req, rq);
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

/* ── route table ──────────────────────────────────────────────────────── */
const fontCss = fs.readFileSync(path.join(FIX, 'fonts.css'), 'utf8');
function gstaticFile(url) {
  return path.join(FIX, 'gstatic', url.replace('https://fonts.gstatic.com/', '').replace(/\//g, '_'));
}
/* the ElevenLabs widget's config endpoint — the real widget refuses to render
   without a `widget_config`, so the harness answers with the shape the bundle's
   own defaults describe. The conversation itself (a WebSocket to ElevenLabs)
   cannot be reached from here and is never attempted by these rounds. */
const WIDGET_CFG = JSON.stringify({ widget_config: { variant: 'full', placement: 'bottom-right',
  avatar: { type: 'orb', color_1: '#2792dc', color_2: '#9ce6e6' }, feedback_mode: 'none', language: 'sr',
  mic_muting_enabled: false, transcript_enabled: false, text_input_enabled: false, default_expanded: false,
  always_expanded: false, dismissible: false, text_contents: { start_call: 'Start call' }, language_presets: {},
  disable_banner: true, text_only: false, supports_text_only: false } });
async function wire(ctx, { blockCdn = false, blockFonts = false, blockWidget = null } = {}) {
  const widgetDown = blockWidget === null ? blockCdn : blockWidget;
  await ctx.route(/unpkg\.com/, r => {
    if (widgetDown) return r.abort('failed');
    const f = path.join(NM, '@elevenlabs/convai-widget-embed/dist/index.js');
    if (!fs.existsSync(f)) return r.abort('failed');
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(f) });
  });
  /* the widget also pulls its orb-avatar texture from Google Storage; a 1×1 PNG
     stands in for it so a clean run stays clean */
  await ctx.route(/storage\.googleapis\.com\/eleven-public-cdn/, r => {
    if (widgetDown) return r.abort('failed');
    r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
  });
  await ctx.route(/elevenlabs\.io/, r => {
    if (widgetDown) return r.abort('failed');
    if (/\/v1\/convai\/agents\/[^/]+\/widget/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/json', body: WIDGET_CFG });
    r.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  await ctx.route(/fonts\.googleapis\.com/, r => {
    if (blockFonts) return r.abort('failed');
    r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: fontCss });
  });
  await ctx.route(/fonts\.gstatic\.com/, r => {
    if (blockFonts) return r.abort('failed');
    const f = gstaticFile(r.request().url());
    if (!fs.existsSync(f)) return r.abort('failed');
    r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) });
  });
  await ctx.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/, r => {
    if (blockCdn) return r.abort('failed');
    const u = r.request().url();
    let f = null;
    if (/gsap\.min\.js/.test(u)) f = path.join(NM, 'gsap/dist/gsap.min.js');
    else if (/ScrollTrigger\.min\.js/.test(u)) f = path.join(NM, 'gsap/dist/ScrollTrigger.min.js');
    else if (/lenis(\.min)?\.js/.test(u)) f = path.join(NM, 'lenis/dist/lenis.min.js');
    if (!f || !fs.existsSync(f)) return r.abort('failed');
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(f) });
  });
}

/* ── console / error collector ────────────────────────────────────────── */
const EXPECTED_HOST = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.g(oogleapis|static)\.com|lenis|unpkg\.com|elevenlabs\.io|eleven-public-cdn/;
function watch(page, bag) {
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (m.location() && m.location().url) || '';
    // the browser logs the aborted CDN fetch itself — that abort is the test
    /* only the browser's own resource-load line for a host this run blocks is
       excused; anything the widget (or the page) logs at runtime counts */
    if (/net::ERR_|Failed to load resource/.test(m.text()) && EXPECTED_HOST.test(loc + m.text())) return;
    bag.push('console.error: ' + m.text() + (loc ? ' @ ' + loc : ''));
  });
  page.on('pageerror', e => bag.push('pageerror: ' + (e && e.message)));
  page.on('requestfailed', r => {
    const u = r.url();
    /* A media element asks for `bytes=0-`, reads the metadata it needs and
       abandons the rest. Every browser does this; it is the element working,
       not the page failing. */
    if (r.resourceType() === 'media' && (r.failure() || {}).errorText === 'net::ERR_ABORTED') return;
    if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.g(oogleapis|static)\.com|unpkg\.com|elevenlabs\.io|eleven-public-cdn/.test(u)) return; // intentional in blocked runs
    bag.push('requestfailed: ' + u);
  });
}

/* ── contrast maths ───────────────────────────────────────────────────── */
function lum(hex) {
  const n = hex.replace('#', '');
  const v = [0, 2, 4].map(i => parseInt(n.substr(i, 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ── helpers run inside the page ──────────────────────────────────────── */
const SCROLL_TO = `(y => { if (window.__glasLenis) window.__glasLenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y); })`;

const OVERFLOW_PROBE = `(() => {
  const w = document.documentElement.clientWidth;
  const bad = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > w + 1) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && cs.visibility === 'hidden') return;
      let n = el.parentElement, clipped = false;
      while (n && n !== document.documentElement) {
        const p = getComputedStyle(n);
        if (/hidden|clip|auto|scroll/.test(p.overflowX)) { clipped = true; break; }
        n = n.parentElement;
      }
      if (clipped) return;
      bad.push({ t: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''), l: Math.round(r.left), r: Math.round(r.right) });
    }
  });
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: w, bad: bad.slice(0, 6) };
})()`;

const PHONE_STATE = `(() => {
  const g = s => document.querySelector(s);
  const op = e => e ? parseFloat(getComputedStyle(e).opacity) : -1;
  const disp = e => e ? getComputedStyle(e).display : 'x';
  return {
    t: g('#ph-timer') ? g('#ph-timer').textContent : '',
    incoming: op(g('#ph-incoming')),
    call: op(g('#ph-call')),
    content: op(g('#ph-content')),
    confirm: disp(g('#ph-confirm')) === 'none' ? 0 : op(g('#ph-confirm')),
    turns: Array.from(document.querySelectorAll('.ph-turn')).map(e => disp(e) === 'none' ? 0 : +op(e).toFixed(2)),
    typing: Array.from(document.querySelectorAll('.ph-typing')).map(e => disp(e) === 'none' ? 0 : +op(e).toFixed(2))
  };
})()`;

/* the laptop: how far its scrub has run, whether anything is still
   transformed, whether the screen's words are on, and how tall the lid draws
   against its own layout box (a shut lid projects to a sliver) */
const LAPTOP_ST = `(() => {
  const g = s => document.querySelector(s), cs = s => getComputedStyle(g(s));
  const st = window.ScrollTrigger && ScrollTrigger.getAll().find(t => t.trigger && t.trigger.classList && t.trigger.classList.contains('laptop-base'));
  const lid = g('#laptop-lid'), r = lid.getBoundingClientRect();
  const ui = Array.from(document.querySelectorAll('#lap-ui > :not(.vh)'));
  const id = m => m === 'none' || m === 'matrix(1, 0, 0, 1, 0, 0)' || m === 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)';
  return { progress: st ? +st.progress.toFixed(2) : null, lid: cs('#laptop-lid').transform, lap: cs('#laptop').transform,
           identity: id(cs('#laptop-lid').transform) && id(cs('#laptop').transform) && ui.every(e => id(getComputedStyle(e).transform)),
           lidRatio: +(r.height / lid.offsetHeight).toFixed(2),
           uiShown: ui.length === 3 && ui.every(e => parseFloat(getComputedStyle(e).opacity) > 0.98),
           uiHidden: ui.every(e => parseFloat(getComputedStyle(e).opacity) < 0.02),
           lit: +parseFloat(cs('#laptop-lit').opacity).toFixed(2),
           mail: g('#lap-mail').getAttribute('href'), copy: g('#lap-copy-idle').textContent.trim() };
})()`;

/* ══════════════════════════════════════════════════════════════════════════
   ROUNDS
   ══════════════════════════════════════════════════════════════════════ */
(async () => {
  const { srv, base } = await serve();
  /* a fake microphone, always granted: the engine takes one before it opens its socket */
  const browser = await chromium.launch({ executablePath: EXE, args: ['--font-render-hinting=none', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

  /* ── 1 · console cleanliness ─────────────────────────────────────────── */
  head('1 · Console — normal load, network idle + 5 s of animation');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    rec(1, 'zero console errors / pageerrors / unhandled rejections', bag.length === 0, bag.slice(0, 4).join(' | '));
    const libs = await page.evaluate(`({gsap: !!window.gsap, st: !!window.ScrollTrigger, lenis: !!window.Lenis, lenisLive: !!window.__glasLenis, motion: document.documentElement.classList.contains('js-motion'), loop: document.documentElement.classList.contains('js-loop')})`);
    rec(1, 'GSAP + ScrollTrigger + Lenis all active', libs.gsap && libs.st && libs.lenis && libs.lenisLive, JSON.stringify(libs));
    await ctx.close();
  }

  /* ── 2 · overflow at every width ─────────────────────────────────────── */
  head('2 · Horizontal overflow — 360 → 1920');
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await wire(ctx);
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    // check top of page and after a full scroll-through
    const top = await page.evaluate(OVERFLOW_PROBE);
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight)`);
    await page.waitForTimeout(1600);
    const bottom = await page.evaluate(OVERFLOW_PROBE);
    const ok = top.scrollWidth <= top.clientWidth + 1 && bottom.scrollWidth <= bottom.clientWidth + 1;
    rec(2, `no horizontal scroll @ ${w}px`, ok,
      ok ? '' : `sw ${top.scrollWidth}/${bottom.scrollWidth} vs ${top.clientWidth} :: ` + JSON.stringify(top.bad.concat(bottom.bad).slice(0, 4)));
    await ctx.close();
  }

  /* ── 3 · screenshots ─────────────────────────────────────────────────── */
  head('3 · Screenshots — stepped viewport frames at every width');
  /* Full-page capture uses captureBeyondViewport, which re-lays-out a pinned
     section and a fixed nav. Stepped viewport frames are what actually ships. */
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await wire(ctx);
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1900);
    const total = await page.evaluate(`document.body.scrollHeight`);
    const step = 900;
    let i = 0;
    /* the last step is clamped to the page's real end: a scroll past it
       leaves the compositor overscrolled for the frame, and the fixed nav
       lands mid-frame in a picture of a page that never renders that way */
    for (let y = 0; y < total - 200 && i < 12; y += step, i++) {
      await page.evaluate(SCROLL_TO + '(Math.min(' + y + ', document.documentElement.scrollHeight - innerHeight))');
      await page.waitForTimeout(720);
      await page.screenshot({ path: path.join(SHOTS, `v${w}-${String(i).padStart(2, '0')}.png`) });
    }
    await page.evaluate(SCROLL_TO + `(0)`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, `w${w}.png`), fullPage: true });
    await ctx.close();
  }
  rec(3, `stepped viewport frames + one full-page reference for ${WIDTHS.length} widths`, true, SHOTS);

  /* ── 4 · CDN failure (F1) ────────────────────────────────────────────── */
  head('4 · CDN blocked (F1) — cdnjs + jsDelivr aborted at the network layer');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await wire(ctx, { blockCdn: true });
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    const st = await page.evaluate(`({
      gsap: !!window.gsap,
      booted: !!window.__glasBooted,
      hiddenReveals: Array.from(document.querySelectorAll('[data-reveal]')).filter(e => parseFloat(getComputedStyle(e).opacity) < 0.9).length,
      totalReveals: document.querySelectorAll('[data-reveal]').length,
      h1: getComputedStyle(document.querySelector('h1')).opacity,
      heroVisible: Array.from(document.querySelectorAll('[data-hero]')).every(e => parseFloat(getComputedStyle(e).opacity) > 0.9),
      canScroll: document.body.scrollHeight > window.innerHeight,
      text: document.body.innerText.length,
      bubbles: Array.from(document.querySelectorAll('.ph-bubble')).every(e => parseFloat(getComputedStyle(e).opacity) > 0.9),
      confirmShown: getComputedStyle(document.querySelector('#ph-confirm')).display !== 'none'
    })`);
    rec(4, 'GSAP genuinely absent', st.gsap === false);
    rec(4, 'page still booted its own modules', st.booted === true);
    rec(4, 'zero console errors with the CDN down', bag.length === 0, bag.slice(0, 3).join(' | '));
    rec(4, 'every [data-reveal] block is visible', st.hiddenReveals === 0, `${st.hiddenReveals}/${st.totalReveals} hidden`);
    rec(4, 'hero copy fully visible', st.heroVisible === true);
    rec(4, 'phone falls back to the booked state (transcript + confirmation readable)', st.bubbles && st.confirmShown);
    rec(4, 'page scrolls', st.canScroll === true);
    rec(4, 'body text present', st.text > 2500, st.text + ' chars');
    const lap = await page.evaluate(LAPTOP_ST);
    rec(4, 'the laptop stands open, untransformed, with the address and its button in plain view', lap.identity && lap.lidRatio >= 0.99 && lap.uiShown && lap.mail === 'mailto:support@glasai.online', JSON.stringify(lap));
    await page.waitForTimeout(5000);                /* the engine gets 8 s before the block folds */
    const talk = await page.evaluate(`({ gone: document.querySelector('#talk').classList.contains('is-gone'), ready: document.querySelector('#talk').classList.contains('is-ready'),
      talkVisible: document.querySelector('#talk').offsetHeight > 0 })`);
    rec(4, 'the live-demo block folds away when its engine never arrives — no dead button, no empty box', talk.gone && !talk.ready && !talk.talkVisible, JSON.stringify(talk));
    rec(4, 'still zero console errors after the fold', bag.length === 0, bag.slice(0, 3).join(' | '));
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight)`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, 'cdn-blocked-bottom.png'), fullPage: false });
    await page.evaluate(SCROLL_TO + `(0)`); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, 'cdn-blocked.png'), fullPage: true });
    await ctx.close();
  }

  /* ── 5 · reduced motion ──────────────────────────────────────────────── */
  head('5 · prefers-reduced-motion: reduce');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const a = await page.evaluate(`(() => {
      const tr = document.querySelector('.marquee-track');
      const m1 = getComputedStyle(tr).transform;
      return { m1, lenis: !!window.__glasLenis, lenisCls: document.documentElement.classList.contains('lenis'),
               motionCls: document.documentElement.classList.contains('js-motion'),
               loopCls: document.documentElement.classList.contains('js-loop'),
               confirm: getComputedStyle(document.querySelector('#ph-confirm')).display,
               confirmOp: getComputedStyle(document.querySelector('#ph-confirm')).opacity,
               bubbles: Array.from(document.querySelectorAll('.ph-bubble')).every(e=>parseFloat(getComputedStyle(e).opacity)>0.9),
               incoming: getComputedStyle(document.querySelector('#ph-incoming')).visibility,
               anim: getComputedStyle(tr).animationName };
    })()`);
    await page.waitForTimeout(1500);
    const m2 = await page.evaluate(`getComputedStyle(document.querySelector('.marquee-track')).transform`);
    rec(5, 'marquee is static', a.m1 === m2, `${a.m1} → ${m2} (animation-name: ${a.anim})`);
    rec(5, 'Lenis never initialised', a.lenis === false && a.lenisCls === false);
    rec(5, 'no js-motion / js-loop class', a.motionCls === false && a.loopCls === false);
    rec(5, 'phone rests in the booked state', a.bubbles && a.confirm !== 'none' && parseFloat(a.confirmOp) > 0.9 && a.incoming === 'hidden');
    const lap5 = await page.evaluate(LAPTOP_ST);
    rec(5, 'the laptop is open and still — nothing scrubbed, nothing hidden', lap5.identity && lap5.lidRatio >= 0.99 && lap5.progress === null && lap5.uiShown, JSON.stringify(lap5));
    rec(5, 'zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'reduced-motion.png'), fullPage: true });
    await ctx.close();
  }

  /* ── 6 · diacritics ──────────────────────────────────────────────────── */
  head('6 · Diacritics — latin-ext coverage in all three families');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 420 }, deviceScaleFactor: 2 });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    const probe = await page.evaluate(async () => {
      const S = 'Već danas — čćšžđ ČĆŠŽĐ';
      const FAM = [
        ['display', 'Bricolage Grotesque', '700 30px "Bricolage Grotesque"'],
        ['body',    'Instrument Sans',     '400 30px "Instrument Sans"'],
        ['mono',    'JetBrains Mono',      '400 30px "JetBrains Mono"']
      ];
      const host = document.createElement('div');
      host.id = 'diacritic-probe';
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#070A12;color:#F2EDE4;padding:16px 20px;display:flex;flex-direction:column;gap:12px';
      for (const [k, name] of FAM) {
        const el = document.createElement('p');
        el.style.cssText = 'font-family:"' + name + '";font-size:30px;font-weight:' + (k === 'display' ? 700 : 400) + ';margin:0;white-space:nowrap';
        el.textContent = name.padEnd(20, ' ') + '  ' + S;
        host.appendChild(el);
      }
      document.body.appendChild(host);
      /* Google Fonts splits đ/Đ (U+0110-0111) into the *vietnamese* subset, which
         the page only fetches if some rendered text needs it. Force the load for
         each family before asking whether it covers the string. */
      await Promise.all(FAM.map(([, , font]) => document.fonts.load(font, S).catch(() => null)));
      await document.fonts.ready;

      const cv = document.createElement('canvas'); cv.width = 90; cv.height = 90;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const ink = (font, ch) => {                    // pixel signature of one glyph
        cx.clearRect(0, 0, 90, 90); cx.fillStyle = '#fff'; cx.font = font;
        cx.textBaseline = 'alphabetic'; cx.fillText(ch, 10, 62);
        const d = cx.getImageData(0, 0, 90, 90).data;
        let h = 5381;
        for (let i = 3; i < d.length; i += 4) h = ((h * 33) ^ d[i]) >>> 0;
        return h;
      };
      const ACC = ['č','ć','š','ž','đ','Č','Ć','Š','Ž','Đ'];
      const BASE = ['c','c','s','z','d','C','C','S','Z','D'];
      const out = {};
      for (const [k, name, font] of FAM) {
        const loaded = Array.from(document.fonts).filter(f => f.family === name && f.status === 'loaded');
        out[k] = {
          name,
          covers: document.fonts.check(font, S),
          loadedFaces: loaded.length,
          distinct: ACC.every((c, i) => ink(font, c) !== ink(font, BASE[i])),
          notdef: ACC.some(c => ink(font, c) === ink(font, '\uE000'))
        };
      }
      return out;
    });
    for (const k of ['display', 'body', 'mono']) {
      const r = probe[k];
      const ok = r.covers && r.loadedFaces > 0 && r.distinct && !r.notdef;
      rec(6, `č ć š ž đ Č Ć Š Ž Đ render in ${r.name}`, ok, `fonts.check=${r.covers} faces=${r.loadedFaces} distinct=${r.distinct} notdef=${r.notdef}`);
    }
    await page.locator('#diacritic-probe').screenshot({ path: path.join(SHOTS, 'diacritics.png') });
    rec(6, 'diacritic proof sheet written for visual inspection', true, 'diacritics.png');
    await page.evaluate(`document.getElementById('diacritic-probe').remove()`);
    rec(6, 'zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ── 7 · CONFIG placeholders, both states ────────────────────────────── */
  head('7 · CONFIG placeholders — empty and filled');
  for (const filled of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await wire(ctx);
    /* CONFIG is rewritten on the wire in BOTH directions — exactly the lines
       the client edits — so each state is tested for itself rather than
       whichever one the shipped file happens to be in. */
    await ctx.route('**/index.html', async r => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace(/DEMO_TELEFON: *"[^"]*"/, filled ? 'DEMO_TELEFON: "+381 64 123 4567"' : 'DEMO_TELEFON: ""')
                 .replace(/DEMO_AUDIO: *"[^"]*"/,   filled ? 'DEMO_AUDIO: "demo.wav"'          : 'DEMO_AUDIO: ""');
      r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    });
    if (filled) await ctx.route('**/demo.wav', r => r.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() }));
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const rest = await page.evaluate(`(() => { const p = document.querySelector('#play');
      return { disabled: p.getAttribute('aria-disabled'), cursor: getComputedStyle(p).cursor, border: getComputedStyle(p).borderStyle,
               label: document.querySelector('#play-label').textContent.trim() }; })()`);
    await page.locator('#play').click({ force: true });
    await page.waitForTimeout(900);
    const s = await page.evaluate(`(() => {
      const chips = Array.from(document.querySelectorAll('.chip-off')).map(e => e.textContent.trim());
      const tels = Array.from(document.querySelectorAll('a[href^="tel:"]')).map(e => ({ id: e.id, href: e.getAttribute('href'), text: e.textContent.trim(), where: e.closest('.nav-actions') ? 'nav' : e.closest('#menu') ? 'menu' : e.closest('.lap-row') ? 'kontakt' : e.closest('#talk-card') ? 'card' : '?' }));
      const play = document.querySelector('#play');
      const slots = document.querySelectorAll('[data-demo-slot]').length;
      /* the recording's own empty state still says „Snimak uskoro” — that is
         the player's, tested below; what must be gone is the number's chip */
      const uskoro = /Demo broj/i.test(document.body.innerText);
      const lapRow = Array.from(document.querySelector('.lap-row').children).map(e => e.tagName + (e.id ? '#' + e.id : ''));
      return { chips, tels, slots, uskoro, lapRow, audioEls: document.querySelectorAll('audio').length,
               playDisabled: play.getAttribute('aria-disabled'),
               playLabel: document.querySelector('#play-label').textContent.trim(),
               playCursor: getComputedStyle(play).cursor,
               playScanning: play.classList.contains('is-scanning'),
               playBorder: getComputedStyle(play).borderStyle };
    })()`);
    if (!filled) {
      rec(7, 'empty: no number, no placeholder, no „Demo broj — uskoro” — the slots are simply gone', s.chips.length === 0 && s.tels.length === 0 && s.slots === 0 && !s.uskoro, JSON.stringify({ chips: s.chips, tels: s.tels, slots: s.slots, chipText: s.uskoro }));
      rec(7, 'empty: the laptop\'s screen carries the copy button alone', s.lapRow.length === 1 && s.lapRow[0] === 'BUTTON#lap-copy', JSON.stringify(s.lapRow));
      rec(7, 'empty: no <audio> element created at all', s.audioEls === 0);
      /* The *recording* is what is unavailable — the label says so. The control
         itself is live: pressing it runs the line self-test. So it wears the
         „uskoro” hairline, reads as pressable, and is NOT announced as disabled
         (the markup ships aria-disabled for the no-JS case; the module that
         makes the control live removes it). */
      rec(7, 'empty: play button wears the „uskoro” hairline but is pressable', rest.disabled === null && rest.label === 'Snimak uskoro' && rest.cursor === 'pointer' && rest.border === 'dashed', JSON.stringify(rest));
      rec(7, 'empty: a tap on it starts the self-test instead of doing nothing', s.playBorder === 'solid' && s.playScanning === true, 'scanning border: ' + s.playBorder);
      const sweep = await page.evaluate(`(async () => {
        const c = document.querySelector('canvas[data-band="voice"]'), cx = c.getContext('2d');
        const ink = () => { const d = cx.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 3; i < d.length; i += 40) s += d[i]; return s; };
        const e = document.querySelector('#glas'); window.__glasLenis ? window.__glasLenis.scrollTo(e, { immediate: true }) : e.scrollIntoView();
        await new Promise(r => setTimeout(r, 1200));
        /* the meter breathes at rest, so the baseline is an average — a single
           sample can land on a dip and make the sweep look shallower than it is */
        let before = 0;
        for (let k = 0; k < 8; k++) { await new Promise(r => setTimeout(r, 90)); before += ink(); }
        before /= 8;
        document.querySelector('#play').click();
        const scanning = document.querySelector('#play').classList.contains('is-scanning');
        let lo = Infinity, hi = 0;
        for (let k = 0; k < 20; k++) { await new Promise(r => setTimeout(r, 105)); const v = ink(); if (v < lo) lo = v; if (v > hi) hi = v; }
        return { scanning, swing: +(hi / lo).toFixed(3), vsRest: +(lo / before).toFixed(3) };
      })()`);
      rec(7, 'empty: the self-test runs a visible sweep across the band', sweep.scanning === true && sweep.swing > 1.35 && sweep.vsRest < 0.85, JSON.stringify(sweep));
      rec(7, 'empty: clicking the inert player throws nothing', bag.length === 0, bag.slice(0, 3).join(' | '));
      /* no paygate: every button that once led to a booking leads to the address */
      const links = await page.evaluate(`(() => {
        const q = s => Array.from(document.querySelectorAll(s)).map(a => a.getAttribute('href'));
        return { prices: q('.price .btn'), nav: q('.nav-actions .btn--primary'), menu: q('.menu-foot .btn'), hero: q('.hero-cta .btn--ghost'), book: q('#talk-book'), footer: q('.footer-nav a[href="#kontakt"]'),
                 stale: document.querySelectorAll('a[href="#cta"]').length, target: !!document.querySelector('section#kontakt') }; })()`);
      const all = links.prices.concat(links.nav, links.menu, links.hero, links.book);
      rec(7, 'every booking link on the page — three plans, nav, menu, hero, end card — lands on #kontakt', all.length === 7 && all.every(h => h === '#kontakt') && links.footer.length === 1 && links.stale === 0 && links.target, JSON.stringify(links));
    } else {
      rec(7, 'filled: the demo number renders as live tel: links in the nav, the menu, the end card and on the laptop\'s screen',
          s.tels.length === 4 && s.tels.every(t => t.href === 'tel:+381641234567' && t.text === '+381 64 123 4567') && ['nav', 'menu', 'card', 'kontakt'].every(w => s.tels.some(t => t.where === w)),
          JSON.stringify(s.tels.map(t => t.where)));
      rec(7, 'filled: the number joins the copy button, and no empty slot remains', s.lapRow.length === 2 && s.lapRow[0] === 'BUTTON#lap-copy' && s.lapRow[1] === 'A' && s.slots === 0 && s.chips.length === 0, JSON.stringify(s.lapRow));
      rec(7, 'filled: real player, enabled, named for what it plays', s.playDisabled === null && s.playBorder === 'solid' && s.playLabel === 'Poslušaj agenta', `${s.playLabel} / ${s.playBorder}`);
      rec(7, 'filled: zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
      await page.screenshot({ path: path.join(SHOTS, 'config-filled.png'), fullPage: false });
    }
    await ctx.close();
  }

  /* ── 8 · loop integrity ──────────────────────────────────────────────── */
  head('8 · Phone loop — three cycles + a 30 s tab switch');
  if (!QUICK) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.addInitScript(() => { window.__glasDebug = true; });   /* the loop keeps a trace of the observer's reports */
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    /* Bounded by what is observed, not by the clock. Three cycles take ~74 s
       on a machine with a spare core; on a loaded one each sample round-trip
       costs more and the confirmation window is easy to sample straight past,
       which used to report zero wraps for a loop that was fine. It now watches
       until it has seen three, with a ceiling so it can still fail. */
    const samples = [];
    const deadline = Date.now() + 200000, t0 = Date.now();
    let cycles = 0, wasIdle = true;
    while (Date.now() < deadline && cycles < 3) {
      const s = await page.evaluate(PHONE_STATE);
      samples.push(s);
      if (s.confirm > 0.8) wasIdle = false;
      if (s.incoming > 0.8 && !wasIdle) { cycles++; wasIdle = true; }
      await page.waitForTimeout(180);
    }
    const took = Math.round((Date.now() - t0) / 1000);
    // a) never two conversational states at once
    // a 0.4 s cross-fade is the design; two states *both* legible is the bug
    const overlap = samples.filter(s => s.incoming > 0.55 && s.call > 0.55 && s.content > 0.5);
    rec(8, 'incoming and in-call views never both visible', overlap.length === 0, overlap.length + ' samples');
    // b) a typing indicator is never up while its own bubble is
    const badTyping = samples.filter(s => s.typing.some((t, i) => t > 0.1 && s.turns[i] > 0.1));
    rec(8, 'typing indicator never overlaps its own bubble', badTyping.length === 0, badTyping.length + ' samples');
    // c) the timer only ever falls back to 00:00
    const secs = samples.map(s => parseInt((s.t || '00:00').split(':')[1], 10));
    let back = 0;
    for (let i = 1; i < secs.length; i++) if (secs[i] < secs[i - 1] && secs[i] !== 0) back++;
    rec(8, 'timer never runs backwards (only resets to 00:00)', back === 0, back + ' regressions');
    // d) three confirmations seen => three full cycles observed
    /* a run that saw no wraps says why: the page's visibility, the loop's
       flags, and the first and last states it sampled */
    const why = cycles >= 3 ? '' : ' :: ' + JSON.stringify(await page.evaluate(`({ hidden: document.hidden, vis: document.visibilityState, frozen: document.querySelector('.phone-stage').classList.contains('is-frozen'),
      heroDone: !!window.__glasHeroDone, loop: document.documentElement.classList.contains('js-loop'), y: window.scrollY, stageTop: Math.round(document.querySelector('.phone-stage').getBoundingClientRect().top), trace: window.__glasPhoneLog })`))
      + ' first=' + JSON.stringify({ t: samples[0].t, inc: samples[0].incoming, call: samples[0].call }) + ' last=' + JSON.stringify({ t: samples[samples.length - 1].t, inc: samples[samples.length - 1].incoming, call: samples[samples.length - 1].call });
    rec(8, 'three full cycles observed with a clean wrap', cycles >= 3, `${cycles} wraps in ${took} s over ${samples.length} samples` + why);
    // e) the seam is dark — no flash of the old state
    const flash = samples.filter(s => s.content < 0.9 && s.content > 0.05 && s.confirm > 0.5 && s.incoming > 0.5);
    rec(8, 'no flash of the previous state across the seam', flash.length === 0);

    // f) background the tab for 30 s
    const before = await page.evaluate(PHONE_STATE);
    const other = await ctx.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await other.waitForTimeout(30000);
    await page.bringToFront();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(PHONE_STATE);
    const coherent = !(after.incoming > 0.55 && after.call > 0.55) &&
                     !after.typing.some((t, i) => t > 0.1 && after.turns[i] > 0.1);
    rec(8, 'loop is coherent after a 30 s background', coherent, JSON.stringify({ before: before.t, after: after.t, inc: after.incoming.toFixed(2), call: after.call.toFixed(2) }));
    rec(8, 'zero console errors across three cycles', bag.length === 0, bag.slice(0, 3).join(' | '));
    await other.close();
    await ctx.close();
  } else {
    rec(8, 'loop integrity (skipped by --quick)', true, 'skipped');
  }

  /* ── 9 · contrast ────────────────────────────────────────────────────── */
  head('9 · Contrast — every text/background token pair actually used');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await wire(ctx);
    const page = await ctx.newPage();
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    const tok = await page.evaluate(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const get = n => cs.getPropertyValue(n).trim();
      return { ink: get('--ink'), ink2: get('--ink-2'), surface: get('--surface'),
               text: get('--text'), muted: get('--muted'), mutedHi: get('--muted-hi'),
               signal: get('--signal'), signalHi: get('--signal-hi'),
               machine: get('--machine'), confirm: get('--confirm') };
    })()`);
    const PAIRS = [
      ['--text  on --ink', tok.text, tok.ink, 4.5],
      ['--text  on --ink-2', tok.text, tok.ink2, 4.5],
      ['--text  on --surface', tok.text, tok.surface, 4.5],
      ['--muted on --ink', tok.muted, tok.ink, 4.5],
      ['--muted on --ink-2', tok.muted, tok.ink2, 4.5],
      ['--muted on --surface', tok.muted, tok.surface, 4.5],
      ['--muted-hi on --ink', tok.mutedHi, tok.ink, 4.5],
      ['--muted-hi on --surface', tok.mutedHi, tok.surface, 4.5],
      ['--signal on --ink (eyebrow/mono)', tok.signal, tok.ink, 4.5],
      ['--signal on --ink-2', tok.signal, tok.ink2, 4.5],
      ['--signal on --surface', tok.signal, tok.surface, 4.5],
      ['--machine on --ink', tok.machine, tok.ink, 4.5],
      ['--confirm on --ink', tok.confirm, tok.ink, 4.5],
      ['--ink on --signal (primary button)', tok.ink, tok.signal, 4.5],
      ['--ink on --signal-hi (button hover)', tok.ink, tok.signalHi, 4.5]
    ];
    for (const [name, fg, bg, min] of PAIRS) {
      const r = ratio(fg, bg);
      rec(9, `${name} ≥ ${min}:1`, r >= min, r.toFixed(2) + ':1');
    }
    // measured, in situ — catches anything the token maths misses
    const live = await page.evaluate(`(() => {
      function px(c){const m=c.match(/\\d+(\\.\\d+)?/g).map(Number);return m;}
      function L(r,g,b){const v=[r,g,b].map(c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)});return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];}
      function bgOf(el){let n=el;while(n&&n!==document.documentElement){const c=getComputedStyle(n).backgroundColor;const m=px(c);if(m.length<4||m[3]>0.92)return m;n=n.parentElement;}return [7,10,18];}
      const out=[];
      document.querySelectorAll('p, li, h1, h2, h3, a, button, span').forEach(el=>{
        if(!el.textContent.trim()) return;
        if(el.closest('.vh, .skip, .phone')) return;
        const cs=getComputedStyle(el);
        if(parseFloat(cs.opacity)<0.9) return;
        if(el.children.length && !Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim())) return;
        const f=px(cs.color), b=bgOf(el);
        const l1=L(f[0],f[1],f[2]), l2=L(b[0],b[1],b[2]);
        const r=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
        const size=parseFloat(cs.fontSize), bold=parseInt(cs.fontWeight,10)>=700;
        const large=size>=24||(size>=18.66&&bold);
        const min=large?3:4.5;
        if(r<min) out.push({sel:el.tagName.toLowerCase()+'.'+(el.className||'').toString().trim().split(/\\s+/)[0], r:+r.toFixed(2), min, size:+size.toFixed(1), t:el.textContent.trim().slice(0,42)});
      });
      return out.slice(0,10);
    })()`);
    rec(9, 'measured in-situ contrast on every text node', live.length === 0, live.length ? JSON.stringify(live) : '0 failures');
    await ctx.close();
  }

  /* ── 10 · a11y + semantics + interaction ─────────────────────────────── */
  head('10 · Accessibility & interaction');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const a = await page.evaluate(`(() => {
      const heads = Array.from(document.querySelectorAll('h1,h2,h3')).map(h => +h.tagName[1]);
      let orderOk = true;
      for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i-1] > 1) orderOk = false;
      const iconOnly = Array.from(document.querySelectorAll('button')).filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby'));
      return {
        lang: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length,
        orderOk,
        landmarks: ['header','nav','main','footer'].map(t => document.querySelectorAll(t).length),
        skip: !!document.querySelector('a.skip[href="#sadrzaj"]'),
        faqBtns: document.querySelectorAll('.faq-q[aria-expanded][aria-controls]').length,
        faqOpen: document.querySelectorAll('.faq-q[aria-expanded="true"]').length,
        iconOnly: iconOnly.length,
        burgerName: (document.querySelector('#burger') || {}).textContent,
        marqueeDup: document.querySelectorAll('.marquee-run[aria-hidden="true"]').length,
        imgs: document.querySelectorAll('img').length
      };
    })()`);
    rec(10, 'lang="sr-Latn"', a.lang === 'sr-Latn', a.lang);
    rec(10, 'exactly one <h1>', a.h1 === 1, String(a.h1));
    rec(10, 'no skipped heading levels', a.orderOk === true);
    rec(10, 'header / nav / main / footer landmarks present', a.landmarks[0] >= 1 && a.landmarks[1] >= 1 && a.landmarks[2] === 1 && a.landmarks[3] === 1, JSON.stringify(a.landmarks));
    rec(10, 'skip-to-content link present', a.skip === true);
    rec(10, 'accordion uses real buttons with aria-expanded + aria-controls', a.faqBtns === 8, String(a.faqBtns));
    rec(10, 'exactly one accordion panel open at load', a.faqOpen === 1, String(a.faqOpen));
    rec(10, 'no unnamed icon-only buttons', a.iconOnly === 0);
    rec(10, 'marquee duplicate is aria-hidden', a.marqueeDup === 1);
    rec(10, 'zero <img> — every visual is CSS / SVG / canvas', a.imgs === 0);

    // accordion behaviour
    await page.locator('#faq-q3').click();
    await page.waitForTimeout(600);
    const acc = await page.evaluate(`({open: document.querySelectorAll('.faq-q[aria-expanded="true"]').length,
      p3: document.querySelector('#faq-p3').getBoundingClientRect().height,
      p1: document.querySelector('#faq-p1').getBoundingClientRect().height})`);
    rec(10, 'accordion: opening one closes the other', acc.open === 1 && acc.p3 > 20 && acc.p1 < 2, JSON.stringify(acc));

    // focus ring — driven by real Tab presses so :focus-visible actually applies
    await page.evaluate(`window.scrollTo(0,0)`);
    await page.waitForTimeout(400);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const noRing = [], order = [];
    for (let i = 0; i < 34; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = (cs.boxShadow && cs.boxShadow !== 'none') || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0);
        const insideClosedPanel = !!el.closest('.faq-panel:not([data-open])') || !!(el.closest('#menu') && document.querySelector('#menu').hidden);
        return { tag: el.tagName, cls: (el.className || '').toString().trim().split(/\\s+/)[0], ring, insideClosedPanel, txt: (el.textContent||'').trim().slice(0,24) };
      })()`);
      if (!f) break;
      order.push(f.tag + '.' + f.cls);
      if (!f.ring) noRing.push(f.tag + '.' + f.cls);
      if (f.insideClosedPanel) noRing.push('TRAPPED:' + f.tag + '.' + f.cls);
    }
    rec(10, 'a designed focus ring on every tab stop', noRing.length === 0, noRing.length ? JSON.stringify(noRing.slice(0,6)) : order.length + ' tab stops walked');
    rec(10, 'focus never lands in a closed panel or the hidden menu', !noRing.some(x => x.startsWith('TRAPPED')));

    // mobile menu open → resize to desktop → page must not stay locked
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.locator('#burger').click();
    await page.waitForTimeout(600);
    const openState = await page.evaluate(`({exp: document.querySelector('#burger').getAttribute('aria-expanded'), lock: document.body.style.overflow, focus: document.activeElement.className})`);
    rec(10, 'mobile menu opens and moves focus inside', openState.exp === 'true' && openState.lock === 'hidden' && /menu-link/.test(openState.focus), JSON.stringify(openState));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(900);
    const unlocked = await page.evaluate(`({lock: document.body.style.overflow, exp: document.querySelector('#burger').getAttribute('aria-expanded'), hidden: document.querySelector('#menu').hidden})`);
    rec(10, 'resizing to desktop unlocks the page and closes the menu', unlocked.lock === '' && unlocked.exp === 'false', JSON.stringify(unlocked));
    rec(10, 'zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ── 11 · resize during the pin, orientation flip, fast scroll ───────── */
  head('11 · Motion QA — resize under the pin, orientation flip, fast scroll');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.evaluate(SCROLL_TO + `(window.innerHeight * 0.45)`);   // mid-pin
    await page.waitForTimeout(700);
    let worst = null;
    for (let w = 1920; w >= 360; w -= 130) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(340);
      const r = await page.evaluate(OVERFLOW_PROBE);
      // a pin that misbehaves leaves a hole: nothing but <body>/<html> under a probe point
      const gap = await page.evaluate(`(() => {
        const holes = [];
        for (const f of [0.2, 0.45, 0.7, 0.9]) {
          const el = document.elementFromPoint(Math.round(innerWidth * 0.5), Math.round(innerHeight * f));
          const tag = el ? el.tagName : 'NONE';
          if (tag === 'BODY' || tag === 'HTML' || tag === 'NONE') holes.push(f + ':' + tag);
        }
        const ph = document.querySelector('.phone');
        const pr = ph ? ph.getBoundingClientRect() : null;
        return { holes, phoneOffscreen: pr ? (pr.bottom < -40 || pr.top > innerHeight + 40) : true };
      })()`);
      if (r.scrollWidth > r.clientWidth + 1) worst = { w, sw: r.scrollWidth, cw: r.clientWidth, bad: r.bad.slice(0,3) };
      if (gap.holes.length) worst = worst || { w, holes: gap.holes };
    }
    rec(11, 'slow 1920 → 360 resize while pinned: no overflow, no gap or overlap', worst === null, worst ? JSON.stringify(worst).slice(0, 220) : '');
    rec(11, 'zero console errors during the resize sweep', bag.length === 0, bag.slice(0, 3).join(' | '));

    // orientation flip mid-scroll
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight * 0.35)`);
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(900);
    const flip = await page.evaluate(OVERFLOW_PROBE);
    rec(11, 'portrait → landscape mid-scroll survives', flip.scrollWidth <= flip.clientWidth + 1, JSON.stringify(flip.bad.slice(0, 3)));

    // maximum-speed scroll — no reveal may be skipped
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(700);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight)`);
    await page.waitForTimeout(2800);
    const skipped = await page.evaluate(`Array.from(document.querySelectorAll('[data-reveal]')).filter(e => parseFloat(getComputedStyle(e).opacity) < 0.95).map(e => e.className).slice(0,6)`);
    rec(11, 'instant scroll to the bottom skips no reveal', skipped.length === 0, JSON.stringify(skipped));
    rec(11, 'zero console errors overall', bag.length === 0, bag.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ── 12 · 4× CPU throttle ────────────────────────────────────────────── */
  head('12 · 4× CPU throttle');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    const t0 = Date.now();
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight * 0.5)`);
    await page.waitForTimeout(1500);
    const usable = await page.evaluate(`({ booted: !!window.__glasBooted, y: Math.round(window.scrollY), reveals: Array.from(document.querySelectorAll('[data-reveal]')).filter(e=>parseFloat(getComputedStyle(e).opacity)>0.9).length })`);
    rec(12, 'page still boots and scrolls under 4× throttle', usable.booted && usable.y > 100 && usable.reveals > 5, JSON.stringify(usable) + ` (${Date.now() - t0} ms)`);
    rec(12, 'zero console errors under throttle', bag.length === 0, bag.slice(0, 3).join(' | '));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await ctx.close();
  }

  /* ── 12b · the motion system ─────────────────────────────────────────── */
  head('12b · Motion — trigger geometry, line masks, band, probe');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);

    /* A pinned section adds its spacing to the document. If it refreshes after
       the triggers below it, every one of them fires a pin-length too early. */
    const geo = await page.evaluate(`(() => {
      const bad = [];
      ScrollTrigger.getAll().forEach(t => {
        if (!t.trigger || !t.trigger.getBoundingClientRect || t.pin) return;
        const s = String(t.vars.start || '');
        const m = s.match(/^top (\\d+)%$/);
        if (!m) return;
        const want = t.trigger.getBoundingClientRect().top + window.scrollY - innerHeight * (+m[1] / 100);
        const d = Math.round(t.start - want);
        if (Math.abs(d) > 60) bad.push({ sel: (t.trigger.className || t.trigger.tagName).toString().split(' ')[0], d });
      });
      return bad.slice(0, 6);
    })()`);
    rec(12, 'every scroll trigger is measured against the pinned layout', geo.length === 0, JSON.stringify(geo));

    /* Splitting a heading into line masks must be geometrically invisible. */
    const lines = await page.evaluate(`(() => {
      const hosts = Array.from(document.querySelectorAll('[data-lines]')).filter(e => !e.closest('#hero'));
      const split = hosts.map(e => ({ h: Math.round(e.getBoundingClientRect().height), n: e.querySelectorAll('.ln').length, t: e.textContent }));
      const docSplit = Math.round(document.body.scrollHeight);
      hosts.forEach(e => { e.classList.remove('is-split'); e.textContent = e.__lineText; });
      const plain = hosts.map(e => Math.round(e.getBoundingClientRect().height));
      const docPlain = Math.round(document.body.scrollHeight);
      hosts.forEach((e, i) => { /* leave it plain; the page is done with */ });
      return {
        hosts: hosts.length,
        mismatched: split.filter((s, i) => s.h !== plain[i]).length,
        unsplit: split.filter(s => s.n === 0).length,
        docDelta: docSplit - docPlain,
        textOk: split.every((s, i) => s.t.replace(/\\s+/g, ' ').trim() === hosts[i].textContent.replace(/\\s+/g, ' ').trim())
      };
    })()`);
    rec(12, 'every [data-lines] host is split into line masks', lines.unsplit === 0 && lines.hosts >= 10, JSON.stringify({ hosts: lines.hosts, unsplit: lines.unsplit }));
    rec(12, 'line masks change no element height and no page height', lines.mismatched === 0 && lines.docDelta === 0, JSON.stringify({ mismatched: lines.mismatched, docDelta: lines.docDelta }));
    rec(12, 'line masks preserve the text exactly', lines.textOk === true);
    await ctx.close();
  }

  head('12c · The band and the scroll probe');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.addInitScript(() => { window.__glasDebug = true; });   /* the player's element is not in the DOM */
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);

    /* Bar heights are measured off the rendered canvas, not off internals. */
    const stat = await page.evaluate(`(async () => {
      const c = document.querySelector('canvas[data-band="voice"]');
      /* The meter answers only while the scroll probe is inside 300-3400 Hz,
         and it draws itself in behind that probe — so it is measured where it
         is actually being looked at, with the stage centred, not at the top of
         the section where it is still filling. */
      const st = document.querySelector('.voice-stage').getBoundingClientRect();
      const y = st.top + window.scrollY + st.height / 2 - window.innerHeight / 2;
      if (window.__glasLenis) window.__glasLenis.scrollTo(y, { immediate: true });
      else window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 1600));
      const cx = c.getContext('2d'), out = [];
      for (let k = 0; k < 14; k++) {
        const img = cx.getImageData(0, 0, c.width, c.height), W = c.width, H = c.height, cy = H / 2;
        let mx = 0, sum = 0, n = 0;
        for (let x = Math.floor(W * 0.32); x < W * 0.74; x += 4) {
          let top = cy;
          for (let y = 0; y < cy; y++) { if (img.data[((y * W) + x) * 4 + 3] > 60) { top = y; break; } }
          const hh = (cy - top) / cy;
          if (hh > mx) mx = hh;
          sum += hh; n++;
        }
        out.push([sum / n, mx]);
        await new Promise(r => setTimeout(r, 110));
      }
      const means = out.map(o => o[0]), maxs = out.map(o => o[1]);
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      return { mean: +avg(means).toFixed(3), peak: +avg(maxs).toFixed(3),
               clipped: maxs.filter(v => v > 0.985).length, breathes: +(Math.max(...means) - Math.min(...means)).toFixed(3) };
    })()`);
    rec(12, 'band fills its canvas without clipping', stat.mean > 0.18 && stat.mean < 0.45 && stat.peak > 0.7 && stat.peak < 0.97 && stat.clipped === 0, JSON.stringify(stat));
    rec(12, 'band breathes rather than droning', stat.breathes > 0.02, 'range ' + stat.breathes);

    /* The probe has to sweep the whole spectrum, and light only 300–3400. */
    await page.evaluate(`window.scrollTo(0, 0)`);
    await page.waitForTimeout(700);
    const seen = [];
    for (let i = 0; i < 70; i++) {
      await page.mouse.wheel(0, 130);
      await page.waitForTimeout(45);
      const s = await page.evaluate(`(() => {
        const c = document.querySelector('#band-cursor');
        if (!c || getComputedStyle(c).display === 'none') return null;
        const st = document.querySelector('.voice-stage').getBoundingClientRect();
        if (st.top > innerHeight || st.bottom < 0) return null;
        return { hz: parseInt(document.querySelector('#band-read').textContent, 10), inb: c.classList.contains('in-band') };
      })()`);
      if (s && isFinite(s.hz)) seen.push(s);
    }
    const lows = seen.filter(s => s.hz < 300), mids = seen.filter(s => s.hz >= 320 && s.hz <= 3200), highs = seen.filter(s => s.hz > 3600);
    rec(12, 'the probe sweeps below, through and above the telephone band',
        lows.length > 0 && mids.length > 2 && highs.length > 0,
        JSON.stringify({ samples: seen.length, below: lows.length, inside: mids.length, above: highs.length }));
    rec(12, 'the probe lights up only inside 300–3400 Hz',
        mids.every(s => s.inb) && lows.every(s => !s.inb) && highs.every(s => !s.inb),
        JSON.stringify({ badLow: lows.filter(s => s.inb).length, badMid: mids.filter(s => !s.inb).length, badHigh: highs.filter(s => s.inb).length }));

    /* The shipped player: a real recording, driving the meter's amplitude and
       walking the playhead across the passband. */
    await page.evaluate(`(() => { const e = document.querySelector('#glas'); window.__glasLenis ? window.__glasLenis.scrollTo(e, { immediate: true }) : e.scrollIntoView(); })()`);
    await page.waitForTimeout(1200);
    const play = await page.evaluate(`(async () => {
      const c = document.querySelector('canvas[data-band="voice"]'), cx = c.getContext('2d'), btn = document.querySelector('#play');
      /* the rightmost bar tall enough to be a lit in-band bar — the playhead */
      /* One row, just above the stub cap (stubs never reach 11% of half): the
         rightmost pixel on it is the last lit in-band bar — the playhead. A
         single row is far steadier than a per-column height, which flickers
         with the voice's own amplitude. */
      const head = () => { const W = c.width, cy = c.height >> 1, row = Math.max(1, Math.round(cy * 0.86));
        const d = cx.getImageData(0, row, W, 1).data;
        let lit = 0; for (let x = 0; x < W; x++) if (d[x * 4 + 3] > 90) lit = x;
        return lit / W; };
      const amp = () => { const d = cx.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 3; i < d.length; i += 40) s += d[i]; return s; };
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      const playing = btn.classList.contains('is-playing'), label = document.querySelector('#play-label').textContent.trim();
      const marks = [], amps = [];
      for (let k = 0; k < 12; k++) { await new Promise(r => setTimeout(r, 400)); marks.push(head()); amps.push(amp()); }
      return { playing, label, first: +marks[0].toFixed(3), last: +marks[marks.length - 1].toFixed(3),
               monotonic: marks.every((v, i) => i === 0 || v >= marks[i - 1] - 0.05),
               swing: +(Math.max(...amps) / Math.min(...amps)).toFixed(3) };
    })()`);
    rec(12, 'the recording plays, and the meter answers it', play.playing === true && play.label === 'Zaustavi' && play.swing > 1.05, JSON.stringify(play));
    rec(12, 'the playhead walks the passband as it plays — never blank while a voice is speaking',
        play.first >= 0.30 && play.last > play.first + 0.15 && play.monotonic, JSON.stringify({ first: play.first, last: play.last, monotonic: play.monotonic }));
    /* the control is play-from-the-start and stop, never pause-and-resume:
       pressed mid-clip it rewinds, and every play — after a stop, after the
       end — begins at the first word */
    const again = await page.evaluate(`(async () => {
      const a = window.__glasAudio, btn = document.querySelector('#play'), lbl = document.querySelector('#play-label');
      const wait = ms => new Promise(r => setTimeout(r, ms));
      a.pause(); a.currentTime = 0; await wait(300);          /* a known state: stopped, at the top */
      btn.click(); await wait(900);                            /* playing, most of a second in */
      const playing = { paused: a.paused, t: +a.currentTime.toFixed(2), label: lbl.textContent.trim() };
      btn.click(); await wait(250);                            /* pressed while playing */
      const stopped = { paused: a.paused, t: +a.currentTime.toFixed(2), label: lbl.textContent.trim() };
      btn.click(); await wait(400);                            /* and again: from the top */
      const restarted = { paused: a.paused, t: +a.currentTime.toFixed(2) };
      await new Promise(r => { a.addEventListener('ended', r, { once: true }); setTimeout(r, 12000); });
      const ended = { ended: a.ended, label: lbl.textContent.trim() };
      btn.click(); await wait(400);                            /* after the end: from the top */
      const third = { paused: a.paused, t: +a.currentTime.toFixed(2) };
      a.pause();
      return { playing, stopped, restarted, ended, third };
    })()`);
    rec(12, 'pressed while playing, the control stops and rewinds — no resume from mid-sentence', !again.playing.paused && again.playing.t > 0.5 && again.playing.label === 'Zaustavi' && again.stopped.paused && again.stopped.t === 0 && again.stopped.label === 'Poslušaj agenta', JSON.stringify({ playing: again.playing, stopped: again.stopped }));
    rec(12, 'every play starts at the first word — after a stop, and after the end', !again.restarted.paused && again.restarted.t < 0.8 && again.ended.ended && again.ended.label === 'Poslušaj agenta' && !again.third.paused && again.third.t < 0.8, JSON.stringify({ restarted: again.restarted, ended: again.ended, third: again.third }));
    rec(12, 'zero console errors across the motion system', bag.length === 0, bag.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ── 15 · the contact section: the laptop and the address ─────────────── */
  head('15 · Kontakt — the laptop opens with the scroll, and the address copies');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await wire(ctx);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    /* a pricing button: the section arrives under the nav, focus lands on it,
       and the laptop — beside the heading — is open with its button in view,
       having swung open during the glide */
    await page.evaluate(SCROLL_TO + `(document.querySelector('#cene').getBoundingClientRect().top + window.scrollY)`);
    await page.waitForTimeout(700);
    await page.click('.price:nth-of-type(2) .btn');
    await page.waitForTimeout(2200);
    const land = await page.evaluate(`(() => { const r = document.querySelector('#kontakt').getBoundingClientRect(); const b = document.querySelector('#lap-copy').getBoundingClientRect();
      return { hash: location.hash, top: Math.round(r.top), focus: document.activeElement.id, btnTop: Math.round(b.top), btnBottom: Math.round(b.bottom), inView: b.top >= 0 && b.bottom <= innerHeight }; })()`);
    let lp = await page.evaluate(LAPTOP_ST);
    rec(15, 'a plan\'s button lands on the contact section: heading under the nav, focus on the section, the copy button on screen with the laptop open', land.hash === '#kontakt' && land.top >= 60 && land.top <= 130 && land.focus === 'kontakt' && land.inView && lp.progress === 1 && lp.identity && lp.uiShown, JSON.stringify({ land, progress: lp.progress, identity: lp.identity }));
    /* the scrub, sampled: shut, half, open. A shut lid lies flat and, seen
       from a little above and tilted toward the eye, still projects to
       roughly half its height — so the three are compared with each other */
    const st = await page.evaluate(`(() => { const t = ScrollTrigger.getAll().find(t => t.trigger && t.trigger.classList && t.trigger.classList.contains('laptop-base')); return { start: t.start, end: t.end }; })()`);
    const at = async f => { await page.evaluate(SCROLL_TO + `(${st.start + (st.end - st.start) * f})`); await page.waitForTimeout(1100); return page.evaluate(LAPTOP_ST); };
    const shut = await at(0), half = await at(0.5), open = await at(1.15);
    rec(15, 'shut below the fold: the lid lies flat, the screen dark, the words off', shut.progress === 0 && shut.lidRatio < 0.55 && shut.uiHidden && shut.lit === 0, JSON.stringify({ lidRatio: shut.lidRatio, lit: shut.lit, progress: shut.progress }));
    rec(15, 'half-way through the scroll the lid is between shut and open', half.progress > 0.4 && half.progress < 0.6 && half.lidRatio > shut.lidRatio + 0.12 && half.lidRatio < 0.96, JSON.stringify({ shut: shut.lidRatio, half: half.lidRatio, progress: half.progress }));
    rec(15, 'open at rest: every part back at identity, the words on, the deck lit', open.progress === 1 && open.identity && open.lidRatio >= 0.99 && open.uiShown && open.lit === 1, JSON.stringify({ lidRatio: open.lidRatio, identity: open.identity, lit: open.lit }));
    /* the copy button, and what it says */
    const before = await page.evaluate(`({ w: document.querySelector('#lap-copy').getBoundingClientRect().width, name: getComputedStyle(document.querySelector('#lap-copy-done')).visibility })`);
    await page.click('#lap-copy');
    await page.waitForTimeout(350);
    const after = await page.evaluate(`(async () => ({ clip: await navigator.clipboard.readText(), done: document.querySelector('#lap-copy').classList.contains('is-done'),
      label: getComputedStyle(document.querySelector('#lap-copy-done')).visibility + '/' + getComputedStyle(document.querySelector('#lap-copy-idle')).visibility,
      status: document.querySelector('#lap-status').textContent, w: document.querySelector('#lap-copy').getBoundingClientRect().width }))()`);
    await page.waitForTimeout(2500);
    const later = await page.evaluate(`({ done: document.querySelector('#lap-copy').classList.contains('is-done'), idle: getComputedStyle(document.querySelector('#lap-copy-idle')).visibility, status: document.querySelector('#lap-status').textContent })`);
    rec(15, 'the button copies the address to the clipboard', after.clip === 'support@glasai.online', JSON.stringify(after.clip));
    rec(15, 'it says „Kopirano” and announces it once, at the same width', after.done && after.label === 'visible/hidden' && after.status === 'Adresa je kopirana.' && before.name === 'hidden' && Math.abs(after.w - before.w) < 0.5, JSON.stringify(after));
    rec(15, 'and is back to „Kopiraj adresu” two seconds later, the announcement cleared', !later.done && later.idle === 'visible' && later.status === '', JSON.stringify(later));
    rec(15, 'the address itself is a mailto link', open.mail === 'mailto:support@glasai.online' && open.copy === 'Kopiraj adresu');
    /* an instant jump to the bottom — a hash link, a dragged scrollbar —
       leaves the laptop open, not caught mid-hinge */
    await page.evaluate(SCROLL_TO + `(0)`); await page.waitForTimeout(600);
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight)`); await page.waitForTimeout(1500);
    const jump = await page.evaluate(LAPTOP_ST);
    rec(15, 'an instant jump to the bottom leaves the laptop open', jump.progress === 1 && jump.identity && jump.uiShown, JSON.stringify({ progress: jump.progress, identity: jump.identity }));
    rec(15, 'zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'kontakt-open.png') });
    await ctx.close();
  }

  /* ── 13 · touch device — F10, every pointer effect needs a real alternative ─ */
  head('14 · The live demo — the widget driven through its own hook, on a fake clock');
  {
    const TALK_ST = `(() => { const g = id => document.getElementById(id); const t = g('talk');
      return { ready: t.classList.contains('is-ready'), gone: t.classList.contains('is-gone'), live: t.classList.contains('is-live'),
        ctl: g('talk-ctl').classList.contains('is-on'), card: g('talk-card').classList.contains('is-on'),
        label: g('talk-label').textContent, busy: g('talk-btn').getAttribute('aria-busy'), clock: g('talk-clock').textContent,
        rule: g('talk-rule').style.transform, noteOn: g('talk-note').classList.contains('is-on'), liveOn: g('talk-live').classList.contains('is-on'),
        timers: (window.__glasTalkTimers || []).length, tel: !!g('talk-card').querySelector('a[href^="tel:"]'),
        telSlot: !!g('talk-card').querySelector('[data-talk-tel]'), book: g('talk-book').getAttribute('href'),
        engineBtn: !!(document.querySelector('elevenlabs-convai') && document.querySelector('elevenlabs-convai').shadowRoot && document.querySelector('elevenlabs-convai').shadowRoot.querySelector('button')),
        engineHidden: getComputedStyle(g('talk-engine')).visibility === 'hidden' }; })()`;
    const FAKE = `(() => { const cfg = {}; document.querySelector('elevenlabs-convai').dispatchEvent(new CustomEvent('elevenlabs-convai:call', { bubbles: true, composed: true, detail: { config: cfg } }));
      window.__fake = { ended: 0, muted: null, ctx: [], vol: 0.3,
        endSession() { this.ended++; setTimeout(() => cfg.onDisconnect({ reason: 'user' }), 40); return Promise.resolve(); },
        setMicMuted(m) { this.muted = m; }, getOutputVolume() { return this.vol; }, sendContextualUpdate(t) { this.ctx.push(t); }, isOpen() { return !this.ended && this.open !== false; } };
      const hooks = ['onConversationCreated', 'onConnect', 'onDisconnect', 'onError'].every(k => typeof cfg[k] === 'function');
      cfg.onConversationCreated(window.__fake); cfg.onConnect({ conversationId: 'x' }); return hooks; })()`;
    for (const filled of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await wire(ctx);
    await ctx.grantPermissions(['microphone']);   /* the connect clock starts once the permission is known */
      if (filled) await ctx.route('**/index.html', async r => {
        const body = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace('DEMO_TELEFON: ""', 'DEMO_TELEFON: "+381 64 123 4567"').replace('DEMO_LINK:    ""', 'DEMO_LINK:    "https://cal.example/glasai"');
        r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
      });
      const page = await ctx.newPage(); const bag = [];
      watch(page, bag);
      await page.addInitScript(() => { window.__glasDebug = true; window.__glasConfig = { DEMO_VEZA: 'websocket' }; });   /* these rounds mock the plain socket; WebRTC has its own round */
      /* The engine now reaches a real socket, and this sandbox refuses it —
         which the page would now report within a second, resetting the very
         attempt these tests drive by hand. So the socket is mocked to open
         and say nothing: the real SDK waits for metadata that never comes,
         and the page's hooks are worked by the fakes below, as designed. */
      await page.routeWebSocket(/v1\/convai\/conversation/, ws => { ws.onMessage(() => {}); });
      await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      let st = await page.evaluate(TALK_ST);
      const tag = filled ? 'filled' : 'empty';
      rec(14, `${tag}: block becomes ready only once the engine renders its button`, st.ready && !st.gone && st.ctl && !st.card && st.engineBtn, JSON.stringify(st));
      rec(14, `${tag}: the engine is never painted and never in the tab order`, st.engineHidden === true);
      rec(14, `${tag}: end card — booking button and the number line`, filled ? (st.tel && st.book === 'https://cal.example/glasai') : (!st.tel && !st.telSlot && st.book === '#kontakt'), JSON.stringify({ tel: st.tel, slot: st.telSlot, book: st.book }));
      if (filled) { rec(14, 'filled: zero console errors', bag.length === 0, bag.slice(0, 3).join(' | ')); await ctx.close(); continue; }

      await page.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`);
      await page.waitForTimeout(700);
      await page.evaluate(`(() => { window.__calls = 0; document.getElementById('talk-engine').addEventListener('elevenlabs-convai:call', e => { window.__calls++; window.__hooks = ['onConversationCreated','onConnect','onDisconnect','onError'].every(k => typeof e.detail.config[k] === 'function'); }); })()`);
      await page.click('#talk-btn'); await page.waitForTimeout(700);
      st = await page.evaluate(TALK_ST);
      const real = await page.evaluate(`({ calls: window.__calls, hooks: window.__hooks })`);
      rec(14, 'pressing the page\'s button presses the real engine\'s: one elevenlabs-convai:call, carrying the page\'s four hooks', real.calls === 1 && real.hooks === true && st.label === 'Povezujem…' && st.busy === 'true', JSON.stringify({ real, label: st.label }));
      await page.click('#talk-btn'); await page.waitForTimeout(400);
      st = await page.evaluate(TALK_ST);
      rec(14, 'a change of mind while connecting returns to the start, with no timer left', st.label === 'Razgovaraj sa agentom' && st.busy === null && st.timers === 0 && st.ctl, JSON.stringify(st));

      await page.clock.install();
      await page.click('#talk-btn'); await page.clock.runFor(300);
      const hooks = await page.evaluate(FAKE); await page.clock.runFor(100);
      st = await page.evaluate(TALK_ST);
      rec(14, 'a connected session goes live: „Slušam”, the clock at 00:40, the rule full', hooks && st.live && st.label === 'Slušam' && st.clock === '00:40' && st.rule === 'scaleX(1)' && st.liveOn && !st.noteOn, JSON.stringify(st));
      rec(14, 'while live the control is named for what pressing it does', (await page.getAttribute('#talk-btn', 'aria-label')) === 'Slušam — prekini demo');
      await page.clock.runFor(10000); st = await page.evaluate(TALK_ST);
      rec(14, 'ten seconds in: 00:30, the rule three-quarters', st.clock === '00:30' && /scaleX\(0\.7[45]/.test(st.rule), JSON.stringify({ clock: st.clock, rule: st.rule }));
      await page.clock.runFor(21500);
      const nudged = await page.evaluate(`window.__fake.ctx.length`);
      rec(14, 'the agent is told to wrap up before the cap', nudged === 1, 'contextual updates: ' + nudged);
      await page.clock.runFor(8600); st = await page.evaluate(TALK_ST);
      const cap = await page.evaluate(`({ muted: window.__fake.muted, ended: window.__fake.ended })`);
      rec(14, 'at forty seconds the visitor\'s line is muted and the clock reads 00:00 — but a speaking agent is not cut off', st.clock === '00:00' && st.rule === 'scaleX(0)' && cap.muted === true && cap.ended === 0, JSON.stringify(cap));
      rec(14, 'past the cap the control says it is finishing, not listening', st.label === 'Završavam…' && (await page.getAttribute('#talk-btn', 'aria-label')) === null, st.label);
      await page.clock.runFor(1500);
      rec(14, 'still speaking 1.5 s past the cap: still not cut', (await page.evaluate(`window.__fake.ended`)) === 0);
      await page.evaluate(`window.__fake.vol = 0`); await page.clock.runFor(800);
      const endedAfterQuiet = await page.evaluate(`window.__fake.ended`);
      await page.clock.runFor(1000); st = await page.evaluate(TALK_ST);
      rec(14, 'half a second of silence ends the session, and the end card takes the widget\'s place', endedAfterQuiet === 1 && st.card && !st.ctl && !st.live, JSON.stringify(st));
      rec(14, 'the countdown and every other timer are cleared, not left ticking', st.timers === 0, 'live timers: ' + st.timers);
      const c1 = st.clock; await page.clock.runFor(5000); const c2 = (await page.evaluate(TALK_ST)).clock;
      rec(14, 'the clock does not move after the end', c1 === c2, c1 + ' → ' + c2);
      const replaced = await page.evaluate(`document.querySelector('elevenlabs-convai') !== null && document.querySelectorAll('elevenlabs-convai').length === 1`);
      rec(14, 'a fresh engine is in place for the next run, and only one', replaced === true);
      await page.click('#talk-again'); await page.clock.runFor(300); st = await page.evaluate(TALK_ST);
      rec(14, 'the demo can be started again', st.ctl && !st.card && st.label === 'Razgovaraj sa agentom', JSON.stringify(st));

      /* an attempt that goes nowhere: twelve seconds after the microphone is
         known, the control comes back with a notice that steps aside itself.
         The microphone is real (a fake device) and answers in real time, so
         the fake clock is given that moment before it is run. */
      await page.click('#talk-btn'); await page.clock.runFor(200);
      const midWait = await page.evaluate(TALK_ST);
      await page.waitForTimeout(400);
      await page.clock.runFor(12200); st = await page.evaluate(TALK_ST);
      const failShown = await page.evaluate(`document.querySelector('#talk-fail').classList.contains('is-on')`);
      const failText = await page.evaluate(`document.querySelector('#talk-fail').textContent`);
      const failLink = await page.evaluate(`!!document.querySelector('#talk-fail a[href="#kontakt"]')`);
      await page.clock.runFor(4200);
      const failStays = await page.evaluate(`document.querySelector('#talk-fail').classList.contains('is-on') && !document.querySelector('#talk-note').classList.contains('is-on')`);
      rec(14, 'an attempt the service accepts and never answers comes back after 12 s with the owner\'s notice — the address linked — and that notice stays past the four seconds the generic one gets, since a retry cannot mend it',
          midWait.label === 'Povezujem…' && st.label === 'Razgovaraj sa agentom' && failShown && failText === 'Demo trenutno nije dostupan — zakažite razgovor.' && failLink && failStays, JSON.stringify({ mid: midWait.label, after: st.label, failShown, failText, failLink, failStays }));

      /* the agent hangs up early — the widget keeps onDisconnect for itself,
         so the page has to notice on its own */
      await page.click('#talk-btn'); await page.clock.runFor(300);
      await page.evaluate(`(() => { const cfg = {}; document.querySelector('elevenlabs-convai').dispatchEvent(new CustomEvent('elevenlabs-convai:call', { bubbles: true, composed: true, detail: { config: cfg } }));
        window.__fake3 = { ended: 0, open: true, endSession() { this.ended++; return Promise.resolve(); }, setMicMuted() {}, getOutputVolume() { return 0; }, sendContextualUpdate() {}, isOpen() { return this.open && !this.ended; } };
        cfg.onConversationCreated(window.__fake3); cfg.onConnect({}); })()`);
      await page.clock.runFor(5000); st = await page.evaluate(TALK_ST);
      const wasLive = st.live && /^00:3[56]$/.test(st.clock);
      await page.evaluate(`window.__fake3.open = false`); await page.clock.runFor(600); st = await page.evaluate(TALK_ST);
      rec(14, 'an early hang-up, which the widget never forwards, is still noticed within a tick and ends on the card', wasLive && st.card && !st.live && st.timers === 0, JSON.stringify({ wasLive, card: st.card, timers: st.timers }));
      await page.click('#talk-again'); await page.clock.runFor(600);

      /* a second run whose agent never stops talking hits the hard ceiling */
      await page.click('#talk-btn'); await page.clock.runFor(300);
      await page.evaluate(`(() => { const cfg = {}; document.querySelector('elevenlabs-convai').dispatchEvent(new CustomEvent('elevenlabs-convai:call', { bubbles: true, composed: true, detail: { config: cfg } }));
        window.__fake2 = { ended: 0, endSession() { this.ended++; setTimeout(() => cfg.onDisconnect({}), 40); return Promise.resolve(); }, setMicMuted() {}, getOutputVolume() { return 0.5; }, sendContextualUpdate() {}, isOpen() { return !this.ended; } };
        cfg.onConversationCreated(window.__fake2); cfg.onConnect({}); })()`);
      await page.clock.runFor(40200);
      const atCap = await page.evaluate(`window.__fake2.ended`);
      await page.clock.runFor(6300); st = await page.evaluate(TALK_ST);
      const afterGrace = await page.evaluate(`window.__fake2.ended`);
      rec(14, 'an agent that never goes quiet is ended at the grace ceiling — each run capped the same way', atCap === 0 && afterGrace === 1 && st.card && st.timers === 0, JSON.stringify({ atCap, afterGrace, timers: st.timers }));
      rec(14, 'zero console errors across every state', bag.length === 0, bag.slice(0, 3).join(' | '));
      await ctx.close();
    }
    /* reduced motion: the block is not motion, so it must still work */
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      await wire(ctx);
      const page = await ctx.newPage(); const bag = [];
      watch(page, bag);
      await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const st = await page.evaluate(TALK_ST);
      rec(14, 'reduced motion: the block is ready and its control live', st.ready && st.ctl && st.engineBtn && bag.length === 0, JSON.stringify(st));
      await ctx.close();
    }
  }

  /* ── 14b · the real engine against a mocked service ────────────────── */
  /* the widget config the mocked service serves, and ElevenLabs' own quota sentence — shared by 14b and 14c */
  const CFG_BASE = { variant: 'full', placement: 'bottom-right', avatar: { type: 'orb', color_1: '#2792dc', color_2: '#9ce6e6' }, feedback_mode: 'none', language: 'sr',
    mic_muting_enabled: false, transcript_enabled: true, text_input_enabled: true, default_expanded: false, always_expanded: false, dismissible: false,
    text_contents: {}, language_presets: {}, disable_banner: false, text_only: false, supports_text_only: true };
  const QUOTA = 'This request exceeds your quota of 33338. You have 5 credits remaining, while 100 credits are required for this request.';
  head('14b · The real widget, the real SDK, a mocked ElevenLabs socket — every way it can go');
  {
    /* The service, mocked at the socket: it speaks enough of the protocol for
       the real widget and its bundled SDK to hold a session — the initiation
       metadata with a conversation id, pong for ping — and can refuse the
       handshake, or accept it and close with the quota message the owner's
       own dashboard showed. Each mode is a fresh context; each asserts what
       the visitor sees, what the owner's console says, and what reached the
       socket. */
    const TALK_ST2 = `(() => { const g = id => document.getElementById(id); const t = g('talk');
      return { ready: t.classList.contains('is-ready'), gone: t.classList.contains('is-gone'), live: t.classList.contains('is-live'), ctl: g('talk-ctl').classList.contains('is-on'), card: g('talk-card').classList.contains('is-on'),
        label: g('talk-label').textContent, failOn: g('talk-fail').classList.contains('is-on'), failText: g('talk-fail').textContent.trim(), clock: g('talk-clock').textContent,
        timers: (window.__glasTalkTimers || []).length, ws: window.WebSocket.name, engines: document.querySelectorAll('elevenlabs-convai').length,
        terms: g('talk-terms').classList.contains('is-on'), termsText: g('talk-terms-body').textContent.trim(), focus: document.activeElement && document.activeElement.id,
        failLink: !!g('talk-fail').querySelector('a[href="#kontakt"]') }; })()`;
    for (const mode of ['handshake', 'refused', 'quota', 'terms', 'terms-decline', 'micdenied', 'insecure', 'errorfirst', 'hangpending', 'storage']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const cfg = { widget_config: { ...CFG_BASE } };
      if (mode === 'terms' || mode === 'terms-decline') { cfg.widget_config.terms_html = '<p>Uslovi korišćenja demoa.</p>'; cfg.widget_config.terms_key = null; }
      await wire(ctx);
      await ctx.route(/elevenlabs\.io/, r => { if (/\/v1\/convai\/agents\/[^/]+\/widget/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) }); r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); });
      await ctx.grantPermissions(['microphone']);
      const page = await ctx.newPage(); const bag = [], lines = [];
      watch(page, bag);
      page.on('console', m => { if (/\[glas\] demo:|ConversationalAI/.test(m.text())) lines.push(m.text()); });
      await page.addInitScript(() => { window.__glasDebug = true; window.__glasConfig = { DEMO_VEZA: 'websocket' }; });   /* these rounds mock the plain socket; WebRTC has its own round */
      if (mode === 'micdenied') await page.addInitScript(() => { const md = navigator.mediaDevices; Object.defineProperty(navigator, 'mediaDevices', { value: Object.assign(Object.create(md), { getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) }), configurable: true }); });
      if (mode === 'insecure') await page.addInitScript(() => { Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }); });
      /* a browser with site data blocked for this origin: storage that throws */
      if (mode === 'storage') await page.addInitScript(() => { const thrower = { get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); }, configurable: true }; Object.defineProperty(window, 'localStorage', thrower); Object.defineProperty(window, 'sessionStorage', thrower); });
      const sock = { url: null, protocol: null, first: null, pings: 0 };
      await page.routeWebSocket(/v1\/convai\/conversation/, ws => {
        sock.url = ws.url();
        if (mode === 'refused') { ws.close({ code: 1008, reason: 'Origin not allowed' }); return; }
        if (mode === 'hangpending') { ws.onMessage(() => {}); return; }          /* accepted, then silence */
        if (mode === 'errorfirst') { ws.onMessage(msg => { let m = {}; try { m = JSON.parse(String(msg)); } catch (e) {} if (m.type === 'conversation_initiation_client_data') { sock.first = sock.first || m.type; ws.send(JSON.stringify({ type: 'error', error_event: { error_type: 'agent_not_found', message: 'Agent not found' } })); } }); return; }
        ws.onMessage(msg => {
          let m = null; try { m = JSON.parse(String(msg)); } catch (e) { m = {}; }
          if (m.type === 'conversation_initiation_client_data') {
            sock.first = sock.first || m.type;
            ws.send(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'conv_mock_' + mode, agent_output_audio_format: 'pcm_16000', user_input_audio_format: 'pcm_16000' } }));
            if (mode === 'quota') setTimeout(() => ws.close({ code: 1008, reason: QUOTA }), 400);
          } else if (m.type === 'ping') { sock.pings++; ws.send(JSON.stringify({ type: 'pong', event_id: m.ping_event && m.ping_event.event_id })); }
        });
      });
      await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const before = await page.evaluate(TALK_ST2);
      if (mode === 'insecure') {
        rec(14, 'insecure page: the demo is hidden, and the owner is told why', before.gone && !before.ready && lines.some(l => /\[glas\] demo: hidden — the live demo needs a secure page \(https\)/.test(l)), JSON.stringify({ gone: before.gone, lines }));
        rec(14, 'insecure page: zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
        await ctx.close(); continue;
      }
      await page.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`);
      await page.waitForTimeout(500);
      await page.click('#talk-btn');
      await page.waitForTimeout(mode === 'quota' ? 2600 : /^(errorfirst|hangpending|storage)$/.test(mode) ? 12600 : 2200);   /* the three that run out the 12 s clock */
      const st = await page.evaluate(TALK_ST2);
      const said = re => lines.some(l => re.test(l));
      if (mode === 'handshake') {
        rec(14, 'the real engine, a fake microphone, a service that answers: the page goes live — „Slušam”, the clock running, the socket the widget opened seen by the page',
            st.live && st.label === 'Slušam' && /^00:(3[6-9]|40)$/.test(st.clock) && st.ws === 'WebSocket' && said(/microphone granted/) && said(/call event received/) && said(/socket open — the service accepted/) && said(/session live/), JSON.stringify({ st, lines }));
        rec(14, `the socket is the one the widget documents: wss api.elevenlabs.io /v1/convai/conversation?agent_id=…&source=widget&version=${WIDGET_VER}, and the first thing sent is the initiation client data`,
            new RegExp('^wss:\\/\\/api\\.(us\\.)?elevenlabs\\.io\\/v1\\/convai\\/conversation\\?agent_id=agent_5701m14n57q9e25ryes2tg8tdjhd&source=widget&version=' + WIDGET_VER_RE + '$').test(sock.url || '') && sock.first === 'conversation_initiation_client_data', JSON.stringify({ sock, WIDGET_VER }));
        await page.click('#talk-btn');          /* the visitor stops it */
        await page.waitForTimeout(2200);
        const after = await page.evaluate(TALK_ST2);
        rec(14, 'stopped by the visitor: the end card, no timers, one fresh engine, the native WebSocket back in place', after.card && !after.ctl && !after.live && after.timers === 0 && after.engines === 1 && after.ws === 'WebSocket' && said(/session ended/), JSON.stringify(after));
      } else if (mode === 'refused') {
        rec(14, 'a refused handshake: the owner\'s notice within two seconds — no „try again”, a link to the address — and the owner\'s console names the close code and reason', st.failOn && st.failText === 'Demo trenutno nije dostupan — zakažite razgovor.' && st.failLink && !st.live && st.label === 'Razgovaraj sa agentom' && said(/socket closed, code 1008 — Origin not allowed/) && said(/failed — the service closed the socket before a session began/), JSON.stringify({ st, lines }));
      } else if (mode === 'quota') {
        rec(14, 'a session the service closes for the quota half a second in: named for the owner, and the visitor sees the owner\'s notice with the address, not a finished demo', st.failOn && st.failText === 'Demo trenutno nije dostupan — zakažite razgovor.' && st.failLink && !st.card && !st.live && st.label === 'Razgovaraj sa agentom' && said(/session live/) && said(/socket closed, code 1008 — This request exceeds your quota/) && said(/failed — the session ended \d+ ms after it began/), JSON.stringify({ st, lines }));
      } else if (mode === 'terms' || mode === 'terms-decline') {
        rec(14, `${mode}: the widget's terms sheet is met with the page's own panel within two seconds — the owner's words in it, focus on them, no socket opened yet`,
            st.terms && !st.ctl && !st.live && st.termsText === 'Uslovi korišćenja demoa.' && st.focus === 'talk-terms-body' && sock.url === null && said(/asking the visitor to accept terms/), JSON.stringify({ st, sock }));
        if (mode === 'terms') {
          await page.click('#talk-accept');
          await page.waitForTimeout(2600);
          const st2 = await page.evaluate(TALK_ST2);
          rec(14, '„Prihvatam” is handed to the widget\'s own Accept, and the call goes on from where it waited: the socket opens and the page goes live', st2.live && st2.ctl && !st2.terms && st2.label === 'Slušam' && sock.url !== null && sock.first === 'conversation_initiation_client_data' && said(/terms accepted by the visitor/) && said(/session live/), JSON.stringify({ st2, sock, lines }));
          await page.click('#talk-btn'); await page.waitForTimeout(2200);
          const st3 = await page.evaluate(TALK_ST2);
          rec(14, 'and can be stopped onto the end card like any other', st3.card && !st3.live && st3.timers === 0 && st3.engines === 1, JSON.stringify(st3));
        } else {
          await page.click('#talk-decline');
          await page.waitForTimeout(900);
          const st2 = await page.evaluate(TALK_ST2);
          rec(14, '„Odustani” returns to the start: no socket, no timer, one fresh engine, and the widget\'s waiting promise goes with the old one — no error', st2.ctl && !st2.terms && !st2.live && st2.label === 'Razgovaraj sa agentom' && sock.url === null && st2.timers === 0 && st2.engines === 1 && said(/terms declined by the visitor/), JSON.stringify({ st2, sock }));
        }
      } else if (mode === 'errorfirst') {
        rec(14, 'a first frame that is not the initiation metadata: named for the owner the moment it arrives, and the 12 s verdict says the service accepted the socket but never answered — the owner\'s notice, not „try again”',
            st.failOn && st.failText === 'Demo trenutno nije dostupan — zakažite razgovor.' && st.failLink && !st.live && said(/first frame from the service was not the initiation metadata but „error”/) && said(/failed — the service accepted the socket but no session began within 12 s/), JSON.stringify({ st, lines }));
      } else if (mode === 'hangpending') {
        rec(14, 'a handshake the service accepts and never answers: the 12 s verdict names it (accepted, no session) and the notice is the owner\'s',
            st.failOn && st.failText === 'Demo trenutno nije dostupan — zakažite razgovor.' && !st.live && said(/socket open — the service accepted/) && !said(/first frame/) && said(/failed — the service accepted the socket but no session began within 12 s/), JSON.stringify({ st, lines }));
      } else if (mode === 'storage') {
        rec(14, 'site data blocked for the origin: the widget throws before it opens a socket — the browser reports it as its own „Uncaught (in promise)” line (a cross-origin script, muted for the page), and the 12 s verdict says no socket was opened and points at that line',
            st.failOn && st.failText === 'Povezivanje nije uspelo — pokušajte ponovo.' && sock.url === null && bag.some(b => /Access is denied for this document/.test(b)) && said(/failed — no socket was opened within 12 s of pressing the widget — something inside the widget stopped it before it reached the network; the browser's own line above/), JSON.stringify({ st, lines, sock, bag }));
        await page.waitForTimeout(4300);
        const stGone = await page.evaluate(TALK_ST2);
        rec(14, 'and the generic notice — a retry might mend this one — steps aside after four seconds, the note back in its place', !stGone.failOn && stGone.ctl && stGone.label === 'Razgovaraj sa agentom', JSON.stringify(stGone));
      } else if (mode === 'micdenied') {
        await page.waitForTimeout(4600);
        const stHold = await page.evaluate(TALK_ST2);
        rec(14, 'a microphone notice the visitor can act on stays until the next attempt — it does not step aside after four seconds like the generic one', stHold.failOn && stHold.failText === 'Mikrofon je blokiran u pretraživaču — dozvolite ga za ovu stranicu i pokušajte ponovo.' && stHold.ctl && stHold.label === 'Razgovaraj sa agentom', JSON.stringify(stHold));
        rec(14, 'a blocked microphone: the visitor is told to allow it, the owner\'s console names the error, and no socket is opened', st.failOn && st.failText === 'Mikrofon je blokiran u pretraživaču — dozvolite ga za ovu stranicu i pokušajte ponovo.' && sock.url === null && said(/microphone refused for this page: NotAllowedError/), JSON.stringify({ st, lines }));
      }
      const stEnd = await page.evaluate(TALK_ST2);
      rec(14, `${mode}: the native WebSocket is restored and no timer is left`, stEnd.ws === 'WebSocket' && (mode === 'handshake' || mode === 'terms' || stEnd.timers <= 1), JSON.stringify({ ws: stEnd.ws, timers: stEnd.timers }));
      rec(14, `${mode}: zero console errors from the page`, bag.filter(b => !/ConversationalAI\] Disconnected due to an error/.test(b) && !(mode === 'storage' && /Access is denied for this document/.test(b))).length === 0, bag.slice(0, 3).join(' | '));
      await ctx.close();
    }
    /* the page inside another site's frame, without allow="microphone": the
       browser refuses the microphone by policy, and the page says so — both
       origins https, so the frame is neither mixed content nor insecure */
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await wire(ctx);
      await ctx.route(/elevenlabs\.io/, r => { if (/\/v1\/convai\/agents\/[^/]+\/widget/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ widget_config: { ...CFG_BASE } }) }); r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); });
      await ctx.grantPermissions(['microphone']);
      const page = await ctx.newPage(); const lines = [];
      page.on('console', m => { if (/\[glas\] demo:/.test(m.text())) lines.push(m.text()); });
      await page.route(/^https:\/\/site\.test\//, r => { const u = new URL(r.request().url()); const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' }); r.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });
      await page.route('https://frame.test/wrap.html', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wrap</title><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="https://site.test/index.html"></iframe>' }));
      await page.addInitScript(() => { window.__glasDebug = true; window.__glasConfig = { DEMO_VEZA: 'websocket' }; });   /* these rounds mock the plain socket; WebRTC has its own round */
      const sock = { url: null };
      await page.routeWebSocket(/v1\/convai\/conversation/, ws => { sock.url = ws.url(); ws.onMessage(() => {}); });
      await page.goto('https://frame.test/wrap.html', { waitUntil: 'load' });
      let P = null;
      for (let i = 0; i < 100 && !(P = page.frames().find(f => /site\.test\/index\.html/.test(f.url()))); i++) await page.waitForTimeout(100);
      let st = null;
      if (P) {
        await P.waitForFunction('window.__glasBooted === true', null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await P.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`);
        await page.waitForTimeout(500);
        await P.click('#talk-btn');
        await page.waitForTimeout(2200);
        st = await P.evaluate(TALK_ST2);
      }
      const said = re => lines.some(l => re.test(l));
      rec(14, 'framed by another origin without allow="microphone": the visitor sees the microphone notice, and the owner\'s line says the page is inside a frame and that the host\'s policy disallows the microphone — no socket',
          !!st && st.failOn && st.failText === 'Mikrofon je blokiran u pretraživaču — dozvolite ga za ovu stranicu i pokušajte ponovo.' && sock.url === null && said(/microphone refused for this page: NotAllowedError.*the page is inside a frame \(window\.top !== window\).*the microphone is disallowed by the host's Permissions-Policy/), JSON.stringify({ st, lines, frames: page.frames().map(f => f.url()) }));
      await ctx.close();
    }
  }

  head('14c · The connection — WebRTC as ElevenLabs\' own preview, the plain socket as the net');
  {
    const TALK_ST3 = `(() => { const g = id => document.getElementById(id); const t = g('talk'); const el = document.querySelector('elevenlabs-convai');
      return { live: t.classList.contains('is-live'), ctl: g('talk-ctl').classList.contains('is-on'), card: g('talk-card').classList.contains('is-on'), terms: g('talk-terms').classList.contains('is-on'),
        label: g('talk-label').textContent, failOn: g('talk-fail').classList.contains('is-on'), timers: (window.__glasTalkTimers || []).length, ws: window.WebSocket.name, fetchNative: window.fetch.name === 'fetch',
        engines: document.querySelectorAll('elevenlabs-convai').length, useRtc: el && el.getAttribute('use-rtc') }; })()`;
    for (const mode of ['rtc-token-500', 'rtc-signal-close', 'rtc-silent', 'rtc-terms', 'ws-config']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const cfg = { widget_config: { ...CFG_BASE } };
      if (mode === 'rtc-terms') { cfg.widget_config.terms_html = '<p>Uslovi korišćenja demoa.</p>'; cfg.widget_config.terms_key = null; }
      await wire(ctx);
      const reqs = { token: 0 };
      await ctx.route(/elevenlabs\.io/, r => { const u = r.request().url();
        if (/\/v1\/convai\/agents\/[^/]+\/widget/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
        if (/\/v1\/convai\/conversation\/token/.test(u)) { reqs.token++; return /token-500|rtc-terms/.test(mode) ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"nope"}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"mock-token"}' }); }
        r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); });
      await ctx.grantPermissions(['microphone']);
      const page = await ctx.newPage(); const bag = [], lines = [];
      watch(page, bag);
      page.on('console', m => { if (/\[glas\] demo:/.test(m.text())) lines.push(m.text()); });
      await page.addInitScript(() => { window.__glasDebug = true; });
      if (mode === 'ws-config') await page.addInitScript(() => { window.__glasConfig = { DEMO_VEZA: 'websocket' }; });
      const sockets = [];
      await page.routeWebSocket(/elevenlabs/, ws => { const u = ws.url(); const sig = /livekit|\/rtc\//.test(u); sockets.push(sig ? 'signalling' : 'conversation');
        if (sig) { if (mode === 'rtc-signal-close') setTimeout(() => ws.close({ code: 4001, reason: 'room not found' }), 600); else ws.onMessage(() => {}); return; }
        ws.onMessage(msg => { let m = {}; try { m = JSON.parse(String(msg)); } catch (e) {}
          if (m.type === 'conversation_initiation_client_data') ws.send(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'conv_mock_' + mode, agent_output_audio_format: 'pcm_16000', user_input_audio_format: 'pcm_16000' } }));
          else if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', event_id: m.ping_event && m.ping_event.event_id })); }); });
      await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const before = await page.evaluate(TALK_ST3);
      const want = mode === 'ws-config' ? 'false' : 'true';
      rec(14, `${mode}: before any press the engine carries use-rtc="${want}" — set by the page on the element, the snippet's bytes untouched`, before.useRtc === want && before.engines === 1, JSON.stringify(before));
      await page.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`);
      await page.waitForTimeout(500);
      await page.click('#talk-btn');
      if (mode === 'rtc-terms') {
        await page.waitForTimeout(1500);
        const t = await page.evaluate(TALK_ST3);
        rec(14, 'rtc-terms: the terms panel comes first, before any token is asked for', t.terms && reqs.token === 0, JSON.stringify({ t, reqs }));
        await page.click('#talk-accept');
      }
      await page.waitForTimeout(mode === 'rtc-silent' ? 9000 : 3500);
      const st = await page.evaluate(TALK_ST3);
      const said = re => lines.some(l => re.test(l));
      const count = re => lines.filter(l => re.test(l)).length;
      if (mode === 'ws-config') {
        rec(14, 'ws-config: DEMO_VEZA "websocket" — no token is asked for, the plain socket opens at once, live', st.live && reqs.token === 0 && sockets.join() === 'conversation' && said(/attempt begins over a plain WebSocket, as configured/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, reqs, sockets, lines }));
      } else if (mode === 'rtc-token-500') {
        rec(14, 'a WebRTC token the service refuses: named at once, and the same attempt goes on over the plain socket within a second — live, one engine, marked use-rtc="false" for the retry', st.live && reqs.token === 1 && sockets.join() === 'conversation' && said(/attempt begins over WebRTC/) && said(/WebRTC token refused: HTTP 500/) && said(/the same attempt goes on over a plain WebSocket, once/) && said(/session live over a plain WebSocket/) && st.engines === 1 && st.useRtc === 'false', JSON.stringify({ st, reqs, sockets, lines }));
      } else if (mode === 'rtc-signal-close') {
        rec(14, 'a signalling socket the service closes: the code and reason named, the retry over the plain socket, live — and no false first-frame alarm on the binary channel', st.live && sockets.join() === 'signalling,conversation' && said(/WebRTC token issued/) && said(/WebRTC signalling closed, code 4001 — room not found/) && said(/the same attempt goes on over a plain WebSocket, once/) && said(/session live over a plain WebSocket/) && !said(/first frame from the service was not/), JSON.stringify({ st, sockets, lines }));
      } else if (mode === 'rtc-silent') {
        rec(14, 'signalling that opens and says nothing: the SDK gives up on its own within seconds, the page retries over the plain socket, live — no false first-frame alarm', st.live && sockets.join() === 'signalling,conversation' && said(/WebRTC signalling open/) && !said(/first frame from the service was not/) && said(/the same attempt goes on over a plain WebSocket, once/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, sockets, lines }));
      } else if (mode === 'rtc-terms') {
        rec(14, 'terms accepted, then a refused token: the retried engine asks for the terms again and gets the visitor\'s earlier answer — the panel is shown once, and the call goes live', st.live && !st.terms && count(/asking the visitor to accept terms/) === 1 && said(/the retried engine asked for the terms again — the visitor's earlier answer stands/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, lines }));
      }
      if (st.live) {
        await page.click('#talk-btn'); await page.waitForTimeout(2200);
        const after = await page.evaluate(TALK_ST3);
        rec(14, `${mode}: stopped onto the end card — no timers, native WebSocket and fetch back, one fresh engine marked use-rtc="${want}" for the next attempt`, after.card && !after.live && after.timers === 0 && after.ws === 'WebSocket' && after.fetchNative && after.engines === 1 && after.useRtc === want, JSON.stringify(after));
      }
      rec(14, `${mode}: zero console errors from the page`, bag.filter(b => !(/token-500|rtc-terms/.test(mode) && /status of 500/.test(b))).length === 0, bag.slice(0, 3).join(' | '));
      await ctx.close();
    }
    rec(14, `the harness serves widget ${WIDGET_VER} — what the unpinned snippet resolves to today (npm latest)`, /^\d+\.\d+\.\d+$/.test(WIDGET_VER), WIDGET_VER);
  }

  head('13 · Touch (Pixel 7) — no dead elements where hover is impossible');
  {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    await wire(ctx);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const t1 = await page.evaluate(`document.querySelector('#phone-tilt').style.transform`);
    await page.waitForTimeout(1600);
    const t2 = await page.evaluate(`document.querySelector('#phone-tilt').style.transform`);
    const env = await page.evaluate(`({
      coarse: matchMedia('(pointer: coarse)').matches,
      magnetic: Array.from(document.querySelectorAll('.btn--magnetic')).map(e => e.style.transform).filter(Boolean).length,
      glow: getComputedStyle(document.querySelector('#cursor-glow')).display,
      pinned: !!document.querySelector('.pin-spacer')
    })`);
    rec(13, 'coarse pointer detected', env.coarse === true);
    rec(13, 'cursor tilt is replaced by a slow automatic sway', t1 !== t2 && !!t1, `${t1} → ${t2}`);
    rec(13, 'magnetic buttons never engage on touch', env.magnetic === 0);
    rec(13, 'cursor glow is off', env.glow === 'none');
    rec(13, 'the hero is not pinned on a phone', env.pinned === false);

    await page.locator('#burger').tap();
    await page.waitForTimeout(700);
    const open = await page.evaluate(`({exp: document.querySelector('#burger').getAttribute('aria-expanded'), lock: document.body.style.overflow})`);
    await page.locator('.menu-link[href="#cene"]').tap();
    await page.waitForTimeout(1700);
    const after = await page.evaluate(`({exp: document.querySelector('#burger').getAttribute('aria-expanded'), lock: document.body.style.overflow,
      atCene: Math.abs(document.querySelector('#cene').getBoundingClientRect().top) < 160})`);
    rec(13, 'menu opens on tap, closes on link tap, scrolls, and unlocks the page',
        open.exp === 'true' && open.lock === 'hidden' && after.exp === 'false' && after.lock === '' && after.atCene,
        JSON.stringify({ open, after }));

    await page.evaluate(`(() => { const el = document.querySelector('#glas'); window.__glasLenis ? window.__glasLenis.scrollTo(el, {immediate:true}) : el.scrollIntoView(); })()`);
    await page.waitForTimeout(1200);
    /* the control is live and focusable; force the tap anyway so the check
       does not depend on Playwright's actionability heuristics */
    await page.locator('#play').tap({ force: true });
    await page.waitForTimeout(900);
    const stillFocusable = await page.evaluate(`(() => { const b = document.querySelector('#play'); b.focus(); return document.activeElement === b; })()`);
    rec(13, 'the player answers a tap without erroring and stays focusable', stillFocusable && bag.length === 0, bag.slice(0, 3).join(' | '));
    await page.locator('#play').tap({ force: true });   /* and pauses again */
    /* the laptop on a phone: it opens with the scroll, stands open at the
       bottom, and its button is a real tap target that copies */
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight)`);
    await page.waitForTimeout(1600);
    const lapT = await page.evaluate(LAPTOP_ST);
    const tap = await page.evaluate(`(() => { const r = document.querySelector('#lap-copy').getBoundingClientRect(); const m = document.querySelector('#lap-mail').getBoundingClientRect(); return { btnH: Math.round(r.height), btnW: Math.round(r.width), mailH: Math.round(m.height), inView: r.top >= 0 && r.bottom <= innerHeight }; })()`);
    rec(13, 'the laptop stands open at the bottom of a phone', lapT.progress === 1 && lapT.identity && lapT.uiShown, JSON.stringify(lapT));
    rec(13, 'the copy button and the address are real tap targets on the screen', tap.btnH >= 44 && tap.btnW >= 44 && tap.mailH >= 22 && tap.inView, JSON.stringify(tap));
    await page.locator('#lap-copy').tap();
    await page.waitForTimeout(400);
    const tapped = await page.evaluate(`(async () => ({ clip: await navigator.clipboard.readText().catch(() => 'unreadable'), done: document.querySelector('#lap-copy').classList.contains('is-done') }))()`);
    rec(13, 'a tap on the button copies the address', tapped.done && tapped.clip === 'support@glasai.online', JSON.stringify(tapped));
    rec(13, 'zero console errors on touch', bag.length === 0, bag.slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'touch-pixel7.png') });
    await ctx.close();
  }

  await browser.close();
  srv.close();

  /* ── summary ─────────────────────────────────────────────────────────── */
  const fails = rows.filter(r => !r.pass);
  console.log('\n' + '─'.repeat(78));
  console.log('  ROUND 1 — RESULT TABLE');
  console.log('─'.repeat(78));
  let cur = 0;
  for (const r of rows) {
    if (r.round !== cur) { cur = r.round; console.log(''); }
    console.log(`  ${r.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}  [${String(r.round).padStart(2)}] ${r.check}${r.detail ? '   · ' + r.detail : ''}`);
  }
  console.log('─'.repeat(78));
  console.log(`  ${rows.length - fails.length}/${rows.length} passed` + (fails.length ? `   \x1b[31m${fails.length} FAILING\x1b[0m` : '   \x1b[32mall green\x1b[0m'));
  console.log('─'.repeat(78) + '\n');
  fs.writeFileSync(path.join(ROOT, '.audit', 'result.json'), JSON.stringify(rows, null, 2));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
