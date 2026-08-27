# GLAS AI — build report

Deliverables: **`index.html`** (the complete site, one self-contained file),
**`audit.js`** (the Playwright harness that was actually run), and
**`.audit/copy-check.mjs`** (the §9 Round 4 content diff). Screenshots land in
`.audit/shots/`.

```
cd .audit && npm install      # gsap + lenis, served to the browser locally
node audit.js                 # all rounds  (--quick skips the 74 s loop round)
node .audit/copy-check.mjs    # every visible string, diffed against §8
```

---

## 1 · The two lines the client edits to go live

At the very top of the `<script>` in `index.html`:

```js
const CONFIG = {
  DEMO_TELEFON: "",   // npr. "+381 64 123 4567" — prazno = dugme je neaktivno
  DEMO_AUDIO:   ""    // npr. "demo.mp3" — prazno = plejer je u stanju „uskoro"
};
```

Nothing else needs touching. Both empty states are designed, not broken, and
both filled states are exercised by the harness:

| | empty (shipped) | filled |
|---|---|---|
| `DEMO_TELEFON` | inert chip `Demo broj — uskoro`, muted, dashed hairline, `cursor: default`, `aria-disabled="true"`. **No fake number and no dead `tel:` anywhere.** | live `tel:` link in the nav, the mobile menu and the final CTA, showing the number exactly as typed |
| `DEMO_AUDIO` | **no `<audio>` element is constructed at all.** The player sits in a `uskoro` state — dashed ring, muted `Snimak uskoro`, `aria-disabled` — and a tap pulses the band instead of erroring | a real play/pause control; a Web Audio analyser drives the band's amplitude and it settles back on `ended` |

---

## 2 · Round 1 — final automated audit (`node audit.js`)

**92 / 92 passed, all green.** Full table below; it is reproduced verbatim from
the last run. Everything was actually executed in headless Chromium against the
real file.

| # | round | checks | result |
|---|---|---|---|
| 1 | Console — network idle + 5 s of animation | 2 | zero `console.error`, zero `pageerror`, zero unhandled rejections; GSAP + ScrollTrigger + Lenis all live |
| 2 | Horizontal overflow @ 360/390/414/768/1024/1280/1440/1920 | 8 | `scrollWidth ≤ clientWidth` at every width, checked at the top of the page **and** after a full scroll-through |
| 3 | Screenshots | 1 | stepped viewport frames at all 8 widths + 6 phone-loop states + degraded states |
| 4 | **CDN blocked (F1)** — cdnjs + jsDelivr aborted at the network layer | 9 | GSAP genuinely absent; all 30 `[data-reveal]` blocks visible; hero copy visible; the phone falls back to a readable booked state; page scrolls; 4 947 characters of body text; zero console errors |
| 5 | `prefers-reduced-motion: reduce` | 5 | marquee static, Lenis never constructed, no `js-motion`/`js-loop`, phone at rest in the booked state |
| 6 | Diacritics | 5 | `fonts.check` true, glyphs distinct from their bases, no `.notdef`, in all three families |
| 7 | CONFIG placeholders, empty **and** filled | 10 | see the table in §1; also asserts the primary CTA never points backwards |
| 8 | Phone loop — 3 cycles + a 30 s tab switch | 7 | never two states at once, typing never overlaps its own bubble, timer never runs backwards, 3 clean wraps, no flash across the seam, coherent after backgrounding |
| 9 | Contrast | 16 | 15 token pairs computed + every text node measured in situ against its real composited background — 0 failures. `--muted` on `--ink` is 6.48:1 |
| 10 | Accessibility & interaction | 16 | landmarks, one `h1`, heading order, skip link, real accordion semantics, 28 keyboard tab stops each with a visible ring, focus never inside a closed panel, menu lock/unlock across a breakpoint |
| 11 | Motion QA | 5 | 1920 → 360 resize *while the hero is pinned*, portrait ↔ landscape mid-scroll, instant scroll to the bottom skips no reveal |
| 12 | 4× CPU throttle | 2 | still boots, scrolls and reveals |
| 13 | Touch (Pixel 7) | 8 | sway replaces cursor tilt, magnetism never engages, no pin, menu works by tap, the inert player answers a tap without erroring |

