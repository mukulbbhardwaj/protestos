import type { MailProvider } from '@app/providers';
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
  config: ServiceConfig;
}
