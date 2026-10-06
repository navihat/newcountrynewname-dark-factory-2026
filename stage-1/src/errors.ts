export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const malformed = (message: string) => new ApiError(400, 'malformed_request', message);
export const missingIdempotencyKey = () =>
  new ApiError(400, 'missing_idempotency_key', 'Idempotency-Key header is required');
export const unauthenticated = (message = 'missing or invalid bearer token') =>
  new ApiError(401, 'unauthenticated', message);
export const forbidden = (message: string) => new ApiError(403, 'forbidden', message);
export const notFound = (message: string) => new ApiError(404, 'not_found', message);
export const keyReuse = () =>
  new ApiError(409, 'idempotency_key_reuse', 'Idempotency-Key was used with a different request');
export const insufficientFunds = () =>
  new ApiError(409, 'insufficient_funds', 'balance is too low for this operation');
export const validation = (message: string) => new ApiError(422, 'validation_failed', message);
