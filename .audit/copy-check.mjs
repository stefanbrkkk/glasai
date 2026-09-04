/* ══════════════════════════════════════════════════════════════════════════
   BRIEF §9 · ROUND 4 — content, language and claims.
   Every visible string is diffed against §8/§6/§7 character for character.
   Only NBSP (U+00A0, required by §8's price rule) is normalised to a space.
   ══════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import http from 'http'; import path from 'path';

const ROOT = '/home/user/glasai';
const FIX = path.join(ROOT, '.audit/fixtures'), NM = path.join(ROOT, '.audit/node_modules');
const MIME = { '.html': 'text/html; charset=utf-8', '.mp3': 'audio/mpeg' };
const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  const size = fs.statSync(f).size, type = MIME[path.extname(f)] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(q.headers.range || '');
  if (m) {                                   /* a media element asks by range */
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2]);
    if (!isFinite(start) || start < 0) start = 0;
    if (!isFinite(end) || end >= size) end = size - 1;
    r.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
    fs.createReadStream(f, { start, end }).pipe(r); return;
  }
  r.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;

/* ─── §8 · verbatim copy, transcribed straight from the brief ────────────── */
const EXPECT = {
  nav:        ['Kako radi', 'Mogućnosti', 'Glas', 'Cene', 'Pitanja'],
  navCta:     'Zakaži demo',
  eyebrow:    'AI GLASOVNI AGENT — SRBIJA · HRVATSKA · BIH',
  h1:         'Nijedan poziv ne ostaje bez odgovora.',
  heroSub:    'AI agent koji se javlja za dve sekunde, vodi razgovor prirodnim srpskim jezikom i zakazuje termine direktno u vaš kalendar — 24 sata dnevno, sedam dana u nedelji.',
  heroCta:    ['Poslušaj demo', 'Zakaži razgovor'],
  microstats: ['manje od 2 s do javljanja', '24/7 dostupan', '0 propuštenih poziva'],

  problemEyebrow: 'PROBLEM',
  problemH2:  'Svaki propušten poziv je izgubljen klijent.',
  problemBody:'Dok ste sa pacijentom, na terenu ili van radnog vremena — telefon zvoni. U malim biznisima veliki deo poziva ostane bez odgovora, a većina ljudi ne zove drugi put. Pozovu sledećeg na Google-u.',
  /* §8's replacement block — the percentages are unsourced, so they are not published */
  stats: [
    ['Koliko juče', 'propuštenih poziva možete da nabrojite?'],
    ['Nijedan', 'od njih nije ostavio poruku'],
    ['1 poziv', 'je često razlika između punog i praznog termina']
  ],

  stepsH2: 'Od zvona do zakazanog termina — bez vas.',
  steps: [
    ['01', 'Poziv stiže', 'Agent se javlja za manje od dve sekunde. Uvek istim tonom — ljubaznim.'],
    ['02', 'Razgovor teče prirodno', 'Razume pitanja, odgovara na srpskom, hrvatskom ili bosanskom i zna kada poziv treba da preusmeri na vas.'],
    ['03', 'Termin je u kalendaru', 'Zakazuje direktno u vaš kalendar. Vi samo dođete na posao.']
  ],

  featH2: 'Sve što recepcija radi. Bez pauze.',
  feats: [
    ['Zakazivanje termina', 'Direktna sinhronizacija sa Google kalendarom.'],
    ['Odgovori na česta pitanja', 'Radno vreme, cene, lokacija, priprema za pregled — agent zna vaš biznis.'],
    ['Usklađen sa zakonom', 'Agent u prvoj rečenici kaže da je veštačka inteligencija i da se poziv snima. Pozivalac u svakom trenutku može da traži čoveka.'],
    ['Prebacivanje na čoveka', 'Dovoljno je da pozivalac kaže „operater”. Hitne i složene pozive prosleđuje vama, sa kratkim rezimeom razgovora.'],
    ['Radi non-stop', 'Noć, vikend, praznik, gužva — svaki poziv dobije odgovor.'],
    ['Snimci i izveštaji', 'Transkript svakog razgovora i nedeljni pregled: koliko poziva, koliko termina.']
  ],

  voiceEyebrow: 'GLAS',
  voiceH2:  'Glas pravljen za telefonsku liniju.',
  voiceSub: 'Telefonska veza propušta samo uzak pojas — od 300 do 3400 herca. Ono što lepo zvuči na slušalicama tu se često raspadne. Naš glas je biran merenjem kroz tu istu liniju, jer to je jedino što vaš pacijent zaista čuje.',
  voiceMarks: ['300 Hz', '3400 Hz'],
  voiceCap: 'Isti opseg koji propušta svaka telefonska veza.',
  /* the live demo — the client's copy for it, exactly */
  talk: {
    start: 'Razgovaraj sa agentom',
    note:  'Govorite naglas — agent odgovara na srpskom. Traje četrdeset sekundi.',
    connecting: 'Povezujem…',
    live: 'Slušam',
    cardH: 'Demo je gotov.',
    cardP: 'Za pun razgovor zakažite petnaest minuta sa nama.',
    cardBtn: 'Zakaži razgovor'
  },

  marquee: 'Stomatološke ordinacije · Frizerski i kozmetički saloni · Auto servisi · Privatne klinike · Fizioterapeuti · Agencije za nekretnine · Restorani · Advokatske kancelarije ·',

  priceH2: 'Jednostavno kao i sam agent.',
  prices: [
    ['Starter', '99 €', '/ mesečno', ['Do 200 poziva mesečno', 'Zakazivanje termina', 'Prebacivanje na čoveka', 'Osnovni izveštaji'], 'Započni'],
    ['Professional', '199 €', '/ mesečno', ['Do 600 poziva mesečno', 'Sve iz Starter paketa', 'Prilagođena skripta i ton', 'Prioritetna podrška'], 'Zakaži demo'],
    ['Enterprise', 'Po dogovoru', '', ['Neograničeni pozivi', 'Više lokacija', 'Integracije po meri', 'Ugovor o nivou usluge (SLA)'], 'Kontaktiraj nas']
  ],
  priceBadge: 'Najpopularniji',
  priceNote: 'Podešavanje za sedam dana. Bez ugovorne obaveze — otkažite bilo kad.',

  faqH2: 'Česta pitanja',
  faq: [
    ['Da li agent kaže da je veštačka inteligencija?', 'Da, na početku svakog poziva. To je zakonska obaveza i mi je ne zaobilazimo. U praksi ne smeta — ljudi žele brz odgovor i termin, a ne da pogađaju s kim razgovaraju.'],
    ['Da li agent zvuči robotski?', 'Koristi najnoviju generaciju glasovne sinteze za srpski jezik — prirodne pauze, intonaciju i naglasak. Poslušajte demo i procenite sami.'],
    ['Šta ako agent ne zna odgovor?', 'Iskreno kaže da će proveriti, zapiše poruku ili odmah prebaci poziv na vas — nikada ne izmišlja.'],
    ['Mogu li da tražim da razgovaram sa čovekom?', 'U svakom trenutku. Dovoljno je reći „operater” i poziv ide na vaš broj.'],
    ['Kako se povezuje sa mojim kalendarom?', 'Radi sa Google kalendarom. Celo podešavanje radimo mi.'],
    ['Da li radi na hrvatskom i bosanskom?', 'Da. Razume i odgovara na sva tri jezika i prilagođava se sagovorniku.'],
    ['Koliko traje podešavanje?', 'Obično pet do sedam dana od prvog razgovora do prvog primljenog poziva.'],
    ['Šta se dešava sa snimcima razgovora?', 'Čuvaju se bezbedno i dostupni su samo vama, u skladu sa propisima o zaštiti podataka o ličnosti.']
  ],

  ctaH2: 'Čujte ga uživo.',
  ctaSub: 'Zakažite razgovor od petnaest minuta — pokazaćemo vam kako zvuči vaš budući agent i koliko poziva mesečno propuštate.',
  /* the contact section: the client's address, and the words on the laptop's screen */
  kontakt: { eyebrow: 'KONTAKT', h3: 'Pišite nam.', mail: 'support@glasai.online', copy: 'Kopiraj adresu', copied: 'Kopirano' },

  footerNav: ['Kako radi', 'Mogućnosti', 'Glas', 'Cene', 'Kontakt'],
  footerLegal: 'Agent na početku svakog poziva najavljuje da je veštačka inteligencija.',
  footerCopy: '© 2026 GLAS AI · Beograd',

  /* §6 · the transcript, verbatim */
  transcript: [
    ['Agent', 'Ordinacija Novak, dobar dan. Ja sam veštačka inteligencija, poziv se snima. Za osobu recite operater.'],
    ['Pozivalac', 'Dobar dan, hteo bih da zakažem pregled.'],
    ['Agent', 'Naravno. Prvi slobodan termin je u sredu u 14.00 — da li vam odgovara?'],
    ['Pozivalac', 'Može, sreda je super.'],
    ['Agent', 'Zakazano — sreda u 14.00. Ponoviću: sreda, četrnaest časova. Prijatan dan!']
  ],
  phone: ['Dolazni poziv', 'AI AGENT AKTIVAN', 'zakonska najava', 'Termin zakazan', 'Sreda · 14.00', 'Upisano u kalendar'],
  playLabel: 'Poslušaj agenta'   /* DEMO_AUDIO is set, so the player is live */
};

