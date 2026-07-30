import express, { type Express } from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Server as SocketServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@ppc/shared';
import { HTTP_PORT, PUBLIC_DIR } from './config.js';
import { getDb } from './db/index.js';
import { errorHandler } from './http/error-handler.js';
import { lanAddresses } from './util/network.js';

/**
 * Builds the HTTP + Socket.io server shell: JSON body parsing, health check,
 * and the `io` instance. Everything else — device/group/command/dispatch/
 * trigger routers, Socket.io connection handling, the Poller — is
 * constructed and mounted by index.ts, since those all need `db` and `io`
 * together and `io` is created here.
 *
 * `finalizeRoutes()` must be called after every router is mounted: it adds
 * static file hosting + the SPA fallback + the error-handling middleware,
 * which Express requires to be registered last.
 */
export function buildServer() {
  const app = express();
  app.use(express.json());

  const http = createServer(app);
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(http, {
    // Same-origin in production; the Vite dev server needs an explicit allow.
    cors: { origin: process.env.NODE_ENV === 'production' ? false : true },
  });

  app.get('/api/health', (_req, res) => {
    const db = getDb();
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number };
    res.json({
      ok: true,
      version: '0.1.0',
      phase: 4,
      devices: count,
      uptimeSec: Math.round(process.uptime()),
      // NextSteps.md phase 3 item 12 — shown in the header under the connection light.
      port: HTTP_PORT,
      lanAddresses: lanAddresses(),
    });
  });

  return { app, http, io };
}

export function finalizeRoutes(app: Express): void {
  if (existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
    // SPA fallback — anything not under /api serves the React entry point.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(resolve(PUBLIC_DIR, 'index.html'));
    });
  }

  app.use(errorHandler);
}
