/**
 * Vision-based projector name verification — matching logic.
 * See docs/vision-name-verification-plan.md for the full design.
 *
 * Deliberately framework-agnostic (no DOM/WASM/OCR-library dependency here):
 * this is pure string logic, shared between wherever OCR actually runs
 * (client-side, Milestone 1) and wherever the match/mismatch decision is
 * made (server-side, Milestone 2) so there is exactly one definition of
 * "counts as a match", testable without a browser.
 */

export type NameVerificationStatus = 'match' | 'mismatch' | 'error';

export interface NameVerificationResult {
  deviceId: number;
  status: NameVerificationStatus;
  /** Raw OCR output, kept for troubleshooting a bad read vs. a genuine mismatch. Null when nothing was read at all. */
  detectedText: string | null;
  /** OCR engine's own confidence score (0-100), if the caller has one. */
  confidence: number | null;
  checkedAt: string;
}

/**
 * Uppercases, strips punctuation, and collapses whitespace so that OCR
 * noise and incidental formatting differences (a stray comma, extra
 * spacing) don't cause false mismatches. Not exported for reuse beyond this
 * module's own matching — callers should go through `matchDeviceName`.
 */
function normalizeForMatch(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const curr = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    for (let j = 0; j < cols; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** 1.0 = identical, 0.0 = completely different (relative to the longer of the two strings). */
function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

interface WindowMatch {
  ratio: number;
  window: string;
}

/**
 * Slides a `name`-length window across `text` and returns the best
 * similarity found (plus the window text itself) — tolerates the device
 * name appearing anywhere within a longer block of OCR'd text (a slide with
 * a room number, building, or logo caption alongside the name) without
 * requiring a clean substring match.
 */
function bestWindowMatch(name: string, text: string): WindowMatch {
  if (text.length <= name.length) return { ratio: similarityRatio(name, text), window: text };
  let best: WindowMatch = { ratio: 0, window: '' };
  for (let start = 0; start <= text.length - name.length; start++) {
    const window = text.slice(start, start + name.length);
    const ratio = similarityRatio(name, window);
    if (ratio > best.ratio) best = { ratio, window };
    if (best.ratio === 1) break;
  }
  return best;
}

/**
 * Trailing digit run, e.g. "PROJECTOR 12" -> "12" — targets auto-numbered
 * device names (`Projector 1`, `Projector 2`, ...), the naming convention
 * this app's bulk-add uses. Fuzzy similarity alone can't tell "Projector 1"
 * apart from a same-length, OCR-clean "Projector 2": both are a single
 * substituted character, scoring the same way OCR mistaking O for 0 does —
 * so a name/window pair that differs only in their trailing number must be
 * rejected outright rather than left to the similarity threshold.
 */
function trailingDigits(text: string): string | null {
  return /(\d+)$/.exec(text)?.[1] ?? null;
}

export interface NameMatchOptions {
  /** Minimum similarity (0-1) accepted when the name isn't found as a clean substring — tolerates OCR mistaking similar characters (0/O, 1/l/I) without accepting an unrelated read. Default 0.8; expect this to need tuning once tried against real signage. */
  similarityThreshold?: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

/**
 * Decides whether OCR'd text from a projector's preview frame confirms its
 * configured name. `error` (not `mismatch`) when there's nothing usable to
 * compare — a blank/unreadable frame is a different problem than a wrong
 * name, and conflating them would raise false "flag the user" alerts for
 * e.g. a projector that's simply powered off or on the wrong input.
 */
export function matchDeviceName(deviceName: string, detectedText: string | null, options: NameMatchOptions = {}): NameVerificationStatus {
  if (detectedText === null || detectedText.trim() === '') return 'error';

  const normalizedName = normalizeForMatch(deviceName);
  const normalizedText = normalizeForMatch(detectedText);
  if (normalizedName === '' || normalizedText === '') return 'error';

  if (normalizedText.includes(normalizedName)) return 'match';

  const best = bestWindowMatch(normalizedName, normalizedText);

  const nameDigits = trailingDigits(normalizedName);
  if (nameDigits !== null && trailingDigits(best.window) !== nameDigits) return 'mismatch';

  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  return best.ratio >= threshold ? 'match' : 'mismatch';
}
