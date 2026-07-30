import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import type { GlobalCredentialsStatus } from '@ppc/shared';
import { clearGlobalCredentials, getGlobalCredentials, getGlobalUsername, setGlobalCredentials } from '../credentials/store.js';
import { asyncHandler } from '../http/async-handler.js';
import { setSetting } from '../poller/settings.js';
import { getNameVerificationThreshold } from './name-verification-threshold.js';

const setCredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const nameVerificationSettingsSchema = z.object({
  similarityThreshold: z.number().min(0).max(1),
});

function status(db: DatabaseSync): GlobalCredentialsStatus {
  return { configured: getGlobalCredentials(db) !== null, username: getGlobalUsername(db) };
}

function nameVerificationSettings(db: DatabaseSync): { similarityThreshold: number } {
  return { similarityThreshold: getNameVerificationThreshold(db) };
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

  // Vision-based name verification (docs/vision-name-verification-plan.md),
  // Milestone 3: the fuzzy-match similarity threshold (shared/name-verification.ts's
  // matchDeviceName) is tunable rather than a hardcoded constant, since real
  // signage was always expected to need adjusting it (§6).
  router.get('/name-verification', (_req, res) => {
    res.json(nameVerificationSettings(db));
  });

  router.put(
    '/name-verification',
    asyncHandler(async (req, res) => {
      const body = nameVerificationSettingsSchema.parse(req.body);
      setSetting(db, 'name_verification_threshold', String(body.similarityThreshold));
      res.json(nameVerificationSettings(db));
    }),
  );

  return router;
}
