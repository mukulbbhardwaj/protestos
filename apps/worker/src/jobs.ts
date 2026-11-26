import { forOrg } from '@app/db';
import type { PrismaClient } from '@app/db/raw';
import { applyImport } from '@app/imports';
import type { StorageProvider } from '@app/providers';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

/** What handlers get besides their jobs. Tenant work always goes through forOrg. */
export interface JobDeps {
  prisma: PrismaClient;
  storage: StorageProvider;
}

/**
 * Every background job is registered here: emails, PDFs, imports and webhook
 * processing join this list in later milestones. Job payloads always carry an
 * orgId, and handlers scope their work to it.
 */
export interface JobDefinition<T extends object = object> {
  name: string;
  /** Optional cron schedule (UTC). */
  cron?: string;
  handle: (jobs: Job<T>[], log: Logger, deps: JobDeps) => Promise<void>;
}

export const heartbeatJob: JobDefinition<{ at?: string }> = {
  name: 'system.heartbeat',
  cron: '*/5 * * * *',
  async handle(jobs, log) {
    for (const job of jobs) log.info({ jobId: job.id }, 'heartbeat');
  },
};

/** Runs a previewed CSV import (BUILD_PLAN 8.9). The API marks it RUNNING and enqueues it. */
export const importRunJob: JobDefinition<{
  orgId: number;
  jobId: number;
  actorUserId: number | null;
}> = {
  name: 'imports.run',
  async handle(batch, log, { prisma, storage }) {
    for (const job of batch) {
      const { orgId, jobId, actorUserId } = job.data;
      const outcome = await applyImport(
        { db: forOrg(prisma, orgId), orgId, actorUserId },
        storage,
        jobId,
      );
      log.info({ orgId, importJobId: jobId, ...outcome.summary }, 'import finished');
    }
  },
};

export const jobs: JobDefinition[] = [heartbeatJob as JobDefinition, importRunJob as JobDefinition];
