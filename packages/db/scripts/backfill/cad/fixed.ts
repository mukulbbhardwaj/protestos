import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** 1-based, inclusive [start, end] column positions, as CAD layout documents give them. */
export type FixedLayout = Record<string, readonly [start: number, end: number]>;

/**
 * Streams a fixed-width export (Latin-1), yielding only the fields named in `layout`,
 * trimmed. Values are fresh strings, not slices that would pin the whole line in memory.
 */
export async function* readFixed<L extends FixedLayout>(
  path: string,
  layout: L,
): AsyncGenerator<Record<keyof L, string>> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });
  const fields = Object.entries(layout);
  for await (const line of lines) {
    if (!line) continue;
    const row = {} as Record<keyof L, string>;
    for (const [name, [start, end]] of fields) {
      row[name as keyof L] = Buffer.from(line.slice(start - 1, end).trim(), 'latin1')
        .toString('latin1')
        // eslint-disable-next-line no-control-regex -- stripping control bytes is the point
        .replace(/[\u0000-\u001f]/g, '');
    }
    yield row;
  }
}