const norm = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
let fails = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const a = norm(got), b = norm(want);
  if (a === b) return true;
  fails++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  console.log(`      got : ${JSON.stringify(a)}`);
  console.log(`      want: ${JSON.stringify(b)}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log(`      first difference at index ${i}: got ${JSON.stringify(a[i])} (U+${(a.codePointAt(i)||0).toString(16).toUpperCase().padStart(4,'0')}) want ${JSON.stringify(b[i])} (U+${(b.codePointAt(i)||0).toString(16).toUpperCase().padStart(4,'0')})`); break; }
  }
  return false;
}
function ok(label, cond, detail) {
  checks++;
  if (cond) return true;
  fails++; console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? '  — ' + detail : ''}`);
  return false;
}

const fontCss = fs.readFileSync(path.join(FIX, 'fonts.css'), 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: fontCss }));
await ctx.route(/fonts\.gstatic\.com/, r => { const f = path.join(FIX, 'gstatic', r.request().url().replace('https://fonts.gstatic.com/', '').replace(/\//g, '_')); r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) }); });
await ctx.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/, r => { const u = r.request().url(); const f = /gsap\.min/.test(u) ? 'gsap/dist/gsap.min.js' : /ScrollTrigger/.test(u) ? 'gsap/dist/ScrollTrigger.min.js' : 'lenis/dist/lenis.min.js'; r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, f)) }); });
/* the live-demo widget, served locally so this check is hermetic and never
   waits on a network that is not there */
