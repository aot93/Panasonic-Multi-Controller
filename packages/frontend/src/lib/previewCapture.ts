import { PREVIEW_SUBPROTOCOL, PREVIEW_WS_PORT } from '../hooks/usePreviewSocket';

/**
 * Opens a short-lived connection to a device's own preview WebSocket, waits
 * for exactly one frame, then closes it — used by PreviewGrid's "Verify
 * all" bulk action for devices that don't already have a tile connection
 * open (docs/vision-name-verification-plan.md §9/§11).
 *
 * Deliberately never used for a device that already has an open tile
 * connection (see PreviewGrid.tsx) — the preview protocol is undocumented
 * and reverse-engineered, and a redundant second connection to the same
 * device risks disrupting the one already open, not just wasting a socket.
 *
 * Resolves `null` (not a rejection) on anything that isn't a usable frame —
 * timeout, HDCP, or a connection error — so the caller can uniformly treat
 * "nothing to verify against" as this device's own `error` status rather
 * than aborting the whole batch.
 */
export function captureOnePreviewFrame(host: string, timeoutMs = 5000): Promise<Blob | null> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://${host}:${PREVIEW_WS_PORT}`, PREVIEW_SUBPROTOCOL);
    socket.binaryType = 'blob';
    let settled = false;

    function finish(result: Blob | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    }

    const timer = setTimeout(() => finish(null), timeoutMs);

    socket.addEventListener('open', () => socket.send('start'));
    socket.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data;
      if (data instanceof Blob) finish(data);
      else if (data === 'HDCP') finish(null);
    });
    socket.addEventListener('error', () => finish(null));
    socket.addEventListener('close', () => finish(null));
  });
}
