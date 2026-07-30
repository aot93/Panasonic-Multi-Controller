# Project recap — where things stand

A checkpoint for resuming this build. Read this first if picking the project
back up cold; it links out to the deeper docs rather than repeating them.

**Last updated:** 2026-07-30. Real-hardware testing succeeded (commands
received, callbacks working against 192.168.0.101–122); `docs/NextSteps.md`
Phase 1 (10 feature items) was implemented in full, then a real-hardware bug
report (AC voltage NaN + wrong scale) was fixed the same session. Phase 2
(live preview feed) was built, tried by the user against the real fleet via
`npm run dev`, and confirmed working — plus four small follow-on additions
in the same session: group filtering in the preview grid, removing a device
from a group, deleting a device from the app, and renaming a device. Then
the user surfaced `data/logs/errorcodes.md` (self-diagnosis codes
hardware-tested independently) and asked to replace the temperature-
threshold health system with real `QVX:ERRS1`/`ERRS2` decoding, including
logging related sensor values — done, then refined once more so `ERRS1`'s
unidentified findings stay out of the display text (still affect
health/events) per feedback after trying it. **Then `docs/NextSteps.md`
Phase 3 was added** (built-in command additions + usability: input select
rework, a searchable/grouped command picker, server IP in the header,
pause/resume polling, double-click-to-open-web-UI, and 8 new built-in
commands) — done, see that section near the end of this file. **The exe has
been rebuilt with the Phase 3 round and is ready for testing.**

## What this project is

A web app for monitoring and controlling a fleet of Panasonic projectors over
the network, replacing the ad-hoc Python scripts at the repo root. Full spec:
`Claude/Panasonic_Projector_App_Spec_v2.md`. Build order and phases follow
`Claude/claude-code-kickoff-prompt_2.md` — 7 phases, pausing for review after
each.

## Status: phase 7 of 7 — Windows done, macOS not

| Phase | Status |
|---|---|
| 1. Project scaffolding | ✅ Done |
| 2. Panasonic protocol client | ✅ Done |
| 3. Device polling + WebSocket layer | ✅ Done |
| 4. Core API (REST + external TCP/UDP triggers) | ✅ Done |
| 5. Scheduler (node-cron) | ✅ Done |
| — Macro execution engine (pulled forward, see below) | ✅ Done |
| 6. Frontend (grid, batch actions, macros, analytics) | ✅ Done |
| 7. Packaging — Windows | ✅ Done |
| 7. Packaging — macOS | ⬜ Not started (needs a Mac — see below) |
| — Post-packaging UI feedback round (see below) | ✅ Done |
| — Real hardware test (192.168.0.101–122) | ✅ Done — succeeded |
| — `NextSteps.md` Phase 1 (10 items, see below) | ✅ Done |
| — AC voltage bugfix (real-hardware feedback) | ✅ Done |
| — `NextSteps.md` Phase 2 (live preview feed) | ✅ Done — confirmed working against real hardware |
| — Preview group filter, remove-from-group, delete device, rename device | ✅ Done |
| — Real self-diagnosis codes replace temp thresholds | ✅ Done |
| — `NextSteps.md` Phase 3 (built-in commands + usability, 13 items) | ✅ Done — exe rebuilt |

## Repo layout

```
packages/
  shared/    Types + protocol constants shared by backend and frontend
             src/types.ts     — Device, Group, Command, Macro, MacroRunResult, Schedule, etc.
             src/protocol.ts  — NTCONTROL constants, command bodies, enums
             src/self-diagnosis.ts — QVX:ERRS1/ERRS2 code table + lookupSelfDiagnosisCode() (hardware-confirmed, not from either official PDF)
  backend/   Express + Socket.io server, SQLite via node:sqlite
             src/config.ts             — env vars, paths
             src/db/                   — schema, migrations, seed, crypto, cli-add-device (dev helper)
             src/protocol/             — NTCONTROL TCP client + mock projector server (phase 2)
             src/credentials/          — per-device/global credential resolution (phase 2)
             src/poller/               — background polling, health, telemetry, alerting (phase 3)
             src/devices/              — read-model (phase 3) + CRUD + telemetry routes (phase 4/6)
             src/groups/               — group CRUD routes (phase 4)
             src/commands/             — command catalogue CRUD routes (phase 4)
             src/dispatch/             — dispatch engine + POST /api/dispatch (phase 4)
             src/triggers/             — external TCP/UDP trigger listener + CRUD (phase 4)
             src/scheduler/            — node-cron task runner + /api/schedules CRUD (phase 5)
             src/macros/               — macro execution engine + /api/macros CRUD
             src/settings/             — global credentials CRUD (/api/settings/credentials)
             src/events/               — GET /api/events, reads the `events` table (NextSteps phase 1)
             src/project/              — save/load a whole config: export-import.ts + /api/project routes
             src/logging/              — per-device CSV error log (error-log.ts), NextSteps phase 1 item 1
             src/http/                 — error handling, async wrapper, router test helper
             src/util/                 — concurrency limiter (poller/dispatch), network.ts (lanAddresses,
                                         phase 3 item 12)
             src/server.ts, index.ts   — HTTP + Socket.io wiring; composition root for all of the above
  frontend/  React + Tailwind + TanStack Query (phase 6 + feedback round + NextSteps phase 1)
             src/lib/api.ts        — typed fetch client, one object per resource
             src/lib/socket.ts     — one shared Socket.io connection for the app's lifetime
             src/lib/queryKeys.ts  — central query key factory
             src/hooks/            — useDevices/useGroups/useCommands/useMacros/useDispatch/
                                     useDeviceSocket/useSettings/useEvents/usePreviewSocket/
                                     useServerInfo/usePollerStatus
             src/components/       — DeviceGrid, DeviceCard, BatchActionBar, MacroBuilder, MacroEditor,
                                     AnalyticsPane, LineChart, CommandParamInput, CommandPicker
                                     (phase 3 item 11 — searchable/category-grouped), InputSelectPicker
                                     (phase 3 item 2 — slot/type/number), AddDeviceForm,
                                     BulkAddDevicesForm, GlobalCredentialsForm, DeviceCredentialsModal,
                                     GroupsManager, EventLogViewer, CommandCatalogueManager,
                                     ProjectFileManager, PreviewGrid, DevicePreviewTile (Phase 2 —
                                     talks directly to each projector's own preview WebSocket, no
                                     backend involvement at all)
             src/App.tsx           — tab shell (Devices / Macros / Preview / Logs / Settings), selection
                                     state, modals, server IP + pause/resume-polling in the header
docs/
  panasonic-command-list.txt  — extracted text of the official command-list PDF
  ptrq-connection.txt         — extracted text of the official connection-appendix PDF
  protocol-notes.md           — confirmed protocol facts vs. what's still unknown
  PROGRESS.md                 — this file
Claude/
  Panasonic_Projector_App_Spec_v2.md    — the spec
  claude-code-kickoff-prompt_2.md       — the phased build-order prompt
  PTRQ-CONNECTION.pdf                   — official connection appendix (source PDF)
  rq35_rz34_command_list_....pdf        — official command-list (source PDF)
panasonic_*.py                          — original working Python scripts (repo root),
                                           useful reference for real-world credentials/behavior
scripts/
  package.mjs                           — Windows SEA packaging (phase 7): npm run package:win
release/win/                            — packaging output (gitignored): ProjectorControl.exe,
                                           public/, migrations/, README.txt
```

## Key decisions made along the way

1. **SQLite driver: `node:sqlite`, not `better-sqlite3`.** No native compiler
   toolchain on this machine; zero native compilation needed, arguably better
   for phase 7 packaging too. User-approved swap.
