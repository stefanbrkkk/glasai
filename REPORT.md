# GLAS AI — build report

Deliverables: **`index.html`** (the complete site, one self-contained file),
**`audit.js`** (the Playwright harness that was actually run), and
**`.audit/copy-check.mjs`** (the §9 Round 4 content diff). Screenshots land in
`.audit/shots/`.

```
cd .audit && npm install      # gsap, lenis and the ElevenLabs widget, served to the browser locally
node audit.js                 # all rounds  (--quick skips the 74 s loop round)
node .audit/copy-check.mjs    # every visible string, diffed against §8
.audit/node_modules/.bin/html-validate --config .audit/.htmlvalidate.json index.html   # markup lint
```
One note on the harness itself: the phone-loop round watches the page for
74 s and is the one round sensitive to CPU starvation — run the suite alone,
not beside other browsers, or it can report zero wraps for a loop that is
fine.

---

## 1 · The three lines the client edits to go live

At the very top of the `<script>` in `index.html`:

```js
const CONFIG = {
  DEMO_TELEFON: "",   // npr. "+381 64 123 4567" — prazno = dugme je neaktivno
  DEMO_AUDIO:   "",   // npr. "demo.mp3" — prazno = plejer je u stanju „uskoro”
  DEMO_LINK:    ""    // npr. "https://cal.com/glasai/15min" — gde vodi glavno dugme
};
```

Nothing else needs touching. Every empty state is designed, not broken, and
every filled state is exercised by the harness:

| | empty (shipped) | filled |
|---|---|---|
| `DEMO_TELEFON` | inert chip `Demo broj — uskoro`, muted, dashed hairline, `cursor: default`, `aria-disabled="true"`. **No fake number and no dead `tel:` anywhere.** | live `tel:` link in the nav, the mobile menu and the final CTA, showing the number exactly as typed |
| `DEMO_AUDIO` | **no `<audio>` element is constructed at all.** The player sits in a `uskoro` state — dashed ring, muted `Snimak uskoro`, `aria-disabled` — and pressing it runs the spectrum self-test instead of erroring | a real play/pause control; a Web Audio analyser drives the band's amplitude and it settles back on `ended` |
| `DEMO_LINK` | the primary CTA falls back to the demo number, and failing that to the voice section — never circular, never dead | the CTA points at the booking page (`target="_blank"` for an absolute URL) |

`DEMO_LINK` is a departure from §7's two values; §9 of this report explains why.

---

## 2 · The motion round — what the client asked for after the first build

The brief for this pass, verbatim in substance: *the sound bars are the one
thing I dislike; several more scroll animations like the phone one are missing;
raise the visual of the whole site without changing the content or the rest,
which is good; nothing may be tasteless; and fix what happens when you press
play on the sound demo.*

### 2.1 · The meter

The old bars were a barcode: a constant-pitch comb whose heights came from one
noise field. It looked like every stock equaliser because it was one. What
replaced it is a spectrum analyser that models a voice on a telephone line:

- **A log-frequency axis.** 60 Hz to 12 kHz, so the 300–3400 Hz passband sits
  at a fixed `x = 0.3038 … 0.7620` on every canvas at every width. The two
  labelled rails, the probe's live Hz readout and the lit slice are all reading
  the *same* axis — that is why the readout says `360 Hz` where it does, and not
  because a number was picked to look right.
- **Two moving formants** under a vocal envelope, plus a syllabic amplitude
  clock, so the meter phrases instead of hissing. Five spatial noise terms at
  different frequencies keep adjacent bars related rather than independent.
- **Meter ballistics.** Fast attack (0.40), slow release (0.052) and a
  peak-hold that falls at 0.20/s — the behaviour of a real VU meter, not a
  per-frame random walk. The held peak is clamped to 6 px above its own bar, so
  it reads as a cap and never detaches into a floating dotted contour.
- **A soft limiter** (`knee 0.68`, `ceiling 0.96`) instead of a hard clamp.
  Measured off the rendered canvas: mean bar height 0.390 of the half-canvas,
  peak 0.925, **zero clipped samples** in 40 frames, and zero even under
  repeated fast scroll flicks (the scroll-velocity term is inside the limiter).
- **Bar pitch scales with the box.** A phone gets a third of the desktop width;
  holding the desktop pitch there left about eighteen bars inside the passband
  and the meter read as a bar chart. Below 470 px the pitch is 0.6×, below
  720 px 0.8×, integers only.
- **Drawn in batches.** Almost every in-band bar is lit at the same alpha, so
  they go into one path and one fill; only the filter's shoulders and the few
  bars under the scan need their own. That is about a dozen rasterisations a
  frame instead of ~380. The bloom is prerendered once to a 128×128 offscreen
  and blitted; the reflection is a CSS `mask-image`, not a second canvas pass;
  the palette strings, the centre-line gradient and the corner radius are built
  in `layout()`, not once a frame.

### 2.2 · The scroll system

Nine mechanisms, each a `gsap.matchMedia` scope with its own teardown:

