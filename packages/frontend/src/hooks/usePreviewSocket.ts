import { useEffect, useRef, useState } from 'react';

export type PreviewStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface PreviewState {
  status: PreviewStatus;
  imageUrl: string | null;
  hdcp: boolean;
  preshowActive: boolean;
  preshowBusy: boolean;
  error: string | null;
}

export interface PreviewControls extends PreviewState {
  togglePreshow: () => void;
  reconnect: () => void;
}

/** Fixed port from the projector's own web UI JS (docs/NextSteps.md) — separate from both the NTCONTROL port (1024, configurable per device) and whatever port serves its HTTP admin pages. Unverified beyond that one captured page; not configurable here since nothing suggests it varies. */
const PREVIEW_WS_PORT = 8080;
const SUBPROTOCOL = 'pj-cast-protocol';

/**
 * Talks the projector's own undocumented live-preview protocol directly
 * from the browser — no backend involvement at all. This mirrors exactly
 * what the projector's own web UI does at its
 * `/cgi-bin/main.cgi?page=MENU_PREVIEW` page (captured HTML/JS in
 * docs/NextSteps.md): connect with the `pj-cast-protocol` subprotocol, send
 * `start`, then render whatever comes back — binary `Blob` frames as an
 * image, or one of a handful of text control messages.
 *
 * Deliberately opt-in via `enabled` rather than connecting the moment a
 * component mounts: a fleet-wide multiview means one persistent
 * binary-streaming connection per visible device, for as long as it's
 * open — see PreviewGrid.tsx for why that's never automatic.
 *
 * Two messages from the original page don't translate here and are
 * intentionally no-ops: `REFRESH` reload the projector's own frameset page
 * (`top.rightFrame.mainFrame.location.reload()`), which this app has no
 * equivalent of — treated instead as "reconnect this one preview socket".
 * `SIGNAL` reloaded a sibling "status frame" that doesn't exist here either,
 * and has nothing sensible to substitute, so it's simply ignored.
 */
export function usePreviewSocket(host: string, enabled: boolean): PreviewControls {
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hdcp, setHdcp] = useState(false);
  const [preshowActive, setPreshowActive] = useState(false);
  const [preshowBusy, setPreshowBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setImageUrl(null);
      setHdcp(false);
      setPreshowActive(false);
      setPreshowBusy(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('connecting');
    setError(null);

    const socket = new WebSocket(`ws://${host}:${PREVIEW_WS_PORT}`, SUBPROTOCOL);
    socket.binaryType = 'blob';
    socketRef.current = socket;

    const revokeImage = () => {
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
    };

    socket.addEventListener('open', () => {
      if (cancelled) return;
      setStatus('connected');
      socket.send('start');
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (cancelled) return;
      const data: unknown = event.data;

      if (data instanceof Blob) {
        const url = URL.createObjectURL(data);
        revokeImage();
        imageUrlRef.current = url;
        setImageUrl(url);
        setHdcp(false);
        return;
      }
      if (typeof data !== 'string') return;

      switch (data) {
        case 'HDCP':
          setHdcp(true);
          revokeImage();
          setImageUrl(null);
          break;
        case 'BLANK':
          revokeImage();
          setImageUrl(null);
          break;
        case 'REFRESH':
          if (!refreshTimerRef.current) {
            refreshTimerRef.current = setTimeout(() => {
              refreshTimerRef.current = null;
              if (!cancelled) setNonce((n) => n + 1);
            }, 1000);
          }
          break;
        case 'CHANGING_PRE':
          setPreshowBusy(true);
          break;
        default:
          // Includes 'SIGNAL' — see the doc comment above.
          break;
      }
    });

    socket.addEventListener('close', () => {
      if (cancelled) return;
      setStatus((s) => (s === 'connecting' ? 'error' : 'closed'));
      revokeImage();
      setImageUrl(null);
    });

    socket.addEventListener('error', () => {
      if (cancelled) return;
      setStatus('error');
      setError('Preview connection failed');
    });

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      socket.close();
      socketRef.current = null;
      revokeImage();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, enabled, nonce]);

  function togglePreshow(): void {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const next = !preshowActive;
    socket.send(next ? 'preshow:1' : 'preshow:0');
    setPreshowActive(next);
    setPreshowBusy(false);
  }

  function reconnect(): void {
    setNonce((n) => n + 1);
  }

  return { status, imageUrl, hdcp, preshowActive, preshowBusy, error, togglePreshow, reconnect };
}
