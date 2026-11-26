import { readFile } from 'node:fs/promises';
import { listFormFields } from './tx-50-162.js';

// pnpm --filter @app/pdf forms:fields <file.pdf>
const file = process.argv[2];
if (!file) {
  console.error('Usage: forms:fields <file.pdf>');
  process.exit(1);
}
for (const line of await listFormFields(await readFile(file))) console.log(line);