| | what it does |
|---|---|
| **hero journey** | the section pins for 42 vh while the phone shrinks, flattens out of its tilt and drifts, the hero band lifts, and the copy hands over |
| **voice probe** | one scrub drives four things at once — a measurement cursor walking the spectrum, a live Hz readout, the band drawing itself in behind the cursor, and the level rising *only* while the cursor is inside 300–3400 Hz. Scroll past it and you have performed the section's argument without reading a word |
| **line masks** | headings arrive one *rendered* line at a time, measured with a `Range` against the real layout after `document.fonts.ready` — not with injected spans, which would change how `text-wrap: balance` breaks the block |
| **card reveals** | a 9° `rotateX` off a shared perspective, staggered |
| **drawn detail** | every eyebrow rule scales out of its own left edge; every line-art icon draws its stroke, with dash lengths corrected for `vector-effect: non-scaling-stroke` |
| **steps rail** | the connector draws between the first and last number, measured, with a travelling pulse — and turns vertical below 900 px, where the scrub switches axis |
| **divider draw-in** | each divider band reveals left-to-right with a drawing head |
| **scroll signal** | `ScrollTrigger.getVelocity()` feeds the bands' energy, so the meters lean into a fast flick and settle when you stop |
| **marquee** | scroll velocity drives `timeScale`, and the direction returns to forward once the magnitude decays |

### 2.3 · The play button

`DEMO_AUDIO` ships empty, so there is no recording to play. Rather than a dead
control, the button plays *the line*: a test tone walks the spectrum from
60 Hz upward, nothing happens until it reaches 300, it blooms across the
passband, and it dies again at 3400 — the section's entire claim, performed in
1.9 s. While it runs, the rest of the meter collapses to a floor, the peak-hold
decays 3.2× faster so the held trace of the broadband signal does not hang over
the collapsed meter as a second detached graphic, and the tone stays visible as
a bright tick while it crosses the dead parts of the axis, so the gate is
demonstrated rather than asserted. Measured off the canvas: passband energy
falls to 0.33 of resting, peaks at 0.63 as the tone crosses the middle, falls to
0.28, and recovers at 1.95 s. The hero's `Poslušaj demo` scrolls to the section
and fires the same sweep on arrival.

The sweep ends **with itself**, not on a wall clock, because a hidden tab stops
the ticker but never stops a `setTimeout`; a backstop timer at 2.2× the duration
guarantees the control is released even if the band scrolls away mid-sweep.

### 2.4 · One bug that predated the round

The hero pin adds 42 vh of spacing to the document, but it was created last, in
its own width-scoped context, so ScrollTrigger measured **every trigger below
it against the unpinned layout** — a 378 px error on the whole page, confirmed
against the previous commit. `refreshPriority: 10` puts the pin at the front of
the refresh order. The harness now asserts it (`every scroll trigger is measured
against the pinned layout`).

---

## 2b · The content round and the live demo — what the client asked for third

Five items, in the order they were asked.

### 1 · SMS is gone

Five places, not four — every one is out, and `grep -i sms` over the page, the
harness and the content corpus returns nothing:

| where | was | is |
|---|---|---|
| the phone's last agent line | `Zakazano — sreda u 14.00. Potvrda stiže SMS-om. Prijatan dan!` | `Zakazano — sreda u 14.00. Ponoviću: sreda, četrnaest časova. Prijatan dan!` |
| the phone's confirmation card, third line | `SMS potvrda poslata` | `Upisano u kalendar` |
| feature card 3 | `SMS potvrde i podsetnici` | `Usklađen sa zakonom`, with the body supplied, and a shield whose check is the interior mark — same 1.35 stroke, same round joins, the silhouette closing first like the other five |
| Starter plan, third bullet | `SMS potvrde` | (see 2) |
| step 03's body | `Zakazuje direktno u vaš kalendar i šalje SMS potvrdu klijentu. Vi samo dođete na posao.` | `Zakazuje direktno u vaš kalendar. Vi samo dođete na posao.` — **the fifth place; no copy was supplied for it, so the SMS clause came out and nothing was written in** |

The phone loop was re-timed for the longer line: the agent speaks 0.35 s
longer (`speakTo` 19.20 → 19.55), the confirmation lands 0.30 s later
(`CONFIRM_AT` 20.15) and the seam 0.20 s later (`OUT_AT` 22.55, `RESET_AT`
23.22, `IN_AT` 23.30) — the card's dwell gives up a tenth of a second so the
cycle stays exactly 24.0 s; the static timer is still `00:20`. While looking
at it, one bug that predates this round: the thread made room for the card by
reading the card's height while it was still `display: none`, which is zero,
so at common viewport sizes the card landed on top of the last line. It is
measured laid-out-but-unseen now. Watched at 16.8,
18.4, 19.9, 21.0, 22.4, 23.2, 24.6 and 26.5 s: the line fits its bubble on two
rows, the card lands with its check drawn, the screen goes dark on schedule and
the next ring fades up with no cut. Round 8 of the harness (three cycles and a
30 s tab switch) is green.

### 2 · Pricing

Starter: `Do 200 poziva mesečno · Zakazivanje termina · Prebacivanje na čoveka
· Osnovni izveštaji`. Professional: `Do 600 poziva mesečno · Sve iz Starter
paketa · Prilagođena skripta i ton · Prioritetna podrška`. Enterprise untouched.
The content corpus asserts both lists in order.

