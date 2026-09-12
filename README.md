# Cognia
**A privacy-conscious, non-destructive AI cognitive accessibility layer for the web.**

Cognia is a Chrome extension that helps users (older adults, people with visual/sensory impairments, neurodivergent individuals) complete complex digital tasks — like renewing a licence on a government portal — by dimming irrelevant page content and spotlighting the next meaningful action. It never takes over the page, never clicks on the user's behalf, and never sends sensitive form data off the device.

**Event:** INFERENTIA 2026 — 24hr National Level Hackathon (AURA / Dept. of CSE AI&ML, PES University)
**Track:** Making Access Easier
**Team:** COMMITment Issues — PES University, Bengaluru

| Name | SRN/USN |
|---|---|
| Aryan Srivastava | PES1UG25EC051 |
| Ashrith Puppala | PES1UG25EC358 |
| Felicia Andrew | PES1UG25EC092 |
| Keerthana K | PES1UG25CS727 |

---

## 1. How the whole system fits together

```
User types goal → [Popup] → [Orchestration loop] 
                                   │
                                   ▼
                          [Page Mapper] scans the live page
                                   │  (produces PageState JSON)
                                   ▼
                          [PII Guard] strips sensitive values
                                   │
                                   ▼
                          [Backend /reason API] → LLM reasons about
                          what the next step should be
                                   │  (produces GuidanceAction JSON)
                                   ▼
                          [Cognitive HUD] dims the page, spotlights
                          the target element, shows the instruction
                                   │
                                   ▼
                          User performs the action → loop repeats
                          (Verify & Re-plan)
```

The **only two things every module must agree on** are the two JSON shapes that pass between them. These are documented in full in [`CONTRACTS.md`](./CONTRACTS.md) and defined formally in [`shared/schemas/`](./shared/schemas). Sample data for building against before your teammate's real module exists lives in [`shared/mocks/`](./shared/mocks).

**Golden rule: if you need a new field in either JSON shape, do NOT just add it. Post in the group chat first, get a thumbs-up, then edit the schema file.** Everyone else's code assumes the shape hasn't changed underneath them.

---

## 2. Repo map — who owns what

```
cognia/
├── README.md                      ← you are here
├── CONTRACTS.md                   ← the two JSON contracts, read this first
├── shared/                        ← shared by everyone, edit with care
│   ├── schemas/                   ← formal JSON Schema for both contracts
│   └── mocks/                     ← sample JSON to build against before integration
├── test-site/                     ← Person 1's fake demo website (licence renewal form)
├── extension/                     ← Chrome extension — Persons 1, 3, 4 all live here
│   ├── manifest.json
│   ├── content-scripts/
│   │   ├── page-mapper.js         ← PERSON 1 owns this file
│   │   ├── pii-guard.js           ← PERSON 4 owns this file
│   │   └── hud-overlay.js         ← PERSON 3 owns this file
│   ├── background/
│   │   └── service-worker.js      ← PERSON 4 owns this file (the integration point)
│   ├── popup/                     ← PERSON 4 owns this folder
│   └── styles/hud.css             ← PERSON 3 owns this file
├── backend/                       ← PERSON 2 owns this whole folder
│   ├── server.js
│   ├── routes/reason.js
│   ├── services/llm-client.js
│   ├── services/task-planner.js
│   └── prompts/reasoner-system-prompt.md
└── docs/
    └── demo-script.md             ← whoever's pitching fills this in near the end
```

**Rule of thumb:** stay inside your own folder/files as much as possible. The only cross-cutting files are inside `shared/` — touch those together, not solo.

---

## 3. Roles — read your section, only your section, in full

### PERSON 1 — Page Mapper (Aryan)
**Owns:** `extension/content-scripts/page-mapper.js`, `test-site/index.html`

**What this module does:** Runs inside the browser tab as a content script. It scans the live webpage's DOM and produces a `PageState` JSON object (see `CONTRACTS.md`) describing what's on the page right now — every interactive element (inputs, buttons, dropdowns), its role, its label, whether it's filled in, and where it sits on screen.

