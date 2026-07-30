import { useMemo, useState } from 'react';
import { DIGITAL_LINK_SUB_OPTIONS, NON_SLOT_INPUT_OPTIONS, SLOT_INPUT_NUMBERS, SLOT_INPUT_TYPES } from '@ppc/shared';

interface InputSelectPickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

type Connection = '' | 'HD1' | 'DL1' | 'slot1' | 'slot2';

interface PickerState {
  connection: Connection;
  dlSub: string;
  slotType: string;
  slotNumber: number;
}

const DEFAULT_SLOT_TYPE = SLOT_INPUT_TYPES[0]!.code;

function parseValue(value: string): PickerState {
  const slotMatch = /^AU([12]),([A-Z]+)(\d+)$/.exec(value);
  if (slotMatch) {
    return {
      connection: slotMatch[1] === '1' ? 'slot1' : 'slot2',
      dlSub: 'DL1',
      slotType: slotMatch[2]!,
      slotNumber: Number(slotMatch[3]),
    };
  }
  if (value.startsWith('DL1')) {
    return { connection: 'DL1', dlSub: value, slotType: DEFAULT_SLOT_TYPE, slotNumber: 1 };
  }
  if (value === 'HD1') {
    return { connection: 'HD1', dlSub: 'DL1', slotType: DEFAULT_SLOT_TYPE, slotNumber: 1 };
  }
  return { connection: '', dlSub: 'DL1', slotType: DEFAULT_SLOT_TYPE, slotNumber: 1 };
}

/**
 * NextSteps.md phase 3 item 2: input select reworked as a 3-part control —
 * slot number, type, and input number (e.g. "Slot 1, SDI, 1" -> `IIS:AU1,SD1`)
 * — instead of one flat 34-option dropdown. Non-slot inputs are restricted
 * to HDMI and Digital Link per the request; Digital Link additionally
 * offers its own sub-inputs (Computer 1/2, Video, HDMI 1/2, S-Video, or
 * Auto), which existed before this rework and would otherwise be lost.
 *
 * Only used for the `input.set` command (see CommandParamInput.tsx) — every
 * other enum command keeps the plain dropdown.
 */
export function InputSelectPicker({ value, onChange, className = '' }: InputSelectPickerProps) {
  const [state, setState] = useState(() => parseValue(value));
  const base = `rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm ${className}`;

  function emit(next: PickerState) {
    setState(next);
    if (next.connection === '') {
      onChange('');
    } else if (next.connection === 'HD1') {
      onChange('HD1');
    } else if (next.connection === 'DL1') {
      onChange(next.dlSub);
    } else {
      const slot = next.connection === 'slot1' ? 1 : 2;
      onChange(`AU${slot},${next.slotType}${next.slotNumber}`);
    }
  }

  const availableNumbers = useMemo(() => {
    if (state.connection !== 'slot1' && state.connection !== 'slot2') return [];
    const slot = state.connection === 'slot1' ? 1 : 2;
    return SLOT_INPUT_NUMBERS[slot][state.slotType] ?? [];
  }, [state.connection, state.slotType]);

  return (
    <div className="flex items-center gap-1">
      <select
        value={state.connection}
        onChange={(e) => {
          const connection = e.target.value as Connection;
          if (connection === 'slot1' || connection === 'slot2') {
            const slot = connection === 'slot1' ? 1 : 2;
            const firstNumber = SLOT_INPUT_NUMBERS[slot][DEFAULT_SLOT_TYPE]![0]!;
            emit({ ...state, connection, slotType: DEFAULT_SLOT_TYPE, slotNumber: firstNumber });
          } else {
            emit({ ...state, connection, dlSub: 'DL1' });
          }
        }}
        className={base}
      >
        <option value="">Choose…</option>
        {NON_SLOT_INPUT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        <option value="slot1">Slot 1</option>
        <option value="slot2">Slot 2</option>
      </select>

      {state.connection === 'DL1' && (
        <select value={state.dlSub} onChange={(e) => emit({ ...state, dlSub: e.target.value })} className={base}>
          <option value="DL1">Auto</option>
          {DIGITAL_LINK_SUB_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {(state.connection === 'slot1' || state.connection === 'slot2') && (
        <>
          <select
            value={state.slotType}
            onChange={(e) => {
              const slotType = e.target.value;
              const slot = state.connection === 'slot1' ? 1 : 2;
              const firstNumber = SLOT_INPUT_NUMBERS[slot][slotType]![0]!;
              emit({ ...state, slotType, slotNumber: firstNumber });
            }}
            className={base}
          >
            {SLOT_INPUT_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
          <select value={state.slotNumber} onChange={(e) => emit({ ...state, slotNumber: Number(e.target.value) })} className={base}>
            {availableNumbers.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