### 3 · The live demo — what the widget actually offers

The instruction was to add ElevenLabs' widget snippet, and the requirements
were a native-looking control, exact copy for four states, a visible countdown,
a hard cap with a graceful end, and an end card *in place of the widget*.
Those two things pull against each other, so the first hour went into finding
out what the widget really exposes — from its bundle, not from the web. The
bundle (`@elevenlabs/convai-widget-embed` 0.17.1, installed from npm, since
unpkg and elevenlabs.io are unreachable from this sandbox) has **no**
`startConversation`, `endConversation`, `conversationStarted` or
`conversationEnded` — the pages that document those are describing something
this version does not ship. It has one public hook: it dispatches
`elevenlabs-convai:call` with a mutable `detail.config` that it then spreads
into the SDK's `startSession`; the SDK spreads that config over no-op defaults
and calls `onConversationCreated(conversation)` before `onConnect`. The widget
overrides only `onMessage`, `onModeChange`, `onStatusChange`,
`onCanSendFeedbackChange` and its agent-tool callbacks, so a page can attach
`onConversationCreated`, `onConnect`, `onDisconnect` and `onError` through the
documented event and receive the live `Conversation` — which has `endSession`,
`setMicMuted`, `getOutputVolume` and `sendContextualUpdate`.

So the build is: the snippet, **verbatim**, inside a one-pixel box that is
`visibility: hidden`, transform-contained and `aria-hidden` — present, running,
never painted, never in the tab order. The page's own control (`.btn--ghost`,
a cyan line-art microphone, the four supplied strings) presses the widget's
start button in its open shadow root; the hook above gives the page the
session. A fresh widget element is cloned for every run, so no run inherits
another's state. Cyan is the machine's colour on this page, and the live state
— border, dot, clock, the draining rule — is the only place it appears outside
the phone.

**Readiness and degradation.** The block reserves its space from first paint
but shows nothing until the engine has rendered a button; if that has not
happened in 8 s (script blocked, config endpoint unreachable, agent not
public) the block folds away, `ScrollTrigger.refresh()` re-measures, and the
section is exactly what it was — the play button and `Snimak uskoro`. Nothing
on the page logs. One caveat the client should know: when the *script* loads
but ElevenLabs' config endpoint does not answer, the widget itself logs one
`console.error` of its own before the page folds the block; that line is
ElevenLabs', not the page's, and the only way to silence it would be to feed
the widget a local `override-config`, which replaces the agent's dashboard
settings wholesale and could change the conversation's language — not a trade
worth making blind.

**The cap.** A 250 ms clock drives `00:40 → 00:00` and a cyan rule that drains
under it — the same gesture as every eyebrow rule on the page. At 31 s the
agent receives a contextual update asking it to finish its thought in one
sentence (in English: it is an instruction to the model, not page copy). At
40 s the visitor's microphone is muted, the clock reads `00:00`, and the page
watches the agent's output level: half a second of silence ends the session;
an agent that will not stop is ended at 46 s regardless. `onDisconnect` swaps
the control for the card — heading, line, the primary-CTA button (booking
link if configured, else the booking section), the number as a ghost button
*only* if `DEMO_TELEFON` is set (the slot is removed, not left empty), and a
quiet mono link that reuses `Razgovaraj sa agentom` to run again, since no
"again" copy was supplied. Every timer is in one list and every end path
empties it; the harness asserts the list is empty after each run and that the
clock no longer moves.

**Transitions.** Control ↔ card is a cross-fade on transform/opacity at the
page's `--d-mid`/`--ease`, and the block's height is transitioned between the
two states so nothing below ever jumps; the outgoing state leaves the flow
only once the fade has finished. Under reduced motion the swaps are instant
and the demo still works — it is not motion.

### 3b · The review pass on the demo

Five independent reviewers, each with one lens — design at six widths, motion,
adversarial code, a requirements audit against the numbered list, and
accessibility — with every finding above a nit put to two skeptics who were
told to refute it. (The box has four CPUs, so the pass ran two agents wide and
the skeptics were still working as this was written; every refutation that had
landed was of a finding already fixed in the working copy, which is what a
refutation should say.) Forty-four findings; the ones that changed the build:

- **The page's `onDisconnect` hook was dead** — found independently by the
  requirements auditor and the code reviewer. My first read of the widget's
  `startSession` call was truncated: after the spread it sets its *own*
  `onDisconnect` as well as the four I had listed, so a session the agent ends
  early would never have reached the end card. The page now reads the session's
  own `isOpen()` on its clock — a tick after any hang-up shows the card — and
  the harness has a test for exactly that.
- **Callbacks were not bound to the engine that raised them.** Press, cancel,
  press again: engine A's late session could be adopted by run B and the live
  one hung up. Every callback now carries its engine and its run number; a
  session that lands for either a replaced engine or an abandoned run is hung
  up, unheard.
- **The state swap measured the incoming state inside a stretched grid row**,
  so the card→control swap snapped 59–65 px. `align-self: start`.
- **"First visible button" is the wrong button under some dashboard settings**
  (text input on, expanded by default). The start button is found by its
  name first (`call | poziv | razgovor`), by position only as a fallback.