**Step by step:**
1. `cd extension && npm init -y` if not already done.
2. Build `test-site/index.html` first — a simple fake "driver's licence renewal" form: a few labeled text inputs (Full Name, Date of Birth), one dropdown (Department/Licence Type), a submit button, and some visual clutter (an ad banner div, a promo blurb, extra nav links) so the "reduce complexity" story has something real to dim. Keep it static HTML/CSS, no framework needed.
3. In `page-mapper.js`, write a function `getPageState(goal, accessibilityProfile)` that (the profile is chosen by the user in Person 4's popup and just passed through into your output untouched — you don't act on it, the backend does):
   - Walks the DOM (or uses `document.querySelectorAll` on form elements, buttons, links, etc.)
   - For each interactive element, extract: a unique `id` (generate one if the element has none — e.g. `el_` + incrementing counter, and stamp it onto the DOM element as a `data-cognia-id` attribute so you can find it again later), `role` (input/select/button/etc., ideally from ARIA role or tag name), `label` (from `<label for>`, `aria-label`, or nearest text), `state` (empty/filled/selected), and `rect` (from `getBoundingClientRect()` → `[x, y, width, height]`).
   - Assemble everything into the exact shape in `shared/schemas/page-state.schema.json`. Validate your output against `shared/mocks/mock-page-state.json` — same keys, same nesting.
4. Set up a `MutationObserver` on `document.body` so that whenever the page changes (a field gets filled, a new section appears), you can re-run `getPageState()` — this is what powers the "Verify & Re-plan" step later. You don't need to wire this into the full loop yet — just have the function ready and tested standalone.
5. **Test it in isolation:** open your `test-site/index.html`, load the extension, open the browser console, and manually call `getPageState("renew my driver's licence")`. Confirm the printed JSON matches the schema exactly (field names, types, nesting) before telling the team it's ready.
6. **Handoff:** once your JSON output matches the schema, tell Person 4 — they'll wire your function into the orchestration loop, replacing their mock.

**Milestone 3 — real-site hardening (do this only after the core loop works end-to-end, not before):** to make the demo credible beyond our own test page, run `getPageState()` against 2–3 real websites — pick simple, mostly-static ones (a government service portal, a hospital appointment form, a university admission form). Avoid heavy single-page-app sites, anything behind a login wall, or anything with CAPTCHAs — those will break DOM parsing in ways `test-site` never will, and we don't have time to debug that live. For each real site: confirm `getPageState()` still produces valid schema-matching JSON, note any DOM quirks (iframes, shadow DOM, oddly-nested labels) that trip up your extraction logic, and patch your parser to be more general rather than site-specific. If a real site proves too fragile with the time remaining, don't force it — screen-record whatever partial run you got instead of risking it live, and tell the group which sites are demo-safe vs. video-only.

**Don't worry about:** talking to the backend, rendering anything visually, or PII redaction — that's not your job, just produce clean, accurate `PageState` JSON.

---

### PERSON 2 — Backend + AI Task Reasoner (Ashrith)
**Owns:** the entire `backend/` folder

**What this module does:** A small Node/Express server with one important endpoint, `POST /reason`, that takes a `PageState` JSON body and returns a `GuidanceAction` JSON response (see `CONTRACTS.md`). Internally it calls an LLM and forces it to reason about what the user should do next, then structures that reasoning into the exact `GuidanceAction` shape.

**Step by step:**
1. `cd backend && npm install` (installs `express`, `cors`, `dotenv` — already in `package.json`).
2. Copy `.env.example` to `.env` at the repo root and add your LLM API key there. **Never commit `.env`** — it's already in `.gitignore`, double-check it stays that way.
3. In `server.js`: stand up a basic Express app, enable `cors()` (the extension calling from a content script origin needs this), mount `routes/reason.js` at `/reason`, and `app.listen()` on a port (e.g. 3000).
4. **First milestone — do this before touching the LLM at all:** make `routes/reason.js` just read `shared/mocks/mock-guidance-action.json` and return it as-is, regardless of what's in the request body. This gives Person 3 (HUD) and Person 4 (orchestration) a real, live endpoint to call within the first hour, even though it's not "smart" yet.
5. **Second milestone — the real reasoning:** in `services/llm-client.js`, write the function that calls your LLM provider's API. Force structured JSON output (most providers support a JSON mode or you can instruct it firmly in the system prompt and parse defensively). Write the system prompt in `prompts/reasoner-system-prompt.md` — it should instruct the model: given a `PageState` (the goal, the elements on the page, and interaction history), decide which single element the user should act on next, and produce a `GuidanceAction` matching the schema exactly (same field names, `target_element_id` must be one of the ids that were actually present in the incoming PageState — never invented).
6. In `services/task-planner.js`: handle the "step counting" and `support_level` logic.
   - Look at `history` in the incoming `PageState` — if it shows repeated failed attempts or backtracking, bump `support_level` from `"normal"` to `"elevated"` or `"high"`. This is what powers the "adaptive assistance / frustration detection" feature from the pitch deck. Keep this logic simple — a count of ≥2 repeated/failed entries in `history` is enough to visibly trigger during a live demo; this doesn't need real emotion detection.
   - Also read `accessibility_profile` from the incoming `PageState`: if it's `"low_vision"` or `"cognitive_load"`, start `support_level` at `"elevated"` instead of `"normal"` even before any friction shows up — the profile is a head start, friction detection is the escalation on top of it.
   - Decide `read_aloud`: `true` when `accessibility_profile` is `"low_vision"` or `"unsure"`, OR whenever `support_level` is `"elevated"`/`"high"` (someone struggling benefits from audio regardless of their stated profile). Otherwise `false`.