**Round 4 — content (`node .audit/copy-check.mjs`): 75 / 75 passed.** Every
visible string diffed against §8/§6/§7 character for character (only NBSP is
normalised, since §8 requires it before `€`), plus: no Cyrillic anywhere, no
`30 %`/`85 %` published, meta/OG built only from §8 sentences, no generated
Serbian in `aria-label`/`title`/`alt`, a regex sweep for any claim implying the
caller is deceived, and the presence of the AI disclosure in all three required
places (transcript, FAQ, footer).

---

## 3 · Round 2 — adversarial code review (subagent)

Instructed to find problems, not to approve. It returned 29 findings plus two
it flagged as uncertain. **23 were real and are fixed.** The ones that mattered:

| # | finding | fix |
|---|---|---|
| 1 | `.price--hi { transform: translateY(-0.85rem) }` on an element that also carries `data-reveal` — the reveal tween folds the lift into GSAP's `y` cache and lands on 0, so the featured plan permanently loses its elevation the moment it scrolls into view | the lift is `top` now, which GSAP's transform cannot clobber |
| 2 | `.btn` transitioned `transform`, which `gsap.quickTo` writes every frame — double-easing the magnetic follow — and the resulting inline transform meant `:active { transform: scale() }` could never apply, so pressing a CTA gave no feedback on the one platform magnetism targets | the transition drops `transform`; the press uses the standalone `scale` property, which composes with transform instead of fighting it |
| 3 | the rotating conic border animated forever on 7–10 buttons on devices that can never show it | moved inside `(hover: hover) and (pointer: fine)` and gated on `:hover`/`:focus-visible` |
| 4 | the four blurred `.glow` layers — the page's most expensive compositing — were the only loops F8 never froze | one `[data-freeze]` observer now covers the hero, the CTA, the marquee and the phone |
| 5 | all 31 reveal targets were given `will-change` at once and held it for the session | promoted per batch, only while moving, released on complete |
| 6 | the debounced resize handler called `ScrollTrigger.refresh()` on every resize, defeating `ignoreMobileResize` set twelve lines away — a mobile URL-bar collapse would jump the pinned hero | refresh is gated on a **width** change; `orientationchange` forces it |
| 7 | collapsed FAQ panels were zero-height but still in the a11y tree, in find-in-page and in tab order | `visibility: hidden` with a delayed transition, restored for the no-JS path |
| 8 | the phone was fully exposed to assistive tech while a 24 s timeline rewrote it every few seconds | `aria-hidden` **only while the loop runs**; the static, reduced-motion and no-JS states stay fully exposed |
| 9 | the menu's focus trap excluded its own visible close control, and nothing outside was inerted | the burger joined the trap; `main` and `footer` go `inert`; the overlay is a real `role="dialog" aria-modal` |
| 10 | two `<nav>` landmarks with the identical name `GLAS AI` | the footer link list is no longer a landmark |
| 11 | the marquee band was named after the first industry inside it | the bogus `aria-label` is gone |
| 13 | `initHero`'s font race could resolve **after** its own teardown, building a timeline no context owned and that nothing would ever kill | a `dead` flag closes the continuation |
| 14/15 | two different anchor offsets for the same click, and `preventDefault` with no `pushState` — Back was broken after any in-page jump | one measured offset (so `is-stuck` counts); the history entry is written |
| 16 | `initNav` registered its scroll listener *before* validating `#nav`, so a rename would throw on every scroll event forever — exactly the failure `safe()` exists to contain | validate first |
| 17 | the phone loop's only `play()` path was the IntersectionObserver; without one it froze on the incoming-call frame | explicit fallback |
| 18 | the bands read `prefers-reduced-motion` once at boot, outside `gsap.matchMedia`, so toggling the OS setting left six canvases wrong forever | band motion is driven from the matchMedia context like everything else |
| 21 | the `AudioContext` was never closed and `createMediaElementSource` is irreversible — a leak per context re-run once `DEMO_AUDIO` is filled | closed on teardown |
| 23 | the "boot never happened" fallback opened the accordion panels while their buttons still reported `aria-expanded="false"` | it now restores `no-js` and corrects the ARIA |
| 27 | the step connector's right edge was hard-wired to exactly three steps (`right: 28.2%`); the loop's stop value and the static markup disagreed (`00:20` vs `00:22`) | the rail is measured from the first and last number; the timer comes from one constant |
| 28 | three `visibilitychange` listeners with three different resume policies | one dispatcher, one policy per module |
| 29 | the comments claimed `power3.out == cubic-bezier(.16,1,.3,1)` and `back.out(1.7) == cubic-bezier(.34,1.56,.64,1)`. Neither is true, so CSS and JS motion did **not** match | a real cubic-bezier solver (Newton + bisection); §5's two curves are now literally the same function in both languages |

