import type { IncomingHttpHeaders } from 'node:http';
import { malformed, unauthenticated } from './errors';
import { store, type User } from './state';
import { isObject, type JsonObject } from './util';

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  rawBody: string;
}

/** `raw` is already-serialised JSON (idempotent replays); otherwise `body` is serialised. */
export interface Reply {
  status: number;
  body?: unknown;
  raw?: string;
  /** Overrides the JSON content type, for pages and assets. */
  contentType?: string;
}

export type Handler = (ctx: Ctx, params: string[]) => Reply;

export function json(status: number, body: unknown): Reply {
  return { status, body };
}

export function parseJsonObject(rawBody: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw malformed('request body is not valid JSON');
  }
  if (!isObject(parsed)) throw malformed('request body must be a JSON object');
  return parsed;
}

/** Like `parseJsonObject`, but an empty body counts as `{}`. */
export function parseOptionalJsonObject(rawBody: string): JsonObject {
  return rawBody.trim() === '' ? {} : parseJsonObject(rawBody);
}

export function authenticate(ctx: Ctx): User {
  const header = ctx.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  const userId = match ? store.state.tokens.get(match[1]) : undefined;
  const user = userId === undefined ? undefined : store.state.users.get(userId);
  if (!user) throw unauthenticated();
  return user;
}

export function authed(handler: (ctx: Ctx, user: User, params: string[]) => Reply): Handler {
  return (ctx, params) => handler(ctx, authenticate(ctx), params);
}
