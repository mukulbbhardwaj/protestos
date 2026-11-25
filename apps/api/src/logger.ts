import type { FastifyServerOptions } from 'fastify';
import type { Env } from './env.js';

/** Structured JSON logs (pino). Credentials and contact details are redacted. */
export function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.email',
        '*.phone',
      ],
      censor: '[redacted]',
    },
    ...(env.LOG_PRETTY ? { transport: { target: 'pino-pretty' } } : {}),
  };
}
