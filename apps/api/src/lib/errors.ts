/* One error shape for every route: { code, message, details? }. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Sign in to continue') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'That') => new AppError(404, 'NOT_FOUND', `${what} was not found`);
export const conflict = (message: string, details?: unknown, code = 'CONFLICT') => new AppError(409, code, message, details);
export const gone = (message: string) => new AppError(410, 'GONE', message);
export const locked = (message = 'Sales are paused') => new AppError(423, 'SALES_PAUSED', message);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE', message, details);
export const notImplemented = (message: string) => new AppError(501, 'NOT_IMPLEMENTED', message);

export const isDupKey = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { code?: number }).code === 11000;
