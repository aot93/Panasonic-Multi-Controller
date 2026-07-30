import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { useNameVerificationSettings, useSetNameVerificationSettings } from '../hooks/useSettings';

/**
 * Tunes matchDeviceName's fuzzy-match similarity threshold
 * (docs/vision-name-verification-plan.md §6/§11) — how close an OCR read
 * has to be to a device's configured name to count as a match when it
 * isn't a clean substring. Lower tolerates noisier OCR reads (more
 * forgiving, more false "match"es); higher requires a cleaner read (fewer
 * false matches, more false "mismatch"es on legitimate noisy reads). The
 * plan always expected this would need adjusting once tried against real
 * signage rather than assuming the 80% default was right for every fleet.
 */
export function NameVerificationSettingsForm() {
  const { data: settings, isPending } = useNameVerificationSettings();
  const setSettings = useSetNameVerificationSettings();

  const [draft, setDraft] = useState(80);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(Math.round(settings.similarityThreshold * 100));
  }, [settings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await setSettings.mutateAsync(draft / 100);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Name verification sensitivity</h2>
      <p className="mt-1 text-sm text-slate-400">
        How close an OCR read of a device's name has to be to count as a match when it isn't found as a clean
        substring of the slide's text (Preview tab's "Verify Name"). Lower tolerates noisier reads; higher requires a
        cleaner one.
      </p>

      {!isPending && (
        <form onSubmit={handleSave} className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="range"
            min={50}
            max={100}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            className="w-full max-w-xs accent-sky-500 sm:w-64"
          />
          <span className="w-12 text-sm tabular-nums">{draft}%</span>
          <button
            type="submit"
            disabled={setSettings.isPending || draft === Math.round((settings?.similarityThreshold ?? 0.8) * 100)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
          >
            {setSettings.isPending ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
    </section>
  );
}
