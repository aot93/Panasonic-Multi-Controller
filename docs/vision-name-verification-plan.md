# Vision-based projector name verification — design plan

**Status: Milestones 1 and 2 implemented and validated on real hardware**
(client-side OCR + "Verify Name" button, backend persistence, device-tile
badge) — living only on the `development` branch, not yet merged to
`main`. Milestone 1 is committed; Milestone 2 is not yet committed. See
§15 for the full build/validation history and what Milestone 3 covers
next.

## 1. The ask, verbatim

> Using the preview feature we added we inspect each projector to check that
> the projector name matches what is on the preview window, if [it] does not
> this is flagged to the user.

Two limitations named up front:

1. The user must correctly name the projector in the app (garbage in,
   garbage out — the check can only confirm the *display* matches the
   *configured name*, not that the configured name is the right one).
2. The image on the preview must contain the projector's name as visible
   text — content has to be designed for this. Sample/template images will
   be provided.

## 2. Design goals this has to respect

Both are existing, load-bearing constraints of this project, not new ones:

- **Simple installation** — single Windows exe (`npm run package:win`,
  `docs/PROGRESS.md` decision log), no native compile step, no separate
  runtime/toolchain to install. This project has already swapped
  `better-sqlite3` → `node:sqlite` specifically to avoid a native build step
  — a vision feature that reintroduces one (a system OCR binary, a Python
  environment, a GPU-dependent model) would be a regression of the same
  kind.
- **Local only, no internet** — the app already binds to the LAN
  (`0.0.0.0`) and has no cloud dependency anywhere (no telemetry, no
  license server, no cloud OCR API). Whatever OCR approach is chosen must
  run **fully offline** — including not silently phoning home for model
  files at runtime, which is a real gotcha with some JS OCR libraries'
  default configuration (see §4).

## 3. What already exists to build on

Phase 2 (`docs/PROGRESS.md`) built a live preview: the **browser** connects
directly to each projector's undocumented preview WebSocket
(`ws://<host>:8080`, subprotocol `pj-cast-protocol`) and renders incoming
JPEG-ish `Blob` frames as an `<img>`. Key facts that shape this design:

- **No backend involvement at all** in the preview path today
  (`hooks/usePreviewSocket.ts`, `components/DevicePreviewTile.tsx`,
  `components/PreviewGrid.tsx`) — the protocol needs no NTCONTROL
  credentials, and the browser already has direct LAN access to the fleet.
- **Nothing auto-connects.** Opening the Preview tab does not itself open a
  socket; every connection is an explicit click. This was a deliberate
  choice (a fleet-wide multiview is a materially heavier load than anything
  else in the app) and the same reasoning applies here.
- Frames arrive as a `Blob` (`event.data instanceof Blob`) and are currently
  only ever turned into an object URL for `<img src>`. Nothing decodes
  pixels or inspects content today.

## 4. OCR engine choice

| Option | Verdict |
|---|---|
| **Tesseract.js** (WASM, runs in browser or Node, MIT licensed) | **Recommended.** Pure JS/WASM — no native compile, matching every other dependency decision in this project. Works in the browser (keeps the existing "no backend involvement" preview architecture intact) or in Node identically. |
| System Tesseract binary (`node-tesseract-ocr` and similar wrappers) | Rejected — requires installing a separate native binary on the target machine, which breaks "download the exe and run it." |
| ONNX Runtime Web + a scene-text model (PaddleOCR/EasyOCR-onnx) | Rejected for now — meaningfully more accurate on messy real-world scene text, but heavier to bundle/quantize and total overkill for reading a large, high-contrast, purpose-built name slide (see §6). Worth revisiting only if Tesseract's accuracy proves insufficient in practice. |
| Cloud OCR (Google Vision / AWS Textract / Azure CV) | Rejected outright — violates "local only, no internet" as a hard requirement, not a preference. |

**The one thing that needs explicit attention:** Tesseract.js's default
configuration fetches its core/worker JS and language traineddata from a
CDN (`unpkg.com`) at runtime unless told otherwise. For this app, those
files must be **self-hosted** — copied into
`packages/frontend/public/tesseract/` (Vite's `public/` convention copies
its contents byte-for-byte into `dist/`, which `copy-assets.mjs` already
copies into `packages/backend/dist/public`, which `scripts/package.mjs`
already copies next to the exe — so this needs **zero packaging script
changes**, just dropping the files in the right folder) and the Tesseract
worker pointed at those local paths instead of the CDN.