- **The block reserved 108 px of nothing for eight seconds when the widget was
  blocked, then collapsed in one frame** — the one state change that ignored
  the page's easing. It reserves nothing now and grows in when the engine is
  ready; a page whose engine never comes never shows a hole.
- The live state wore the ghost button's amber hover inside a cyan border;
  the pill changed width three times a run; the icon and the dot were hard
  cuts; the rule popped 0→1 on a second run; the restart link read as a second
  caption; the stacked card buttons differed in width; `endSession()`
  rejections could surface; the fresh engine's five-second timeout was
  declared and never wired; a fading control could still take Enter; focus
  fell to `body` at the end. All fixed. The connect timeout is 8 s, not 15.
- Accessibility: the note is now the button's description
  (`aria-describedby`), the engine is `inert` as well as hidden, the end card
  puts focus on its heading so Tab reaches its button with context, state
  changes go through one polite live region instead of a label inside a
  button, and `aria-busy` is set after the text it would defer.

**Not changed, with reasons.** Three accessibility findings want a Serbian
string the brief does not supply and §8 forbids composing — a stop name for
the live control (it is named `Slušam` and pressing it ends the demo), a
"remaining" label for the clock, and a new-window hint on an external booking
link. Each is one word or phrase from the client away; say the words and they
go in. The snippet's script is unpinned, so the cap mechanism is verified
against 0.17.1 and relies on an order the widget does not document; pinning it
would be a one-token change to a snippet I was told to add verbatim, so it is
recorded here rather than made. The "hard 40 s" is 40 s for the visitor's
microphone and up to 46 s of the agent's audio — the reviewers were right to
call that a compromise, and it is the one the requirement's own words ("no
abrupt cut mid-sentence") asked for.

### 3b · The calls that were handed back, decided as the owner would

The client delegated the open decisions ("imagine yourself as the CEO").
Each one, and the reasoning:

| decision | what was done | why |
|---|---|---|
| a stop name for the live control | while live the button's accessible name is `Slušam — prekini demo`; the visible word stays `Slušam` as specified | a visitor tabbing back to the only control must hear what pressing it does; the visible text is inside the name, so 2.5.3 Label in Name holds |
| an honest ending | after the cap the label reads `Završavam…` — same shape as `Povezujem…` — instead of `Slušam` while the visitor's line is already muted | `Slušam` ("I'm listening") was literally false for up to six seconds; the ellipsis form the client chose for connecting was the obvious sibling |
| a name for the clock | a visually hidden `Preostalo` precedes `00:40` | a screen reader reads "Preostalo 00:35" on demand; nothing changes for the eye |
| a failed attempt | if an attempt never connects, the note slot shows `Povezivanje nije uspelo — pokušajte ponovo.` for four seconds and steps aside; it is announced once | a visitor who denied the microphone, or whose network dropped, was seeing the button silently revert and could only assume the demo was broken. This is not an error *state*: nothing is left on screen, and the widget-failed-to-load path still folds quietly as required |
| the microphone prompt | the eight-second connect timeout starts only once the browser's microphone permission is known; while the prompt is open the page waits (ceiling 45 s); a denied microphone ends the attempt at once; a browser that cannot say gets 20 s | the first thing the browser does after the press is ask for the microphone, and a visitor reading that prompt was about to have the rug pulled at eight seconds — a real bug found while thinking the decision through |
| external booking links | when `DEMO_LINK` is an absolute URL, both booking buttons carry a hidden `(otvara se u novom prozoru)` | the new-window warning WCAG asks for; the same helper serves the CTA and the end card |
| pin the widget | the snippet's script is `…/convai-widget-embed@0.17.1` — the one deliberate change to the snippet as supplied | the forty-second cap rests on an undocumented spread order verified against this version; an unpinned URL would let a future release silently break the product's only interactive proof. The content harness asserts the pinned form |
| the calendar claim on the first feature card | stays trimmed to `Direktna sinhronizacija sa Google kalendarom.` | the client said the integration does not exist; a claim that is false in the FAQ is equally false on a card |
| the grace after the cap | kept: the visitor's line closes at 40 s, the agent may finish one sentence, 46 s regardless | six seconds of agent audio costs cents; a sentence cut in half in front of a prospect costs the impression the demo exists to make |

Five Serbian phrases were written for this — the first time any were — and
every one is declared in the content harness's list of non-brief strings and
asserted verbatim, so nothing else can slip in under the same door.

Two lint-level cleanups from the same pass: the FAQ panels are real
`<section>` elements rather than `div[role=region]`, and the two frequency
rails are positioned from a stylesheet rule instead of inline styles. An HTML
validator (`html-validate`, recommended ruleset) now passes with one rule
switched off and the reason recorded: the client's snippet carries
`type="text/javascript"`, and it is kept as supplied.

### 4 · What could **not** be verified, and how the rest was

