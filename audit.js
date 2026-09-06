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
function silentWav(secs = 0.4) {
  const rate = 8000, n = rate * secs, b = Buffer.alloc(44 + n * 2);
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

  /* ── 0 · the file against itself ─────────────────────────────────────── */
  head('0 · Static — the file against itself');
  {
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    const script = src.slice(src.lastIndexOf('<script>'));
    const written = new Set(); const re = /classList\.(?:add|remove|toggle)\(\s*"([^"]+)"/g; let m;
    while ((m = re.exec(script))) written.add(m[1]);
    /* `is-done` is read by this harness (rounds 13 and 15), not by a rule */
    const DOCUMENTED = new Set(['is-done']);
    const orphan = Array.from(written).filter(c => !DOCUMENTED.has(c) && !new RegExp('\\.' + c + '(?![\\w-])').test(style));
    rec(0, 'every class the script writes has a rule in the stylesheet, or a documented reader', orphan.length === 0, orphan.join(', ') || written.size + ' classes written');
    rec(0, 'the skip link is revealed by plain :focus too, for engines without :focus-visible', /\.skip:focus,\s*\.skip:focus-visible/.test(style));
    rec(0, 'the gutter token, the skip link and the footer carry the safe-area insets (viewport-fit=cover is opted into)', /--gut:\s*max\(clamp\([^)]*\),\s*env\(safe-area-inset-left/.test(style) && /\.skip \{[^}]*env\(safe-area-inset-top/.test(style) && /\.footer \{[^}]*env\(safe-area-inset-bottom/.test(style));
    rec(0, 'the laptop lid rotates through a fallback --lid, for engines without @property', (style.match(/rotateX\(var\(--lid, 0deg\)\)/g) || []).length === 2 && !/var\(--lid\)/.test(style));
    rec(0, 'the head writes the vendor logger\'s level before the widget\'s script can run', /localStorage\.setItem\("loglevel:livekit", "WARN"\)/.test(src) && src.indexOf('loglevel:livekit') < src.indexOf('<elevenlabs-convai'));
  }

  /* ── 1 · console cleanliness ─────────────────────────────────────────── */
  head('1 · Console — normal load, network idle + 5 s of animation');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    /* the hero's opening state, sampled every frame from before the first paint */
    await page.addInitScript(() => { window.__ops = []; const f = () => { const e = document.querySelector('.hero .lede'); if (e) window.__ops.push(getComputedStyle(e).opacity); if (!window.__glasHeroDone || window.__ops.length < 300) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    rec(1, 'zero console errors / pageerrors / unhandled rejections', bag.length === 0, bag.slice(0, 4).join(' | '));
    const ops = await page.evaluate('window.__ops');
    let seen = false, erased = false; for (const o of ops) { const v = parseFloat(o); if (v > 0.9) seen = true; if (seen && v < 0.1) erased = true; }
    rec(1, 'the hero is never painted and then erased: the lede opens closed and is only ever revealed', ops.length > 10 && !erased && parseFloat(ops[ops.length - 1]) > 0.98, JSON.stringify({ samples: ops.length, first: ops[0], last: ops[ops.length - 1] }));
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
    const page = await ctx.newPage(); const bag = [], lines4 = [];
    watch(page, bag); page.on('console', m => { if (/\[glas\] demo:/.test(m.text())) lines4.push(m.text()); });
    await page.addInitScript(() => { window.__glasDebug = true; });
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
    rec(4, 'the fold names its reason — the script never ran — rather than „never rendered”', lines4.some(l => /hidden — the page finished loading and the widget's script \(unpkg\.com\) never ran/.test(l)), lines4.filter(l => /hidden/.test(l)).join(' | '));
    rec(4, 'still zero console errors after the fold', bag.length === 0, bag.slice(0, 3).join(' | '));
    await page.evaluate(SCROLL_TO + `(document.body.scrollHeight)`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, 'cdn-blocked-bottom.png'), fullPage: false });
    await page.evaluate(SCROLL_TO + `(0)`); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, 'cdn-blocked.png'), fullPage: true });
    await ctx.close();
  }

  /* ── 4b · the engine's script arrives late ────────────────────────────── */
  head('4b · The widget\'s script is slow to arrive — the demo waits for it');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await wire(ctx);
    await ctx.route(/unpkg\.com/, r => setTimeout(() => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(path.join(NM, '@elevenlabs/convai-widget-embed/dist/index.js')) }), 10000));
    const page = await ctx.newPage(); const bag = [], lines = [];
    watch(page, bag); page.on('console', m => { if (/\[glas\] demo:/.test(m.text())) lines.push(m.text()); });
    await page.addInitScript(() => { window.__glasDebug = true; });
    const t0 = Date.now();
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    let st = null; for (let i = 0; i < 64; i++) { await page.waitForTimeout(250); st = await page.evaluate(`({ ready: document.getElementById('talk').classList.contains('is-ready'), gone: document.getElementById('talk').classList.contains('is-gone') })`); if (st.ready || st.gone) break; }
    rec(4, 'a bundle that takes ten seconds to arrive — longer than the eight-second render budget — still ends in a live demo block, not a folded one', st.ready && !st.gone && !lines.some(l => /hidden —/.test(l)), JSON.stringify({ st, after: Date.now() - t0, lines: lines.filter(l => /hidden/.test(l)) }));
    rec(4, 'zero console errors while waiting', bag.length === 0, bag.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ── 5 · reduced motion ──────────────────────────────────────────────── */
  head('5 · prefers-reduced-motion: reduce');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await wire(ctx);
    /* the recording, for the meter: a four-second silent file, so the playhead has room to move */
    await ctx.route('**/index.html', async r => { const res = await r.fetch(); r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: (await res.text()).replace(/DEMO_AUDIO: *"[^"]*"/, 'DEMO_AUDIO: "demo.wav"') }); });
    await ctx.route('**/demo.wav', r => r.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(4) }));
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
    /* the industry strip cannot scroll, so it must set as a list — here and on a phone */
    const strip = async () => page.evaluate(`(() => { const runs = Array.from(document.querySelectorAll('.marquee-run')); const vis = runs[0], dup = runs[1]; const vp = document.querySelector('.marquee-vp');
      return { fits: vis.scrollWidth <= vis.clientWidth, text: vis.innerText.toUpperCase(), docOk: document.documentElement.scrollWidth === document.documentElement.clientWidth, mask: getComputedStyle(vp).maskImage || getComputedStyle(vp).webkitMaskImage, dup: getComputedStyle(dup).display, dupHidden: dup.getAttribute('aria-hidden') }; })()`);
    const EIGHT = ['STOMATOLOŠKE ORDINACIJE', 'FRIZERSKI I KOZMETIČKI SALONI', 'AUTO SERVISI', 'PRIVATNE KLINIKE', 'FIZIOTERAPEUTI', 'AGENCIJE ZA NEKRETNINE', 'RESTORANI', 'ADVOKATSKE KANCELARIJE'];
    const s1280 = await strip();
    await page.setViewportSize({ width: 412, height: 900 }); await page.waitForTimeout(500);
    const s412 = await strip();
    await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(500);
    const stripOk = s => s.fits && s.docOk && s.mask === 'none' && EIGHT.every(x => s.text.includes(x));
    rec(5, 'the industry strip is readable with motion off — all eight, no overflow, no mask — at 1280 and at 412', stripOk(s1280) && stripOk(s412), JSON.stringify({ s1280: { ...s1280, text: undefined }, s412: { ...s412, text: undefined } }));
    rec(5, 'its duplicate run stays in the DOM, aria-hidden and out of view', s1280.dup === 'none' && s1280.dupHidden === 'true' && s412.dup === 'none');
    /* the meter under reduced motion: the playhead moves, the bars do not; a stop restores the rest */
    await page.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`);
    await page.waitForTimeout(800);
    const meter = await page.evaluate(`(async () => {
      const c = document.querySelector('canvas[data-band="voice"]'), cx = c.getContext('2d'), btn = document.querySelector('#play');
      const grab = () => cx.getImageData(0, 0, c.width, c.height).data;
      const cols = (a, b) => { const out = []; for (let x = 0; x < c.width; x++) { let d = false; for (let y = 0; y < c.height && !d; y++) { const i = (y * c.width + x) * 4; if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2] || a[i+3] !== b[i+3]) d = true; } if (d) out.push(x); } return out; };
      const span = xs => xs.length ? { from: xs[0], to: xs[xs.length - 1], n: xs.length } : { n: 0 };
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const rest0 = grab(); await sleep(700); const rest1 = grab();
      btn.click(); await sleep(400); const a = grab(); await sleep(1600); const b = grab();
      const playing = btn.classList.contains('is-playing');
      btn.click(); await sleep(900); const after = grab();
      return { w: c.width, restDrift: span(cols(rest0, rest1)), restVsA: span(cols(rest0, a)), aVsB: span(cols(a, b)), playing, afterVsRest: span(cols(rest0, after)), label: document.querySelector('#play-label').textContent.trim() };
    })()`);
    rec(5, 'at rest the meter is still: two captures 0.7 s apart are identical', meter.restDrift.n === 0, JSON.stringify(meter.restDrift));
    rec(5, 'while the recording plays only the playhead moves: 1.6 s apart, every changed column lies inside the passband to the right of where the playhead was, and every bar to its left is untouched', meter.playing && meter.aVsB.n > 100 && meter.aVsB.from >= meter.restVsA.from && meter.aVsB.to <= meter.restVsA.to, JSON.stringify({ restVsA: meter.restVsA, aVsB: meter.aVsB }));
    rec(5, 'stopping the recording restores the resting meter exactly, without a scroll', meter.afterVsRest.n === 0 && meter.label === 'Poslušaj agenta', JSON.stringify({ afterVsRest: meter.afterVsRest, label: meter.label }));
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
    const page = await ctx.newPage(); const bag = [], audioReqs = [];
    watch(page, bag); page.on('request', q => { if (/demo\.wav/.test(q.url())) audioReqs.push(q.url()); });
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    if (filled) {
      rec(7, 'filled: the recording is not fetched at boot — nothing has asked for it yet', audioReqs.length === 0, audioReqs.join(' | '));
      await page.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`); await page.waitForTimeout(400);
      await page.hover('#play'); await page.waitForTimeout(500);
      rec(7, 'filled: it is fetched the moment someone reaches for the control', audioReqs.length === 1, String(audioReqs.length));
    }
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

  /* ── 7b · a recording that will not load ─────────────────────────────── */
  head('7b · CONFIG names a recording the server does not have');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await wire(ctx);
    await ctx.route('**/index.html', async r => { const res = await r.fetch(); r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: (await res.text()).replace(/DEMO_AUDIO: *"[^"]*"/, 'DEMO_AUDIO: "nema.mp3"') }); });
    await ctx.route('**/nema.mp3', r => r.fulfill({ status: 404, contentType: 'text/plain', body: 'no' }));
    const page = await ctx.newPage(); const bag = [], lines = [];
    watch(page, bag); page.on('console', m => { if (/\[glas\] demo:/.test(m.text())) lines.push(m.text()); });
    await page.addInitScript(() => { window.__glasDebug = true; });
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`); await page.waitForTimeout(600);
    const before = await page.evaluate(`({ label: document.querySelector('#play-label').textContent.trim(), empty: document.querySelector('#play').classList.contains('is-empty') })`);
    await page.locator('#play').click({ force: true });
    await page.waitForTimeout(1800);
    const after = await page.evaluate(`({ label: document.querySelector('#play-label').textContent.trim(), empty: document.querySelector('#play').classList.contains('is-empty') })`);
    rec(7, 'a missing recording is named for the owner in the console and the control says „Snimak uskoro” from then on — it was „Poslušaj agenta” until someone reached for it', lines.some(l => /the recording „nema\.mp3” will not play/.test(l)) && after.empty && after.label === 'Snimak uskoro' && before.label === 'Poslušaj agenta' && !before.empty, JSON.stringify({ before, after, lines }));
    rec(7, 'no console error escapes — the media error is caught and explained', bag.filter(b => !/nema\.mp3/.test(b)).length === 0, bag.slice(0, 3).join(' | '));
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
        imgs: document.querySelectorAll('img').length,
        regions: document.querySelectorAll('section[aria-label], section[aria-labelledby], [role="region"]').length,
        articles: document.querySelectorAll('article').length,
        lists: document.querySelectorAll('ul, ol').length,
        statuses: document.querySelectorAll('[role="status"]').length,
        priceH3: Array.from(document.querySelectorAll('.price')).every(p => !!p.querySelector('h3')),
        heads: Array.from(document.querySelectorAll('h2, h3')).map(h => h.textContent.trim()),
        describedby: document.querySelector('#talk-btn').getAttribute('aria-describedby'),
        termsRole: document.querySelector('#talk-terms-body').getAttribute('role') + '/' + document.querySelector('#talk-terms-body').tagName,
        gut: getComputedStyle(document.documentElement).getPropertyValue('--gut').trim(),
        pad: getComputedStyle(document.querySelector('.container')).paddingLeft
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
    rec(10, 'no region or article landmark anywhere — the FAQ answers and the terms box are groups, not landmarks — and nine lists', a.regions === 0 && a.articles === 0 && a.lists === 9 && a.termsRole === 'group/DIV', JSON.stringify({ regions: a.regions, articles: a.articles, lists: a.lists, terms: a.termsRole }));
    rec(10, 'every card grid names its cards: an h3 in each plan; „Za koga” and the three plan names are in the outline', a.priceH3 && ['Za koga', 'Starter', 'Professional', 'Enterprise'].every(h => a.heads.includes(h)), JSON.stringify(a.heads));
    rec(10, 'role="status" appears nowhere — the two live regions are aria-live spans', a.statuses === 0, String(a.statuses));
    rec(10, 'the demo control is described by the idle note before anything is pressed', a.describedby === 'talk-note', a.describedby);
    rec(10, 'the gutter token computes through its max() to the same 48 px padding where the insets are zero', /^max\(clamp\(/.test(a.gut) && a.pad === '48px', JSON.stringify({ gut: a.gut, pad: a.pad }));

    // accordion behaviour
    await page.locator('#faq-q3').click();
    await page.waitForTimeout(600);
    const acc = await page.evaluate(`({open: document.querySelectorAll('.faq-q[aria-expanded="true"]').length,
      p3: document.querySelector('#faq-p3').getBoundingClientRect().height,
      p1: document.querySelector('#faq-p1').getBoundingClientRect().height})`);
    rec(10, 'accordion: opening one closes the other', acc.open === 1 && acc.p3 > 20 && acc.p1 < 2, JSON.stringify(acc));

    /* every anchor lands under the stuck nav — from anywhere on the page, the top included.
       Lenis approaches its target by lerp, so the last pixel takes a while: wait for the scroll to stand still */
    const settled = async () => { let last = -1, same = 0; for (let i = 0; i < 60; i++) { await page.waitForTimeout(100); const y = await page.evaluate('Math.round(scrollY)'); if (y === last) { if (++same >= 4) return; } else { same = 0; last = y; } } };
    const landings = {};
    for (const id of ['kako-radi', 'mogucnosti', 'glas', 'cene', 'pitanja']) {
      await page.evaluate(`document.querySelector('a.nav-link[href="#${id}"]').click()`);
      await settled();
      landings[id] = await page.evaluate(`Math.round(document.getElementById('${id}').getBoundingClientRect().top)`);
    }
    await page.evaluate(SCROLL_TO + `(0)`); await settled();
    await page.evaluate(`document.querySelector('a.nav-link[href="#pitanja"]').click()`); await settled();
    landings.pitanjaFromTop = await page.evaluate(`Math.round(document.getElementById('pitanja').getBoundingClientRect().top)`);
    const navH = await page.evaluate(`Math.round(document.getElementById('nav').getBoundingClientRect().height)`);
    rec(10, 'the five nav anchors land 24 px under the stuck nav, and an anchor pressed from the top of the page lands on the same pixel as one pressed mid-page', Object.values(landings).every(t => Math.abs(t - (navH + 24)) <= 2), JSON.stringify({ landings, navH }));
    await page.evaluate(`document.querySelector('#nav .wordmark').click()`); await settled();
    const w1 = await page.evaluate(`({ y: Math.round(scrollY), op: getComputedStyle(document.querySelector('.hero-copy')).opacity })`);
    await page.evaluate(SCROLL_TO + `(document.querySelector('#pitanja').getBoundingClientRect().top + scrollY)`); await settled();
    await page.evaluate(`document.querySelector('footer .wordmark').click()`); await settled();
    const w2 = await page.evaluate(`({ y: Math.round(scrollY), op: getComputedStyle(document.querySelector('.hero-copy')).opacity })`);
    rec(10, 'both wordmarks — the page\'s only „back to top” — return to the top of the document with the hero at full opacity, not 292 px inside a faded pin', w1.y <= 2 && w2.y <= 2 && w1.op === '1' && w2.op === '1', JSON.stringify({ nav: w1, footer: w2 }));

    // focus ring — driven by real Tab presses so :focus-visible actually applies
    await page.evaluate(`window.scrollTo(0,0)`);
    await page.waitForTimeout(400);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    /* the resting box-shadow of every control, so a ring has to be a change, not a decoration */
    await page.evaluate(`window.__rest = new Map(Array.from(document.querySelectorAll('a[href], button, [tabindex]')).map(el => [el, getComputedStyle(el).boxShadow]))`);
    const noRing = [], order = []; let playRing = null;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const rest = (window.__rest && window.__rest.get(el)) || 'none';
        const ring = (cs.boxShadow && cs.boxShadow !== 'none' && cs.boxShadow !== rest) || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0);
        const insideClosedPanel = !!el.closest('.faq-panel:not([data-open])') || !!(el.closest('#menu') && document.querySelector('#menu').hidden);
        return { tag: el.tagName, cls: (el.className || '').toString().trim().split(/\\s+/)[0], ring, insideClosedPanel, txt: (el.textContent||'').trim().slice(0,24), id: el.id, rest, shadow: cs.boxShadow };
      })()`);
      if (!f) break;
      order.push(f.tag + '.' + f.cls);
      if (!f.ring) noRing.push(f.tag + '.' + f.cls);
      if (f.insideClosedPanel) noRing.push('TRAPPED:' + f.tag + '.' + f.cls);
      if (f.id === 'play') playRing = { rest: f.rest, focused: f.shadow };
    }
    rec(10, 'a designed focus ring on every tab stop — one that differs from the control\'s resting shadow', noRing.length === 0, noRing.length ? JSON.stringify(noRing.slice(0,6)) : order.length + ' tab stops walked');
    rec(10, 'the play control\'s keyboard ring is not its decorative halo: focused and resting box-shadows differ', !!playRing && playRing.rest !== playRing.focused && playRing.focused.length > playRing.rest.length, JSON.stringify(playRing));
    rec(10, 'focus never lands in a closed panel or the hidden menu', !noRing.some(x => x.startsWith('TRAPPED')));

    // mobile menu open → resize to desktop → page must not stay locked
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const burger = await page.evaluate(`(() => { const b = document.querySelector('#burger'), s = b.querySelector('span[aria-hidden]'); const rb = b.getBoundingClientRect(), rs = s.getBoundingClientRect(); return { dx: +Math.abs((rb.left + rb.right) / 2 - (rs.left + rs.right) / 2).toFixed(2), dy: +Math.abs((rb.top + rb.bottom) / 2 - (rs.top + rs.bottom) / 2).toFixed(2) }; })()`);
    rec(10, 'the burger\'s icon is centred in its button', burger.dx < 1 && burger.dy < 1.5, JSON.stringify(burger));
    await page.locator('#burger').click();
    await page.waitForTimeout(600);
    const openState = await page.evaluate(`({exp: document.querySelector('#burger').getAttribute('aria-expanded'), lock: document.body.style.overflow, focus: document.activeElement.className})`);
    rec(10, 'mobile menu opens and moves focus inside', openState.exp === 'true' && openState.lock === 'hidden' && /menu-link/.test(openState.focus), JSON.stringify(openState));
    /* the trap: Tab from the last control lands on the burger, Shift+Tab from the burger on the last control, and a full cycle never reaches the page behind */
    await page.evaluate(`document.querySelector('.menu-foot .btn').focus()`);
    await page.keyboard.press('Tab'); const t1 = await page.evaluate(`document.activeElement.id`);
    await page.keyboard.press('Shift+Tab'); const t2 = await page.evaluate(`document.activeElement.textContent.trim()`);
    const cycle = []; for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); cycle.push(await page.evaluate(`document.activeElement === document.body ? 'BODY' : (document.activeElement.id || document.activeElement.className.split(' ')[0])`)); }
    rec(10, 'Tab from „Zakaži demo” lands on the burger, Shift+Tab from the burger returns to it, and seven Tabs never leave the overlay for the skip link, the wordmark or the body', t1 === 'burger' && t2 === 'Zakaži demo' && cycle.every(c => c === 'burger' || c === 'menu-link' || c === 'btn') && cycle.includes('burger'), JSON.stringify({ t1, t2, cycle }));
    /* a short viewport: the menu scrolls, and every item can be reached */
    const reach = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500); return page.evaluate(`(() => { const m = document.getElementById('menu'); const cs = getComputedStyle(m); const first = m.querySelector('.menu-link').getBoundingClientRect().top; m.scrollTop = 9999; const last = Array.from(m.querySelectorAll('.btn')).pop().getBoundingClientRect().bottom; m.scrollTop = 0; return { open: m.classList.contains('is-open'), overflowY: cs.overflowY, scrolls: m.scrollHeight > m.clientHeight, firstTop: Math.round(first), lastBottom: Math.round(last), nav: Math.round(document.getElementById('nav').getBoundingClientRect().height), vh: innerHeight }; })()`); };
    const r1 = await reach(812, 375), r2 = await reach(900, 500);
    const reachOk = r => r.open && r.overflowY === 'auto' && r.scrolls && r.firstTop >= r.nav && r.lastBottom <= r.vh;
    rec(10, 'in a short landscape viewport (812×375, 900×500) the open menu scrolls: the first link starts below the nav and „Zakaži demo” can be scrolled onto the screen', reachOk(r1) && reachOk(r2), JSON.stringify({ r1, r2 }));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
    /* Escape: the closing menu leaves the tab order at once, not when its fade ends */
    await page.keyboard.press('Escape'); await page.waitForTimeout(40); await page.keyboard.press('Tab');
    const esc = await page.evaluate(`({ inMenu: !!document.activeElement.closest('#menu'), inert: document.getElementById('menu').inert, exp: document.querySelector('#burger').getAttribute('aria-expanded') })`);
    rec(10, 'Escape closes the menu and the very next Tab lands on the page, not inside the fading overlay — the menu is inert the moment it closes', !esc.inMenu && esc.inert === true && esc.exp === 'false', JSON.stringify(esc));
    await page.locator('#burger').click(); await page.waitForTimeout(600);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(900);
    const unlocked = await page.evaluate(`({lock: document.body.style.overflow, exp: document.querySelector('#burger').getAttribute('aria-expanded'), hidden: document.querySelector('#menu').hidden})`);
    rec(10, 'resizing to desktop unlocks the page and closes the menu', unlocked.lock === '' && unlocked.exp === 'false', JSON.stringify(unlocked));
    rec(10, 'zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ── 10b · print ─────────────────────────────────────────────────────── */
  head('10b · Print — nothing hidden, nothing dark');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await wire(ctx);
    const page = await ctx.newPage(); const bag = [];
    watch(page, bag);
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(400);
    const pr = await page.evaluate(`(() => { const cs = e => getComputedStyle(e);
      return { hidden: Array.from(document.querySelectorAll('[data-reveal],[data-hero],[data-fx]')).filter(e => cs(e).opacity === '0' || cs(e).visibility === 'hidden').length,
               faq: Array.from(document.querySelectorAll('.faq-panel > div')).every(d => cs(d).visibility === 'visible'), faqN: document.querySelectorAll('.faq-panel > div').length,
               bg: cs(document.body).backgroundColor, text: cs(document.body).color, btn: cs(document.querySelector('.btn--primary')).color, skip: cs(document.querySelector('.skip')).display }; })()`);
    const pdf = await page.pdf({ printBackground: false, format: 'A4' });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
    rec(10, 'print: no reveal, hero or card is left at opacity 0 — all three reveal paths are neutralised', pr.hidden === 0, String(pr.hidden));
    rec(10, 'print: every FAQ answer is visible, the tokens are black on white, the amber button prints as dark amber and the skip link is gone', pr.faq && pr.faqN === 8 && pr.bg === 'rgb(255, 255, 255)' && pr.text === 'rgb(0, 0, 0)' && pr.btn !== 'rgb(255, 255, 255)' && pr.skip === 'none', JSON.stringify(pr));
    rec(10, 'print: the page sets in about six A4 pages — as many as the copy needs, none blank', pages >= 5 && pages <= 7, pages + ' pages');
    rec(10, 'print: zero console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
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
      rec(14, 'while live the control\'s name leads with the word it shows, then says what pressing it does (2.5.3 Label in Name)', (await page.getAttribute('#talk-btn', 'aria-label')) === 'Slušam — Prekini demo', await page.getAttribute('#talk-btn', 'aria-label'));
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

      /* a third run: an agent that has already said its goodbye — the meter
         moved during the call and is silent at the cap — is not held six
         seconds; two seconds of nothing, and the demo ends */
      await page.click('#talk-again'); await page.clock.runFor(300);
      await page.click('#talk-btn'); await page.clock.runFor(300);
      await page.evaluate(`(() => { const cfg = {}; document.querySelector('elevenlabs-convai').dispatchEvent(new CustomEvent('elevenlabs-convai:call', { bubbles: true, composed: true, detail: { config: cfg } }));
        window.__fake4 = { ended: 0, vol: 0.3, endSession() { this.ended++; setTimeout(() => cfg.onDisconnect({}), 40); return Promise.resolve(); }, setMicMuted() {}, getOutputVolume() { return this.vol; }, sendContextualUpdate() {}, isOpen() { return !this.ended; } };
        cfg.onConversationCreated(window.__fake4); cfg.onConnect({}); })()`);
      await page.clock.runFor(35000);
      await page.evaluate(`window.__fake4.vol = 0`);
      await page.clock.runFor(5200);
      const q0 = await page.evaluate(`window.__fake4.ended`);
      await page.clock.runFor(1500); const q1 = await page.evaluate(`window.__fake4.ended`);
      await page.clock.runFor(1000); const q2 = await page.evaluate(`window.__fake4.ended`);
      await page.clock.runFor(1500); st = await page.evaluate(TALK_ST);
      rec(14, 'an agent already finished at the cap — the meter moved during the call and is quiet now — is ended after two seconds of nothing, not six', q0 === 0 && q1 === 0 && q2 === 1 && st.card && st.timers === 0, JSON.stringify({ q0, q1, q2, timers: st.timers }));

      /* a fourth: a meter that never moved cannot tell a finished agent from
         one it cannot hear — the whole grace stands */
      await page.click('#talk-again'); await page.clock.runFor(300);
      await page.click('#talk-btn'); await page.clock.runFor(300);
      await page.evaluate(`(() => { const cfg = {}; document.querySelector('elevenlabs-convai').dispatchEvent(new CustomEvent('elevenlabs-convai:call', { bubbles: true, composed: true, detail: { config: cfg } }));
        window.__fake5 = { ended: 0, endSession() { this.ended++; setTimeout(() => cfg.onDisconnect({}), 40); return Promise.resolve(); }, setMicMuted() {}, getOutputVolume() { return 0; }, sendContextualUpdate() {}, isOpen() { return !this.ended; } };
        cfg.onConversationCreated(window.__fake5); cfg.onConnect({}); })()`);
      await page.clock.runFor(40200);
      const m0 = await page.evaluate(`window.__fake5.ended`);
      await page.clock.runFor(5500); const m1 = await page.evaluate(`window.__fake5.ended`);
      await page.clock.runFor(800); const m2 = await page.evaluate(`window.__fake5.ended`);
      await page.clock.runFor(1500); st = await page.evaluate(TALK_ST);
      rec(14, 'a meter that never moved cannot tell a finished agent from one it cannot hear: the whole six-second grace stands', m0 === 0 && m1 === 0 && m2 === 1 && st.card && st.timers === 0, JSON.stringify({ m0, m1, m2, timers: st.timers }));
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
      if (mode === 'terms' || mode === 'terms-decline') { cfg.widget_config.terms_html = '<p>Uslovi korišćenja demoa.</p>' + (mode === 'terms' ? '<p><a href="https://example.com/politika">Politika</a> <a href="/uslovi">Uslovi</a> <a href="#glas">Vrh</a></p>' : ''); cfg.widget_config.terms_key = null; }
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
            st.terms && !st.ctl && !st.live && st.termsText.startsWith('Uslovi korišćenja demoa.') && st.focus === 'talk-terms-body' && sock.url === null && said(/asking the visitor to accept terms/), JSON.stringify({ st, sock }));
        if (mode === 'terms') {
          const tl = await page.evaluate(`(() => { const tb = document.getElementById('talk-terms-body'); return { role: tb.getAttribute('role'), tag: tb.tagName, regions: document.querySelectorAll('section[aria-label], section[aria-labelledby], [role="region"]').length, links: Array.from(tb.querySelectorAll('a')).map(a => [a.getAttribute('href'), a.target, a.rel, !!a.querySelector('.vh')]) }; })()`);
          rec(14, 'the owner\'s links inside the terms open elsewhere — absolute and root-relative alike get target=_blank, rel=noopener and the new-window hint; a same-page fragment is left alone — and the box is a group, not a landmark', tl.role === 'group' && tl.tag === 'DIV' && tl.regions === 0 && tl.links.length === 3 && tl.links[0][1] === '_blank' && tl.links[0][2] === 'noopener' && tl.links[0][3] && tl.links[1][1] === '_blank' && tl.links[1][2] === 'noopener' && tl.links[1][3] && !tl.links[2][1] && !tl.links[2][2] && !tl.links[2][3], JSON.stringify(tl));
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
        rec(14, 'a microphone notice the visitor can act on stays until the next attempt — it does not step aside after four seconds like the generic one', stHold.failOn && stHold.failText === 'Mikrofon je blokiran u pregledaču — dozvolite ga za ovu stranicu i pokušajte ponovo.' && stHold.ctl && stHold.label === 'Razgovaraj sa agentom', JSON.stringify(stHold));
        rec(14, 'a blocked microphone: the visitor is told to allow it, the owner\'s console names the error, and no socket is opened', st.failOn && st.failText === 'Mikrofon je blokiran u pregledaču — dozvolite ga za ovu stranicu i pokušajte ponovo.' && sock.url === null && said(/microphone refused for this page: NotAllowedError/), JSON.stringify({ st, lines }));
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
          !!st && st.failOn && st.failText === 'Mikrofon je blokiran u pregledaču — dozvolite ga za ovu stranicu i pokušajte ponovo.' && sock.url === null && said(/microphone refused for this page: NotAllowedError.*the page is inside a frame \(window\.top !== window\).*the microphone is disallowed by the host's Permissions-Policy/), JSON.stringify({ st, lines, frames: page.frames().map(f => f.url()) }));
      await ctx.close();
    }
  }

  head('14c · The connection — WebRTC as ElevenLabs\' own preview, the plain socket as the net');
  {
    const TALK_ST3 = `(() => { const g = id => document.getElementById(id); const t = g('talk'); const el = document.querySelector('elevenlabs-convai');
      return { live: t.classList.contains('is-live'), ctl: g('talk-ctl').classList.contains('is-on'), card: g('talk-card').classList.contains('is-on'), terms: g('talk-terms').classList.contains('is-on'),
        label: g('talk-label').textContent, failOn: g('talk-fail').classList.contains('is-on'), timers: (window.__glasTalkTimers || []).length, ws: window.WebSocket.name, fetchNative: window.fetch.name === 'fetch',
        engines: document.querySelectorAll('elevenlabs-convai').length, useRtc: el && el.getAttribute('use-rtc'), region: el && el.getAttribute('server-location'),
        gone: t.classList.contains('is-gone'), fpjs: window.__fpjs_d_m === true, note: g('talk-note').classList.contains('is-on'),
        userId: el && el.getAttribute('user-id'), stored: (() => { try { return localStorage.getItem('glas_convai_uid'); } catch (e) { return 'threw'; } })(),
        widgetOwnId: (() => { try { return localStorage.getItem('elevenlabs_convai_user_id'); } catch (e) { return 'threw'; } })() }; })()`;
    for (const mode of ['rtc-token-500', 'rtc-signal-close', 'rtc-silent', 'rtc-terms', 'ws-config', 'rtc-token-hang', 'rtc-token-slow', 'rtc-slow-config', 'ws-terms-late', 'ws-terms-idle']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const cfg = { widget_config: { ...CFG_BASE } };
      if (/terms/.test(mode)) { cfg.widget_config.terms_html = '<p>Uslovi korišćenja demoa.</p>'; cfg.widget_config.terms_key = null; }
      if (mode === 'ws-config') cfg.widget_config.text_contents = { start_call: 'Pozovi' };      /* the dashboard renames the button, as the owner's did */
      await wire(ctx);
      const reqs = { token: 0, cfg: 0 };
      await ctx.route(/elevenlabs\.io/, r => { const u = r.request().url();
        if (/\/v1\/convai\/agents\/[^/]+\/widget/.test(u)) {
          reqs.cfg++;
          const body = JSON.stringify(cfg), ok = () => r.fulfill({ status: 200, contentType: 'application/json', body });
          if (mode === 'rtc-slow-config' && reqs.cfg === 2) { setTimeout(ok, 7000); return; }     /* the retried engine's settings, late */
          return ok();
        }
        if (/\/v1\/convai\/conversation\/token/.test(u)) {
          reqs.token++;
          if (mode === 'rtc-token-hang') return;                                                   /* never answered */
          if (mode === 'rtc-token-slow') { setTimeout(() => r.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"mock-token"}' }), 9500); return; }   /* after the page has moved on */
          return /token-500|rtc-terms|rtc-slow-config/.test(mode) ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"nope"}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"mock-token"}' });
        }
        r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); });
      await ctx.grantPermissions(['microphone']);
      const page = await ctx.newPage(); const bag = [], lines = [], at = {};
      watch(page, bag);
      const vendor = [];
      page.on('console', m => { const t = m.text(); if (/\[glas\] demo:/.test(t)) { lines.push(t); if (/call event received/.test(t) && !at.call) at.call = Date.now(); if (/WebRTC token requested/.test(t) && !at.token) at.token = Date.now(); } else if (m.type() !== 'error' && (/livekit/i.test(t) || t.length > 600)) vendor.push(t.slice(0, 90)); });
      await page.addInitScript(() => { window.__glasDebug = true; });
      if (/^ws-/.test(mode)) await page.addInitScript(() => { window.__glasConfig = { DEMO_VEZA: 'websocket' }; });
      if (mode === 'ws-terms-idle') await page.addInitScript(() => { window.__glasTiming = { TALK_TERMS_MIC_MS: 1500 }; });
      /* every microphone stream the page or the widget takes, so a stop can be checked */
      await page.addInitScript(() => { const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md); window.__glasStreams = []; md.getUserMedia = c => gum(c).then(s => { window.__glasStreams.push(s); return s; }); });
      const sockets = [], hosts = [];
      await page.routeWebSocket(/elevenlabs/, ws => { const u = ws.url(); const sig = /livekit|\/rtc\//.test(u); sockets.push(sig ? 'signalling' : 'conversation'); hosts.push(new URL(u).host);
        if (sig) { if (mode === 'rtc-signal-close') setTimeout(() => ws.close({ code: 4001, reason: 'room not found' }), 600); else { ws.onMessage(() => {}); ws.send('\u0008\u0001not-json'); } return; }   /* a frame the page must not read */
        ws.onMessage(msg => { let m = {}; try { m = JSON.parse(String(msg)); } catch (e) {}
          if (m.type === 'conversation_initiation_client_data') {
            const meta = () => ws.send(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'conv_mock_' + mode, agent_output_audio_format: 'pcm_16000', user_input_audio_format: 'pcm_16000' } }));
            if (mode === 'rtc-token-slow') setTimeout(meta, 2500); else meta();     /* the retry still connecting when the orphan dials */
            if (mode === 'ws-config') {                                                /* the service hears a turn, calls a tool, answers */
              setTimeout(() => ws.send(JSON.stringify({ type: 'user_transcript', user_transcription_event: { user_transcript: 'Dobar dan' } })), 900);
              setTimeout(() => ws.send(JSON.stringify({ type: 'agent_tool_request', agent_tool_request: { tool_name: 'google_calendar_check_availability', tool_call_id: 't1' } })), 1000);
              setTimeout(() => ws.send(JSON.stringify({ type: 'agent_tool_response', agent_tool_response: { tool_name: 'google_calendar_check_availability', tool_call_id: 't1', is_error: false, is_called: true } })), 1400);
              setTimeout(() => ws.send(JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'Dobar dan!' } })), 1700);
            }
          }
          else if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', event_id: m.ping_event && m.ping_event.event_id })); }); });
      await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const before = await page.evaluate(TALK_ST3);
      const want = /^ws-/.test(mode) ? 'false' : 'true';
      rec(14, `${mode}: before any press the engine carries use-rtc="${want}", server-location="global" and a visitor id kept in the browser — set by the page on the element, the snippet's bytes untouched`, before.useRtc === want && before.region === 'global' && before.engines === 1 && /^[0-9a-f-]{36}$|^v-/.test(before.userId || '') && before.userId === before.stored, JSON.stringify(before));
      await page.evaluate(SCROLL_TO + `(document.querySelector('#glas').getBoundingClientRect().top + window.scrollY)`);
      await page.waitForTimeout(500);
      if (mode === 'rtc-terms') await page.evaluate(`(() => { const t = document.getElementById('talk'); window.__hs = []; const f = () => { window.__hs.push(t.offsetHeight); if (window.__hs.length < 2400) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
      await page.click('#talk-btn');
      const said = re => lines.some(l => re.test(l));
      const count = re => lines.filter(l => re.test(l)).length;
      if (mode === 'rtc-terms') {
        await page.waitForTimeout(1500);
        const t = await page.evaluate(TALK_ST3);
        rec(14, 'rtc-terms: the terms panel comes first, before any token is asked for', t.terms && reqs.token === 0, JSON.stringify({ t, reqs }));
        await page.click('#talk-accept');
      } else if (mode === 'ws-terms-late') {
        /* the visitor reads for ten and a half seconds — past the plain socket's twelve-second clock, had it kept running */
        await page.waitForTimeout(10500);
        const t = await page.evaluate(TALK_ST3);
        rec(14, 'ws-terms-late: the panel is still up after ten seconds of reading, nothing has failed, and the microphone is still the page\'s', t.terms && !t.failOn && !said(/failed —/) && (await page.evaluate(`window.__glasStreams.length > 0 && window.__glasStreams[0].getTracks().every(x => x.readyState === 'live')`)), JSON.stringify({ t, lines }));
        await page.click('#talk-accept');
      } else if (mode === 'ws-terms-idle') {
        await page.waitForTimeout(2600);
        const t = await page.evaluate(TALK_ST3);
        const ended = await page.evaluate(`window.__glasStreams.length > 0 && window.__glasStreams[0].getTracks().every(x => x.readyState === 'ended')`);
        rec(14, 'ws-terms-idle: a sheet left unanswered lets the microphone go after the wait (shortened to 1.5 s here) — the panel stays, the answer is still taken', t.terms && ended && said(/the terms went unanswered for 1\.5 s — the microphone is let go/), JSON.stringify({ t, ended, lines }));
        await page.click('#talk-accept');
      }
      let labels = null;
      if (mode === 'ws-config') {
        /* the control's word through the mocked turn: „Slušam” at first, „Razmišljam…” once the service has the words, „Slušam” again when the reply is ready */
        const NAME = `document.getElementById('talk-btn').getAttribute('aria-label')`;
        await page.waitForTimeout(600);  const l0 = await page.evaluate(`document.getElementById('talk-label').textContent`), n0 = await page.evaluate(NAME), d0 = await page.evaluate(`document.getElementById('talk-btn').getAttribute('aria-describedby')`);   /* live, before the transcript (~1.2 s) */
        await page.waitForTimeout(850);  const l1 = await page.evaluate(`document.getElementById('talk-label').textContent`), n1 = await page.evaluate(NAME);   /* after the transcript, before the reply (~2.0 s) */
        await page.waitForTimeout(900);  const l2 = await page.evaluate(`document.getElementById('talk-label').textContent`);   /* after the reply */
        labels = { l0, l1, l2, n0, n1, d0, thinkingClassNow: await page.evaluate(`document.getElementById('talk').classList.contains('is-thinking')`) };
        await page.waitForTimeout(1150);
      } else await page.waitForTimeout(mode === 'rtc-slow-config' ? 9000 : /^(rtc-silent|rtc-token-hang)$/.test(mode) ? 12500 : mode === 'rtc-token-slow' ? 14000 : 3500);
      const st = await page.evaluate(TALK_ST3);
      if (mode === 'ws-config') {
        rec(14, 'ws-config: DEMO_VEZA "websocket" — no token is asked for, the plain socket opens at once to api.elevenlabs.io, the host ElevenLabs routes, live', st.live && reqs.token === 0 && sockets.join() === 'conversation' && hosts[0] === 'api.elevenlabs.io' && said(/attempt begins over a plain WebSocket, as configured/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, reqs, sockets, hosts, lines }));
        rec(14, 'the widget\'s fingerprint library is told not to phone home, and no request leaves for it', st.fpjs && !bag.some(b => /openfpcdn/.test(b)), JSON.stringify({ fpjs: st.fpjs, bag }));
        rec(14, 'a start button the dashboard renamed („Pozovi”) is still found — by its phone icon, not its name or its place — and the label pressed is printed', said(/the widget's start button pressed — „Pozovi”/) && !said(/by position/), JSON.stringify(lines));
        rec(14, 'with the visitor id handed to the widget, its own fingerprint-derived id is never computed or stored', st.widgetOwnId === null && st.userId === st.stored, JSON.stringify({ own: st.widgetOwnId, userId: st.userId }));
        rec(14, 'the service\'s own gap is printed per turn: from the caller\'s transcript to the agent\'s reply, in milliseconds', said(/turn 1: the service had your words → the agent's reply was ready [5-9]\d\d ms later/), JSON.stringify(lines));
        rec(14, 'the tool the agent calls is named, and its answer timed', said(/turn 1: the agent is calling google_calendar_check_availability/) && said(/turn 1: google_calendar_check_availability answered [2-7]\d\d ms later/), JSON.stringify(lines));
        rec(14, 'the control reads „Slušam” before the turn, „Razmišljam…” once the service has the words, and „Slušam” again when the reply is ready — with the thinking class gone', labels && labels.l0 === 'Slušam' && labels.l1 === 'Razmišljam…' && labels.l2 === 'Slušam' && labels.thinkingClassNow === false && st.label === 'Slušam', JSON.stringify(labels));
        rec(14, 'the live control names itself with the word it shows (2.5.3), listening and thinking alike, then says what pressing it does — and is described by the clock, not the idle note', labels && labels.n0 === 'Slušam — Prekini demo' && labels.n1 === 'Razmišljam… — Prekini demo' && labels.d0 === 'talk-live', JSON.stringify({ n0: labels && labels.n0, n1: labels && labels.n1, d0: labels && labels.d0 }));
      } else if (mode === 'rtc-token-hang') {
        rec(14, 'a token request the service never answers: the page\'s own eight-second clock names it and the same attempt goes on over the plain socket — live', st.live && reqs.token === 1 && said(/the token was requested but no signalling socket was opened within 8 s/) && said(/the same attempt goes on over a plain WebSocket, once/) && said(/session live over a plain WebSocket/) && !said(/failed —/), JSON.stringify({ st, reqs, lines }));
      } else if (mode === 'rtc-token-slow') {
        rec(14, 'a token that arrives after the page has moved on: the signalling socket it then opens, while the retry is still connecting, is ignored as an earlier attempt\'s, and the plain socket\'s session is not disturbed', st.live && sockets.join() === 'conversation,signalling' && said(/opened after its attempt had moved on — ignored/) && !said(/failed —/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, sockets, lines }));
      } else if (mode === 'rtc-slow-config') {
        rec(14, 'a retried engine whose settings never arrive in time: the attempt fails with a notice and the block stays — it does not fold away mid-attempt', !st.live && st.ctl && st.failOn && !st.gone && said(/the retried engine never rendered its button within 5 s/), JSON.stringify({ st, reqs, lines }));
      } else if (mode === 'ws-terms-late' || mode === 'ws-terms-idle') {
        rec(14, `${mode}: accepted, the call goes live over the plain socket with no stale clock firing`, st.live && !st.terms && !said(/failed —/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, lines }));
      } else if (mode === 'rtc-token-500') {
        rec(14, 'the widget\'s 300 ms sleep before dialling is gone: the token is requested within a quarter second of the call event', at.call && at.token && at.token - at.call < 250, JSON.stringify({ call: at.call, token: at.token, delta: at.token - at.call }));
        rec(14, 'a WebRTC token the service refuses: named at once, and the same attempt goes on over the plain socket within a second — live, one engine, marked use-rtc="false" for the retry', st.live && reqs.token === 1 && sockets.join() === 'conversation' && said(/attempt begins over WebRTC/) && said(/WebRTC token refused: HTTP 500/) && said(/the same attempt goes on over a plain WebSocket, once/) && said(/session live over a plain WebSocket/) && st.engines === 1 && st.useRtc === 'false', JSON.stringify({ st, reqs, sockets, lines }));
      } else if (mode === 'rtc-signal-close') {
        rec(14, 'a signalling socket the service closes: the code and reason named, the retry over the plain socket, live — and no false first-frame alarm on the binary channel', st.live && sockets.join() === 'signalling,conversation' && said(/WebRTC token issued/) && said(/WebRTC signalling closed, code 4001 — room not found/) && said(/the same attempt goes on over a plain WebSocket, once/) && said(/session live over a plain WebSocket/) && !said(/first frame from the service was not/), JSON.stringify({ st, sockets, lines }));
      } else if (mode === 'rtc-silent') {
        rec(14, 'signalling that opens and sends a binary frame the page must not read: no first-frame alarm; the page\'s own eight-second clock names the silence, the retry over the plain socket, live', st.live && sockets.join() === 'signalling,conversation' && said(/WebRTC signalling open/) && !said(/first frame from the service was not/) && said(/the signalling opened but no session began within 8 s/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, sockets, lines }));
      } else if (mode === 'rtc-terms') {
        rec(14, 'terms accepted, then a refused token: the retried engine asks for the terms again and gets the visitor\'s earlier answer — the panel is shown once, and the call goes live', st.live && !st.terms && count(/asking the visitor to accept terms/) === 1 && said(/the retried engine asked for the terms again — the visitor's earlier answer stands/) && said(/session live over a plain WebSocket/), JSON.stringify({ st, lines }));
      }
      if (mode !== 'rtc-slow-config') {
        /* a mode that should be live and is not fails here, loudly */
        if (st.live) { await page.click('#talk-btn'); await page.waitForTimeout(2200); }
        const after = await page.evaluate(TALK_ST3);
        const micGone = await page.evaluate(`window.__glasStreams.length > 0 && window.__glasStreams[0].getTracks().every(x => x.readyState === 'ended')`);
        rec(14, `${mode}: stopped onto the end card — no timers, native WebSocket and fetch back, the page's microphone stream ended, one fresh engine marked use-rtc="${want}" for the next attempt`, st.live && after.card && !after.live && after.timers === 0 && after.ws === 'WebSocket' && after.fetchNative && micGone && after.engines === 1 && after.useRtc === want && after.region === 'global', JSON.stringify({ wasLive: st.live, after, micGone }));
      }
      if (mode === 'rtc-terms') {
        const hs = await page.evaluate(`window.__hs`);
        const runs = []; for (const h of hs) { const r = runs[runs.length - 1]; if (r && r.h === h) r.n++; else runs.push({ h, n: 1 }); }
        /* plateaus are states; what lies between two plateaus is a swap, and a swap has to be a ramp inside its two ends */
        const plateaus = runs.map((r, i) => ({ ...r, i })).filter(r => r.n >= 12);
        const swaps = []; for (let k = 1; k < plateaus.length; k++) { const p = plateaus[k - 1], q = plateaus[k]; if (p.h === q.h) continue; const between = runs.slice(p.i + 1, q.i).map(r => r.h); const lo = Math.min(p.h, q.h), hi = Math.max(p.h, q.h); const path = [p.h].concat(between, [q.h]); swaps.push({ from: p.h, to: q.h, steps: between.length, overshoot: between.some(h => h < lo || h > hi), maxJump: Math.max.apply(null, path.map((h, j) => j ? Math.abs(h - path[j - 1]) : 0)) }); }
        rec(14, 'rtc-terms: every swap of the block — control → terms, terms → control, control → end card — is a ramp of frames inside its two heights, never a snap and never an overshoot', swaps.length >= 3 && swaps.every(s => s.steps >= 4 && !s.overshoot && s.maxJump <= Math.max(12, Math.abs(s.to - s.from) / 2)), JSON.stringify({ swaps, runs: runs.map(r => r.h + 'x' + r.n).join(' ') }));
      }
      if (/^rtc-/.test(mode)) rec(14, `${mode}: the vendor SDK's connection narration is silent — no livekit line, nothing over 600 characters — while the page's own „[glas] demo:” lines are all there`, vendor.length === 0 && lines.length >= 6, JSON.stringify({ vendor: vendor.slice(0, 3), pageLines: lines.length }));
      /* the widget's own line when an element is removed while its settings are still on the way — the page replaces the engine on purpose there */
      rec(14, `${mode}: the start button was found by its phone icon, never pressed by position`, said(/the widget's start button pressed — „/) && !said(/by position/), lines.filter(l => /start button/.test(l)).join(' | '));
      rec(14, `${mode}: zero console errors from the page`, bag.filter(b => !(/token-500|rtc-terms|rtc-slow-config/.test(mode) && /status of 500/.test(b)) && !(mode === 'rtc-slow-config' && /Cannot fetch config .* aborted/.test(b))).length === 0, bag.slice(0, 3).join(' | '));
      await ctx.close();
    }
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
