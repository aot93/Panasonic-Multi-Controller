import type { NameVerificationResult } from '@ppc/shared';
import { devicesApi } from './api';
import { getOcrWorker } from './ocrWorker';

/**
 * Runs OCR on a captured preview frame and submits the result to the
 * backend, which owns the actual match/mismatch decision and persistence
 * (docs/vision-name-verification-plan.md §5). Single source of truth for
 * the two call sites that need it: `useNameVerification` (the Preview
 * tab's own "Verify Name" button) and `PreviewGrid`'s "Verify all" bulk
 * action, so both run OCR the same way.
 */
export async function runNameVerification(deviceId: number, frame: Blob): Promise<NameVerificationResult> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(frame);
  return devicesApi.verifyName(deviceId, { detectedText: data.text, confidence: data.confidence });
}