- **No conversation was ever held.** ElevenLabs' API and WebSocket are blocked
  from this sandbox, so the harness never connects. What it does, against the
  *real* widget bundle served from `node_modules` and a mocked config: proves
  the page's button presses the engine's (exactly one `elevenlabs-convai:call`,
  carrying the four hooks); then drives the same hook with a fake
  `Conversation` on Playwright's fake clock through every state — 00:30 at ten
  seconds, the nudge at 31, mute at 40 with a speaking agent *not* cut, the end
  half a second after it goes quiet, the card, zero timers, a fresh engine,
  a restart, and a second run ended at the 46 s ceiling. **The first real call
  has to be made by a person with a microphone**, and three things can only
  be seen then: that the agent answers in Serbian, that the browser's mic
  prompt appears where expected, and that the agent's dashboard has "require
  terms" off — with it on, the hidden widget would wait for an acceptance
  nobody can see, and the page would return to its start after 15 s.
- The widget fetches its avatar texture from `storage.googleapis.com`; the
  harness stubs it. In production that host is one more the page touches.
- Everything else is run, not reasoned: **131 / 131 harness checks** (fourteen rounds — round 14 is the demo, see the table) and **84 / 84 content checks**.

### 5 · The calendar claim, and the percentages

The FAQ answer now reads exactly `Radi sa Google kalendarom. Celo podešavanje
radimo mi.` The same claim — `… i sistemima za zakazivanje` — was also on the
first feature card (`Zakazivanje termina`), so that card's body is now
`Direktna sinhronizacija sa Google kalendarom.` **Tell me if you want the card
put back**; it seemed wrong to fix the claim in one place and leave it in the
other.

`30%` and `85%` are not on the page. They were replaced by §8's own
replacement block in the first build because they were unsourced, and the
content harness asserts every run that neither figure is published. Nothing to
decide there.

---

## 3 · Round 1 — final automated audit (`node audit.js`)

**131 / 131 passed, all green.** Everything below was actually executed in
headless Chromium against the real file.

| # | round | result |
|---|---|---|
| 1 | Console — network idle + 5 s of animation | zero `console.error`, zero `pageerror`, zero unhandled rejections; GSAP + ScrollTrigger + Lenis all live |
| 2 | Horizontal overflow @ 360/390/414/768/1024/1280/1440/1920 | `scrollWidth ≤ clientWidth` at every width, at the top **and** after a full scroll-through |
| 3 | Screenshots | stepped viewport frames at all 8 widths + 6 phone-loop states + degraded states |
| 4 | **CDN blocked (F1)** — cdnjs, jsDelivr, unpkg and elevenlabs.io aborted at the network layer | GSAP genuinely absent; every `[data-reveal]` block visible; hero copy visible; the phone falls back to a readable booked state; page scrolls; ~4 900 characters of body text; the live-demo block folds away with no dead button and no empty box; zero console errors before and after the fold |
| 5 | `prefers-reduced-motion: reduce` | marquee static, Lenis never constructed, no `js-motion`/`js-loop`, phone at rest in the booked state, the meter renders one settled frame |
| 6 | Diacritics | `fonts.check` true, glyphs pixel-distinct from their bases, no `.notdef`, in all three families |
| 7 | CONFIG placeholders, empty **and** filled | see §1; also asserts the primary CTA never points backwards |
| 8 | Phone loop — 3 cycles + a 30 s tab switch | never two states at once, typing never overlaps its own bubble, timer never runs backwards, 3 clean wraps, no flash across the seam |
| 9 | Contrast | 15 token pairs computed + every text node measured in situ against its real composited background — 0 failures |
| 10 | Accessibility & interaction | landmarks, one `h1`, heading order, skip link, real accordion semantics, 28 keyboard tab stops each with a visible ring, focus never inside a closed panel, menu lock/unlock across a breakpoint |
| 11 | Motion QA | 1920 → 360 resize *while the hero is pinned*, portrait ↔ landscape mid-scroll, instant scroll to the bottom skips no reveal |
| 12 | Throttle + motion system | boots and scrolls under 4× CPU throttle; every trigger measured against the pinned layout; all 12 `[data-lines]` hosts split with **zero** height change to any element and zero change to the document; line masks preserve the text exactly; the band fills its canvas without clipping and breathes rather than drones; the probe sweeps below, through and above the telephone band |
| 13 | Touch (Pixel 7) | sway replaces cursor tilt, magnetism never engages, no pin, menu works by tap, the inert player answers a tap without erroring |
| 14 | **The live demo** — the real widget bundle served locally, its config and avatar texture stubbed, the microphone granted, the session driven through the widget's own hook on a fake clock | ready only once the engine renders its button; engine never painted, never focusable; the page's button presses the engine's — one `elevenlabs-convai:call` carrying the four hooks; a change of mind while connecting leaves no timer; live → `00:30` at ten seconds with the rule at ¾; the wrap-up nudge at 31 s; at 40 s the mic is muted and the clock reads `00:00` but a speaking agent is not cut; half a second of silence ends it and the card takes the widget's place; zero timers, a frozen clock, one fresh engine; restart works; while live the control is named for what pressing it does, and past the cap it says it is finishing; an attempt that never connects comes back after 8 s with a notice that steps aside after 4 s; an early hang-up — which the widget never forwards — is noticed within a tick and ends on the card; an agent that never goes quiet is ended at 46 s; the card's number line only with `DEMO_TELEFON`, the booking link when `DEMO_LINK` is set; reduced motion still live; zero console errors in every state |