Expect roughly 1–2 MB for the core WASM/worker and ~2–4 MB (gzipped) for
`eng.traineddata` — a real but modest exe size increase, and a one-time
download during development (fetching the release asset once to vendor it
locally), not something the shipped app ever fetches itself.

**Actual, post-implementation:** this estimate was too low. Vendoring the
three LSTM WASM core variants (`OEM.LSTM_ONLY`, all three of
plain/SIMD/relaxedSIMD — see §15's real-hardware finding for why all three
are required, not just one), the worker script, and `eng.traineddata.gz`
comes to **~22 MB** total, not ~3-6 MB — `eng.traineddata` alone is ~11 MB,
not 2-4 MB, and each WASM core variant is ~3.9 MB. Still a modest addition
for a desktop app exe, just a materially bigger one than first guessed. See
§15 for how these are vendored (`scripts/setup-ocr-assets.mjs`, gitignored,
not committed).

## 5. Where OCR runs: browser, with results reported to the backend

Neither "pure client-side" nor "pure server-side" alone is quite right:

- **Pure client-side** (run Tesseract, compare, show a result — never tell
  the backend) would be simplest, but the result would vanish on page
  reload and couldn't show up anywhere else in the app (the device grid,
  the Logs tab) — and a "flag to the user" that only exists transiently in
  one tab isn't really a fleet-monitoring feature.
- **Pure server-side** would mean the *backend* opens the preview
  WebSocket itself, which undoes Phase 2's deliberate "browser talks
  directly to the projector, backend not involved" design, and would mean
  a wholly new backend WebSocket client for a protocol that's already
  unofficial/reverse-engineered.

**Recommended split:** the browser (which already has the frame) runs
Tesseract.js against it and sends just the *result* — detected text (and a
confidence score) — to a small new backend endpoint. The backend owns the
actual match/no-match decision and persists it, so:

- Matching logic lives in one place, is unit-testable without a browser or
  WASM runtime, and is consistent regardless of which tab/device triggered
  the check.
- Results persist and can drive the same UI/alerting patterns already built
  for health/self-diagnosis (device tile badge, `events` table + CSV log,
  `GET /api/events`).

## 6. Matching logic

Normalize both sides before comparing — device names and OCR output won't
match byte-for-byte even on a clean read:

1. Uppercase, trim, collapse internal whitespace, strip punctuation from
   both the configured device name and the OCR text.
2. **Primary check:** is the normalized device name a *substring* of the
   normalized OCR text? (The slide may have other text around the name —
   room number, building, a logo caption — so exact whole-string equality
   is too strict.)
3. **Fallback:** if not a clean substring, compute a similarity score
   (e.g. Levenshtein-based ratio) between the device name and the best-
   matching window of the OCR text, and accept above a configurable
   threshold — tolerates the OCR mistaking similar characters (`0`/`O`,
   `1`/`l`/`I`) without accepting an unrelated read.