2. **Node.js was not installed on this machine** — installed via
   `winget install OpenJS.NodeJS.LTS` (now v24.18.0), with user approval.
3. **Protocol handshake/framing rebuilt from the official connection appendix**
   (`PTRQ-CONNECTION.pdf`) — see `docs/protocol-notes.md`. Two protect modes
   (MD5 **and** SHA-256); the projector's default is one command per TCP
   connection; responses carry a fixed 2-char `"00"` header; `ERRA ***` is a
   3-strikes lockout with seconds remaining.
4. **Credential management added beyond the spec** (user's explicit note).
   Global default + per-device override, resolved field-by-field, encrypted
   at rest, write-only over HTTP.
5. **A wrong password reads as "unreachable"**, not "healthy with blank
   fields" — the poller's power query doubles as a reachability+auth probe.
6. **The dispatch engine is the one place that executes commands against
   hardware.** The scheduler, the external trigger server, and (as of this
   update) macro execution are all just different callers of the same
   `Dispatch` function built in phase 4 — never a separate execution path.
7. **The external trigger wire protocol is our own design** (phase 4) — spec
   §6 doesn't specify one. Plain ASCII trigger keys over TCP/UDP, `OK`/
   `ERR <reason>` responses, for interop with Crestron/AMX/QSC-style systems.
8. **Macro execution engine built ahead of the original plan**, at the
   user's request ("minimal execution engine for now, for better testing")
   right before phase 6. `macros/run-macro.ts`: steps run strictly in order,
   each falling back to the invocation's target unless it has its own
   override; a step that can't even be dispatched (structural error) stops
   the run, but a partial per-device failure within a step does not — that
   mirrors how `dispatch()` already treats group/all targets. Both the
   external trigger server and the scheduler now actually execute
   `action_kind: 'macro'` instead of returning "not supported yet". Full
   CRUD at `/api/macros` plus `POST /:id/run`.
9. **`node-cron` ships zero TypeScript types** — added `@types/node-cron`
   (exists on the registry) rather than hand-rolling ambient declarations.
10. **A new backend endpoint was added specifically to unblock phase 6**:
    `GET /api/devices/:id/telemetry` (`?metric=&idx=&since=&limit=`). The
    poller has written to the `telemetry` table since phase 3, but nothing
    exposed it over HTTP — the analytics pane needed it and it didn't exist,
    so it was built as part of phase 6 rather than treated as a blocker.
11. **The frontend has no client-side router** — a plain `useState` tab
    switch (Devices / Macros) in `App.tsx`. Adding one (react-router or
    similar) would be a real dependency for a two-tab internal tool; not
    justified yet. The analytics pane is a modal, not a route, opened by
    clicking a device card.
12. **No browser or screenshot tool was available while building the
    frontend.** Verification is typecheck + Vite build + real HTTP/Socket.io
    traffic against the live compiled server (every endpoint the UI calls
    was exercised via curl, matching exactly what each component sends) —
    not actual visual rendering or interaction in a browser. This caught one
    real bug (see below) but cannot catch a layout or rendering problem. A
    manual look in an actual browser is worth doing before relying on this.
13. **Packaging uses Node's built-in SEA feature, not `pkg`** (the spec's
    other named option) — `pkg` (Vercel) was archived in 2024 and is no
    longer maintained; SEA is the actively-developed, officially-supported
    path in current Node.