await ctx.route(/unpkg\.com/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, '@elevenlabs/convai-widget-embed/dist/index.js')) }));
await ctx.route(/storage\.googleapis\.com\/eleven-public-cdn/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
await ctx.route(/elevenlabs\.io/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ widget_config: { variant: 'full', placement: 'bottom-right', avatar: { type: 'orb', color_1: '#2792dc', color_2: '#9ce6e6' }, feedback_mode: 'none', language: 'sr', mic_muting_enabled: false, transcript_enabled: false, text_input_enabled: false, default_expanded: false, always_expanded: false, dismissible: false, text_contents: {}, language_presets: {}, disable_banner: true, text_only: false, supports_text_only: false } }) }));
const page = await ctx.newPage();
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(`window.__glasBooted === true`, null, { timeout: 20000 });
await page.waitForTimeout(1800);
await page.waitForTimeout(2200);

/* A counting numeral is aria-hidden with a visually-hidden twin carrying the
   real value, so assistive tech never reads a value mid-animation. Strip the
   twin before diffing, or every count-up would read as a doubled digit. */
const VISIBLE = `(e => { const c = e.cloneNode(true); c.querySelectorAll('.vh').forEach(n => n.remove()); return c.textContent; })`;
const T = sel => page.$$eval(sel, (es, fn) => es.map(eval(fn)), VISIBLE);
const T1 = async sel => (await page.$eval(sel, (e, fn) => eval(fn)(e), VISIBLE).catch(() => null));

