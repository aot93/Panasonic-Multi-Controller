import { useMemo, useState } from 'react';
import type { CommandDef } from '@ppc/shared';

interface CommandPickerProps {
  commands: CommandDef[];
  /** The selected command's id, or '' for "nothing selected". */
  value: number | '';
  onChange: (commandId: number) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Searchable, category-grouped command selector — NextSteps.md phase 3 item
 * 11: the catalogue got long enough (built-ins + custom, phase 1 item 7)
 * that a flat `<select>` needed a search box and category grouping to stay
 * usable. Shared between BatchActionBar and MacroEditor rather than
 * duplicated.
 *
 * Grouped by `category` (matching the official command list's own grouping,
 * per the request), each category's own commands sorted queries-last so a
 * function's "set" command reads above its "query" — not full per-function
 * pairing (the catalogue doesn't record that relationship), but the
 * practical effect asked for.
 */
export function CommandPicker({ commands, value, onChange, placeholder = 'More commands…', className = '' }: CommandPickerProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  }, [commands, search]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, CommandDef[]>();
    for (const c of filtered) {
      const list = byCategory.get(c.category) ?? [];
      list.push(c);
      byCategory.set(c.category, list);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => (a.isQuery !== b.isQuery ? (a.isQuery ? 1 : -1) : a.sortOrder - b.sortOrder));
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search…"
        aria-label="Search commands"
        className="w-24 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm placeholder:text-slate-500"
      />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="max-w-[14rem] rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
      >
        <option value="">{placeholder}</option>
        {groups.map(([category, cmds]) => (
          <optgroup key={category} label={category}>
            {cmds.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.isQuery ? ' (query)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
