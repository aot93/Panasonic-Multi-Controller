import { Router } from 'express';
import { z } from 'zod';
import type { Poller } from './poller.js';

const setPausedSchema = z.object({ paused: z.boolean() });

/**
 * NextSteps.md phase 3 item 13: a pause/resume control for the automatic
 * polling cycle — dispatching commands (manual or via macro/schedule/
 * trigger) is untouched either way, only the background tick is affected.
 * In-memory only (see Poller.paused) — resets to running on restart.
 */
export function pollerRouter(poller: Poller): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({ paused: poller.isPaused });
  });

  router.put('/status', (req, res) => {
    const { paused } = setPausedSchema.parse(req.body);
    if (paused) poller.pause();
    else poller.resume();
    res.json({ paused: poller.isPaused });
  });

  return router;
}