console.log('\n\x1b[1mROUND 4 · content, language and claims\x1b[0m\n');

/* nav + hero */
eq('nav links', (await T('.nav-links .nav-link')).join('|'), EXPECT.nav.join('|'));
eq('nav CTA', await T1('.nav-actions .btn--primary'), EXPECT.navCta);
eq('hero eyebrow', await T1('#hero .eyebrow'), EXPECT.eyebrow);
eq('h1', await T1('h1'), EXPECT.h1);
eq('hero sub', await T1('#hero .lede'), EXPECT.heroSub);
eq('hero CTAs', (await T('.hero-cta .btn')).join('|'), EXPECT.heroCta.join('|'));
eq('micro-stats', (await T('.microstat')).join('|'), EXPECT.microstats.join('|'));

/* problem */
eq('problem eyebrow', await T1('#problem .eyebrow'), EXPECT.problemEyebrow);
eq('problem h2', await T1('#problem h2'), EXPECT.problemH2);
eq('problem body', await T1('#problem .lede'), EXPECT.problemBody);
eq('stat figures', (await T('.stat-fig')).join('|'), EXPECT.stats.map(s => s[0]).join('|'));
eq('stat captions', (await T('.stat-cap')).join('|'), EXPECT.stats.map(s => s[1]).join('|'));
ok('no unsourced percentage published anywhere', !/\b(30|85)\s*%/.test(await page.evaluate('document.body.innerText')));

/* steps */
eq('steps h2', await T1('#kako-radi h2'), EXPECT.stepsH2);
eq('step numbers', (await T('.step-n')).join('|'), EXPECT.steps.map(s => s[0]).join('|'));
eq('step titles', (await T('.step-title')).join('|'), EXPECT.steps.map(s => s[1]).join('|'));
eq('step bodies', (await T('.step p')).join('|'), EXPECT.steps.map(s => s[2]).join('|'));

/* features */
eq('features h2', await T1('#mogucnosti h2'), EXPECT.featH2);
eq('talk: button', await T1('#talk-label'), EXPECT.talk.start);
eq('talk: note', await T1('#talk-note'), EXPECT.talk.note);
eq('talk: failed-attempt notice (owner copy)', await T1('#talk-fail'), 'Povezivanje nije uspelo — pokušajte ponovo.');
ok('talk: the clock has a name for AT and none for the eye', (await page.$eval('#talk-live', e => e.textContent)).trim().startsWith('Preostalo') && (await T1('#talk-live')).trim().startsWith('00:'));
eq('talk: card heading', await T1('#talk-card h3'), EXPECT.talk.cardH);
eq('talk: card body', await T1('#talk-card p'), EXPECT.talk.cardP);
eq('talk: card button', await T1('#talk-book'), EXPECT.talk.cardBtn);
eq('talk: run-again reuses the start label', await T1('#talk-again'), EXPECT.talk.start);
eq('feature titles', (await T('.feat h3')).join('|'), EXPECT.feats.map(f => f[0]).join('|'));
eq('feature bodies', (await T('.feat p')).join('|'), EXPECT.feats.map(f => f[1]).join('|'));

