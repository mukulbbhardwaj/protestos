/**
 * What Sentry may collect (Sentry `dataCollection` option). Client PII lives in
 * request bodies, cookies and query strings, so all of those are off.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ['user-agent', 'x-request-id'] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
};
