import { keyReuse, missingIdempotencyKey, validation } from './errors';
import type { Ctx, Reply } from './http';
import { idempotencyKey, store, type User } from './state';
import { canonicalJson, characterCount, type JsonObject } from './util';

const MAX_KEY_LENGTH = 255;

/**
 * Runs an idempotent write. A key already claimed by this user for this method and path is
 * resolved here, before `produce` validates anything. Only a successful `produce` claims the key.
 */
export function runIdempotent(ctx: Ctx, user: User, body: JsonObject, produce: () => unknown): Reply {
  const key = readKey(ctx);
  const fingerprint = canonicalJson(body);
  const slot = idempotencyKey(user.id, ctx.method, ctx.path, key);
  const claimed = store.state.idempotency.get(slot);
  if (claimed) {
    if (claimed.fingerprint !== fingerprint) throw keyReuse();
    return { status: 200, raw: claimed.response };
  }

  const response = JSON.stringify(produce());
  store.state.idempotency.set(slot, {
    userId: user.id,
    key,
    method: ctx.method,
    path: ctx.path,
    fingerprint,
    status: 201,
    response,
  });
  return { status: 201, raw: response };
}

function readKey(ctx: Ctx): string {
  const header = ctx.headers['idempotency-key'];
  const key = Array.isArray(header) ? header.join(', ') : header;
  if (key === undefined || key === '') throw missingIdempotencyKey();
  if (characterCount(key) > MAX_KEY_LENGTH) throw validation('Idempotency-Key must be 1 to 255 characters');
  return key;
}
