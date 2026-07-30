import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './errors.js';

/** Must be registered AFTER every route/router — Express only treats a 4-arg middleware as an error handler. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
