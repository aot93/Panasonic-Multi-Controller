import { useState } from 'react';
import type { NameVerificationStatus } from '@ppc/shared';
import { useVerifyDeviceName } from './useDevices';
import { getOcrWorker } from '../lib/ocrWorker';

export type NameVerificationRunState = 'idle' | 'running' | NameVerificationStatus;

export interface NameVerificationOutcome {
  runState: NameVerificationRunState;
  detectedText: string | null;
  confidence: number | null;
  /** Set only for a hard failure (e.g. the OCR worker itself failed to load, or the backend request failed) — distinct from a clean `error` runState, which means "OCR ran but found nothing to compare". */
  error: string | null;
  verify: (deviceId: number, frame: Blob) => Promise<void>;
  reset: () => void;
}

/**
 * Vision-based name verification (docs/vision-name-verification-plan.md).
 * OCR runs client-side (Milestone 1, self-hosted Tesseract.js against a
 * captured preview frame) but the match/mismatch decision and persistence
 * are the backend's job (Milestone 2, `POST /api/devices/:id/verify-name`)
 * — one definition of "counts as a match" regardless of which tab/device
 * triggered the check, and a result that survives a page reload and shows
 * up on the device tile (see DeviceCard.tsx).
 */
export function useNameVerification(): NameVerificationOutcome {
  const [runState, setRunState] = useState<NameVerificationRunState>('idle');
  const [detectedText, setDetectedText] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verifyDeviceName = useVerifyDeviceName();

  async function verify(deviceId: number, frame: Blob): Promise<void> {
    setRunState('running');
    setError(null);
    try {
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(frame);
      setDetectedText(data.text);
      setConfidence(data.confidence);
      const result = await verifyDeviceName.mutateAsync({ id: deviceId, detectedText: data.text, confidence: data.confidence });
      setRunState(result.status);
    } catch (err) {
      setRunState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function reset(): void {
    setRunState('idle');
    setDetectedText(null);
    setConfidence(null);
    setError(null);
  }

  return { runState, detectedText, confidence, error, verify, reset };
}
