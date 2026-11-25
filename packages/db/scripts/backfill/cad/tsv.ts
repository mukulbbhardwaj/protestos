import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Streams a tab-separated file with a header row as records of trimmed strings.
 * CAD exports are Latin-1 (Windows) text, not UTF-8.
 */
export async function* readTsv(path: string): AsyncGenerator<Record<string, string>> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  for await (const line of lines) {
    if (!line) continue;
    // Some CAD exports contain NUL and other control bytes, which Postgres text rejects.
    // eslint-disable-next-line no-control-regex -- stripping control bytes is the point
    const cells = line.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').split('\t');
    if (!header) {
      header = cells.map((h) => h.trim());
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]!] = (cells[i] ?? '').trim();
    yield row;
  }
}