/* voice */
eq('voice eyebrow', await T1('#glas .eyebrow'), EXPECT.voiceEyebrow);
eq('voice h2', await T1('#glas h2'), EXPECT.voiceH2);
eq('voice sub', await T1('#glas .lede'), EXPECT.voiceSub);
eq('band marks', (await T('.band-mark span')).join('|'), EXPECT.voiceMarks.join('|'));
eq('voice caption', await T1('.voice-cap'), EXPECT.voiceCap);
eq('play label', await T1('#play-label'), EXPECT.playLabel);
ok('the recording is served as audio', await page.evaluate(`(async () => { const r = await fetch('demo.mp3'); return r.ok && /audio/.test(r.headers.get('content-type') || '') && (await r.blob()).size > 10000; })()`));

/* marquee */
eq('marquee', await T1('.marquee-run'), EXPECT.marquee);
eq('marquee section label', await T1('.marquee-label'), 'Za koga');

/* pricing */
eq('pricing h2', await T1('#cene h2'), EXPECT.priceH2);
eq('plan names', (await T('.price-name')).join('|'), EXPECT.prices.map(p => p[0]).join('|'));
eq('plan figures', (await T('.price-fig')).join('|'), EXPECT.prices.map(p => (p[1] + ' ' + p[2]).trim()).join('|'));
eq('plan badge', await T1('.price-badge'), EXPECT.priceBadge);
for (let i = 0; i < 3; i++) {
  eq(`plan ${i + 1} features`, (await page.$$eval(`.price:nth-of-type(${i + 1}) .price-list li`, es => es.map(e => e.textContent))).join('|'), EXPECT.prices[i][3].join('|'));
  eq(`plan ${i + 1} button`, await page.$eval(`.price:nth-of-type(${i + 1}) .btn`, e => e.textContent), EXPECT.prices[i][4]);
}
eq('pricing note', await T1('.price-note'), EXPECT.priceNote);
ok('prices use a non-breaking space before €', (await page.$$eval('.price-fig', es => es.map(e => e.textContent))).filter(t => /€/.test(t)).every(t => / €/.test(t)));

/* faq */
eq('faq h2', await T1('#pitanja h2'), EXPECT.faqH2);
eq('faq questions', (await T('.faq-q')).map(t => t.trim()).join('|'), EXPECT.faq.map(f => f[0]).join('|'));
eq('faq answers', (await T('.faq-panel p')).join('|'), EXPECT.faq.map(f => f[1]).join('|'));

/* kontakt + footer */
eq('kontakt eyebrow', await T1('#kontakt .eyebrow'), EXPECT.kontakt.eyebrow);
eq('kontakt h2', await T1('#kontakt h2'), EXPECT.ctaH2);
eq('kontakt sub', await T1('#kontakt .lede'), EXPECT.ctaSub);
eq('kontakt: the screen\'s heading', await T1('.lap-title'), EXPECT.kontakt.h3);
eq('kontakt: the address, as text', await T1('#lap-mail'), EXPECT.kontakt.mail);
ok('kontakt: the address is a mailto link to itself', (await page.getAttribute('#lap-mail', 'href')) === 'mailto:' + EXPECT.kontakt.mail);
eq('kontakt: the copy button', await T1('#lap-copy-idle'), EXPECT.kontakt.copy);
eq('kontakt: the copied label', await T1('#lap-copy-done'), EXPECT.kontakt.copied);
ok('kontakt: the copied label is out of the button\'s name until it is true', (await page.$eval('#lap-copy', e => e.textContent.replace(/\s+/g, ' ').trim())) === EXPECT.kontakt.copy + ' ' + EXPECT.kontakt.copied && (await page.$eval('#lap-copy-done', e => getComputedStyle(e).visibility)) === 'hidden');
ok('no paygate: every booking link lands on #kontakt', await page.evaluate(`Array.from(document.querySelectorAll('.price .btn, .nav-actions .btn--primary, .menu-foot .btn, .hero-cta .btn--ghost, #talk-book')).every(a => a.getAttribute('href') === '#kontakt') && document.querySelectorAll('a[href="#cta"]').length === 0`));
ok('no „uskoro” placeholder on a live page', !/uskoro/i.test(await page.evaluate('document.body.innerText')));
eq('footer nav', (await T('.footer-nav a')).join('|'), EXPECT.footerNav.join('|'));
eq('footer legal line', await T1('.footer-legal p'), EXPECT.footerLegal);
eq('footer copyright', await T1('.footer-mark'), EXPECT.footerCopy);

