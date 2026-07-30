# Claude Code Kickoff Prompt

Copy everything below into Claude Code to start the project.

---

I'm building a web-based application to monitor and control a fleet of Panasonic projectors on a local network. Attached is the full technical spec (`Panasonic_Projector_App_Spec_v2.md`) — read it fully before doing anything. This is revision 2 of the spec, already updated to resolve a conflict between the original suggested stack (Postgres + Redis) and the offline/one-click-install requirements, so build against what's written in Section 3 as the source of truth.

**Stack, per Section 3 of the spec:**

- **Backend:** Node.js + TypeScript, Express, running as a single local server (one instance runs on-site, e.g. a NUC or spare PC; other devices, including phones, connect to it over the LAN via browser — this satisfies "mobile nice to have" without a native app).
- **Data storage:** SQLite (via `better-sqlite3` or Prisma with the sqlite provider) instead of PostgreSQL. Zero-config, single file, no separate service to install.
- **Scheduling:** `node-cron` for the automated task runner (e.g. nightly shutdown), instead of a Redis-backed queue.
- **Real-time updates:** Socket.io for pushing live device status to connected browsers — same as the spec.
- **Frontend:** React + TypeScript + Tailwind CSS + TanStack Query, served as static files from the same Node server (no separate frontend deployment).
- **Packaging:** package the backend + built frontend into a single executable per OS (Node SEA or `pkg`) so install is "download and run" rather than "npm install and configure a database."

**Build order — please work in this sequence and pause for my confirmation between phases:**

1. **Project scaffolding**: set up the monorepo structure (backend + frontend), TypeScript configs, SQLite schema for device metadata and time-series lamp-hour/temperature/error logs.
2. **Panasonic protocol client**: implement the Computer Control protocol client — TCP port 1024, the 8-byte challenge + MD5 auth handshake, and the query/command parsing described in section 4 of the spec. Build this as an isolated, testable module before wiring it into anything else. Include a mock/simulated projector server for testing without real hardware.
3. **Device polling + WebSocket layer**: background polling of registered devices, broadcasting status changes over Socket.io.
4. **Core API**: REST endpoints for device registration, grouping, command dispatch (power/shutter/input), and the external TCP/UDP command trigger interface described in section 6.
5. **Scheduler**: node-cron-based task runner for calendar-based automation.
6. **Frontend**: grid view with color-coded status cards, multi-select batch action bar, custom button/macro builder, and an analytics pane for temperature/lamp-hour history — in that order.
7. **Packaging**: single-executable build for Windows and Mac.

Start with phase 1 and stop for my review before moving to phase 2. Ask me if anything in the spec is ambiguous rather than guessing — especially around the exact byte structure of Panasonic commands beyond what's shown in the reference snippet, since that will need real device documentation or hardware testing to get right.
