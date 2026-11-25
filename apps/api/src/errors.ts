/** An error with a plain-sentence message that is safe to show the user. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') =>
  new AppError(400, code, message);
export const unauthorized = (message = 'Log in to continue.') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (
  message = "Your role doesn't allow this. Ask an owner or admin of your firm.",
) => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = "We couldn't find that. It may have been removed.") =>
  new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