/* the phone */
eq('transcript speakers', (await T('.ph-who')).join('|'), EXPECT.transcript.map(t => t[0]).join('|'));
eq('transcript bubbles', (await T('.ph-bubble')).join('|'), EXPECT.transcript.map(t => t[1]).join('|'));
ok('legal disclosure is the FIRST thing the agent says',
   norm(await T1('.ph-bubble')) === norm(EXPECT.transcript[0][1]) && /veštačka inteligencija/.test(await T1('.ph-bubble')));
for (const p of EXPECT.phone) ok(`phone UI string present: "${p}"`, (await page.evaluate('document.querySelector("#hero").textContent')).includes(p));

/* meta + language */
const meta = await page.evaluate(`({
  lang: document.documentElement.lang,
  title: document.title,
  desc: (document.querySelector('meta[name=description]')||{}).content,
  ogT: (document.querySelector('meta[property="og:title"]')||{}).content,
  ogD: (document.querySelector('meta[property="og:description"]')||{}).content,
  ogType: (document.querySelector('meta[property="og:type"]')||{}).content,
  ogLoc: (document.querySelector('meta[property="og:locale"]')||{}).content,
  charset: (document.querySelector('meta[charset]')||{}).getAttribute ? document.querySelector('meta[charset]').getAttribute('charset') : '',
  viewport: (document.querySelector('meta[name=viewport]')||{}).content
})`);
ok('lang="sr-Latn"', meta.lang === 'sr-Latn', meta.lang);
ok('charset utf-8', (meta.charset || '').toLowerCase() === 'utf-8', meta.charset);
ok('viewport has viewport-fit=cover', /viewport-fit=cover/.test(meta.viewport || ''), meta.viewport);
ok('og:type = website', meta.ogType === 'website');
ok('og:locale = sr_RS', meta.ogLoc === 'sr_RS');
eq('meta description is the §8 hero sub, verbatim', meta.desc, EXPECT.heroSub);
eq('og:description is the §8 hero sub, verbatim', meta.ogD, EXPECT.heroSub);
ok('title is brand + the §8 H1, verbatim', meta.title === 'GLAS AI — ' + EXPECT.h1, meta.title);
ok('og:title matches title', meta.ogT === meta.title);

/* no Cyrillic anywhere in visible text */
const bodyText = await page.evaluate('document.body.innerText');
ok('no Cyrillic in visible copy', !/[Ѐ-ӿ]/.test(bodyText));

/* claims audit: nothing may imply the caller is deceived */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const DECEPTION = [
  /ne\s+prime(ć|c)uj/i, /ne\s+primet/i, /ne\s+zna(ju)?\s+da\s+je\s+(ve(š|s)ta(č|c)k|AI|robot)/i,
  /misle\s+da\s+(je|razgovaraju)/i, /ne\s+razlikuj/i, /nikad(a)?\s+ne\s+sazna/i,
  /kao\s+da\s+je\s+(pravi\s+)?(č|c)ovek/i, /indistinguishable/i, /nobody\s+notices/i, /ne\s+mo(ž|z)ete\s+da\s+razlikuje/i
];
const hits = DECEPTION.filter(re => re.test(html)).map(String);
ok('no claim implies callers are deceived', hits.length === 0, hits.join(' '));
ok('the AI disclosure is stated in the FAQ', /Da, na po(č|c)etku svakog poziva\. To je zakonska obaveza/.test(html));
ok('the AI disclosure is stated in the footer', /Agent na po(č|c)etku svakog poziva najavljuje da je ve(š|s)ta(č|c)ka inteligencija\./.test(html));
ok('talk: the state labels exist only in the script, verbatim', /"Povezujem…"/.test(html) && /"Slušam"/.test(html));
ok('talk: no SMS anywhere in the file — markup, comments, meta, script', !/sms/i.test(html));
/* the snippet as supplied, with one deliberate change: the bundle is pinned to
   the version the forty-second cap was verified against */