14. **Assets (built frontend, SQL migrations) ship as plain folders next to
    the exe, not embedded inside the SEA blob.** `node:sea` supports true
    asset embedding (`getAsset()`), which would make this one literal file
    with nothing beside it — a real possible future improvement — but it
    requires rewriting `express.static` and the migration file scanner to
    read from embedded assets instead of the filesystem. The adjacent-folder
    approach needed zero changes to either of those and still delivers
    "download [a small folder] and run" (spec §7's actual bar), so it's what
    shipped. `config.ts` is the one file that had to change: it now detects
    `node:sea`'s `isSea()` and resolves `DATA_DIR`/`MIGRATIONS_DIR`/
    `PUBLIC_DIR` relative to `process.execPath`'s directory when packaged,
    vs. relative to the compiled file / cwd otherwise (unchanged behavior).
15. **The SEA sentinel fuse is NOT the value commonly quoted in
    documentation/examples** (`fce680ab-2cc4-46e2-b638-387c95f7c69a`, with
    dashes) — that string does not appear in the actual installed Node
    24.18.0 binary at all. The real one, read directly out of the binary,
    is `fce680ab2cc467b6e072b8b5df1996b2` (no dashes, different hex). The
    packaging script now reads the fuse dynamically out of the copied
    `node.exe` at build time (`readSeaFuse()` in `scripts/package.mjs`)
    rather than hardcoding it — the value is tied to the specific Node build
    and hardcoding it would silently break on any other Node version.
16. **`signtool` (Windows SDK) is not installed on this machine.** The
    packaging script attempts to strip the copied node.exe's Authenticode
    signature before injection (Node's documented recommendation) and warns
    if it can't. Verified this doesn't actually block anything: the packaged
    exe with its now-invalid signature still launches and runs correctly.
    Installing the Windows SDK would make the packaged exe's signature story
    cleaner but isn't required for it to work.

## A real bug caught during phase 6 end-to-end testing

The batch action bar originally rendered *every* favourite command (spec §5:
"custom buttons") as a one-click quick button, including `input.set` — a
favourite command whose `paramKind` is `enum` (it needs to know which input).
Clicking it would have dispatched with `param: null`, which the backend
correctly rejects with a 400. Caught by curling the real seeded catalogue
during verification and noticing `input.set` was flagged as a favourite, not
by any test or type error. Fixed by restricting one-click quick buttons to
`paramKind === 'none'` commands; anything needing a parameter goes through
the full command picker (which already has the right control per `paramKind`).

## What's built and verified

- Full monorepo builds clean (`npm run typecheck` from repo root).
- SQLite schema covers everything through phase 6; only `scheduled_tasks`'
  execution is exercised by the scheduler (unused: nothing) — the schema has
  no remaining unused tables now that macros execute.
- **Protocol client** (phase 2), **poller** (phase 3), **REST API** (phase 4),
  **scheduler** (phase 5), **macro engine** — see prior updates to this file
  for each, all still accurate.
- **Phase 6 frontend** — see the repo layout above for file-by-file detail.
  Notable design choices: the grid is "live" via direct TanStack Query cache
  patches from Socket.io (no polling once loaded); a shared `CommandParamInput`
  component (enum/integer/string/none) is reused by both the batch bar and
  the macro step editor rather than duplicated; the analytics pane's
  `LineChart` follows the project's dataviz skill (fixed categorical dark-mode
  hues assigned by slot order, 2px lines, ≥8px end markers with a surface-color
  ring, crosshair + shared tooltip, legend for 2+ series, recessive hairline
  gridlines) rather than pulling in a charting library for two chart types.
- 168 backend tests passing (`npm test --workspace @ppc/backend`); frontend
  has no automated tests yet (no test runner configured for it — this
  wasn't asked for and would be a separate, real addition, e.g. Vitest +
  Testing Library, if wanted later).
- **Manually verified end-to-end** against the real compiled server (backend
  serving the built frontend from `dist/public`): registered a device via
  `POST /api/devices` (confirming the exact request shape `AddDeviceForm`
  sends), confirmed the built JS/CSS bundle is served correctly, waited for
  real poll cycles and confirmed `GET /api/devices/:id/telemetry` returns
  data shaped exactly as `AnalyticsPane` expects (grouped by metric/idx,
  parseable timestamps), dispatched a command matching what the batch bar
  sends, and hit `/api/groups` and `/api/macros` matching what `MacroBuilder`
  expects on an empty fleet.
- **Phase 7 packaging** (`scripts/package.mjs`, `npm run package:win`):
  builds shared/frontend/backend, bundles the backend + every npm dependency
  into one CJS file with esbuild (`node:*` builtins, including `node:sqlite`,
  stay external `require()`s automatically — no native addon to worry about),
  generates a Node SEA blob, copies the running `node.exe`, reads that
  binary's actual embedded sentinel fuse (see decision #15), injects the
  blob via `postject`'s programmatic API, and copies `public/`+`migrations/`
  next to the resulting exe.
- **The packaged exe was actually run and exercised**, not just built:
  launched `release/win/ProjectorControl.exe` directly, confirmed `DATA_DIR`
  correctly resolved to a `data/` folder next to the exe (proving the
  `isSea()` branch in `config.ts` works in the real binary, not just in
  theory), registered a device against a real running mock projector,
  dispatched a command, created and ran a macro, confirmed telemetry
  accumulated, confirmed a real `socket.io-client` received `device:state`
  pushes, and confirmed all of it survived stopping and restarting the exe
  (SQLite persisted, migrations correctly didn't re-run).

## What went wrong while building phase 7 (all resolved)

Packaging hit three real, non-obvious problems before it worked — worth
recording since they'll bite again on the macOS pass or after a Node
upgrade:

1. **`execFileSync` on a `.cmd` shim needs `shell: true` on Windows** — npm
   and postject's CLI are both `.cmd` batch files, not real executables;
   without `shell: true` Windows throws `EINVAL` trying to spawn them.
2. **...but `shell: true` doesn't auto-quote array args with spaces** — every
   path in this repo has spaces in it ("Panasonic Multi Controller", "Python
   projects"). `execFileSync(cmd, args, {shell:true})` concatenates the args
   array into one string for `cmd.exe` without quoting each element, so a
   spaced path silently splits into multiple tokens. Fixed for `postject`
   specifically by switching to its programmatic API (`inject()` from
   `postject`'s `dist/api.js`) instead of shelling out to its CLI at all —
   sidesteps the quoting problem entirely rather than fixing the quoting.
3. **The documented SEA sentinel fuse value is stale** — see decision #15.
   This was the real blocker; the fix is reading the actual value out of the
   binary being packaged rather than trusting a hardcoded constant.

## Post-packaging UI feedback round

After trying the packaged Windows exe, the user flagged four gaps — all
closed in this round:

1. **No UI for setting/modifying credentials** — the storage layer
   (`credentials/store.ts`) and the per-device HTTP route
   (`/api/devices/:id/credentials`) existed since phases 2 and 4
   respectively, but (a) the *global* default had no HTTP route at all — an
   oversight, since phase 4's "Core API" should have included it alongside
   the per-device one — and (b) neither had ever gotten frontend UI.
   Fixed: `GET/PUT/DELETE /api/settings/credentials` (new,
   `packages/backend/src/settings/routes.ts`) plus `GlobalCredentialsForm`
   (Settings tab) and `DeviceCredentialsModal` (opened from each device
   card, editing username/password independently — matching the backend's
   existing per-field override semantics, not a single all-or-nothing form).
2. **Add multiple devices from an IP range** — new
   `POST /api/devices/bulk` (`devices/ip-range.ts` + a route in
   `devices/routes.ts`): expands an inclusive start/end IPv4 range,
   deliberately restricted to a single /24 (only the last octet may differ)
   and capped at 254 addresses — arbitrary CIDR support would add real
   complexity for a case that doesn't come up when racking projectors on
   one subnet. A bad IP in the middle of a range doesn't fail the whole
   batch — same "partial success is normal" shape as dispatch() and
   runMacro(). `insertDevice()` was extracted out of the single-create route
   so both paths share one insert-and-translate-constraint-errors helper
   rather than duplicating it.
3. **Select all** — a button in `DeviceGrid`'s header, toggling to
   "Deselect all" once every visible device is selected.
4. **Groups as "selection groups"** — the `groups`/`device_groups` schema
   and CRUD API existed since phase 1/4 but had zero frontend before this:
   no way to create a group, no way to put a device in one, no way to use
   one. Added `GroupsManager` (create/delete, in Settings), clickable group
   chips above the grid (`DeviceGrid`) that select every device in that
   group in one click — replacing the current selection, not adding to it,
   so it reads as "select this saved set" rather than an accumulating
   filter — and an "Add to group" control in `BatchActionBar`. The one
   subtlety: `PUT /api/devices/:id/groups` *replaces* a device's group list
   (by design, from phase 4), so "add selected devices to group X" merges
   client-side (`[...existing groupIds, X]`, deduped) rather than naively
   overwriting whatever groups a device was already in.

Verified the same way as the rest of this build (no browser available):
typecheck, Vite build, and curl-level exercise of every new/changed
endpoint — global credentials set/get/clear, bulk-create across a range
including a deliberately-colliding IP to confirm partial success, group
create + device assignment + deviceCount, per-device credential override.
185 backend tests passing (up from 168) — 17 new, covering
`parseIpRange`'s edge cases (malformed IPs, cross-subnet rejection, the
254-address cap), the bulk-create route's partial-failure behavior, and the
new settings route.

## `docs/NextSteps.md` Phase 1 — real-hardware follow-up round

After the real-hardware test succeeded ("commands are well received and
callbacks are working"), the user asked to work through `docs/NextSteps.md`'s
Phase 1 list (10 items) and pause before Phase 2. All 10 are done:

1. **Per-device CSV error logging** — `logging/error-log.ts`. One CSV file
   per device under `<data dir>/logs/device-<id>-<host>.csv`, header row +
   append-only, timestamp from the local PC's own clock (`getFullYear()`/
   `getHours()`/... — never `toISOString()`, which is UTC) because the
   projector's own clock is frequently wrong. Hooked into two places: the
   poller's existing health-transition events (unchanged trigger condition —
   still only on a *change*, to stay quiet under routine 30s polling), and
   **dispatch failures**, which previously went to `command_log` only and
   never to `events` or any log file at all — now every failed dispatched
   command (wrong password, `ERR1-5`, timeout, ...) writes both an `events`
   row and a CSV line.
2. **Error log viewer** — new `Logs` tab (`EventLogViewer.tsx`), reading
   `GET /api/events` (new, `events/routes.ts` — filters: `deviceId`,
   `severity`, `limit`). Reads the same `events` table the CSV files are
   written from, not the CSV files themselves.
3. **Save/load project files** — `project/export-import.ts` +
   `GET/POST /api/project/export|import`, UI in `ProjectFileManager.tsx`
   (Settings tab). Every cross-table reference in the exported JSON uses a
   stable natural key (device `host:port`, group/macro name, command `key`)
   instead of a numeric id, since ids are meaningless once re-imported.
   Import is strictly additive — an existing row (matched by that same
   natural key) is left alone and reported as skipped, never overwritten or
   deleted; a macro step or schedule/trigger referencing something missing
   on the target install is dropped with a warning rather than failing the
   whole import. **Credentials are never included in the export**, by
   design — the file is meant to be safe to email or commit.
4. **Tile shows error/input/shutter/aspect/screen status** — `DeviceCard.tsx`
   now has `Status` (health), `Input`, `Shutter` (Open/Closed), `Aspect
   ratio`, `Screen setting` rows, each mapped through the existing
   `INPUT_OPTIONS`/`ASPECT_OPTIONS`/`SCREEN_SETTING_OPTIONS` value→label
   tables rather than showing raw protocol tokens.
5. **Removed intake/exhaust temp and lamp hours from the tile** — that data
   still exists (still polled, still on the analytics pane's charts), just
   no longer duplicated on the card itself.
6. **Group chip hides non-members** — `DeviceGrid`/`App.tsx` gained
   `activeGroupId` state; clicking a group chip now both selects its members
   (unchanged) *and* filters the visible grid down to just them; clicking it
   again (or nothing else deselecting) restores the full grid.
7. **UI for custom control codes** — `CommandCatalogueManager.tsx` (Settings
   tab). The backend CRUD (`commands/routes.ts`) has existed since phase 4;
   this was purely the missing frontend — add a command (key/label/category/
   body/param kind/enum options), delete a custom one (built-ins still can't
   be deleted, enforced server-side same as before).
8. **Default credentials → `dispadmin` / `@Panasonic`** —
   `credentials/store.ts`'s new `ensureDefaultCredentials()`, called once at
   startup (`index.ts`, right after `seed()`). Only seeds the global default
   if nothing is configured yet (never overwrites an operator's own
   credentials, on this or any other run) — `dispadmin`/`@Panasonic` is
   Panasonic's own published factory admin login, not a secret this app is
   introducing.
9. **Picture mode added to the built-in command set** — `VPM:{p}` / `QPM` in
   `protocol.ts` (`picturemode.set`/`picturemode.query`), with
   `PICTURE_MODE_OPTIONS` (Dynamic/Natural/Standard/Cinema/Graphic/DICOM
   Sim./User), verified against `docs/panasonic-command-list.txt` line 137-143.
10. **UI display for query command results** — `BatchActionBar.tsx`: firing
    any query-type command now shows a per-device result panel (device name
    + raw response, or the error) above the action bar instead of just an
    "N/M succeeded" count, which was throwing away the one thing a query
    command exists to return.

**A late addition beyond the original 10, added with explicit user
sign-off:** the doc's own numbering had an extra, unnumbered item ("add
input voltage to the graphs") the initial summary missed on first read. The
official command list has no *querying* command for AC voltage under that
name — `QVX:INFS2=03` (the only "AC VOLTAGE" hit) only toggles whether
voltage is shown on the projector's own on-screen overlay. The user supplied
the actual command, confirmed present in the manual: `QVX:VMOI2` (line 2368,
`docs/panasonic-command-list.txt`), response form `VMOI2=+00000`..
`VMOI2=+99999`. Added as `voltage.query` and a new `ac_voltage` telemetry
metric (migration `002_phase1.sql` — SQLite can't `ALTER` a `CHECK`
constraint, so the `telemetry` table is rebuilt), graphed on the analytics
pane. **The value's scale (assumed centivolts, i.e. divide by 100) is not
confirmed by the official docs** — sanity-check the first real reading
against the projector's own displayed mains voltage; see the comment in
`protocol/parsers.ts`'s `parseAcVoltage`.

**Safety note on real hardware, honored throughout:** items 4 and the
voltage graph both required adding new queries (`QIN`, `QSH`, `QVX:VMOI2`) to
the poller's *automatic* cycle — meaning they'd start hitting every
registered real device (192.168.0.101–122) on the normal interval the moment
the app restarts, not just in a one-off test. This was called out and
explicitly approved by the user before writing that code (`poll-device.ts`).
No command was dispatched against the real fleet directly by the assistant
during this round — everything was verified via the mock server
(`protocol/mock-server.ts`, extended with `QVX:VMOI2` support and an
`acVoltageRaw` field) and the backend test suite.

**Tests:** 205 backend tests passing (up from 185) — 20 new, covering CSV
log formatting/escaping/local-timestamp shape (`logging/error-log.test.ts`),
the events route's filters (`events/routes.test.ts`), export/import round-
tripping including the additive-skip behavior and dangling-reference
warnings (`project/export-import.test.ts`), `ensureDefaultCredentials`
(`credentials/store.test.ts`), dispatch failures now writing `events` rows
(`dispatch.test.ts`), and the poller's new input/shutter/voltage fields
(`poll-device.test.ts`, `poller.test.ts`).

**Docs weren't otherwise re-verified against real hardware in this round** —
per the user's instruction, nothing new was tested against 192.168.0.101–122;
the next real-hardware session should specifically check: the input/shutter
tile fields against a unit with a known current input and shutter state, and
the AC voltage reading's actual scale (item above).

**Two issues found and fixed while wrapping up this round, unrelated to the
10 items themselves:**

- **The test suite was writing real files into the repo.** Several existing
  test files (`devices/routes.test.ts` at least) exercise a real `Poller`
  against a `MockProjector`, and the new dispatch/poller failure logging
  (item 1) wrote CSV files to `packages/backend/data/logs/` — the *actual*
  data directory, not a throwaway one — whenever `npm test` ran, because
  those files never had a reason to override `PPC_DATA_DIR` before now.
  Fixed properly rather than patched file-by-file: `packages/backend/
  .env.test` (`PPC_DATA_DIR=.test-data`, gitignored) is now loaded via
  `node --env-file` in the `test` npm script, so every test process gets an
  isolated data directory regardless of which file runs or what it
  transitively touches. Confirmed clean by re-running the full suite and
  checking no new files land under `packages/backend/data/`.
- **Packaging unconditionally deletes `release/win/` first**
  (`scripts/package.mjs`: `rmSync(releaseDir, {recursive:true,force:true})`,
  pre-existing since phase 7, not new this round) — including its `data/`
  subfolder, i.e. the packaged exe's own SQLite database, encryption key,
  and CSV logs, with **no backup**. This was only discovered because
  rebuilding the exe for this round's real-hardware retest hit it directly
  (see the next section). **If real devices/credentials were ever
  registered directly in a packaged exe (as opposed to the dev server),
  rebuilding wipes them with no way back.** Not fixed in this round (the
  user said not to worry about it this time) — worth a guard (e.g. refuse
  to delete a `data/` subfolder that looks populated, or copy it out first)
  before the next `npm run package:win` if that scenario matters.

## AC voltage fix — real-hardware feedback, same session

First real-hardware feedback on the Phase 1 changes: the analytics pane's
AC-voltage chart showed `NaN`, and the scale was wrong. The user confirmed
the wire protocol itself was clean by dispatching `voltage.query` manually
from the batch action bar (which just displays the raw response, no
parsing) against three real units: `VMOI2=+00238`, `VMOI2=+00238`,
`VMOI2=+00239` — proving the bug was in this app's parsing/storage, not the
projector.

Two real bugs, both fixed:

1. **Wrong scale** — `parseAcVoltage` divided by 100 (assumed centivolts).
   238/239 are plausible whole-volt mains readings; ÷100 would show ~2.4V,
   which is what was actually happening. Fixed: the raw integer *is* whole
   volts, no scaling. `docs/panasonic-command-list.txt`'s response format
   doesn't state a unit, so this was corrected from real-world evidence, not
   the docs.
2. **`NaN` propagation with no guard anywhere in the chain** — this is the
   more important one structurally: `parseAcVoltage` can return `NaN` for a
   malformed/blank value field (e.g. a unit whose voltage sensor isn't ready
   yet), and every downstream check was `!== null`, which `NaN` passes
   (`NaN !== null` is `true`). One bad reading would get written to the
   `telemetry` table and then poison the *entire* chart for as long as it
   stayed in the visible time window — `Math.min`/`Math.max` return `NaN` if
   even one input is `NaN`, so the whole series' scale broke, not just that
   one point. Fixed in three places: `poll-device.ts` and `poller.ts` now
   check `Number.isFinite(...)` before accepting/storing a reading, and
   `AnalyticsPane.tsx` filters non-finite values client-side too, so any
   already-written bad row from before this fix can't break the chart either
   — no manual database cleanup needed on the user's live install.

`mock-server.ts` gained an `acVoltageMalformed` state flag to reproduce the
blank-value case in tests. 209 backend tests passing (up from 205) — 4 new,
covering `parseAcVoltage`'s real-hardware-confirmed values, its `NaN` case,
`parseShutter`, and the poller dropping a malformed voltage reading instead
of storing it. Rebuilt `release/win/ProjectorControl.exe` with the fix.

## Still open / unresolved (flagged, not guessed at)

*(Several bullets below predate real-hardware testing and the frontend
actually being used in a browser, both of which have since happened
successfully — see the sections earlier/later in this file. Left largely
as-is rather than rewritten wholesale; the two most obviously stale ones
are corrected inline.)*

- **`QVX:ERRS1`'s position-to-code mapping is still unknown** — `ERRS2`
  decodes fully now (see "Real self-diagnosis codes..." below), but which
  position in `ERRS1`'s 511-character field corresponds to which specific
  U/F-prefixed code is not documented anywhere available. `ERRS1` findings
  are surfaced as "unidentified, active at position N" rather than guessed.
- ~~No real hardware has been used for any of this~~ — **resolved**: real
  hardware testing against 192.168.0.101–122 has succeeded multiple times
  this project (see the dedicated sections in this file).
- **No auth/access control on the API itself** — anyone who can reach the
  server's HTTP port can register devices, dispatch commands, create
  schedules/macros, and read whether credentials are configured (not the
  secrets). Framed by the spec as a LAN-only, single-install tool, so not
  flagged as a problem yet.
- ~~The frontend has still not been visually verified in an actual
  browser~~ — **resolved**: the user has been actively using it in a real
  browser (`npm run dev`) against the real fleet, including Phase 2's live
  preview.
- **No schedule or trigger management UI** — `/api/schedules` and
  `/api/triggers` are fully built (phases 4-5) but phase 6's brief only
  listed grid/batch-bar/macro-builder/analytics, so neither got a frontend.
  Managing them today means calling the API directly.
- **macOS packaging is not implemented** — see the Status table and
  `scripts/package.mjs`'s own comments. Needs to happen on/for a Mac.
- **The packaged exe is unsigned** (no `signtool` available to strip/replace
  the copied node.exe's signature cleanly — see decision #16). Fine for
  internal/LAN tooling; worth revisiting if this is ever distributed more
  broadly, where an unsigned exe will trip SmartScreen warnings.
- **No installer, no auto-start/service registration, no icon** — this is a
  raw exe + two folders, not a polished installer experience (no Start Menu
  entry, doesn't run as a Windows service, no custom .ico). Reasonable next
  steps if "one-click install" needs to mean more than "one file to launch."

## How to resume

```sh
npm install
npm run build --workspace @ppc/shared
npm run migrate --workspace @ppc/backend
npm run seed --workspace @ppc/backend
npm test --workspace @ppc/backend           # protocol + poller + full API test suite
npm run dev --workspace @ppc/backend        # http://localhost:8080
npm run dev --workspace @ppc/frontend       # http://localhost:5173
```

`release/win/ProjectorControl.exe` is already rebuilt with everything through
the post-packaging feedback round (credentials UI, bulk-add, select-all,
groups) — no rebuild needed to pick this up. If you do change any source
after this point, rebuild with:

```sh
npm run package:win
# produces release/win/ProjectorControl.exe (+ public/, migrations/, README.txt)
```

Open `http://localhost:5173` (dev), `http://localhost:8080` (built dev
server), or launch `release/win/ProjectorControl.exe` and open
`http://localhost:8080`.

Node.js is installed on this machine (v24.18.0). See `README.md` for the full
environment variable list and API endpoint table.

## Real-hardware testing — DONE, succeeded

The session after phase 7 tested against real projectors at
192.168.0.101–122 for the first time in this build's history. The user's own
words: "commands are well received and callbacks are working." The checklist
below is kept as a record of what was planned/checked, not as a still-open
task.

This machine remains connected to that real fleet — **any future work here
that dispatches or polls a new command against real hardware needs to be
called out and confirmed first**, same as it was for `NextSteps.md` Phase 1's
new poll queries above.

### Before starting

- A projector reachable on the same LAN as whatever machine runs the app
  (the dev server, or `release/win/ProjectorControl.exe`).
- Its IP address — from the projector's own menu: `NETWORK` → `NETWORK
  STATUS`.
- Its `COMMAND PROTECT` setting — `NETWORK` → `NETWORK SECURITY` →
  `COMMAND PROTECT` — tells you which of the three handshake paths to expect:
  `DISABLE` (no auth), `ENABLE(MD5)`, or `ENABLE(SHA-256)`. The client
  detects this live from the banner (see `docs/protocol-notes.md`) — a real
  unit exercising the SHA-256 path specifically would be new; only MD5 and
  non-protect have any indirect real-world corroboration (the old Python
  scripts at the repo root).
- An administrator account+password already set on the projector itself
  (`NETWORK` menu, per `PTRQ-CONNECTION.pdf`'s cross-reference to "page 240"
  of the full manual — out of this app's scope, done on the unit directly).
  Auth mode `DISABLE` skips this.

### Checklist

1. **Register the device** — either the UI's "+ Add device" or
   `POST /api/devices` with the real host/port (1024 unless changed).
2. **Set credentials** — global (Settings tab) if this will be the shared
   account for the fleet, or per-device (the device card's "Login" link) if
   this unit's account differs. Skip entirely if `COMMAND PROTECT` is
   `DISABLE`.
3. **Watch the first poll land** (~30s, or trigger `devices:refresh` /
   just wait) and check the card's health color:
   - **Green ("ok")** — handshake, auth, and the query set all worked.
     This is the whole protocol client validated end to end for the first
     time against real hardware.
   - **Grey ("unreachable") with a `last_error`** — read the message. A
     wrong/missing password surfaces as `"Password mismatch"` or similar
     (by design — see decision #5 in this file); a network-level failure
     reads differently (timeout, connection refused). Either way this is
     useful signal, not just a failure to shrug off.
4. **Sanity-check the numbers** — temperature and lamp-hours on the
   analytics pane should be plausible for the actual unit, not just
   present. Compare against the projector's own on-screen status menu if
   in doubt.
5. **Try each basic control** from the batch action bar: power on/off,
   shutter open/close, aspect ratio, screen setting. Confirm the projector
   actually does the thing, not just that the API returned `ok: true`.
6. **If the unit is in MD5 or SHA-256 protect mode**, that confirms the
   handshake math (`computeAuthHash` in `protocol/framing.ts`) against a
   real challenge for the first time — the mock server computes the same
   hash formula, so this is really testing "does the real projector agree
   with our understanding of the spec," which is exactly what was
   previously unverifiable.
7. **If anything faults or errors on the unit**, capture the raw
   `QVX:ERRS1`/`ERRS2` response if possible (not currently decoded — see
   "still open" — a real faulted unit is exactly what's been missing to
   make progress on that).

### If something doesn't match the mock server's behavior

That's the point of this test — it's expected to be where reality diverges
from the two PDFs' documented behavior, if it's going to happen anywhere.
Whatever's found should get folded into `docs/protocol-notes.md` (which
already separates "confirmed from official docs" from "still open") and,
if it changes actual client behavior, into `protocol/client.ts` /
`protocol/framing.ts` with a regression test using the mock server to
pin the corrected behavior down.

### Remaining candidates (roughly by likely value)

1. **Visual/interactive verification in an actual browser** — still true as
   of this update: no browser tool has been available for this entire
   build, so nothing has been visually confirmed, including everything built
   in the `NextSteps.md` Phase 1 round (new tile fields, Logs tab, Settings
   additions). Worth doing at the next opportunity.
2. **macOS packaging**, on/for an actual Mac.
3. Polish items from "still open": schedule/trigger UI, an installer/icon/
   code-signing story.

## `docs/NextSteps.md` Phase 2 — live preview, built and confirmed working

Built after the user's explicit go-ahead, then tried by the user via
`npm run dev` against the real fleet and confirmed working — the first real
validation of anything in this feature, since no browser tool is available
in this environment (the same standing caveat as the rest of the frontend)
and there's no way to mock an undocumented binary WebSocket protocol
convincingly enough to prove real hardware behaves as expected; this could
only ever be confirmed by the user, in an actual browser, against a real
unit. Not yet tried via the packaged exe specifically (only the dev server)
— that's the rebuild this session ends with.

**Architecture decision that simplified this a lot versus the original
write-up's concerns:** the browser connects **directly** to each
projector's own preview WebSocket (`ws://<device.host>:8080`, subprotocol
`pj-cast-protocol`) — there is **no backend involvement at all**. The
original protocol notes worried about "no existing WebSocket-proxy or
binary-frame-relay code path" in this backend; that concern only applied to
a *relay* design. Since the preview protocol needs no NTCONTROL credentials
and the browser already has direct LAN access to every projector (same
network the app itself runs on), there's nothing for the backend to proxy —
`hooks/usePreviewSocket.ts` talks to the projector exactly the way the
projector's own web UI does. No new API routes, no new shared types, no
backend changes whatsoever.

**Files:**
- `hooks/usePreviewSocket.ts` — one WebSocket's full lifecycle: connect,
  send `start`, render `Blob` frames via `URL.createObjectURL` (revoking the
  previous one on every new frame, and on unmount, to avoid leaking blob
  URLs), and handle the text control messages.
- `components/DevicePreviewTile.tsx` — one device's tile: status label,
  image area, Start/Stop, a Pre-Show toggle, and a Reconnect button that
  appears after a connection failure/close.
- `components/PreviewGrid.tsx` — the new `Preview` tab: thumbnail grid over
  every *enabled* device, "Start all"/"Stop all", and an expand-to-modal
  view. Expanding a tile pauses that tile's own connection while the modal
  is open (passing `enabled={... && expandedId !== device.id}` down) so a
  device is never double-connected.

**Deliberately opt-in, never automatic** — this was the main practicality
concern from the original write-up, and it's handled by simply never
auto-connecting: opening the `Preview` tab does not by itself open a single
socket. Every connection is an explicit click (per-tile, or "Start all").
Closing/leaving unmounts the tile, which the hook's cleanup uses to close
the socket — no dangling connections after navigating away.

**Two messages from the captured page don't translate and are intentional
no-ops**, documented in the hook itself:
- `REFRESH` reloaded the projector's own frameset page
  (`top.rightFrame.mainFrame.location.reload()`) — adapted to "reconnect
  this one preview socket" after the same ~1s delay, since there's no
  frameset here.
- `SIGNAL` reloaded a sibling "status frame" this app has no equivalent
  of — genuinely ignored, nothing sensible to substitute.

**Follow-up from the same session, after the user tried it via `npm run
dev` and confirmed it works:** `PreviewGrid` gained the same group-chip
filtering as the Devices tab (NextSteps.md phase 1 item 6) — selecting a
group hides every device not in it. Its own local `activeGroupId`, not
shared with the Devices tab's, since this component already manages its own
independent per-device enabled/expanded state rather than lifting selection
up to `App.tsx`. "Start all"/"Stop all" and the connected-count header all
respect the active filter (operate on/count only the visible devices).

**Two more small additions, same session, after Phase 2 was confirmed
working:** the user asked for the ability to remove a device from a group,
and to remove a device from the application entirely — both had existing
backend support with no frontend before this (`PUT /api/devices/:id/groups`
since phase 4; `DELETE /api/devices/:id` since phase 4), so this was UI-only,
no backend changes:
- `DeviceCard.tsx` — a "Delete" button next to the login link, `confirm()`
  before calling `DELETE /api/devices/:id`.
- `BatchActionBar.tsx` — the existing group dropdown (previously "Add to
  group" only) now has both **Add** and **Remove** buttons, symmetric
  (`handleRemoveFromGroup` filters the group id out of each selected
  device's `groupIds` and re-`PUT`s, mirroring `handleAddToGroup`'s merge).
  A **Delete selected** button (`confirm()`, then deletes every selected
  device and clears the selection) covers bulk removal.

**And one more, right after those:** renaming a projector. Also had full
backend support already (`PATCH /api/devices/:id` accepts `name`,
phase 4) with no frontend before this — `DeviceCard.tsx` gained a small ✎
button next to the device name that swaps it for an inline text input
(Save/Cancel, Enter/Escape), calling `useUpdateDevice`. No backend changes.

**Confirmed by the user against the real fleet:** the core flow works end
to end — direct browser-to-projector connection on port 8080, live frames
rendering. **Still open, not specifically confirmed one way or the other:**
- Preshow toggle, HDCP/BLANK handling, and the REFRESH auto-reconnect
  behavior specifically (vs. just "a live image renders").
- Real reconnect/failure behavior against a unit that *doesn't* support this
  page — does it refuse the WebSocket handshake outright (clean
  `error`/`close`), or behave some other way this code doesn't handle
  gracefully yet?
- Load in practice: how many concurrent preview connections a given model
  actually tolerates before something degrades (the fleet tested against is
  22 units, 192.168.0.101–122, but "Start all" against all of them at once
  specifically hasn't been reported on).

## `docs/NextSteps.md` Phase 2 — original practicality write-up (superseded above)

The doc's own instruction is explicit: *"Phase 2 is a significant addition
and you should consider the practicality of implementing it and any
performance considerations"* before starting — and separately, to prompt the
user before beginning it at all. Both conditions are why this section exists
instead of code.

**What it asks for:** an in-app live preview of each projector's actual
projected image (thumbnail multiview and/or a larger single view), on its
own page. The mechanism (from the doc's captured HTML/JS, sourced from the
projector's own undocumented web UI at
`http://<host>/cgi-bin/main.cgi?page=MENU_PREVIEW&lang=e`): a WebSocket to
`ws://<host>:8080` with subprotocol `pj-cast-protocol`, client sends `start`
then optionally `preshow:1`/`preshow:0`, server pushes binary JPEG-ish `Blob`
frames (rendered via `URL.createObjectURL`) or text control messages
(`HDCP`, `BLANK`, `REFRESH`, `SIGNAL`, `CHANGING_PRE`).

**Practicality/performance considerations worth weighing before starting:**

- **Undocumented, reverse-engineered protocol** — no official spec for the
  `pj-cast-protocol` frame format beyond what one HTML page's JS reveals.
  Unlike NTCONTROL (two official PDFs), everything here would be built by
  observation against real units, with more risk of silent
  misunderstanding.
- **A second live connection per device, per open viewer** — today's
  architecture is one lightweight NTCONTROL query cycle per device on a
  shared interval; a preview feed is a persistent per-device WebSocket
  streaming binary image frames, active for as long as a viewer has that
  page open. A thumbnail *multiview* of the whole fleet means one such
  connection per device simultaneously, all the time the page is open —
  a materially different load profile (bandwidth, backend fan-out, browser
  decode work) than anything else this app does.
- **Backend has no existing WebSocket-proxy or binary-frame-relay code
  path** — Socket.io today carries small JSON events only. This would need
  either the browser connecting directly to each projector's `:8080` (CORS/
  mixed-content and "is the projector's own port reachable from the
  browser, not just the server" considerations) or the backend proxying/
  relaying binary frames per device (new architecture, not an extension of
  `dispatch.ts`/`poller.ts`'s request/response model).
- **Real hardware is live** — building and iterating on this would mean
  repeatedly opening preview connections against 192.168.0.101–122 to see
  anything at all; per the standing safety instruction, that needs to be
  called out and confirmed, likely more than once given the trial-and-error
  nature of reverse-engineering an undocumented protocol.

**Status: waiting on the user's go-ahead** before any of this is designed or
coded, per `NextSteps.md`'s own instruction.

## `docs/NextSteps.md` Phase 3 — built-in command additions + usability

The user added a Phase 3 to `NextSteps.md` ("Mostly adds built in functions
and offers improved sorting to the commands list. Adds some ease of use
improvements") and asked to work through it. 13 items, all done.

**Research first, not guessing:** items 3-10 needed exact command bodies and
enum values not previously in this app's catalogue. Rather than guess from
partial memory of the command list (the AC-voltage-scale mistake earlier
this session was exactly this failure mode), a research pass grepped the
full 2,962-line `docs/panasonic-command-list.txt` line-by-line for each
function, cross-checking the PDF extraction's rotated label blocks against
data rows by count, and against commands already implemented (e.g. `VSF`
independently resolving to "SCREEN SETTING" confirmed the alignment method
against code already known correct). Every command below is a verified
quote from the file, not a guess.

### Items 3-10: eight new built-in commands (`shared/src/protocol.ts`, `db/seed.ts`)

| Item | Function | Set | Query | Notes |
|---|---|---|---|---|
| 3 | Startup Logo | `MLO:{p}` | `QLO` | Off / User Logo / Default Logo |
| 4 | Back Color | `OBC:{p}` | `QBC` | Blue / Black / User Logo / Default Logo |
| 4b | Shutter Fade In | `VXX:SEFS1={p}` | `QVX:SEFS1` | 12 literal decimal values (0.0–10.0s), **not** a uniform range |
| 5 | Shutter Fade Out | `VXX:SEFS2={p}` | `QVX:SEFS2` | same 12-value set as fade in |
| 6 | On Screen | `OOS:{p}` | `QOS` | OSD master on/off — distinct from OSD *position* (item 9) |
| 7 | Quad Pixel Drive | `VXX:QPDI1={p}` | `QVX:QPDI1` | **RQ35K/SRQ35KC series only** (single ✔ in the doc) — not on RZ34K |
| 8 | Projection Method | `OIL:{p}` | `QSP` | Front/Rear × Desk/Ceiling/Auto (6 combinations) |
| 8b | Installation | *(none)* | `QVX:ADRI1` | **Query-only** — projector reports its own detected mounting attitude, nothing to set |
| 9 | OSD Position | `ODP:{p}` | `QDP` | 9 screen positions, numbered 1-9 (no 0) |
| 10 | Daylight View (front install) | `VXX:DLVI0={p}` | `QVX:DLVI0` | Off/Auto(1)/On(2)/On(3)/4/5/6 — ambient-light compensation strength |

Categorized as `Display` (logo, back color, on screen, quad pixel drive, OSD
position) or `Installation` (projection method, installation query, daylight
view); fade in/out extend the existing `Shutter` category. 45 commands
seeded now (up from 26).

### Item 2: input select reworked as a 3-part control

Real finding that changed the design: the official list's full `IIS`
enumeration is **34 values**, not the dozen or so previously abridged into
`INPUT_OPTIONS`, confirmed missing: `DL1:VID`/`DL1:SVD` (Digital Link
Video/S-Video), and the entire DVI slot family (`AU1,DV1`/`AU1,DV2`/
`AU2,DV3`/`AU2,DV4`) plus `AU1,OP2`/`AU2,OP1`/`AU2,OP2`. Slot numbering is
**not symmetric**: slot 2's HDMI/DVI/DisplayPort continue the numbering
from slot 1 (`AU2,HD3`/`AU2,HD4`, not restarting at 1), while SDI and 12G-SDI
Optical restart at 1 on each slot — confirmed row-by-row, not assumed
uniform.

A flat 34-option dropdown is exactly the unusable list item 11 (below)
exists to fix generally — but the user specifically asked for input select
to be a 3-part control (slot number / type / input number, e.g. "Slot 1,
SDI, 1"), so it gets its own bespoke picker rather than relying on the
general search: `components/InputSelectPicker.tsx`. First selector: HDMI /
Digital Link / Slot 1 / Slot 2 (non-slot inputs restricted to HDMI and
Digital Link, per the request — built-in DVI-D/SDI on some models is still
reachable via the custom command catalogue if a fleet needs it). Digital
Link gets a second selector for its existing sub-inputs (Computer 1/2,
Video, HDMI 1/2, S-Video, or Auto) — preserved from the old list rather than
dropped. Slot 1/2 get Type then Number selectors, the Number list computed
from `SLOT_INPUT_NUMBERS` so it reflects the real (non-symmetric)
per-slot/type availability rather than a naive 1-4 range. Composes back into
the same `IIS:{value}` the backend already validates against the (now
34-entry) `INPUT_OPTIONS` — no backend changes needed beyond the expanded
list itself. Wired in via `CommandParamInput.tsx` special-casing
`command.key === 'input.set'`; every other enum command keeps the plain
dropdown.

### Item 11: searchable, category-grouped command picker

`components/CommandPicker.tsx` — a search box plus a native `<select>` with
one `<optgroup>` per category (`Power`, `Shutter`, `Display`, `Installation`,
etc. — matching the official list's own grouping, per the request), each
category's own commands sorted so queries trail the set commands rather
than interleaving alphabetically ("queries grouped below the set command").
Replaces the flat, ungrouped dropdowns in both `BatchActionBar.tsx` (which
switched from dispatching by `commandKey` to `commandId`, since the picker
operates on ids to stay usable for `MacroEditor.tsx` too, which already
selected steps by numeric id) and `MacroEditor.tsx`'s per-step command
selector.

### Item 12: server LAN address in the header

`GET /api/health` (already existed, phase 3/4) gained `port` and
`lanAddresses` fields — `util/network.ts`'s `lanAddresses()` (moved out of
`index.ts`, which used it only for the startup console log, so `server.ts`
can share it) reuses the exact logic already used for the console banner.
Shown under the connection light in `App.tsx`'s header via a new
`useServerInfo` hook.

### Item 13: pause/resume polling

`Poller` gained `pause()`/`resume()`/`isPaused` — `tick()` (the automatic
cycle) checks the flag and no-ops; `pollNow()` (manual refresh, and
dispatch's post-command follow-up poll) is explicitly untouched, since
"sending of commands are still allowed" while paused was explicit in the
request. In-memory only, not persisted — resets to running on restart, same
as the poller's other runtime state (`lastPolledAt`/`inFlight`). New
`GET/PUT /api/poller/status` (`poller/routes.ts`), a toggle button next to
the connection light (`usePollerStatus`/`useSetPollerPaused` hooks).

### Item 1: double-click (or an icon) opens the projector's own web UI

`DeviceCard.tsx`: double-clicking the name/status area, or a new ↗ icon
button next to the rename pencil, opens `http://<device.host>/` in a new
tab — the projector's own built-in admin web interface (separate login from
NTCONTROL, not something this app manages).

**Tests:** 232 backend tests passing (up from 226) — 6 new, covering the
new `poller/routes.ts` endpoint (including a real `Poller` instance's
`pause`/`resume` via HTTP), `Poller.pause()` actually stopping the
background cycle while `pollNow()` still works, and dispatch validation for
a couple of the new phase-3 commands plus the expanded `input.set`
enumeration (`AU2,HD3`, previously invalid, now accepted). No command was
newly added to the *automatic* poll cycle this round — items 3-10 and the
reworked input select are all on-demand/dispatch-only, same footing as
existing controls like aspect ratio or test pattern, so the standing
real-hardware-polling safety agreement wasn't re-triggered.

## Real self-diagnosis codes replace the temperature-threshold health system

Same session, after Phase 2 and its follow-ons. The user found and opened
`data/logs/errorcodes.md` — a table of `QVX:ERRS1`/`ERRS2` self-diagnosis
codes they'd hardware-tested independently (not from either official source
PDF) — and asked to (1) add these codes to the app, (2) remove the
configurable temperature-threshold health system, and (3) log the related
sensor values (temperature for temperature codes, voltage for voltage codes)
alongside each logged error.

**The wire format needed real evidence, not another guess** (learned from
the AC-voltage scale mistake earlier this session) — asked the user for a
raw capture rather than assuming the `"*****"` placeholder's meaning.
Result, and it changed the design:
- `ERRS2` returned `"ERRS2=H001"` — the literal active code as text.
- `ERRS1` returned a **511-character** string, all `'N'` except a single
  `'E'` at position 152 — a positional field, one character per possible
  U/F-prefixed condition, `'N'` meaning "normal here".

These are structurally different, so they're parsed differently
(`protocol/parsers.ts`): `parseDirectSelfDiagnosisCode` (`ERRS2`) returns the
literal code, or null for "nothing active" (blank/all-`N`/all-zero — the
healthy baseline wasn't directly confirmed, so all three are treated as
equivalent); `parsePositionalSelfDiagnosisField` (`ERRS1`) returns the list
of active (non-`N`) 1-based positions.

**The `ERRS1` position-to-code mapping is NOT known** — the user confirmed
they don't have it (asked directly, not assumed), and neither source PDF
documents it either. Rather than invent a fake mapping (actively misleading
for a monitoring feature), `ERRS1` findings are surfaced honestly as
"Unidentified self-diagnosis condition (ERRS1 position N)", severity
`warning`, with the raw value still fully available for later manual
cross-referencing if an official table or more captures (paired with what
the unit's own display showed) ever pin it down. `ERRS2` codes, by contrast,
decode fully against the user's table.

**`shared/src/self-diagnosis.ts`** — the code table (transcribed from
`errorcodes.md`) plus `lookupSelfDiagnosisCode()`, matching exact codes and
letter+numeric-range entries (e.g. `U202`–`U254`). Severity is derived from
each row's own description text ("warning"/"error"), with two documented
judgment calls where the text has neither keyword: `U090` → `warning`
(matches its neighbouring U-codes) and `H001` (battery reminder) → `info`
(a routine maintenance reminder, not a fault — deliberately excluded from
affecting health, unlike every `warning`/`error` finding).

**Health computation (`poller/health.ts`) no longer takes thresholds at
all** — `computeHealth(reading)` now just asks whether any active finding is
`error`-severity (→ health `error`) or `warning`-severity (→ health
`warning`), ignoring `info`-severity findings entirely. `HealthThresholds`
is gone. **`temp_warning_c`/`temp_critical_c` are deleted**, not just
unused — migration `003_self_diagnosis.sql` removes them from `settings` on
any existing install (including the user's own dev-server database),
since a stale row an operator might mistake for still having an effect is
worse than no row.

**Event codes changed** from `temp.warning`/`temp.critical`/`temp.normal` to
`selfdiag.warning`/`selfdiag.error`/`selfdiag.normal` (`poller/transitions.ts`)
— accurate now that the underlying cause can be anything in the table (a
fan, the shutter, a light source), not only temperature. Event messages now
include the actual finding, e.g. *"Foyer: U300: Intake air temperature
error"*, falling back to a generic message only if nothing could be
identified.

**"Log the values from sensors related to the error"** — implemented via
each table entry's `relatedSensors` (`'temperature' | 'voltage'`, empty for
codes with no currently-tracked sensor, e.g. shutter/fan/lens faults).
`poller.ts`'s new `buildSensorDetail()` unions whichever sensors the
currently-active findings name and formats their current readings (e.g.
`"Intake 60°C, Exhaust 45°C"` or `"AC Voltage 85V"`) into the `events.detail`
column and the CSV log's `detail` field — so a temperature-related fault's
log entry carries the actual numbers, not just the code.

**`device_state.self_diagnosis`** (schema column existed since phase 1,
never populated until now) and `DeviceState.selfDiagnosis` are now a
human-readable joined summary of every active finding (e.g. `"H001: Battery
replacement for the internal clock"`), shown on `DeviceCard.tsx` beneath
`lastError`, colour-matched to the device's health.

**`mock-server.ts`** gained `errs1`/`errs2` state fields (default: all-`N` /
`'N'`, i.e. healthy) to exercise all of this without real hardware. **225
backend tests passing** (up from 209) — 16 new, covering the parsers
(including the exact real 511-character capture), the lookup table's exact/
range/case-insensitive/unknown-code matching, `computeHealth`'s new
severity-driven logic (including that `info` findings don't affect health),
`describeHealthTransition`'s renamed codes and cause text, and the poller
end-to-end (a temperature code logging intake/exhaust, a voltage code
logging voltage and *not* temperature, and an info-severity finding being
stored without raising an event or changing health).

**Not touched:** no command was newly dispatched against real hardware for
this — `ERRS1`/`ERRS2` were already approved for the automatic poll cycle
earlier this session (alongside `QIN`/`QSH`/`QVX:VMOI2`); this work only
changed how their *existing* responses are interpreted and stored.

### Follow-up: ERRS1 suppressed from display text (same session)

After trying it, the user reported `ERRS2` reads well but asked to suppress
`ERRS1` "in the UI for better readability" — the "unidentified, active at
position N" text is just noise since the position mapping is unknown.
Clarified before changing anything: should an active `ERRS1` position still
affect health colour/raise an event, just without the confusing text, or be
ignored entirely? **Answer: still affects health and still raises an
event — only the display text is suppressed.**

Implemented in `poller.ts`'s `summarizeSelfDiagnosis()`: filters out
`source === 'ERRS1'` findings before building the joined display string
(used for `device_state.self_diagnosis` / `DeviceCard`'s self-diagnosis
line, and as `describeHealthTransition`'s `cause`). `computeHealth()` is
unaffected — it reads the full `reading.selfDiagnosis` list directly, not
this summary, so `ERRS1` still drives severity exactly as before. When
`ERRS1` is the *only* active finding, the summary is `null` and the event
falls back to `describeHealthTransition`'s generic message ("X
self-diagnosis reports a warning") instead of a position number — still
tells the operator something's wrong, without the noise. `ERRS2` findings
are untouched (they always carry a real `code`, matching what the user said
already reads well). One new test (226 backend tests passing, up from 225)
confirms both halves: health/event still fire, but the message contains no
"position" text.