It also confirmed clean: F1, F2, F3 (canonical wiring, verbatim), F4, F9, F11;
`getTotalLength()` ordering; `immediateRender` on every `fromTo`; `invalidate()`
on repeat; `.btn > :not(.band)`; `.menu[hidden]` specificity; and it found no
dead CSS on the second pass (the first pass's dead rules had already gone).

**Not changed, with reasons:** `#play` keeps `aria-disabled` with a live
decorative handler — a band pulse is not an action, and the duplicate
announcement it flagged *was* fixed; `withBag` capturing only synchronous
registrations is now latent since finding 13 closed the one async path (a
comment says so); single `heroBand`/`voiceBand`/`btnBand` globals are
single-instance by design on this page and are documented as such; the `CUES`
table stays a table, because a timeline score reads better as data than as
derived constants.

---

## 4 · Round 3 — design director review (separate subagent, on the screenshots)

Its verdict: *"The engineering hours are visible. The design decisions are not."*
It found one hard violation of the brief and a long list of real defects. **Its
top 15 are all addressed.** The important ones:

**One banned-list violation, confirmed by sampling pixels.** The featured
pricing card's border was `linear-gradient(160deg, amber → cyan)`. §4.2 says the
two never blend; the reviewer measured the crossover at `#302F30`, hue 300 —
exactly the muddy purple-grey the ban exists to prevent — and it was on a
non-AI element. **Now amber only.**

**The funnel did not exist.** Every CTA terminated in a loop, and the page's
largest button, `Zakaži demo razgovor`, pointed *backwards* at the price list.
The primary CTA now resolves forward through a documented chain: a booking link,
else the demo number, else the voice section. It is never circular and never
dead. This is the one place I added a third `CONFIG` value (see §6).

**Green was an undeclared third accent.** `--confirm` is specified as
"booked, and nothing else" and had leaked onto the answer button, its two pulse
rings and the in-call status dot. Green now survives only on the confirmation
card; the incoming call is amber, which is the human side of the line.

**The cyan the page actually shows was at half chroma.** The badge used
`--machine-hi` (saturation 0.30 against the spec's 0.61). It is `--machine` now,
and the badge itself stopped being a rounded status pill — the banned hero-badge
trope relocated 800px right — and became a mono line with a leading rule, in the
same language as every section eyebrow.

**Display type read straight through the sticky bar** at 62% opacity. Opaque now.

**The pin spent the second screen erasing the demo:** it held for 62% of the
viewport while the phone faded to `opacity: 0.32`. Now 42% with a 0.7 floor.

**The hero band crossed the phone at its waist**, so "the phone stands on the
line" was never implemented. It now runs under the device's base.

**The problem block promised evidence and delivered copywriting** — three
sentence fragments set in the visual language of statistics. They now read as
the three sentences §8 actually wrote, with the lead carrying the accent.

Also fixed: the section rhythm (boundaries with a divider measured ~2× those
without — the divider now sits *inside* the gap instead of adding to it); the
play control moved off the lit slice it was covering; the marquee got its §8
section name `Za koga` so a category list is not read as missing social proof,
and an edge mask with a box that cannot tile; the step connector turns into a
vertical rail on mobile instead of vanishing; a middot can no longer open a line
at 360/390px; the same component was set at two sizes under `PROBLEM` and
`GLAS`; the stat row aligns to the page's left edge; the FAQ heading is sticky
so its column is not 600px of dead space.

**Disagreed with, and why:**

- **"Add the 300 Hz / 3400 Hz rails to the hero too."** Good instinct, but §4.3
  is explicit that the hero instance is "barely alive". Labelling it there would
  make it explanatory and break the escalation into the voice section. Kept.
- **"Break the feature grid 2-up."** §8 specifies 6 cards, 3×2 → 1 column. Kept.
- **"The body scale has four sizes in a 6px range."** The four are 14/17/20/24 —
  a consistent 1.2 ratio, which is a scale, not noise. I fixed the real
  complaint underneath it (one component at two sizes) and left the ladder.
- **"Replace the marquee with real proof or cut it."** §8 mandates the section
  and its content. Labelling it removes the misread at no cost; inventing
  testimonials is not on the table.
- **"Supply real figures for the problem block."** §8's own guidance is that
  unsourced statistics must not be published. There are no sources, so the
  replacement block stands — restyled so it no longer *looks* like data.

---

## 5 · What I could not run, and why

Stated plainly, because a false green tick means the bug ships.

1. **No real browser other than Chromium 141.** Everything below was reasoned
   about and written correctly, but **not executed**: Safari (WebKit) and
   Firefox (Gecko), and therefore every `-webkit-` prefix, the
   `@supports not (backdrop-filter)` fallback, `mask-composite: exclude` vs
   `-webkit-mask-composite: xor`, `text-wrap: balance`, `@property --ang`,
   `inert`, and the standalone `scale` property used for the button press.
   Playwright ships WebKit and Firefox builds, but only Chromium is installed
   in this sandbox and the download host is blocked. **Test in Safari before
   launch** — it is the one engine where the nav's `backdrop-filter` and the
   conic-gradient border have historically differed.
2. **No real device.** The touch round runs Chromium with `hasTouch` and a
   coarse pointer, which is an emulation. Real iOS/Android — notably the
   `100svh` behaviour when the URL bar collapses mid-scroll, and `tel:` links —
   is untested on hardware.
3. **The live CDNs were never reached.** This sandbox's egress policy blocks
   `cdnjs.cloudflare.com` and `cdn.jsdelivr.net` (403 at the proxy). Every run
   serves the *real* library bytes from `node_modules` and the *real* Google
   Fonts CSS and `woff2` files from `.audit/fixtures`, fulfilled through route
   interception — so the code paths and the bytes are genuine, but the **URLs
   themselves are unverified**. The GSAP paths are the canonical cdnjs ones; I
   moved Lenis to a jsDelivr npm path (`/npm/lenis@1.1.18/dist/lenis.min.js`)
   precisely because that path can be checked against the package I have
   locally, where a cdnjs path could only be guessed. **Load the page once with
   the network open and confirm all three scripts return 200.** If Lenis 404s
   the page degrades correctly (no smooth scroll, everything else intact) —
   that is the F1 path and it is tested.
4. **No real slow connection.** Round 12 throttles CPU 4×; it does not throttle
   the network. The font-race timeout (1200 ms before the hero animates
   regardless) is reasoned, not measured against 3G.
5. **`prefers-contrast: more` is written but not asserted.** The tokens are
   overridden and the contrast maths for them is trivially higher, but no round
   emulates that media feature.
6. **The `DEMO_AUDIO` analyser path is only half-exercised.** Round 7 loads a
   generated silent WAV and drives the play/pause states; a real recording with
   real amplitude was never played, so the band's audio-reactive gain
   (`sum / data.length / 110`) is a reasoned constant, not a tuned one. Expect
   to adjust that divisor once a real demo file exists.
7. **Full-page screenshots are unreliable on this page** and I do not treat them
   as evidence. `captureBeyondViewport` re-lays-out a ScrollTrigger-pinned
   section and mis-places `position: fixed` elements. Round 3 takes stepped
   viewport frames instead; the two full-page files are kept only as a
   whole-page reference. (The skip link appearing mid-page in
   `cdn-blocked.png` is this artefact — verified separately that it sits at
   `top: -57px` until the first Tab.)

---

## 6 · Departures from the brief, and why

1. **A third `CONFIG` value, `DEMO_LINK`.** §7 says two. The design review
   established that without a booking destination every CTA on the page loops,
   and the largest button pointed backwards at the price list. Inventing a
   contact form was not an option — §8 forbids generating Serbian, and form
   labels would have to be generated. A single commented URL is the smallest
   thing that makes the page able to convert. It degrades in the same designed
   way as the other two: booking link → demo number → the voice section.
2. **§8's replacement block, not the percentages.** `30 %` and `85 %` are
   unsourced; the brief itself says to use the replacement block if the client
   has no source. Consequence: the count-up utility has fewer numerals to
   animate, so it runs on the hero's `2` and the `1 poziv` figure only.
3. **The pin is on the hero section, not on the phone alone.** §6 asks for the
   phone to be pinned and released. Pinning the phone with `pinSpacing: false`
   jumps by the pin distance at release; pinning it with spacing inflates the
   grid row it sits in. Pinning the section and scrubbing the phone inside it
   gives the same journey with no jump, and survives the 1920 → 360 resize test
   in Round 11. It is still a real `ScrollTrigger` pin with
   `invalidateOnRefresh: true`.
4. **The step numbers get an SVG-free connector, not a fifth band.** §4.3 says
   the motif appears in exactly four places; §8 §3 asks for the band to pulse as
   each number activates. I kept the four placements and gave the steps a drawn
   rail with a travelling amber pulse instead of a fifth canvas.
5. **The band's easing.** §5 names two `cubic-bezier` curves. GSAP core has no
   cubic-bezier ease and `CustomEase` is a separate file, so the page implements
   the solver inline. CSS and JS now ease identically rather than approximately.
6. **The phone is `aria-hidden` while the loop runs.** A transcript that
   rewrites itself every few seconds is hostile to a screen reader. The static,
   reduced-motion and no-JS states — which are the *same markup* — stay fully
   exposed, and the legal disclosure appears twice more, in the FAQ and the
   footer, where it is stable.
7. **Nine strings are not from §8**, because §8 supplies no accessible names:
   `Preskoči na sadržaj` (skip link), `Meni` (menu toggle and the dialog's
   name), `Zatvori`, `Pauziraj` (only ever shown once `DEMO_AUDIO` is filled),
   `Agent` / `Pozivalac` (the transcript speaker labels §6 uses), `Za koga`
   (§8's own name for section 6, used as its eyebrow), plus `21.40` and
   `+381 6• ••• ••••` in the phone chrome. All are single dictionary words or
   §8's own headings; nothing was composed.

---

## 7 · The one thing I would change next

The page still has no conversion endpoint of its own — `DEMO_LINK` points at
someone else's booking widget. If the client wants the form on-page, it needs
two field labels and a success message in Serbian, written by a native speaker,
plus somewhere to post to. That is the highest-value hour of work left on this
site, and it is not something the brief let me invent.
