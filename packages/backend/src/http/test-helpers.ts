import express, { type Express } from 'express';
import { createServer, type Server } from 'node:http';
import { errorHandler } from './error-handler.js';

/**
 * Boots a throwaway Express app on an ephemeral port for router-level
 * integration tests — real HTTP requests via `fetch`, not handler unit
 * tests, so routing, JSON parsing, and the error-handling middleware are all
 * exercised exactly as production traffic would hit them.
 */
export async function startTestApp(configure: (app: Express) => void): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  configure(app);
  app.use(errorHandler);

  const server: Server = createServer(app);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
