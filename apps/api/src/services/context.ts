import type { MailProvider, StorageProvider } from '@app/providers';
import type { JobQueue } from '../jobs.js';
import type { PrismaClient } from '@app/db/raw';

export interface ServiceConfig {
  /** Public URL of the web app; used for links in emails and the Origin check. */
  appUrl: string;
  sessionTtlDays: number;
}

/** What system services share. Route handlers never see `prisma` directly. */
export interface ServiceContext {
  prisma: PrismaClient;
  mail: MailProvider;
  storage: StorageProvider;
  jobs: JobQueue;
  config: ServiceConfig;
}
