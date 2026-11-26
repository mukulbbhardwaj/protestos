import { PgBoss } from 'pg-boss';

/** Background jobs the API starts (the worker runs them). Job payloads always carry an orgId. */
export interface JobQueue {
  send(name: string, data: { orgId: number } & Record<string, unknown>): Promise<void>;
}

export const JOBS = {
  /** Run a previewed CSV import (apps/worker). */
  importRun: 'imports.run',
} as const;

/** pg-boss on the app database: the same queue the worker listens to. */
export async function createPgBossQueue(
  connectionString: string,
): Promise<JobQueue & { stop(): Promise<void> }> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  for (const name of Object.values(JOBS)) await boss.createQueue(name);
  return {
    async send(name, data) {
      await boss.send(name, data);
    },
    stop: () => boss.stop({ graceful: true }),
  };
}

/** Tests and simple setups: runs the job's handler straight away, in-process. */
export class InlineQueue implements JobQueue {
  readonly sent: { name: string; data: Record<string, unknown> }[] = [];
  constructor(private readonly handlers: Record<string, (data: never) => Promise<unknown>> = {}) {}
  async send(name: string, data: { orgId: number } & Record<string, unknown>) {
    this.sent.push({ name, data });
    const handler = this.handlers[name];
    if (handler) await handler(data as never).catch(() => undefined);
  }
}
