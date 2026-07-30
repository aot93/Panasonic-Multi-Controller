import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { GlobalCredentialsStatus } from '@ppc/shared';
import { clearGlobalCredentials, getGlobalCredentials, getGlobalUsername, setGlobalCredentials } from '../credentials/store.js';
import { asyncHandler } from '../http/async-handler.js';

const setCredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function status(db: DatabaseSync): GlobalCredentialsStatus {
  return { configured: getGlobalCredentials(db) !== null, username: getGlobalUsername(db) };
}

/**
 * The global default projector username/password (credentials/store.ts) had
 * no HTTP surface at all until now — per-device overrides got one in phase
 * 4 (`/api/devices/:id/credentials`) but the global fallback they resolve
 * against did not, so there was no way to set it without raw SQL. Write-only
 * like the per-device version: the password is never echoed back, only
 * whether one is configured and what the (non-secret) username is.
 */
export function settingsRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/credentials', (_req, res) => {
    res.json(status(db));
  });

  router.put(
    '/credentials',
    asyncHandler(async (req, res) => {
      const body = setCredentialsSchema.parse(req.body);
      setGlobalCredentials(db, body);
      res.json(status(db));
    }),
  );

  router.delete('/credentials', (_req, res) => {
    clearGlobalCredentials(db);
    res.json(status(db));
  });

  return router;
}
