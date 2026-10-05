const TOKEN_KEY = 'pocketful.token';

export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  start(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  end(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export interface ApiResult {
  status: number;
  // The JSON body, or null when there is none.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/** The request may or may not have reached the server: the outcome is unknown. */
export class NetworkError extends Error {}

export interface ApiOptions {
  body?: unknown;
  key?: string;
}

export async function api(method: string, path: string, options: ApiOptions = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = session.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.key) headers['Idempotency-Key'] = options.key;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let result: ApiResult;
  try {
    const response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    result = { status: response.status, body: text === '' ? null : JSON.parse(text) };
  } catch {
    throw new NetworkError('network failure');
  }
  if (result.status === 401 && !path.startsWith('/auth/')) {
    session.end();
    location.replace('/login');
  }
  return result;
}

export const isSuccess = (result: ApiResult): boolean => result.status >= 200 && result.status < 300;

/** A 5xx says nothing reliable about whether the write happened. */
export const isUncertain = (result: ApiResult): boolean => result.status >= 500;

const FRIENDLY: Record<string, string> = {
  insufficient_funds: 'Not enough available funds for this. Money on hold cannot be spent.',
  not_found: 'We could not find that person or item.',
  self_payment: 'You cannot send money to yourself.',
  self_request: 'You cannot request money from yourself.',
  request_not_pending: 'This request is no longer pending.',
  forbidden: 'You are not allowed to do that.',
  authorization_not_open: 'This authorization is already closed.',
  authorization_expired: 'This authorization has expired.',
  capture_exceeds_authorization: 'That is more than the amount still held.',
  email_taken: 'An account with this email already exists.',
  handle_taken: 'The handle derived from this email is already taken.',
  unauthenticated: 'Email or password is incorrect.',
};

export function describeError(result: ApiResult): string {
  const error = result.body && result.body.error;
  const code: string | undefined = error && error.code;
  if (code === 'validation_failed' && error.message) return `Please check the form: ${error.message}.`;
  return (code && FRIENDLY[code]) || (error && error.message) || 'Something went wrong. Please try again.';
}

export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
