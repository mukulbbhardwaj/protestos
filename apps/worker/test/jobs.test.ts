import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { heartbeatJob, jobs } from '../src/jobs.js';

describe('job registry', () => {
  it('has unique queue names', () => {
    const names = jobs.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('heartbeat handles a batch without throwing', async () => {
    const log = pino({ level: 'silent' });
    const job = { id: '1', name: heartbeatJob.name, data: {} } as Parameters<
      typeof heartbeatJob.handle
    >[0][number];
    await expect(heartbeatJob.handle([job], log)).resolves.toBeUndefined();
  });
});