7. **Differentiating feature — plain-language rewriting.** This is the one genuinely distinct thing this module does versus similar tools we found in research (PageGuide, an academic browser-guidance extension, cites evidence but doesn't simplify language). Update `prompts/reasoner-system-prompt.md` to explicitly instruct the model: every `instruction` must be short, plain-language sentences — no bureaucratic or technical terms from the page itself, rewrite them. E.g. if the page says "Select Jurisdictional Authority," the instruction should say something like "Choose your local office." Test this by feeding a PageState with a deliberately jargon-heavy label and confirming the output instruction is simplified, not copied verbatim.
8. Wire `routes/reason.js` to call `task-planner.js` and `llm-client.js` instead of returning the static mock once both are working.
9. **Test it in isolation:** use `curl` or Postman to `POST` `shared/mocks/mock-page-state.json` to `http://localhost:3000/reason` and confirm you get back valid JSON matching `guidance-action.schema.json` — including a sensible `target_element_id`, a genuinely simplified `instruction`, and a correctly-set `read_aloud`.
10. **Handoff:** tell Person 4 your endpoint URL and confirm the JSON shape once more together before they swap their mock backend call for a real `fetch()`.

**Don't worry about:** the DOM, rendering, or the extension itself — you're a standalone API server that could be tested with `curl` alone.

---

### PERSON 3 — Cognitive HUD / Rendering (Felicia)
**Owns:** `extension/content-scripts/hud-overlay.js`, `extension/styles/hud.css`

**What this module does:** Takes a `GuidanceAction` JSON and visually transforms the page — dims everything except the target element, draws a spotlight/highlight around it, and shows the instruction text near it. This is the part that makes the demo look impressive, so give it real attention.

**Step by step:**
1. In `hud-overlay.js`, write a function `renderHUD(guidanceAction)` that:
   - Injects a full-page overlay `<canvas>` (or a `<div>` with `position: fixed; inset: 0`) on top of the current page, with a semi-transparent dark background (e.g. `rgba(0,0,0,0.75)`).
   - Uses `dim_all_except` from the `GuidanceAction` — find the DOM element(s) matching `target_element_id` (Person 1 stamped `data-cognia-id` on elements, so use `document.querySelector('[data-cognia-id="el_13"]')`), get its `getBoundingClientRect()`, and "cut out" that region from the dark overlay so it appears bright/highlighted against the dimmed background. On `<canvas>` this is a `globalCompositeOperation = 'destination-out'` trick; on plain `<div>` overlays you can achieve a similar effect with a large box-shadow spotlight technique — pick whichever you're comfortable building fast.
   - Renders the `instruction` text in a small floating card near the spotlighted element (position it based on the element's `rect`, flipping above/below/left/right if it would go off-screen).
   - Shows a step counter using `step` / `total_steps` (e.g. "Step 2 of 6") somewhere unobtrusive, like the wireframe's sidebar.
   - Adjusts visual intensity based on `support_level`: `"normal"` = default dimming and a standard spotlight; `"elevated"`/`"high"` = stronger dimming (darker overlay), bigger/brighter spotlight, simpler instruction text — mirror the "Adaptive Assistance" slide from the pitch deck.
2. Add a small "Exit / Turn off Cognia" button on the overlay so a judge or user can dismiss it — important for demo polish and for the "user stays in control" pitch.
2b. **New: read-aloud.** When `guidanceAction.read_aloud` is `true`, speak the `instruction` text using the browser's built-in `SpeechSynthesis` API (`new SpeechSynthesisUtterance(instruction)` → `speechSynthesis.speak(...)`, no extra dependency needed). Cancel any in-progress utterance (`speechSynthesis.cancel()`) before starting a new one, so overlapping steps don't talk over each other. **Add a mute toggle on the overlay itself** — during a live pitch you don't want the extension suddenly talking over your presenter, so make it easy to switch off without leaving the demo flow.
3. **First milestone — test completely standalone:** hardcode a call to `renderHUD()` using the exact contents of `shared/mocks/mock-guidance-action.json` at the top of your file (temporarily), load the extension, open any page, and confirm the dim + spotlight + instruction card render correctly — without waiting on Person 1 or 2 to have anything working.
4. Once it looks right against the mock, remove the hardcoded call — Person 4 will call your `renderHUD()` function from the orchestration loop with real data.
5. **Handoff:** tell Person 4 your function name and exact expected input shape (should just be `GuidanceAction`, nothing extra).

**Don't worry about:** how the `GuidanceAction` gets generated, or how the page gets scanned — you just need one valid `GuidanceAction` object to make something beautiful.

---

### PERSON 4 — Orchestration, PII Guard, and Intent UI (Keerthana)
**Owns:** `extension/background/service-worker.js`, `extension/content-scripts/pii-guard.js`, `extension/popup/`

**What this module does:** Three related jobs, all about wiring things together safely: (a) the popup where the user types/speaks their goal, (b) stripping sensitive data out of the PageState before it ever leaves the browser, and (c) the loop that calls Page Mapper → PII Guard → Backend → HUD, in order, and re-triggers on user action. **This role is the integrator by design** — you'll have a working (mocked) end-to-end loop before anyone else's real module is finished, so that swapping in real modules later is a one-line change each time, not a scramble at hour 20.

**Step by step:**
1. **Popup (Intent Declaration + accessibility profile).** Build `popup/popup.html` + `popup.js` with two things, in order: first, a simple selector — "What kind of support do you need?" with options matching the schema exactly (`low_vision` / `motor` / `cognitive_load` / `unsure`) — then the goal text input ("What are you trying to do?") with a submit button. Optionally add the Web Speech API (`webkitSpeechRecognition`) for voice input on the goal field as a stretch goal, but a plain text box is enough to demo the core idea. On submit, send both the goal and the chosen `accessibility_profile` to the content script/service worker (via `chrome.tabs.sendMessage` or `chrome.runtime.sendMessage`) to kick off the loop. This profile choice is what lets the backend start `support_level` and `read_aloud` correctly from the very first step, instead of only reacting after friction shows up.
2. **PII Guard first, before the loop:** in `pii-guard.js`, write a function `redactPageState(pageState)` that takes a `PageState` object and returns a copy with sensitive values stripped — e.g. blank out anything typed into fields labeled like "SSN", "Password", "Card Number", or any field where `state` shows a filled value that looks like an email/phone/number pattern. Keep the structural info (`id`, `role`, `label`, `rect`) intact — only scrub actual entered values. This is what lets you honestly claim "sensitive form values never leave the browser" in the pitch.
3. **Build the mocked loop FIRST, hour 1, before real modules exist:**
   - In `service-worker.js`, write the orchestration function: call a (temporarily hardcoded/faked) `getPageState()` → pass through `redactPageState()` (this one's real from the start, it's your own module) → `fetch()` a (temporarily hardcoded) `GuidanceAction` from `shared/mocks/mock-guidance-action.json` instead of a real backend call → pass the result to a (temporarily hardcoded) `renderHUD()` call.
   - This proves the wiring works end-to-end on day one, using fakes everywhere except your own PII Guard.
4. **Swap mocks for real modules one at a time, as teammates hand off:**
   - When Person 1 says Page Mapper is ready → replace your fake `getPageState()` call with the real content-script message call to `page-mapper.js`.
   - When Person 2 says the backend is live → replace the hardcoded mock JSON with a real `fetch('http://localhost:3000/reason', { method: 'POST', body: JSON.stringify(redactedPageState) })`.
   - When Person 3 says the HUD is ready → replace your fake `renderHUD()` call with the real one from `hud-overlay.js`.
   - **Swap one at a time and re-test after each swap** — this is the whole reason integration stays painless instead of becoming a big-bang merge at the end.
5. **Verify & Re-plan loop:** after the HUD renders and the user performs the suggested action (e.g. Page Mapper's `MutationObserver` fires because a field got filled), re-trigger the same sequence (get new PageState → redact → reason → render) so the guidance updates automatically as the user progresses.
6. **Test the full loop yourself** on `test-site/index.html` regularly throughout the day, not just at the end — you're the one person who should always be able to say "the loop runs" at any checkpoint, even if pieces are still mocked.

**Don't worry about:** the internals of DOM parsing, LLM prompting, or Canvas rendering — your job is making sure the four pieces talk to each other correctly and safely.

---

## 4. Setup — do this once per machine

```bash
# clone
git clone https://github.com/AshrithPuppala/Cognia.git
cd Cognia

# backend
cd backend
npm install
cp ../.env.example ../.env    # add your LLM API key to .env
npm run dev                   # starts the server, default localhost:3000

# extension (separate terminal, back at repo root)
cd extension
npm init -y                   # if package.json is still empty
# then in Chrome: chrome://extensions → enable Developer mode → Load unpacked → select the extension/ folder
```

Open `test-site/index.html` directly in Chrome (or serve it locally) to test against it.

---

## 5. Git workflow — keep it simple

- Branch per person, named `<yourname>/<module>` — e.g. `aryan/page-mapper`, `keerthana/backend`, `felicia/hud`, `ashrith/orchestration`.
- **Commit and push at least once an hour**, even if the code is unfinished — this keeps everyone's integration point current.
- Merge into `main` as soon as something works, even partially. Don't let branches live longer than a few hours.
- Only edit files inside `shared/` after announcing it in the group chat — everyone else's code depends on those shapes staying stable.
- If you hit a merge conflict, it should almost always be inside `shared/` or `CONTRACTS.md` — resolve it together on a call, don't guess.

```bash
git checkout -b yourname/module-name
# ... work, commit often ...
git add .
git commit -m "clear message about what changed"
git push -u origin yourname/module-name
# open a PR into main, or merge directly if things are moving fast
```

---

## 6. Competitor awareness — read once, everyone

We found a published research tool, **PageGuide** (Auburn/UVA, on the Chrome Web Store), that overlaps with our core mechanic — it also highlights/dims elements on a live page and guides users step by step. Read [`docs/competitor-analysis.md`](./docs/competitor-analysis.md) once before the pitch so everyone gives the same answer if a judge asks "isn't this the same as X?" Short version: PageGuide's goal is verifying AI answers against hallucination for general web users; Cognia's goal is reducing cognitive load for vulnerable users on civic/health portals specifically, via a subtractive (not additive) UI, accessibility-profile personalization, and frustration-adaptive support — features PageGuide's published method doesn't do.

## 7. Sync checkpoints

Every ~3 hours, take 5 minutes as a group and answer just one question each: **"does my output still match the schema in `CONTRACTS.md`?"** If yes, keep going. If you needed to change a field, that's the moment to raise it — not after everyone else has built against the old shape.

---

## 8. Demo scenario

**Primary (guaranteed-safe):** everyone builds and tests against the same fixed scenario: a fake driver's-licence-renewal form (`test-site/index.html`), goal = *"renew my driver's licence."* This is what the core loop must work on before anything else — don't move on to real-site testing until this is rock solid.

**Secondary (credibility stretch, Person 1's Milestone 3):** once the core loop works on `test-site`, harden the Page Mapper against 2–3 real websites with simple/mostly-static DOM (a government service portal, a hospital appointment page, a university admission form). Avoid anything with a login wall, CAPTCHA, or a heavy JS framework re-rendering constantly — those will break live and we won't have time to fix it on stage. Screen-record each real-site run as a backup the moment it works, so the live demo never depends on an unrehearsed real site behaving.

Fill in `docs/demo-script.md` near the end with the exact click-by-click script for both the primary live demo and which real-site clips (if any) get shown live vs. played from video.

---

## 9. Timeline recap

| Time | Milestone |
|---|---|
| Hr 0–1 | Read this README + `CONTRACTS.md`, claim your role, Person 4 gets the mocked loop running |
| Hr 1–10 | Everyone builds core modules against mocks in parallel |
| Hr 10–12 | Swap mocks for real modules, one at a time |
| Hr 12–15 | Full core pipeline running end-to-end on `test-site`, debug together |
| Hr 15–18 | **Differentiation phase** — plain-language prompt tuning (Person 2), accessibility-profile popup + `read_aloud` wiring (Persons 3 & 4), real-site hardening (Person 1). Only start this once the core loop is solid — don't risk the baseline for stretch features. |
| Hr 18–20 | Feature freeze, polish the demo scenario(s), record real-site backup clips |
| Hr 20–21 | Buffer for bugs |
| Hr 21–23 | Record demo / rehearse pitch, read `docs/competitor-analysis.md` together once |
| Hr 23–24 | Submit |

**Priority order if time runs short:** core loop on `test-site` > plain-language instructions > accessibility profile + read-aloud > frustration-adaptive escalation demo polish > real-site hardening. The first item is non-negotiable; everything after it is a genuine differentiator but optional if the clock forces a cut.

If in doubt about anything, re-read your section above before asking — it's written to answer the "what exactly do I build" question in full. If something's genuinely ambiguous, flag it in the group chat immediately rather than guessing and building on a wrong assumption.
