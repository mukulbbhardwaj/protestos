import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

/**
 * Every background job is registered here: emails, PDFs, imports and webhook
 * processing join this list in later milestones. Job payloads always carry an
 * orgId, and handlers scope their work to it.
 */
export interface JobDefinition<T extends object = object> {
  name: string;
  /** Optional cron schedule (UTC). */
  cron?: string;
  handle: (jobs: Job<T>[], log: Logger) => Promise<void>;
}

export const heartbeatJob: JobDefinition<{ at?: string }> = {
  name: 'system.heartbeat',
  cron: '*/5 * * * *',
  async handle(jobs, log) {
    for (const job of jobs) log.info({ jobId: job.id }, 'heartbeat');
  },
};

export const jobs: JobDefinition[] = [heartbeatJob as JobDefinition];