4. Anything not meeting either bar is a **mismatch**; a completely empty/
   unreadable OCR result is a distinct **error** state (couldn't verify),
   not silently treated as a mismatch — an unreadable frame (blank input,
   HDCP placeholder, projector off) is a different problem than a wrong
   name, and conflating them would generate false "flag the user" alerts.

The threshold should be a `settings` row (like `temp_warning_c` used to
be), not hardcoded — expect this needs tuning once tried against real
signage.

## 7. Data model

New table (its own table, not bolted onto `device_state`, since it's
populated on-demand rather than by the regular poll cycle):

```sql
CREATE TABLE device_name_verification (
  device_id     INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('match', 'mismatch', 'error')),
  detected_text TEXT,
  confidence    REAL,
  checked_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

New shared type (`packages/shared/src/types.ts`):

```ts
export type NameVerificationStatus = 'match' | 'mismatch' | 'error';

export interface NameVerificationResult {
  deviceId: number;
  status: NameVerificationStatus;
  detectedText: string | null;
  confidence: number | null;
  checkedAt: string;
}
```

Folded into `DeviceWithState` (like `credentialOverride` already is) so the
grid can show a badge with zero extra requests:

```ts
nameVerification: NameVerificationResult | null; // null = never checked
```

## 8. New API surface

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/devices/:id/verify-name` | Body `{ detectedText: string, confidence?: number }` — backend normalizes/matches, persists the result, and (on `mismatch`) raises an `events` row + CSV log line reusing the existing `logDeviceError` pattern (severity `warning`, code e.g. `name-verify.mismatch`), same as every other alert in this app. Returns the stored `NameVerificationResult`. |
| `GET` | `/api/devices/:id/verify-name` | Last known result (mostly for completeness — `GET /api/devices` already includes it). |

No changes needed to the preview WebSocket path itself, and no automatic
polling of anything — this is dispatched the same way a manual command is,
just from the browser's own OCR result rather than the projector's wire
protocol.

## 9. UI

- **Preview tab** (`DevicePreviewTile.tsx`): a "Verify Name" button, enabled
  once a frame has arrived. Runs OCR on the current frame client-side,
  POSTs the result, shows an inline outcome (✓ / ⚠ / "couldn't read")
  immediately without waiting for a page refresh.
- ~~"Verify all" bulk action on `PreviewGrid.tsx`~~ **Implemented.**
  Sequential, not parallel. For each visible device: if its tile already
  has an open connection, reuse it (`DevicePreviewTileHandle`, an
  imperative ref exposing `isConnected`/`canVerify`/`verifyName` — see
  DevicePreviewTile.tsx); otherwise open a short-lived one-shot connection
  just long enough to grab a single frame, then close it
  (`lib/previewCapture.ts`'s `captureOnePreviewFrame`). Deliberately never
  opens a second connection to a device that already has one open — the
  preview protocol is undocumented/reverse-engineered, and a redundant
  connection risks disrupting the one already in use, not just wasting a
  socket. A device whose tile is already mid-check on its own (e.g. a
  manual click landed on the same device the batch reaches) is skipped for
  this pass rather than raced or double-connected. One device's failure
  doesn't stop the rest of the batch; the button shows live progress
  ("Verifying 3/12…").
- **Device tile** (`DeviceCard.tsx`): a small badge next to the name once a
  device has ever been checked — reusing the same colour convention as
  health (green/amber/grey for match/mismatch/error), with the detected
  text in a tooltip for troubleshooting a bad read vs. a genuine mismatch.
- **Logs tab**:No need for logging to csv or to ui.

## 10. Known limitations (restated + expanded)

From the request, plus what falls out of the design above:

1. **The configured device name must be correct** — this checks
   *display-matches-config*, not *config-is-right*. (User-named limitation.)
2. **The displayed content must contain the name as legible text** — a
   template/sample slide will need to be provided (large, high-contrast,
   sans-serif text; avoid placing it where a logo or busy background could
   occlude it). (User-named limitation.)
3. **Only works while the projector is showing that content** — if the
   input is powered off, blanked (shutter closed), on the wrong source, or
   showing HDCP-protected content (the preview protocol's own `HDCP`
   placeholder message — see `usePreviewSocket.ts`), there's nothing to
   read. This should surface as the distinct `error` status (§6), not a
   false mismatch.
4. **OCR accuracy is not perfect**, even on a good slide — expect to tune
   the similarity threshold (§6) against real signage rather than assuming
   day-one accuracy.
5. **Depends entirely on Phase 2's preview working for that unit** — which
   is itself reverse-engineered and only confirmed against the tested
   fleet, not guaranteed across every model/firmware (`docs/PROGRESS.md`'s
   Phase 2 write-up).
6. **This is a point-in-time check, not monitoring** — a name mismatch
   introduced *after* the last check (e.g. signage content changed) isn't
   caught until someone runs it again, unless/until a scheduled mode is
   built (§11, deferred).

## 11. Phasing

**Milestone 1 — prove it works, minimal surface**
Client-side OCR + "Verify Name" button in the Preview tab only; show the
result inline; nothing persisted, no backend changes. Cheapest way to
validate real-world OCR accuracy against an actual sample slide on actual
hardware before investing in the rest.

**Milestone 2 — persistence + fleet visibility**
`device_name_verification` table, the two API routes, `DeviceWithState`
field, device-tile badge, and the "Verify all" bulk action (see §9 for how
it avoids redundant connections). Per the answered open question #2
(§14), a mismatch is informational only — no `events`/CSV logging, and it
does not affect device health.

**Milestone 3 — polish / deferred**
- A bundled template/reference slide generator or downloadable sample
  image(s), per the "we will provide sample images" plan.
- ~~Inline name editing in the Preview tab~~ **Implemented.** Added to
  this list from real-hardware testing feedback: while verifying a
  device's name, let the user correct its configured name right there
  (`DevicePreviewTile.tsx`), rather than having to navigate to the Devices
  tab. Directly addresses limitation #1 (§10) — the check can only confirm
  display-matches-config, so the fastest fix for a caught mismatch is
  often "the config was wrong, fix it here." Click the name to edit,
  Enter/Save to commit (reuses `useUpdateDevice`, same PATCH the Devices
  tab's own rename uses), Escape/Cancel to back out. Saving clears the
  tile's own inline verification result (it was checked against the old
  name) — the persisted badge on the Devices tab is left as-is rather than
  auto-cleared, a known small inconsistency (a stale checked-against-the-
  old-name result sitting next to the new name) not worth solving until it
  proves confusing in practice.
- Scheduled/automatic re-verification. **Deferred deliberately** — like
  every other addition to the automatic poll cycle in this project, turning
  this into something that runs unattended against real hardware needs the
  same explicit go-ahead already established as standing practice here,
  and a scheduled *image-streaming* check is a heavier ask than a scheduled
  NTCONTROL query.
- Configurable matching threshold exposed in Settings rather than a fixed
  constant.

## 12. Testing strategy

- **Matching/normalization logic** (§6): plain unit tests, no browser or
  WASM needed — this is pure string logic and is exactly the kind of thing
  this project already unit-tests thoroughly (e.g. `self-diagnosis.ts`'s
  code-table lookup).
- **OCR accuracy itself** can't be meaningfully unit-tested against
  guaranteed-correct output, but a small set of synthetic fixture images
  (generated once, checked in — e.g. a canvas-rendered PNG with known
  text, several fonts/contrasts) gives a repeatable smoke test for "does
  the pipeline still produce reasonable text for a clearly-legible input,"
  independent of real hardware.
- **Real-hardware validation** — same standing rule as everything else in
  this project: no automatic/scheduled checks against the live fleet
  without asking first (Milestone 3 explicitly deferred for this reason);
  Milestones 1-2's manual, click-to-verify flow is user-initiated each
  time, same footing as clicking "Start" on a preview tile today.

## 13. Open questions before implementation starts

1. Does the recommended split (OCR in-browser, matching decision on the
   backend) match your expectations, or would you rather keep everything
   client-side for Milestone 1 and only add the backend piece in
   Milestone 2?
2. Any preference on the mismatch severity/handling — should a mismatch be
   allowed to affect a device's overall health colour (like self-diagnosis
   does), or stay purely informational (badge + log, health unaffected)?
3. What should the sample/template slide actually look like — do you have
   an existing signage template, or should this project produce one (e.g.
   a simple generated PNG: device name, large sans-serif, high contrast)
   as part of Milestone 3?
4. Any non-English / non-Latin-alphabet projector names in the fleet?
   Tesseract.js supports other language traineddata files, but each one
   adds to the bundled asset size, so it's worth knowing up front rather
   than assuming English-only.

  ## 14. Answers to questions before implementation starts

  1. Follow the recomneded split

  2. The severity should not affect device overall health, just the badge no log required here

  3. Sample slides will be added to the project in a sample slides folder, you may create this folder in phase 1

  4. English language only

## 15. Progress (Milestone 1 — implemented, unvalidated against real hardware)

Built on the `development` branch only, per instruction — nothing here has
touched `main`.

**Shared matching logic** — `packages/shared/src/name-verification.ts`:
`matchDeviceName(deviceName, detectedText, options?)` implements §6 exactly
(normalize → substring check → Levenshtein-similarity fallback over a
sliding window → distinct `error` for null/blank input). Default similarity
threshold 0.8, overridable via `options.similarityThreshold`. Unit-tested in
`packages/backend/src/name-verification/matching.test.ts` (9 tests — exact
match, case/whitespace/punctuation tolerance, substring-within-longer-text,
unrelated-text mismatch, OCR character-confusion tolerance via the fuzzy
fallback, null/blank → `error` not `mismatch`, threshold sensitivity in both
directions). Full backend suite: 241/241 passing.

**OCR** — `tesseract.js@7.0.0` added to the frontend workspace. Assets
self-hosted under `packages/frontend/public/tesseract/` (worker script, the
two LSTM WASM core variants, `eng.traineddata.gz`) rather than pulled from
tesseract.js's CDN default, per §4's "no internet" requirement — vendored by
the new `npm run setup:ocr-assets` (`scripts/setup-ocr-assets.mjs`), which
is idempotent and deliberately **not** wired into `postinstall` (no silent
network fetch on every install). The generated folder is gitignored, not
committed — regenerate it after a fresh clone with that script, same
pattern as `node_modules`/`dist`. See §4 for the actual asset size (~18 MB,
corrected from the original estimate).

`packages/frontend/src/lib/ocrWorker.ts` holds one shared worker for the
app's lifetime (`getOcrWorker()`, lazy singleton, same pattern as
`lib/socket.ts`'s `getSocket()`), pointed at the local asset paths.

**Frame capture** — `usePreviewSocket.ts` gained `captureFrame(): Blob |
null` in its returned `PreviewControls`, backed by a ref that tracks the
latest raw frame `Blob` alongside the existing object-URL state (cleared in
every place `imageUrl` already gets cleared: `HDCP`, `BLANK`, socket close,
`!enabled`, and effect cleanup).

**UI** — `useNameVerification.ts` (new hook) orchestrates
capture → OCR → match, exposing `runState: 'idle' | 'running' | 'match' |
'mismatch' | 'error'`. `DevicePreviewTile.tsx` adds a "Verify Name" button
(enabled once a frame exists) and an inline colour-coded result with the
detected OCR text in a tooltip — this is **client-side only**: no backend
call, no persistence, nothing else in the app (device grid, Logs tab) knows
a check happened. That's deliberate per §11 — Milestone 1's whole purpose is
proving OCR accuracy is good enough before building persistence around it.

**Sample slides** — `sample-slides/` folder created per §14 answer 3, with a
README describing what belongs there. No actual sample images added yet;
the user will supply/drop them in.

**What's NOT done yet (Milestone 2, per §11 — waits on real-hardware
validation first):** `device_name_verification` table, the two
`/api/devices/:id/verify-name` routes, `DeviceWithState.nameVerification`,
the device-tile badge, "Verify all" bulk action. Also not done: Milestone
3's template-slide generator and configurable-threshold Settings UI.

