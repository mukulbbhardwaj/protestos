import { buildICalendar, HEARING_TYPE_LABELS } from '@app/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../errors.js';
import type { Services } from '../services/index.js';

/**
 * Read-only iCal feed per member (BUILD_PLAN 8.5): the secret token in the URL finds the
 * membership, and with it the org. Hearings assigned to that member, from 60 days ago on.
 */
export const calendarRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (
  app,
  { services },
) => {
  app.get(
    '/calendar/:file',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: z.object({ file: z.string().regex(/^[\w-]{20,100}\.ics$/) }) },
    },
    async (request, reply) => {
      const token = request.params.file.replace(/\.ics$/, '');
      const m = await services.calendar.findByToken(token);
      if (!m) throw notFound('This calendar link is not valid.');
      const db = services.tenantDb(m.orgId);
      const [org, hearings] = await Promise.all([
        db.org.findFirstOrThrow({ select: { name: true } }),
        db.hearing.findMany({
          where: {
            assignedUserId: m.userId,
            deletedAt: null,
            scheduledAt: { gte: new Date(Date.now() - 60 * 86_400_000) },
          },
          include: {
            property: {
              select: {
                accountNumber: true,
                situsLine: true,
                county: { select: { name: true } },
                contact: { select: { displayName: true } },
              },
            },
          },
          orderBy: { scheduledAt: 'asc' },
          take: 2000,
        }),
      ]);
      const body = buildICalendar(
        `${org.name} hearings`,
        hearings.map((h) => ({
          uid: `hearing-${h.id}@protestos`,
          start: h.scheduledAt,
          minutes: h.type === 'INFORMAL' ? 15 : 30,
          summary: `${HEARING_TYPE_LABELS[h.type]}: ${h.property.contact.displayName} (${h.property.county.name} ${h.property.accountNumber})`,
          description: [h.property.situsLine, h.panel && `Panel: ${h.panel}`, h.notes]
            .filter(Boolean)
            .join('\n'),
          location: h.location ?? undefined,
          updated: h.updatedAt,
          cancelled: h.status === 'CANCELLED',
        })),
      );
      return reply
        .type('text/calendar; charset=utf-8')
        .header('content-disposition', 'inline; filename="hearings.ics"')
        .send(body);
    },
  );
};
