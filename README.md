# Panasonic Multi Controller

Web app for monitoring and controlling a fleet of Panasonic projectors over
the network — see `Claude/Panasonic_Projector_App_Spec_v2.md` for the full
spec and `docs/protocol-notes.md` for protocol implementation notes.

## Download (Windows)

**[⬇ Download ProjectorControl-win.zip](https://github.com/aot93/Panasonic-Multi-Controller/releases/latest/download/ProjectorControl-win.zip)**
— extract anywhere and run `ProjectorControl.exe`. No install, no Node.js
required. See `docs/UserGuide.md` (also rendered in-app, About tab) for
setup and usage.

This repo is currently **private**, in public beta with invited testers —
the link above only works if you're logged into GitHub as a collaborator
with access. It'll become a fully public, no-login download once the beta
period ends.

**Status: v1.1 released.** All of `docs/NextSteps.md` Phases 1-4 are done
(live preview, built-in command/usability additions, auto-numbered
bulk-add + natural sort + duplicate-name guard), vision-based projector
name verification is built and validated against real hardware (self-hosted
OCR, no internet required — see `docs/vision-name-verification-plan.md`),
and the app ships as a single packaged Windows exe (`npm run package:win`)
distributed via [GitHub Releases](https://github.com/aot93/Panasonic-Multi-Controller/releases/latest),
MIT-licensed, with an in-app About page (version, license, and the user
guide rendered in-app) and a plain-English `docs/UserGuide.md`. 256 backend
tests passing (`npm test --workspace @ppc/backend`). See `docs/PROGRESS.md`
for the full phase-by-phase history.

### Latest: vision-based projector name verification, About page, v1.1

Using the live-preview WebSocket (Phase 2, below), the browser runs OCR
(self-hosted Tesseract.js, fully offline) against a projector's current
preview frame and checks whether its configured name actually appears on
screen — flags a mismatch instead of silently trusting the name a device
was registered under. See `docs/vision-name-verification-plan.md` for the
full design, milestones, and real-hardware validation notes.

- **"Verify Name" / "Verify all"** — Preview tab, per-device or across
  every visible device at once (sequential, reuses already-open preview
  connections rather than opening redundant ones).
- **Persisted + tunable** — result and detected text persist per device
  (`device_name_verification` table, device-tile badge); the fuzzy-match
  similarity threshold is adjustable from the Settings tab rather than a
  fixed constant.
- **Inline rename** — fix a wrong name right from its preview tile.
- **New About tab** — version, MIT license (full text), the user guide
  rendered in-app, and a contact link, so a non-technical user never needs
  to read source or `docs/` to get oriented.
- **Phase 4 (`NextSteps.md`)** — bulk-add-by-IP-range now numbers devices
  by position in the range instead of naming them after the IP; every
  device listing sorts numerically (`Projector 2` before `Projector 10`)
  instead of lexicographically; device names are now guarded against
  duplicates on create/rename.
- **Confirmation prompts** added for powering off and removing a device
  from a group — both are one click away in the batch action bar and had
  no guard before.
- **Shift-click range select** on device cards, matching standard
  file-manager behaviour.

### Latest: `NextSteps.md` Phase 3 — built-in commands + usability

13 items, all done — see `docs/PROGRESS.md` for full detail on each:

- **8 new built-in commands**, verified against the official command list:
  Startup Logo, Back Color, Shutter Fade In/Out, On Screen (OSD on/off),
  Quad Pixel Drive (RQ35K series only), Projection Method, Installation
  (query-only — reports detected mounting attitude), OSD Position, and
  Daylight View. 45 commands seeded now (up from 26).
- **Input select reworked as a 3-part control** (slot number / type / input
  number, e.g. "Slot 1, SDI, 1") — `components/InputSelectPicker.tsx`. Also
  expanded `INPUT_OPTIONS` to the full 34-value enumeration confirmed
  against the command list (previously an abridged ~16-value subset) —
  slot 2's HDMI/DVI/DisplayPort numbering continues from slot 1
  (`AU2,HD3`/`HD4`) rather than restarting, confirmed row-by-row rather than
  assumed symmetric.
- **Searchable, category-grouped command picker** (`components/CommandPicker.tsx`)
  replaces the flat dropdowns in the batch action bar and macro editor.
- **Server LAN address** shown in the header, under the connection light.
- **Pause/resume polling** — a header toggle stops the automatic poll cycle
  without affecting command dispatch (manual or macro/schedule/trigger).
- **Double-click (or a ↗ icon)** on a device card opens that projector's own
  web interface in a new tab.

### Real self-diagnosis codes replace the temperature-threshold system

The user hardware-tested `QVX:ERRS1`/`ERRS2` self-diagnosis codes
independently (`data/logs/errorcodes.md` — not from either official source
PDF) and asked to wire them in properly, replacing the old configurable
temperature-threshold health system entirely. Real evidence showed the two
fields are shaped differently: `ERRS2` returns the literal active code as
text (`"ERRS2=H001"`); `ERRS1` returns a 511-character positional field
(`'N'` = normal at that position). `ERRS2` decodes fully against
`shared/src/self-diagnosis.ts`'s table; `ERRS1`'s position-to-code mapping
isn't documented anywhere available, so those findings are surfaced as
"unidentified, active at position N" rather than guessed. Health
(`poller/health.ts`) is now driven entirely by finding severity — the old
`temp_warning_c`/`temp_critical_c` settings are deleted by migration
`003_self_diagnosis.sql`, not just unused. Each logged error now carries the
current reading of whichever sensors are related to it (temperature or
voltage), per the user's request. See `docs/PROGRESS.md` for full detail.

### Live preview (new `Preview` tab), confirmed working

A thumbnail multiview (and expand-to-single-view) of each projector's actual
projected image, using the projector's own undocumented preview WebSocket
(`ws://<host>:8080`, subprotocol `pj-cast-protocol`) — reverse-engineered
from its web UI's captured HTML/JS in `docs/NextSteps.md`. **The browser
connects directly to each projector; there is no backend involvement at
all** (the protocol needs no NTCONTROL credentials, and the browser already
has direct LAN access to the fleet), so this shipped with zero backend
changes — see `hooks/usePreviewSocket.ts`, `components/DevicePreviewTile.tsx`,
`components/PreviewGrid.tsx`. Nothing auto-connects: opening the tab, or a
device's tile, is always an explicit click, since a fleet-wide multiview
means one persistent binary-streaming connection per visible device. Tried
by the user via `npm run dev` against the real fleet — working. Since then:
group-chip filtering in the preview grid (mirrors the Devices tab), removing
a device from a group, deleting a device from the app, and renaming a
device — all UI-only additions on top of endpoints that already existed
(see `docs/PROGRESS.md` for the full list and which files changed).

### Latest round: `NextSteps.md` Phase 1

Ten items, all done — see `docs/PROGRESS.md` for full detail on each:

1. **Per-device CSV error log** (`data/logs/device-<id>-<host>.csv`, local PC
   time, spreadsheet-ready) — `logging/error-log.ts`, fed by poller health
   transitions and (new) dispatch failures.
2. **Error log viewer** — new `Logs` tab, `GET /api/events`.
3. **Save/load project files** — `GET/POST /api/project/export|import`,
   additive on import, credentials never included.
4. **Device tile** now shows status/input/shutter/aspect ratio/screen
   setting instead of exhaust/intake temperature/lamp hours (still on the
   analytics pane).
5. **Group chips hide non-members** when a group is selected, not just
   select them.
6. **Custom control codes UI** — `CommandCatalogueManager` (Settings tab);
   the CRUD backend already existed.
7. **Default credentials** — fresh installs seed the global default to
   Panasonic's own factory login (`dispadmin` / `@Panasonic`) if nothing is
   configured yet.
8. **Picture mode** added to the built-in command set (`VPM:{p}` / `QPM`).
9. **Query command results** now show per-device in the batch action bar
   instead of just a success count.
10. **AC voltage** (`QVX:VMOI2`, supplied by the user — not in the official
    command list under this name) added as a new telemetry metric, graphed
    on the analytics pane; scale not yet confirmed against real hardware.

New queries (`QIN`, `QSH`, `QVX:VMOI2`) were added to the poller's automatic
cycle with the user's explicit sign-off, since the real fleet is live and
polled continuously.

### Latest round: credentials UI, bulk add, select-all, groups

After trying the packaged exe, four gaps were flagged and closed:

- **Global + per-device credentials UI** — `Settings` tab has a global
  username/password form; each device card has a "Login" link opening a
  per-field editor (override just the password and keep the global
  username, or vice versa — mirrors what `credentials/store.ts` already
  supported server-side since phase 2, which had no UI at all until now).
  New endpoint: `GET/PUT/DELETE /api/settings/credentials` (the per-device
  route already existed from phase 4; the global one didn't).
- **Add multiple devices from an IP range** — "+ Add range" next to "+ Add
  device": name prefix, start IP, end IP, port. New endpoint:
  `POST /api/devices/bulk` (same-/24 ranges, capped at 254 addresses,
  partial success is normal — one bad IP doesn't fail the rest).
- **Select all** — button in the grid header, toggles to "Deselect all".
- **Groups as reusable "selection groups"** — a `Settings` section to
  create/delete groups, chips above the grid that select every device in a
  group with one click, and an "Add to group" control in the batch action
  bar (merges into a device's existing groups rather than replacing them).

Still no browser to verify visually with (see the phase 6 caveat below) —
verified via typecheck, build, and the same real API smoke-testing approach
used throughout.

### Real hardware testing — done, succeeded

The app has now been tested against real projectors (192.168.0.101–122):
commands are received and callbacks work. **This machine stays connected to
that fleet** — anything that would dispatch or newly poll a command against
it needs to be confirmed first, not assumed safe. See `docs/PROGRESS.md`'s
real-hardware section for what was checked. `release/win/ProjectorControl.exe`
is rebuilt and re-validated against the real fleet as each round of changes
lands (currently v1.1 — see the top of this file and `docs/PROGRESS.md`),
published via [GitHub Releases](https://github.com/aot93/Panasonic-Multi-Controller/releases/latest)
rather than committed to git — remember `scripts/package.mjs` deletes and
regenerates the whole `release/win/` folder on every rebuild, including any
`data/` subfolder next to a previous exe (see `docs/PROGRESS.md`).

### Packaging

```sh
npm run package:win
```

Builds everything and produces `release/win/ProjectorControl.exe` — a single
executable containing the Node runtime and the entire app (Express,
Socket.io, SQLite, all of it), via Node's built-in [Single Executable
Applications](https://nodejs.org/api/single-executable-applications.html)
feature (`scripts/package.mjs`). The built frontend and SQL migrations ship
as plain `public/` and `migrations/` folders next to the exe rather than
embedded inside it — see the comment at the top of `scripts/package.mjs` for
why that's a deliberate, documented simplification rather than an oversight.
Double-click the exe; it creates a `data/` folder beside itself on first run
(SQLite database + encryption key) and serves the app at
`http://localhost:8080`.

**Verified working**: built, launched, and exercised end to end — device
registration, command dispatch, macro creation/execution, telemetry, and a
live Socket.io connection all confirmed against the actual packaged exe (not
just the dev server), including that data survives a restart.

**macOS is not implemented.** SEA packaging is platform-specific — you inject
into *that* OS's own node binary, plus macOS has its own codesigning story —
so it has to be built (and tested) on/for a Mac, which isn't available here.
`scripts/package.mjs` refuses to run for anything but `win` rather than
producing something unverifiable.

Phase 6 built the real React app in the order the kickoff prompt specifies:

- **Grid view** — color-coded status cards (`components/DeviceCard.tsx`),
  live via a shared Socket.io connection that patches the TanStack Query
  cache directly on `device:state` (`hooks/useDeviceSocket.ts`) — no polling
  once the initial `GET /api/devices` has loaded.
- **Multi-select batch action bar** — fixed footer with one-click buttons for
  param-less favourite commands, a full command picker (any command, with
  the right control for its `paramKind`) for everything else, and a "run
  macro against this selection" control.
- **Custom button/macro builder** — create/edit a macro's ordered steps
  (command, param, per-step delay, optional target override), reorder, and
  run it against a chosen device/group/all.
- **Analytics pane** — temperature (intake/exhaust) and lamp-hours history as
  SVG line charts with a crosshair/tooltip, legend, and 24h/7d/30d range
  presets, opened per-device from its grid card. Needed a new backend
  endpoint that didn't exist yet: `GET /api/devices/:id/telemetry` (the
  poller has written this data since phase 3, but nothing exposed it over
  HTTP until now).

Caveat, stated plainly: no browser or screenshot tool was available while
building this, so verification is typecheck + build + real API/Socket.io
traffic against the live server (all endpoints the UI calls were exercised
via curl end to end, including a real bug this caught — see
`docs/PROGRESS.md`) — not actual visual/interactive confirmation in a
browser. Worth a manual look before relying on it.

Backend recap (see `docs/PROGRESS.md` for full detail): devices/groups/
commands CRUD; `POST /api/dispatch` for command execution; `/api/triggers`
for the external TCP/UDP trigger interface; `/api/schedules` for node-cron
calendar automation; `/api/macros` with a real (if minimal) execution
engine — a macro's steps run in sequence honouring each step's configured
delay, and both the trigger server and scheduler now actually execute
`action_kind: 'macro'` instead of returning "not supported yet".

**One deviation from spec §3's exact wording:** the SQLite layer uses Node's
built-in `node:sqlite` module rather than `better-sqlite3`. Both are
synchronous, single-file, zero-service SQLite drivers — functionally
equivalent for this app — but `better-sqlite3` requires a native C++ compile
via node-gyp, which needs Visual Studio Build Tools installed. `node:sqlite`
ships inside Node itself, so there's nothing to compile on a fresh dev
machine and nothing native to embed in phase 7's single-executable build.
Swapping back to `better-sqlite3` (or Prisma, the spec's other named option)
would only touch `packages/backend/src/db/`.

## Layout

```
packages/
  shared/    Types and protocol constants shared by backend and frontend
  backend/   Express + Socket.io server, SQLite (node:sqlite)
    src/protocol/      NTCONTROL TCP client + mock projector server (phase 2)
    src/credentials/   Per-device / global credential resolution (phase 2)
    src/poller/        Background polling, health/telemetry, alerting (phase 3)
    src/devices/       Device read-model (phase 3) + CRUD routes (phase 4)
    src/groups/        Group CRUD routes (phase 4)
    src/commands/      Command catalogue CRUD routes (phase 4)
    src/dispatch/      Command dispatch engine + POST /api/dispatch (phase 4)
    src/triggers/      External TCP/UDP trigger listener + CRUD (phase 4)
    src/scheduler/     node-cron task runner + /api/schedules CRUD (phase 5)
    src/macros/        Macro execution engine + /api/macros CRUD
    src/settings/      Global credentials CRUD (/api/settings/credentials) +
                       name-verification-threshold.ts (tunable OCR match threshold)
    src/events/        GET /api/events — reads the `events` table (Logs tab)
    src/project/       Save/load a whole config: export-import.ts + /api/project routes
    src/logging/       Per-device CSV error log (error-log.ts)
    src/http/          Shared error handling, async wrapper, test helper
    src/util/          Concurrency limiter, network.ts (lanAddresses — phase 3 item 12)
    src/db/            Schema, migrations, seed data, encryption at rest
  frontend/  React + Tailwind + TanStack Query, built to static files
    src/lib/           API client, query keys, Socket.io singleton, ocrWorker.ts (self-hosted
                       Tesseract.js), nameVerification.ts, previewCapture.ts (one-shot preview
                       frame grab for "Verify all")
    src/hooks/         TanStack Query hooks per resource + useDeviceSocket + useSettings + useEvents +
                        usePreviewSocket + useServerInfo + usePollerStatus + useNameVerification
    src/components/    DeviceGrid/Card, BatchActionBar, MacroBuilder/Editor, AnalyticsPane, LineChart,
                        CommandPicker (searchable/grouped), InputSelectPicker (slot/type/number),
                        GlobalCredentialsForm, DeviceCredentialsModal, GroupsManager, BulkAddDevicesForm,
                        EventLogViewer, CommandCatalogueManager, ProjectFileManager, AboutPage,
                        NameVerificationSettingsForm,
                        PreviewGrid/DevicePreviewTile (talks directly to each projector, no backend involved)
    public/            Vite static assets — vendored Tesseract WASM/lang data (gitignored, see
                       `npm run setup:ocr-assets`) + UserGuide.md/LICENSE.txt mirrored in by
                       scripts/copy-static-docs.mjs on every dev/build
docs/
  panasonic-command-list.txt        Text extracted from the official command-list PDF
  ptrq-connection.txt               Text extracted from the official connection appendix PDF
  protocol-notes.md                 Handshake/framing decisions, confirmed vs. open questions
  vision-name-verification-plan.md  Design + build/validation log for name verification (above)
  UserGuide.md                      Plain-English guide for non-technical users; also rendered in-app
scripts/
  package.mjs                  Windows SEA packaging (phase 7) — npm run package:win
  setup-ocr-assets.mjs         One-time vendoring of Tesseract.js WASM/language data — npm run setup:ocr-assets
  copy-static-docs.mjs         Mirrors docs/UserGuide.md + LICENSE into packages/frontend/public/
_old/                           Legacy prototype scripts, staged for review/removal (see docs/PROGRESS.md);
                                the large reference PDFs were purged from git history and live here
                                untracked/gitignored — not part of the repo, just this machine
release/                       Packaging output (gitignored) — not committed; distributed via GitHub Releases
```

## Requirements

- Node.js >= 20.11 (LTS). Installed on this machine as v24.18.0 via winget
  (`OpenJS.NodeJS.LTS`).
- To package (`npm run package:win`) only: `signtool` (Windows SDK) is
  optional — used to strip the copied node.exe's code signature before
  injecting the app blob. Not installed on this machine; the script proceeds
  without it and the packaged exe still runs correctly (verified), it's just
  unsigned. Install the Windows SDK if you want that step to actually run.

## Getting started

```sh
npm install
npm run build --workspace @ppc/shared
npm run migrate --workspace @ppc/backend   # creates data/projectors.sqlite
npm run dev --workspace @ppc/backend       # http://localhost:8080
npm run dev --workspace @ppc/frontend      # http://localhost:5173 (proxies /api and /socket.io)
```

Register a device and dispatch a command:

```sh
curl -X POST http://localhost:8080/api/devices -H 'content-type: application/json' \
  -d '{"name":"Foyer","host":"192.168.0.131"}'

curl -X POST http://localhost:8080/api/dispatch -H 'content-type: application/json' \
  -d '{"target":{"kind":"device","ids":[1]},"commandKey":"power.on"}'
```

## API

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/devices` | List (with live state) / register |
| POST | `/api/devices/bulk` | `{ namePrefix?, startIp, endIp, port? }` — one device per IP in range (same /24, max 254) |
| GET/PATCH/DELETE | `/api/devices/:id` | |
| PUT | `/api/devices/:id/groups` | Replace group membership: `{ groupIds: number[] }` |
| PUT/DELETE | `/api/devices/:id/credentials` | Per-device override; DELETE falls back to the global default |
| GET/POST | `/api/groups`, GET/PATCH/DELETE `/api/groups/:id` | |
| GET/POST | `/api/commands`, GET/PATCH/DELETE `/api/commands/:id` | Built-in rows can't be deleted |
| POST | `/api/dispatch` | `{ target: {kind: "device"\|"group"\|"all", ids?}, commandId? \| commandKey?, param? }` |
| GET/POST | `/api/triggers`, GET/PATCH/DELETE `/api/triggers/:id` | External TCP/UDP trigger definitions |
| GET/PUT | `/api/triggers/settings` | `{ enabled, tcpPort, udpPort }` — PUT restarts the listener immediately |
| GET/POST | `/api/schedules`, GET/PATCH/DELETE `/api/schedules/:id` | Cron expression validated on write |
| POST | `/api/schedules/:id/run` | Fires the task immediately, ignoring its cron schedule |
| GET/POST | `/api/macros`, GET/PATCH/DELETE `/api/macros/:id` | `PATCH` with `steps` replaces the whole sequence |
| POST | `/api/macros/:id/run` | `{ target? }` — falls back to each step's own target override if omitted |
| GET | `/api/devices/:id/telemetry` | `?metric=&idx=&since=&limit=` — history for the analytics pane; metrics now include `ac_voltage` |
| GET/PUT/DELETE | `/api/settings/credentials` | Global default `{ username, password }`; GET/PUT never return the password |
| POST/GET | `/api/devices/:id/verify-name` | Vision-based name check (Preview tab) — POST `{ detectedText, confidence? }`, backend runs the match and persists it |
| GET/PUT | `/api/settings/name-verification` | `{ similarityThreshold: number }` — tunes the fuzzy-match threshold used above |
| GET | `/api/events` | `?deviceId=&severity=&since=&limit=` — the error/event log (Logs tab) |
| GET | `/api/project/export` | Downloads the current config as a portable JSON file (no credentials) |
| POST | `/api/project/import` | Applies a project file additively — existing rows are never overwritten |
| POST/PATCH/DELETE | `/api/commands` | Already existed (phase 4) — now has frontend UI (`CommandCatalogueManager`) |
| GET | `/api/health` | Now also returns `port` and `lanAddresses` — shown in the header (phase 3 item 12) |
| GET/PUT | `/api/poller/status` | `{ paused: boolean }` — pause/resume the automatic poll cycle (phase 3 item 13); dispatch is unaffected either way |

```sh
npm test --workspace @ppc/backend   # protocol, poller, and all API tests
```

## Configuration

Environment variables (all optional, see `packages/backend/src/config.ts`):

| Variable | Default | Purpose |
|---|---|---|
| `PPC_PORT` | `8080` | HTTP/Socket.io port |
| `PPC_HOST` | `0.0.0.0` | Bind address — 0.0.0.0 so phones on the LAN can reach it |
| `PPC_DATA_DIR` | `./data` | Where the SQLite file and encryption key live |
| `PPC_DB_PATH` | `<data dir>/projectors.sqlite` | Override the database file location directly |
| `PPC_SECRET_KEY` | *(generated)* | 32-byte hex key for encrypting stored projector passwords; auto-generated into `<data dir>/secret.key` if unset |

## License

MIT — see [LICENSE](LICENSE).
