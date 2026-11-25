import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';

const strip = (v: string) => v.replace(/[$,\s]/g, '');

/** 314920 → "314,920"; keeps cents when they aren't zero. Leaves non-numbers alone. */
export function formatAmount(raw: string | null | undefined): string {
  const t = strip(raw ?? '');
  if (!/^\d+(\.\d+)?$/.test(t)) return raw ?? '';
  const [int, frac = ''] = t.split('.');
  const grouped = Number(int).toLocaleString('en-US');
  return /^0*$/.test(frac) ? grouped : `${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | number | null | undefined;
  onChange: (raw: string) => void;
};

/**
 * Dollar amount input: shows "$314,920" when idle and the plain number while editing.
 * The form always holds the plain number ("314920"), so validation and the fee engine see digits.
 */
export const MoneyInput = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, onFocus, onBlur, className, ...props }, ref) => {
    const [editing, setEditing] = useState(false);
    const raw = value == null ? '' : String(value);
    return (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
          $
        </span>
        <Input
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          value={editing ? raw : formatAmount(raw)}
          onFocus={(e) => {
            setEditing(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setEditing(false);
            onBlur?.(e);
          }}
          onChange={(e) => onChange(strip(e.target.value))}
          className={cn('pl-6 text-right tabular-nums', className)}
          {...props}
        />
      </div>
    );
  },
);
MoneyInput.displayName = 'MoneyInput';