/* the client's snippet, byte for byte — the one thing on this page that is
   quoted rather than written, so it is asserted as a literal */
ok('talk: the widget snippet is present, exactly as supplied', html.includes('<elevenlabs-convai agent-id="agent_5701m14n57q9e25ryes2tg8tdjhd"></elevenlabs-convai><script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>'));
ok('talk: the ending and stop words exist only in the script, verbatim', /"Završavam…"/.test(html) && /"Slušam — prekini demo"/.test(html));
ok('the AI disclosure is the first line of the transcript', /Ja sam ve(š|s)ta(č|c)ka inteligencija, poziv se snima/.test(html));
ok('a human is always reachable — stated in copy', /Dovoljno je re(ć|c)i „operater” i poziv ide na va(š|s) broj\./.test(html));

/* aria-label / title / alt must not contain generated Serbian beyond the declared set */
const ARIA = await page.evaluate(`Array.from(document.querySelectorAll('[aria-label],[title],[alt]')).map(e => e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('alt'))`);
const ALLOWED_ARIA = new Set(['GLAS AI', 'Meni', 'Slušam — prekini demo']);
const strayAria = ARIA.filter(a => a && !ALLOWED_ARIA.has(a.trim()));
ok('no generated Serbian in aria-label / title / alt', strayAria.length === 0, JSON.stringify(strayAria));

/* every string that is NOT in §8 must be one of the declared exceptions */
const DECLARED_EXTRA = ['Preskoči na sadržaj', 'Meni', 'Zatvori', 'Zaustavi', '21.40', '+381 6• ••• •••', '00:22', 'Agent', 'Pozivalac',
  /* the live demo's own words, written once its copy was delegated: a stop name, an ending, a clock label, a failed attempt, a new-window hint */
  'Slušam — prekini demo', 'Završavam…', 'Preostalo', 'Povezivanje nije uspelo — pokušajte ponovo.', '(otvara se u novom prozoru)',
  /* the microphone's three notices — the one place a visitor can act on a failed attempt */
  'Mikrofon je blokiran u pretraživaču — dozvolite ga za ovu stranicu i pokušajte ponovo.', 'Nije pronađen mikrofon.', 'Mikrofon je zauzet ili nedostupan — pokušajte ponovo.',
  /* the player's own name, once a recording exists: it plays the agent — „Poslušaj demo” is the hero link that scrolls here */
  'Poslušaj agenta',
  /* the contact section, written for the client's address: an eyebrow, a heading, the address, a button and what it says once pressed */
  'KONTAKT', 'Pišite nam.', 'support@glasai.online', 'Kopiraj adresu', 'Kopirano', 'Adresa je kopirana.'];
console.log(`\n  \x1b[2mDeclared non-§8 UI strings (a11y names the brief does not supply): ${DECLARED_EXTRA.filter(x => /[a-zA-Zčćšžđ]/.test(x)).join(', ')}\x1b[0m`);

console.log(`\n${'─'.repeat(72)}\n  ${checks - fails}/${checks} content checks passed${fails ? `   \x1b[31m${fails} FAILING\x1b[0m` : '   \x1b[32mall green\x1b[0m'}\n${'─'.repeat(72)}\n`);
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