**Round 4 — content (`node .audit/copy-check.mjs`): 87 / 87 passed.** Every
visible string diffed against §8/§6/§7 character for character (only NBSP is
normalised, since §8 requires it before `€`), plus: no Cyrillic anywhere, no
`30 %`/`85 %` published, meta/OG built only from §8 sentences, no generated
Serbian in `aria-label`/`title`/`alt`, a regex sweep for any claim implying the
caller is deceived, and the AI disclosure present in all three required places.

**Performance**, measured with `Emulation.setCPUThrottlingRate`: the voice band
idles at 59 fps unthrottled, 43 fps at 4×, 22 fps at 8×. The hero (phone loop +
four blurred glow layers) sits at 40 fps and is compositing-bound, not
CPU-bound — it measures the same at 1× and 4×.

---

## 4 · Round 2 — adversarial code review of the first build (subagent)

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

## 5 · Round 3 — design director review of the first build (separate subagent)

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

## 6 · The motion round — adversarial code review (three passes)

A subagent was given the motion layer and the canvas engine and told to find
defects, not to approve. It ran three times — on the first motion build, on the
diff after the first round of fixes, and once more as a narrow regression pass
over the design round's own diff. **Thirty-four findings across the three
passes; twenty-nine were real and are fixed.** The ones that mattered:

| finding | fix |
|---|---|
| `@property --rule` was declared `inherits: false`, and its only consumers are `::before` pseudo-elements. A registered property with `inherits: false` resolves to its *initial value* on a pseudo — so every eyebrow rule was drawn at full width from first paint and the scroll draw-in, nine instances down the page, **had never once been seen**, while an 0.8 s per-frame custom-property write ran for nothing | `inherits: true`. Verified: below-fold eyebrows now sit at `scaleX(0)` and animate to 1 on entry |
| the steps rail turns vertical below 900 px, but the timeline still scrubbed `scaleX` — which on a 1 px-wide rail scales its *width*. On every phone the rail stayed sub-pixel until progress neared 1 and then appeared all at once | the scrub picks the axis from the measured rail. Verified at 390 (`scaleY` 0 → 0.57 → 1) and at 1440 (`scaleX` 0 → 0.46 → 1) |
| the same module lives in a *motion*-scoped `matchMedia`, not a width-scoped one, so it is never rebuilt across that breakpoint — flipping the axis on refresh left the other one stranded wherever the last scrub had put it. A desktop → phone → desktop round trip at the top of the page brought the rail back fully drawn on a section below the fold | a refresh re-applies the trigger's live progress on whichever axis is current |
| the scroll probe owned the band's `reveal` unconditionally, so pressing the demo button cut the meter off in mid-air for the whole 1.9 s sweep — the one interaction the section exists for | the sweep claims `reveal`; the probe writes it only when nothing else holds it |
| …and the probe's bail-out then skipped the *whole* handler, so during the smooth-scroll glide the cursor parked at one frequency while the readout showed another | only the three fields the sweep owns are skipped. Verified: after the arrival sweep the readout matches the cursor's own position exactly |
| the reduced-motion self-test raised `pulse` without recomputing the targets, so it re-rendered identical bars — the meter did nothing at all | `settle()` before `draw()` |
| the phone-tilt loop restarted on an off-screen phone after any tab switch, and nothing could stop it again: a `transform` write and a forced layout every frame for the rest of the session | `start()` requires the IntersectionObserver's `inView`. Verified frozen off-screen after a tab return, and awake on return to the hero |
| `js-motion` goes on the root whether or not GSAP arrived, so gating the hairline-grid wash on it stripped both grids of their internal rules on the blocked-CDN path — three stats and six feature cells as one undivided slab | the module that lights the wash owns the class that switches it off |
| nothing owns the CTA meter when GSAP is absent, so `wanted` stayed `undefined` and the observer read that as "off" — while the CSS `:hover` still revealed the canvas. A frozen meter, or a blank one if the button had reflowed since boot | `undefined` means "no owner, follow the observer"; a canvas whose backing store was just cleared repaints immediately |
| the reveal watchdog — armed first precisely because everything below it can throw — depended on a binding declared below it, and released the grid washes without the viewport test its siblings get | declaration hoisted, same test applied |
| the CTA arrival demo's `onComplete` switched the meter off under a pointer that was asking for it | an `over` flag gates the hand-back, teardown included |
| per-frame allocation in the only hot loop: one `CanvasGradient`, eight string concatenations and one closure, per band, per frame — all of it dependent only on width and palette | built in `layout()`; the closure is gone |
| teardowns promoted with `willChange` outside GSAP (so `clearProps` could not take it back) and left their own tweens running over the re-initialised hidden state | both released explicitly |
| *(third pass)* the permanent CTA meter was gated on the `#cta` **section**, whose top crosses 92 % of the viewport while the button is still ~300 px below the fold — measured: a 253 px scroll window, a natural parking spot, running a 60 fps canvas repaint nobody could see. And `end: "bottom 8%"` on the section is unreachable at either layout, so two of its four callbacks were dead code | gated on the button, which is the canvas. The remaining window is the 60 px `rootMargin` every band shares |
| *(third pass)* easing the meter's reveal inside the scroll handler froze it short of target — a scroll that stops delivers no more updates. Measured: edge parked at 0.561 against a target of 0.735, stable, leaving a bright drawing head in the middle of the spectrum as the *resting* state | the probe names a target; the gap closes on the band's own clock, which keeps running after the scroll stops. Verified converging exactly |
| *(third pass)* the probe cursor's element-level `opacity: 0.75` also scaled its in-band state, whose amber was tuned against an unscaled base — so the cursor **dimmed** 2.4× on entering the passband where it used to brighten 2.2× | the value moved into the colour stops |

