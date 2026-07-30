import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler.js';
import type { Dispatch } from './dispatch.js';

const targetSchema = z.object({
  kind: z.enum(['device', 'group', 'all']),
  ids: z.array(z.number().int()).optional(),
});

const dispatchRequestSchema = z.object({
  target: targetSchema,
  commandId: z.number().int().optional(),
  commandKey: z.string().min(1).optional(),
  param: z.string().nullable().optional(),
});

/** POST /api/dispatch — power/shutter/input/etc control, spec §5's batch action bar backend. */
export function dispatchRouter(dispatch: Dispatch): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = dispatchRequestSchema.parse(req.body);
      const result = await dispatch(
        body.target,
        { commandId: body.commandId, commandKey: body.commandKey },
        body.param,
        'ui',
      );
      res.json(result);
    }),
  );

  return router;
}
