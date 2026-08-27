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
