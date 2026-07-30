import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 does not catch a rejected promise from an async handler — this forwards it to the error middleware. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
