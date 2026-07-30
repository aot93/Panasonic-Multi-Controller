import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProjectFile, ProjectImportResult } from '@ppc/shared';
import { ApiError } from '../lib/api';
import { projectApi } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/**
 * Save/load a whole configuration (NextSteps.md phase 1 item 3). Export
 * downloads the current devices/groups/custom commands/macros/schedules/
 * triggers as a JSON file the browser saves normally; import reads one back
 * in and applies it additively — existing rows are never overwritten, only
 * added to (see project/export-import.ts on the backend for the exact
 * create-vs-skip rules). Credentials are deliberately never included.
 */
export function ProjectFileManager() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProjectImportResult | null>(null);

  async function handleExport() {
    setError(null);
    setBusy(true);
    try {
      const file = await projectApi.export();
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ppc-project-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ProjectFile;
      const importResult = await projectApi.import(parsed);
      setResult(importResult);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        queryClient.invalidateQueries({ queryKey: queryKeys.commands }),
        queryClient.invalidateQueries({ queryKey: queryKeys.macros }),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof SyntaxError ? 'Not a valid JSON file' : String(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Project file</h2>
      <p className="mt-1 text-sm text-slate-400">
        Save the current devices, groups, custom commands and macros to a file, or load one back in. Import is
        additive — nothing existing is overwritten or deleted. Credentials are never included.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          Save project file…
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          Load project file…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
          }}
        />
      </div>

      {error && <p className="mt-2 text-xs text-status-error">{error}</p>}

      {result && (
        <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-300">
          <p>
            Devices +{result.devices.created} ({result.devices.skipped} skipped) · Groups +{result.groups.created} (
            {result.groups.skipped} skipped) · Commands +{result.commands.created} ({result.commands.skipped}{' '}
            skipped) · Macros +{result.macros.created} ({result.macros.skipped} skipped) · Schedules +
            {result.schedules.created} ({result.schedules.skipped} skipped) · Triggers +{result.triggers.created} (
            {result.triggers.skipped} skipped)
          </p>
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-slate-400">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
