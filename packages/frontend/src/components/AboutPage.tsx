import { useQuery } from '@tanstack/react-query';
import { marked } from 'marked';
import { useServerInfo } from '../hooks/useServerInfo';
import { queryKeys } from '../lib/queryKeys';

const REPO_URL = 'https://github.com/aot93/Panasonic-Multi-Controller';

// docs/UserGuide.md and LICENSE are the hand-edited sources of truth —
// scripts/copy-static-docs.mjs mirrors them into packages/frontend/public/
// on every dev/build, so they're just plain static files here, same as
// anything else served from public/.
async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.text();
}

/**
 * Version/License/User-guide/Contact — the one place a non-technical user
 * (or whoever's setting the app up) can check what build they're on, what
 * they're allowed to do with it, and how to actually use it, without
 * reading source or docs/ on disk.
 */
export function AboutPage() {
  const { data: serverInfo } = useServerInfo();
  const { data: guideMarkdown, isPending: guidePending, isError: guideError } = useQuery({
    queryKey: queryKeys.userGuide,
    queryFn: () => fetchText('/UserGuide.md'),
    staleTime: Infinity,
  });
  const { data: licenseText, isPending: licensePending, isError: licenseError } = useQuery({
    queryKey: queryKeys.licenseText,
    queryFn: () => fetchText('/LICENSE.txt'),
    staleTime: Infinity,
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">Projector Control</h2>
        <p className="mt-1 text-sm text-slate-300">
          Version {serverInfo ? serverInfo.version : '…'}
        </p>
        <p className="mt-1 text-sm text-slate-400">© 2026 aot93. Licensed under the MIT License (below).</p>
        <p className="mt-1 text-sm text-slate-400">
          Contact / source:{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">
            {REPO_URL}
          </a>
        </p>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">User guide</h2>
        {guidePending && <p className="mt-2 text-sm text-slate-400">Loading…</p>}
        {guideError && <p className="mt-2 text-sm text-status-error">Couldn't load the user guide.</p>}
        {guideMarkdown && (
          <div
            className="mt-2 max-w-none [&_a]:text-sky-400 [&_a]:underline [&_code]:rounded [&_code]:bg-slate-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:mt-0 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-slate-100 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-slate-100 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:uppercase [&_h3]:tracking-wider [&_h3]:text-slate-300 [&_li]:mt-1 [&_li]:text-sm [&_li]:text-slate-300 [&_p]:mt-2 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-300 [&_pre]:mt-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-950 [&_pre]:p-3 [&_pre]:text-xs [&_strong]:text-slate-100 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5"
            // Safe: this is our own static file shipped with the app, not
            // user-supplied content.
            dangerouslySetInnerHTML={{ __html: marked.parse(guideMarkdown, { async: false }) }}
          />
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">License</h2>
        {licensePending && <p className="mt-2 text-sm text-slate-400">Loading…</p>}
        {licenseError && <p className="mt-2 text-sm text-status-error">Couldn't load the license text.</p>}
        {licenseText && (
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
            {licenseText}
          </pre>
        )}
      </section>
    </div>
  );
}
