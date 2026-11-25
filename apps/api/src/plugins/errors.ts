import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';

function validationMessage(error: FastifyError): string {
  const first = error.validation?.[0];
  if (!first) return 'Some fields are invalid. Check the form and try again.';
  const field = first.instancePath?.replace(/^\//, '').replace(/\//g, '.');
  return field ? `${field}: ${first.message}` : (first.message ?? 'Invalid request.');
}

/** Every error leaves the API as { error: { code, message } } with a plain-sentence message. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error.validation) {
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION', message: validationMessage(error) } });
    }
    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.' },
      });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code ?? 'BAD_REQUEST', message: error.message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL',
        message: `Something went wrong on our side. Try again, and if it keeps happening, contact support with reference ${request.id}.`,
      },
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } }),
  );
}

/**
 * CSRF defence alongside SameSite=Lax cookies: state-changing requests that carry an
 * Origin header must come from the web app.
 */
export function registerOriginCheck(app: FastifyInstance, allowedOrigin: string) {
  const allowed = new URL(allowedOrigin).origin;
  app.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && origin !== allowed) {
      return reply.code(403).send({
        error: { code: 'BAD_ORIGIN', message: 'This request came from an unexpected site.' },
      });
    }
  });
}
