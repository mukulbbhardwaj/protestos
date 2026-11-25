import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** RFC 4180 CSV rows, streamed. Quoted fields may contain commas, quotes and newlines. */
export async function* readCsv(path: string): AsyncGenerator<Record<string, string>> {
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let header: string[] | null = null;
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  for await (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cell);
        cell = '';
      } else cell += ch;
    }
    if (quoted) {
      cell += '\n';
      continue;
    }
    cells.push(cell);
    if (!header) header = cells.map((h) => h.trim());
    else {
      const row: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) row[header[i]!] = (cells[i] ?? '').trim();
      yield row;
    }
    cells = [];
    cell = '';
  }
}

/** "$1,234.50" / "5%" / "648,835" → number (0 when blank). */
export const money = (v: string | undefined) => Number((v ?? '').replace(/[$,%\s]/g, '')) || 0;