It also confirmed clean, by argument rather than assertion: the blocked-CDN
boot order; the `withBag`/`dispose` teardown discipline and the two
`document.fonts.ready` continuations; that `ScrollTrigger.batch` self-registers
with the active `gsap.context` and is killed on revert; `refreshPriority: 10`
on the hero pin; the `layout()` cache's early-return, first-call and DPR-change
paths (a `CanvasGradient` is resolved against the CTM at paint time, so it
survives the backing-store reset); and that no element outside `.eyebrow` /
`.marquee-label` can now inherit `--rule`.

---

## 7 · The motion round — design director review (two passes)

A second subagent, given the art direction and the client's brief for this
round and told to be harsh. Two passes, the second on the rebuilt page.
**Thirteen real defects in the final pass; eleven are fixed.**

**The reveal outran the probe.** The band completed at `p = 0.226` while the
300 Hz mark sits at `p = 0.3038` — measured, not estimated. So the spectrum was
whole *before* the probe reached the passband, and the causal claim the whole
section rests on was never actually made. It fills just ahead of the probe now
and completes exactly as the probe leaves the band at 3400 Hz.

**The dead track is chassis, not content.** Half-revealed, the meter was a
95 px stump of bars alone on black with one Hz tag floating above it — "a
loading skeleton", occupying a full viewport immediately before the site's
signature moment. The stub track, the centre line and both frequency rails are
drawn from the first frame now; only the amber signal draws in. A divider band
is almost all dead track, so that one still reveals whole — hence an explicit
`chassis` option rather than a global change.

**The fourth placement of the motif was a two-second cameo.** The CTA meter
faded itself to zero after its arrival demo, so most of the time the placement
did not exist; and what did show was a centred lens with no passband-and-stub
reading at all. It rests at 0.24 opacity now, spans the button with a legible
dead track at both ends, and swells to 0.46 rather than appearing and leaving.
The label is masked out of the bars' path, so they pass behind the word and
re-emerge above and below it instead of striking through the letterforms.

**Amber fading its alpha over blue-black ink goes khaki.** Measured: the
roll-off shoulders at (163,133,96) and (136,115,91) against the in-band amber's
(208,167,110) — chroma collapsing from 0.47 to 0.33. They are the tallest
non-passband elements and they straddle the two labelled lines the section's
claim depends on. The bar-height ramp carries the roll-off; the colour holds.

**Cyan was a hero leftover, not a system.** Measured across all nine sections:
349 px of cyan in the hero, ≤ 92 px anywhere else, and those residuals were
anti-aliasing. The probe cursor — the machine measuring the line — was the same
pale grey as the two fixed rules beside it. It is cyan now and turns amber
where it finds signal, which fixes the defect and the 85/15 split in one line.

Also fixed: the spatial noise frequencies scale with bar count, so the envelope
is as smooth at 390 px as at 1920 (bar-to-bar jag was 2.3× worse on a phone); a
held peak over a bar at the floor is suppressed rather than drawing a dotted
rule attached to nothing; the self-test ducks fast at the start so the tone has
a silence to bloom into, and reads as a tick rather than a swell while crossing
the dead axis; every feature icon closes its own silhouette before the marks
inside it draw, instead of holding a fragment of the outline for most of a
second; the play control is a live amber glyph rather than a dead grey one, and
is no longer frosted glass; the hero copy holds legible for longer on the way
out, so a reader scrubbing the pin does not park on a brown-on-brown button.

**Checked and disproved.** Two findings did not survive verification, and I am
recording them because the measurements are worth keeping: the `NAJPOPULARNIJI`
badge is *right-anchored* to the featured card's inner padding, not a failed
centring; and the marquee's edge mask is present and working — sampled at
`y = 150`, the leading glyph runs at roughly 4–35 % opacity across a 259 px
fade. A third, a claimed 2–5 level background seam in the hero, is within the
page's own film-grain overlay and I could not reproduce it as a straight edge.

**Disagreed with, and why:**

- **"Add 60 Hz / 12 kHz endpoint ticks to explain the axis asymmetry."** The
  asymmetry is real and correctly derived from the log axis, and the ticks
  would explain it — but they are new visible copy the brief did not supply,
  on a page whose content the client explicitly protected. Noted, not done.
- **"Widen the hero band clear of the phone."** §4.3 makes the hero instance
  deliberately "barely alive", and the phone standing on the line is the
  composition the client named as the thing he likes. Kept.
- **"Restore the cyan across the steps, the icons and the FAQ."** Correct
  against the art direction, and out of bounds for this round: those sections
  were named as good and unchanged. The probe cursor was the one place inside
  this round's scope, and it is done.
