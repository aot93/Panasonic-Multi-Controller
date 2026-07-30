import { useState } from 'react';
import { matchDeviceName, type NameVerificationStatus } from '@ppc/shared';
import { getOcrWorker } from '../lib/ocrWorker';

export type NameVerificationRunState = 'idle' | 'running' | NameVerificationStatus;

export interface NameVerificationOutcome {
  runState: NameVerificationRunState;
  detectedText: string | null;
  confidence: number | null;
  /** Set only for a hard failure (e.g. the OCR worker itself failed to load) — distinct from a clean `error` runState, which means "OCR ran but found nothing to compare". */
  error: string | null;
  verify: (deviceName: string, frame: Blob) => Promise<void>;
  reset: () => void;
}

/**
 * Vision-based name verification (docs/vision-name-verification-plan.md) —
 * Milestone 1: runs OCR on a captured preview frame client-side and
 * compares the result against the device's configured name. Client-side
 * only for now — no backend call, no persistence, nothing else in the app
 * knows this ran. See the plan doc for what Milestone 2 (persistence,
 * device-tile badge, events/CSV logging) adds on top of this.
 */
export function useNameVerification(): NameVerificationOutcome {
  const [runState, setRunState] = useState<NameVerificationRunState>('idle');
  const [detectedText, setDetectedText] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(deviceName: string, frame: Blob): Promise<void> {
    setRunState('running');
    setError(null);
    try {
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(frame);
      setDetectedText(data.text);
      setConfidence(data.confidence);
      setRunState(matchDeviceName(deviceName, data.text));
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
