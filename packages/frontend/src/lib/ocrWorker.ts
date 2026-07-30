import Tesseract from 'tesseract.js';

let workerPromise: Promise<Tesseract.Worker> | null = null;

/**
 * One shared Tesseract.js worker for the whole app's lifetime, lazily
 * created on first use — same pattern as socket.ts's getSocket(). Worker
 * creation loads the WASM core + English language data, which is too slow
 * to redo on every "Verify Name" click.
 *
 * All three asset paths point at this app's own static files
 * (packages/frontend/public/tesseract/, vendored by
 * scripts/setup-ocr-assets.mjs) rather than tesseract.js's CDN default —
 * required by this app's "local only, no internet" design goal. See
 * docs/vision-name-verification-plan.md §4.
 */
export function getOcrWorker(): Promise<Tesseract.Worker> {
  workerPromise ??= Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    // The vendored files are already local and load instantly — caching
    // them in IndexedDB on top of that would only risk an app upgrade
    // silently serving a stale copy.
    cacheMethod: 'none',
  });
  return workerPromise;
}
