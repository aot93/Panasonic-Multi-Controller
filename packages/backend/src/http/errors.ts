export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = 'BadRequestError';
  }
}

/** True for a UNIQUE constraint violation from node:sqlite — used to turn a raw SQLite error into a clean 400. */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === 'ERR_SQLITE_ERROR' &&
    /UNIQUE constraint failed/.test(err.message)
  );
}

/** True for a CHECK constraint violation (e.g. the target_kind/target_id invariant) — same idea as isUniqueConstraintError. */
export function isCheckConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === 'ERR_SQLITE_ERROR' &&
    /CHECK constraint failed/.test(err.message)
  );
}

/** True for a FOREIGN KEY violation (e.g. a macro step referencing a commandId that doesn't exist). */
export function isForeignKeyConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === 'ERR_SQLITE_ERROR' &&
    /FOREIGN KEY constraint failed/.test(err.message)
  );
}