- **"`--confirm` green and its glow are a third accent."** True, and
  pre-existing — it lives inside the phone, which is protected. Recorded here
  so the decision is the client's.
- **"Give the play button a stop glyph while the self-test runs."** It already
  gets a solid amber ring and an expanding scan ring; a *label* change would
  need a Serbian string §8 does not supply, and §8 forbids composing one.
- **"The self-test has no after."** Measured off the canvas: passband energy
  falls to 0.31 of resting within 148 ms, holds at the floor to 651 ms, swells
  to 0.90 as the tone crosses, falls back to 0.28, and recovers at 1.95 s.
  There is a before and an after; the review was reading a contact sheet.

---

## 8 · What I could not run, and why

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
7. **Nobody with eyes has seen this page.** Both design reviews were run by
   subagents against still frames. Stills cannot judge easing, timing feel, or
   whether a scrub reads as smooth — every motion judgement in §7 is inferred
   from held frames, mine included. The one thing I did measure rather than
   look at is the numbers behind the frames: bar heights off the canvas, sweep
   energy over time, trigger progress at each scroll offset.
8. **`Range.getBoundingClientRect()` line splitting is engine-specific.** The
   masks are rebuilt from the real layout on every resize and the harness
   asserts zero height change in Chromium — but where WebKit or Gecko break a
   line differently, they will simply produce a different (still correct)
   number of masks. Untested.
9. **Full-page screenshots are unreliable on this page** and I do not treat them
   as evidence. `captureBeyondViewport` re-lays-out a ScrollTrigger-pinned
   section and mis-places `position: fixed` elements. Round 3 takes stepped
   viewport frames instead; the two full-page files are kept only as a
   whole-page reference. (The skip link appearing mid-page in
   `cdn-blocked.png` is this artefact — verified separately that it sits at
   `top: -57px` until the first Tab.)

---

## 9 · Departures from the brief, and why

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
7. **Four harness assertions were changed, not just the page.** Each encoded a
   contract this round deliberately replaced, and they are recorded here so the
   change is visible rather than buried in a green tick. Three concern the play
   control (see 8): it was asserted to rest at `cursor: default` with
   `aria-disabled="true"` — a designed *inert* state — and it is now a live
   control, so the checks assert the new contract instead. The fourth is the
   band's fill/breathe check, which measured at the top of the `#glas` section.
   The meter now draws in behind the scroll probe and only answers while that
   probe is inside 300–3400 Hz, so at the top of the section it is legitimately
   quiet; the check measures with the stage centred, where the meter is
   actually being looked at. Thresholds unchanged: mean 0.384, peak 0.936, zero
   clipped samples, breathing range 0.032.
8. **`aria-disabled` on the play control, which §7 mandates.** It is gone from
   the two live states, and here is the reasoning, because it is a departure.
   The attribute still ships in the markup, so with JavaScript dead — when the
   button really does nothing — a screen reader is told exactly that. Both
   modules that make the control live remove it: with `DEMO_AUDIO` empty the
   button runs the line self-test, and with it filled the button plays the
   recording. Announcing "dimmed" about the section's only interactive element,
   in a section whose whole argument is *press this and listen*, is worse than
   the letter of §7. The accessible name is unchanged and still says what is
   unavailable — `Snimak uskoro`, the recording — and the empty state's look is
   unchanged too, driven by an `is-empty` class instead of the attribute. Two
   independent reviewers flagged the original as a lie to assistive tech; this
   is the smallest fix that does not require composing a Serbian string §8 does
   not supply.
9. **`--confirm: #6FD48A` is a fourth colour.** It survives on the phone's
   confirmation card, with a green hairline and a soft green glow. The design
   review is right that the direction allows amber, one cyan and ink — and the
   phone is the component the client named as good and asked not to be touched.
   Recorded so the call is the client's, not mine.
10. **Nine strings are not from §8**, because §8 supplies no accessible names:
   `Preskoči na sadržaj` (skip link), `Meni` (menu toggle and the dialog's
   name), `Zatvori`, `Pauziraj` (only ever shown once `DEMO_AUDIO` is filled),
   `Agent` / `Pozivalac` (the transcript speaker labels §6 uses), `Za koga`
   (§8's own name for section 6, used as its eyebrow), plus `21.40` and
   `+381 6• ••• ••••` in the phone chrome. All are single dictionary words or
   §8's own headings; nothing was composed.

---

## 10 · The two things I would change next

**A real recording.** The self-test is a good empty state — it performs the
section's argument rather than apologising for having nothing — but it is still
an empty state. The moment `DEMO_AUDIO` points at a real clip, the meter stops
being a simulation of a voice and starts being the voice, and the whole GLAS
section changes register. The analyser path is written and its states are
tested; only its gain constant (`sum / data.length / 110`) is a reasoned guess
that will want tuning against a real file.

**A conversion endpoint of its own.** `DEMO_LINK` points at someone else's
booking widget. If the client wants the form on-page, it needs two field labels
and a success message in Serbian, written by a native speaker, plus somewhere
to post to. That is the highest-value hour of work left on this site, and it is
not something the brief let me invent.