**First-pass OCR validation against real sample slides:** two slides were
dropped into `sample-slides/` (`Projector 1.png`, `Projector 2.png` — cyan
text on red / red text on cyan, resolution + device name). Ran the actual
`tesseract.js` + `matchDeviceName` pipeline against both directly in Node
(not through the browser UI, but the same shared matching logic and the
same OCR engine) as a first-pass check before real-hardware testing:

- `Projector 1.png` read as `Projector 1` → correctly `match` (89%
  confidence).
- `Projector 2.png` read as `Projector 2` → correctly `match` (94%
  confidence).
- **Negative control** — checking `Projector 2.png`'s frame against the
  configured name `Projector 1` (i.e. the wrong device) — **incorrectly
  returned `match`** on the first run. Root cause: the fuzzy-similarity
  fallback (§6 step 3) scores "PROJECTOR 1" vs a clean OCR read of
  "PROJECTOR 2" the same way it scores genuine OCR noise like "0"/"O"
  confusion — both are "one substituted character in an 11-character
  string," so no single similarity threshold can accept one and reject the
  other. This is exactly the auto-numbered naming convention
  (`docs/NextSteps.md`'s Phase 4 wishlist, "Projector 1", "Projector 2", …)
  the fleet is expected to use, so it needed a real fix, not just a noted
  limitation.
  **Fixed** in `matchDeviceName`: when the device name ends in a digit run
  (`trailingDigits()`), the matched window's trailing digits must equal the
  name's exactly, or it's forced to `mismatch` regardless of overall
  similarity score. Doesn't affect the existing OCR-noise tolerance test
  (`PR0JECT0R 1`, trailing digits `1` on both sides — unaffected) or any
  non-numbered name. Added as a permanent regression test
  (`matching.test.ts`, "an auto-numbered name is not confused with its
  neighbor"). Full backend suite: 242/242 passing after the fix.

**Real-hardware smoke test, round 1 — found a missing vendored asset:**
first attempt against a live projector failed with `NetworkError: Failed to
execute 'importScripts' ... tesseract-core-relaxedsimd-lstm.wasm.js failed
to load`. Cause: `scripts/setup-ocr-assets.mjs` only vendored two of the
three LSTM WASM core variants (plain + SIMD), on the mistaken assumption
that "LSTM-only" (an OEM/engine-mode choice) meant only two files existed.
In fact the SIMD tier is a *separate, orthogonal* axis — tesseract.js-core
ships plain/SIMD/relaxedSIMD builds of each engine mode, and the browser's
own WASM feature-detection picks whichever tier it supports at runtime,
not something this app chooses. A missing tier isn't a graceful fallback,
it's a hard load failure. **Fixed** — `setup-ocr-assets.mjs` now vendors
all three LSTM variants; re-ran the script to fetch the missing
`relaxedsimd-lstm` file (~3.9 MB, no rebuild/restart needed since Vite
serves `public/` files directly). Asset total revised to ~22 MB (§4).

**Real-hardware smoke test, round 2 — passed.** After vendoring the third
WASM variant, re-tested against a live projector: a correctly-named device
returned `match`, and a deliberately wrong configured name was correctly
rejected as `mismatch`. Both directions now confirmed end-to-end through
the actual browser UI (live preview capture → self-hosted OCR → shared
matching logic), not just the Node-side check against static sample images.

**Milestone 1 is complete, validated, and committed to `development`.**

**Milestone 2 — implemented and validated.** `device_name_verification`
table (migration `004_name_verification.sql`), `POST`/`GET
/api/devices/:id/verify-name` (`devices/routes.ts`, upserts by `device_id`
so re-checking a device replaces its stored result rather than erroring on
the duplicate key), `DeviceWithState.nameVerification` (`read-model.ts`,
`LEFT JOIN device_name_verification`), and a badge on the device card
(`DeviceCard.tsx`) showing the last result with the detected text in a
tooltip. `useNameVerification.ts` was changed from computing the match
client-side to just running OCR and POSTing `{detectedText, confidence}` —
the backend now owns the match decision (`matchDeviceName` runs
server-side in the route handler), matching §5's recommended split
exactly. New backend tests cover: null-before-first-check, persisted
match, the auto-numbered-neighbor mismatch case, null-text → `error`,
upsert-replaces-not-duplicates, and 404 for an unknown device. Full backend
suite: 248/248 passing.

Real-hardware validation: verified against a live projector, confirmed the
badge appears on the Devices tab, and confirmed the result survives a full
page reload — proving it's actually persisted server-side, not just held
in browser memory.

**Feature request from testing, added and implemented:** inline name
editing directly in the Preview tab (`DevicePreviewTile.tsx`) — since
that's exactly where a mismatch is discovered. Click the name to edit,
Enter/Save to commit (reuses `useUpdateDevice`), Escape/Cancel to back
out. Validated on real hardware.

**"Verify all" bulk action — implemented** (originally spec'd in §9,
initially skipped when Milestone 2 shipped, added afterward). Required
lifting an imperative handle out of `DevicePreviewTile` (`forwardRef` +
`useImperativeHandle`, exposing `isConnected`/`canVerify`/`verifyName`) so
`PreviewGrid` can reuse an already-open tile's connection rather than
opening a second one to the same device — a real risk, not just an
optimization, since the preview protocol is undocumented and unclear
whether it tolerates two simultaneous clients per device. For devices
with no tile open, a new standalone one-shot helper
(`lib/previewCapture.ts`) connects, grabs one frame, and closes. The OCR +
submit step was factored out of `useNameVerification.ts` into
`lib/nameVerification.ts`'s `runNameVerification()` so both the
single-tile hook and the bulk path run OCR identically — `useVerifyDeviceName`
(`useDevices.ts`) now takes `{id, frame}` and does the OCR itself, rather
than the caller pre-computing `detectedText`. Typecheck/build clean;
backend suite unaffected (248/248, frontend-only change).

**Milestone 2 is now fully complete**, including the bulk action originally
scoped for it. Milestone 3 remains: a template-slide generator, a
configurable threshold in Settings, and deliberately-deferred scheduled
re-verification.
