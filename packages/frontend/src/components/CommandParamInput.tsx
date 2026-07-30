import type { CommandDef } from '@ppc/shared';
import { InputSelectPicker } from './InputSelectPicker';

interface CommandParamInputProps {
  command: CommandDef | undefined;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Renders the right control for a command's paramKind — shared between the batch action bar and the macro step editor. */
export function CommandParamInput({ command, value, onChange, className = '' }: CommandParamInputProps) {
  const base = `rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm ${className}`;

  if (!command || command.paramKind === 'none') return null;

  // NextSteps.md phase 3 item 2 — input select gets its own 3-part (slot/type/number) control instead of the generic flat dropdown every other enum command uses.
  if (command.key === 'input.set') {
    return <InputSelectPicker value={value} onChange={onChange} className={className} />;
  }

  if (command.paramKind === 'enum') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">Choose…</option>
        {command.paramOptions?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={command.paramKind === 'integer' ? 'number' : 'value'}
      className={`w-28 ${base}`}
    />
  );
}
