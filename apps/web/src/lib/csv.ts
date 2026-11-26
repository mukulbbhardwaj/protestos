import { toCsvLine } from '@app/shared';

/** Downloads rows as a CSV file (BUILD_PLAN 8.10: every dashboard table exports). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const text = [header, ...rows]
    .map((r) => toCsvLine(r.map((v) => (v === null ? '' : String(v)))))
    .join('\n');
  const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
