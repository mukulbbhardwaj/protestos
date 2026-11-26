import { PgBoss } from 'pg-boss';

/** Background jobs the API starts (the worker runs them). Job payloads always carry an orgId. */
export interface JobQueue {
  send(name: string, data: { orgId: number } & Record<string, unknown>): Promise<void>;
}

export const JOBS = {
  /** Run a previewed CSV import (apps/worker). */
  importRun: 'imports.run',
  /** Send one queued email (packages/mailer). */
  mailDeliver: 'mail.deliver',
} as const;

/** Emails retry with backoff (the provider gets the same idempotency key each time). */
export const QUEUE_OPTIONS: Record<
  string,
  { retryLimit: number; retryDelay: number; retryBackoff: boolean }
> = { [JOBS.mailDeliver]: { retryLimit: 4, retryDelay: 30, retryBackoff: true } };

/** pg-boss on the app database: the same queue the worker listens to. */
export async function createPgBossQueue(
  connectionString: string,
): Promise<JobQueue & { stop(): Promise<void> }> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  for (const name of Object.values(JOBS)) await boss.createQueue(name, QUEUE_OPTIONS[name]);
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
